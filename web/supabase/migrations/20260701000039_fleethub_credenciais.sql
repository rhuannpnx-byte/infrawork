-- InfraWork Web — credenciais da FleetHub por empresa, cifradas no Vault (sem segredo no código nem nas variáveis).
-- O adm conecta pela tela (a função fleethub-sync testa o login antes de gravar); a senha nunca volta ao navegador.

create table if not exists public.fleethub_config (
  empresa_id     uuid primary key references public.empresas(id) on delete cascade,
  email          text not null,
  secret_id      uuid not null,
  conectado_em   timestamptz not null default now(),
  conectado_por  uuid references public.profiles(id) on delete set null
);
comment on table public.fleethub_config is
  'Conta da FleetHub da empresa: e-mail e referência ao segredo no Vault (a senha não fica nesta tabela).';
alter table public.fleethub_config enable row level security;
drop policy if exists fleethub_config_select on public.fleethub_config;
create policy fleethub_config_select on public.fleethub_config for select to authenticated
  using (public.auth_role() = 'god'
         or (public.auth_role() in ('adm', 'engenheiro') and empresa_id = public.auth_empresa_id()));
revoke all on public.fleethub_config from public, anon, authenticated;
grant select (empresa_id, email, conectado_em, conectado_por) on public.fleethub_config to authenticated;

-- Só o serviço (Edge Function) grava e lê a senha.
create or replace function public.fleethub_gravar_credencial(_empresa_id uuid, _email text, _senha text, _por uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_secret uuid;
begin
  select secret_id into v_secret from public.fleethub_config where empresa_id = _empresa_id;
  if v_secret is null then
    v_secret := vault.create_secret(_senha, 'fleethub_' || _empresa_id::text, 'Senha da FleetHub da empresa');
  else
    perform vault.update_secret(v_secret, _senha);
  end if;
  insert into public.fleethub_config (empresa_id, email, secret_id, conectado_em, conectado_por)
  values (_empresa_id, lower(trim(_email)), v_secret, now(), _por)
  on conflict (empresa_id) do update
    set email = excluded.email, secret_id = excluded.secret_id, conectado_em = now(), conectado_por = excluded.conectado_por;
end $$;

create or replace function public.fleethub_credencial(_empresa_id uuid)
returns table (email text, senha text) language sql stable security definer set search_path = public as $$
  select c.email, s.decrypted_secret
    from public.fleethub_config c
    join vault.decrypted_secrets s on s.id = c.secret_id
   where c.empresa_id = _empresa_id
$$;

create or replace function public.fleethub_remover_credencial(_empresa_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_secret uuid;
begin
  delete from public.fleethub_config where empresa_id = _empresa_id returning secret_id into v_secret;
  if v_secret is not null then delete from vault.secrets where id = v_secret; end if;
end $$;

alter function public.fleethub_gravar_credencial(uuid, text, text, uuid) owner to postgres;
alter function public.fleethub_credencial(uuid) owner to postgres;
alter function public.fleethub_remover_credencial(uuid) owner to postgres;
revoke all on function public.fleethub_gravar_credencial(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.fleethub_credencial(uuid) from public, anon, authenticated;
revoke all on function public.fleethub_remover_credencial(uuid) from public, anon, authenticated;
grant execute on function public.fleethub_gravar_credencial(uuid, text, text, uuid) to service_role;
grant execute on function public.fleethub_credencial(uuid) to service_role;
grant execute on function public.fleethub_remover_credencial(uuid) to service_role;
