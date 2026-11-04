-- InfraWork — Acompanhamento (Fase A): helpers SECURITY DEFINER + RLS
--
-- Padrão de RLS:
--   obra_acompanhamento_link: god/adm escreve; eng/apoio só lê.
--   acompanhamento_producao / acompanhamento_foto: 4 personas só SELECT.
--   Escrita das tabelas cache: APENAS service_role (Edge Function de sync).

-- ─────────────────────────────────────────────────────────────────────────
-- Helpers SECURITY DEFINER
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.acomp_link_obra(_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select obra_id from public.obra_acompanhamento_link where id = _id
$$;

create or replace function public.acomp_producao_obra(_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select obra_id from public.acompanhamento_producao where id = _id
$$;

create or replace function public.acomp_foto_obra(_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select obra_id from public.acompanhamento_foto where id = _id
$$;

create or replace function public.pode_vincular_acompanhamento(_obra_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.auth_role()
    when 'god' then true
    when 'adm' then public.obra_empresa(_obra_id) = public.auth_empresa_id()
    else false
  end
$$;

alter function public.acomp_link_obra(uuid)               owner to postgres;
alter function public.acomp_producao_obra(uuid)           owner to postgres;
alter function public.acomp_foto_obra(uuid)               owner to postgres;
alter function public.pode_vincular_acompanhamento(uuid)  owner to postgres;

revoke all on function public.acomp_link_obra(uuid)               from public;
revoke all on function public.acomp_producao_obra(uuid)           from public;
revoke all on function public.acomp_foto_obra(uuid)               from public;
revoke all on function public.pode_vincular_acompanhamento(uuid)  from public;

grant execute on function public.acomp_link_obra(uuid)               to authenticated;
grant execute on function public.acomp_producao_obra(uuid)           to authenticated;
grant execute on function public.acomp_foto_obra(uuid)               to authenticated;
grant execute on function public.pode_vincular_acompanhamento(uuid)  to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────
alter table public.obra_acompanhamento_link  enable row level security;
alter table public.acompanhamento_producao   enable row level security;
alter table public.acompanhamento_foto       enable row level security;

-- ============== obra_acompanhamento_link ==============
drop policy if exists acomp_link_god_all on public.obra_acompanhamento_link;
create policy acomp_link_god_all on public.obra_acompanhamento_link
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

drop policy if exists acomp_link_adm_all on public.obra_acompanhamento_link;
create policy acomp_link_adm_all on public.obra_acompanhamento_link
  for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

-- Engenheiro/Apoio: SELECT only (não pode criar/desfazer vínculo)
drop policy if exists acomp_link_eng_select on public.obra_acompanhamento_link;
create policy acomp_link_eng_select on public.obra_acompanhamento_link
  for select to authenticated
  using (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists acomp_link_apoio_select on public.obra_acompanhamento_link;
create policy acomp_link_apoio_select on public.obra_acompanhamento_link
  for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- ============== acompanhamento_producao (SELECT-only para authenticated) ==============
drop policy if exists acomp_prod_god_select on public.acompanhamento_producao;
create policy acomp_prod_god_select on public.acompanhamento_producao
  for select to authenticated
  using (public.auth_role() = 'god');

drop policy if exists acomp_prod_adm_select on public.acompanhamento_producao;
create policy acomp_prod_adm_select on public.acompanhamento_producao
  for select to authenticated
  using (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists acomp_prod_eng_select on public.acompanhamento_producao;
create policy acomp_prod_eng_select on public.acompanhamento_producao
  for select to authenticated
  using (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists acomp_prod_apoio_select on public.acompanhamento_producao;
create policy acomp_prod_apoio_select on public.acompanhamento_producao
  for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- ============== acompanhamento_foto ==============
drop policy if exists acomp_foto_god_select on public.acompanhamento_foto;
create policy acomp_foto_god_select on public.acompanhamento_foto
  for select to authenticated
  using (public.auth_role() = 'god');

drop policy if exists acomp_foto_adm_select on public.acompanhamento_foto;
create policy acomp_foto_adm_select on public.acompanhamento_foto
  for select to authenticated
  using (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists acomp_foto_eng_select on public.acompanhamento_foto;
create policy acomp_foto_eng_select on public.acompanhamento_foto
  for select to authenticated
  using (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists acomp_foto_apoio_select on public.acompanhamento_foto;
create policy acomp_foto_apoio_select on public.acompanhamento_foto
  for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));
