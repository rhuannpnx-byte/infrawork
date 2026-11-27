-- Fundação para atender empresas com soluções diferentes no mesmo sistema (plano de 27/11/2026):
--
--   1. CAPACIDADES: o que está ligado para cada empresa (um módulo, uma regra, um conector). O catálogo das chaves
--      e o padrão de cada uma ficam no código (web/src/config/capacidades.ts); a tabela só guarda o que foge do
--      padrão. Empresa sem linha nenhuma se comporta como sempre.
--   2. INTEGRAÇÕES: o conector de uma empresa com um sistema externo (o SIGA é o primeiro). A credencial fica no
--      Vault; a tabela guarda a parte que pode ser mostrada (servidor, banco, usuário) e o histórico das execuções.
--
-- O modelo do sistema continua sendo este banco: o conector traz o dado externo para cá e leva de volta o que é
-- lançado aqui. Nenhuma tela fala com o sistema externo.

-- ── 1. Capacidades por empresa ───────────────────────────────────────────────────────────────────────────────
create table public.empresa_capacidade (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave text not null,
  valor jsonb not null default 'true'::jsonb,
  atualizado_por uuid default auth.uid() references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (empresa_id, chave),
  constraint chk_empresa_capacidade_chave check (chave ~ '^[a-z][a-z0-9_]{1,59}$')
);
comment on table public.empresa_capacidade is
  'O que foge do padrão para a empresa: capacidade (chave) ligada, desligada ou com um valor. As chaves e os padrões estão em web/src/config/capacidades.ts.';

alter table public.empresa_capacidade enable row level security;

-- a empresa lê as suas; só o god liga e desliga (é o que foi contratado, não uma preferência do cliente)
create policy empresa_capacidade_select on public.empresa_capacidade for select to authenticated
  using (public.auth_role() = 'god' or empresa_id = public.auth_empresa_id());
create policy empresa_capacidade_insert on public.empresa_capacidade for insert to authenticated
  with check (public.auth_role() = 'god');
create policy empresa_capacidade_update on public.empresa_capacidade for update to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');
create policy empresa_capacidade_delete on public.empresa_capacidade for delete to authenticated
  using (public.auth_role() = 'god');

create function public.fn_empresa_capacidade_antes()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  new.atualizado_por := auth.uid();
  return new;
end
$$;
create trigger trg_empresa_capacidade_antes before insert or update on public.empresa_capacidade
  for each row execute function public.fn_empresa_capacidade_antes();

-- A empresa tem a capacidade ligada? `_padrao` é o valor de quem não tem linha (o mesmo do catálogo no código).
-- Só outras funções e o serviço chamam: a tela lê a tabela pela regra de acesso.
create function public.empresa_tem(_empresa_id uuid, _chave text, _padrao boolean default false)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(
    (select case jsonb_typeof(c.valor)
              when 'boolean' then (c.valor)::text::boolean
              when 'null' then false
              else true
            end
       from public.empresa_capacidade c
      where c.empresa_id = _empresa_id and c.chave = _chave),
    _padrao)
$$;
revoke execute on function public.empresa_tem(uuid, text, boolean) from authenticated;

-- ── 2. Integrações (conector por empresa) ────────────────────────────────────────────────────────────────────
create table public.integracao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null,
  -- o que pode ser mostrado: servidor, porta, banco e usuário (nunca a senha)
  config jsonb not null default '{}'::jsonb,
  -- a credencial inteira, no Vault
  secret_id uuid,
  ativa boolean not null default true,
  conectado_em timestamptz not null default now(),
  conectado_por uuid references public.profiles(id) on delete set null,
  constraint uq_integracao_empresa_tipo unique (empresa_id, tipo),
  constraint chk_integracao_tipo check (tipo in ('siga'))
);
comment on table public.integracao is
  'Conector de uma empresa com um sistema externo. A credencial fica no Vault (secret_id); config só tem o que pode aparecer na tela.';

create table public.integracao_execucao (
  id uuid primary key default gen_random_uuid(),
  integracao_id uuid not null references public.integracao(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  obra_id uuid references public.obras(id) on delete set null,
  acao text not null,
  origem text not null default 'manual',
  iniciado_em timestamptz not null default now(),
  terminado_em timestamptz,
  ok boolean,
  resumo jsonb,
  erro text,
  iniciado_por uuid references public.profiles(id) on delete set null,
  constraint chk_integracao_exec_acao check (acao in ('diagnostico')),
  constraint chk_integracao_exec_origem check (origem in ('manual', 'cron'))
);
comment on table public.integracao_execucao is
  'Histórico de cada rodada de um conector (diagnóstico agora; sincronização e envio nas próximas fases).';
create index idx_integracao_exec_recente on public.integracao_execucao (integracao_id, iniciado_em desc);

alter table public.integracao enable row level security;
alter table public.integracao_execucao enable row level security;

-- leitura: o god e quem administra a empresa. Gravação: só o serviço (a função do servidor testa a conexão antes).
create policy integracao_select on public.integracao for select to authenticated
  using (public.auth_role() = 'god'
         or (public.auth_role() in ('adm', 'engenheiro') and empresa_id = public.auth_empresa_id()));
create policy integracao_exec_select on public.integracao_execucao for select to authenticated
  using (public.auth_role() = 'god'
         or (public.auth_role() in ('adm', 'engenheiro') and empresa_id = public.auth_empresa_id()));

-- a referência ao segredo não sai da tabela; o resto é só leitura para o usuário
revoke all on table public.integracao from authenticated;
grant select (id, empresa_id, tipo, config, ativa, conectado_em, conectado_por)
  on table public.integracao to authenticated;
revoke all on table public.integracao_execucao from authenticated;
grant select on table public.integracao_execucao to authenticated;

-- Grava (ou troca) a credencial de um conector. Só o serviço chama, depois de testar a conexão.
create function public.integracao_gravar(
  _empresa_id uuid, _tipo text, _config jsonb, _segredo text, _por uuid
) returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_secret uuid;
  v_id uuid;
begin
  if coalesce(_segredo, '') = '' then raise exception 'Credencial vazia'; end if;
  select secret_id into v_secret from public.integracao where empresa_id = _empresa_id and tipo = _tipo;
  if v_secret is null then
    v_secret := vault.create_secret(
      _segredo, 'integracao_' || _tipo || '_' || _empresa_id::text, 'Credencial do conector ' || _tipo || ' da empresa');
  else
    perform vault.update_secret(v_secret, _segredo);
  end if;
  insert into public.integracao (empresa_id, tipo, config, secret_id, ativa, conectado_em, conectado_por)
  values (_empresa_id, _tipo, coalesce(_config, '{}'::jsonb), v_secret, true, now(), _por)
  on conflict (empresa_id, tipo) do update
    set config = excluded.config, secret_id = excluded.secret_id, ativa = true,
        conectado_em = now(), conectado_por = excluded.conectado_por
  returning id into v_id;
  return v_id;
end
$$;
revoke execute on function public.integracao_gravar(uuid, text, jsonb, text, uuid) from authenticated;

create function public.integracao_remover(_empresa_id uuid, _tipo text) returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare v_secret uuid;
begin
  delete from public.integracao where empresa_id = _empresa_id and tipo = _tipo returning secret_id into v_secret;
  if v_secret is not null then delete from vault.secrets where id = v_secret; end if;
end
$$;
revoke execute on function public.integracao_remover(uuid, text) from authenticated;

-- A credencial em claro, para a função do servidor abrir a conexão. Só o serviço chama.
create function public.integracao_segredo(_empresa_id uuid, _tipo text)
returns table (integracao_id uuid, segredo text)
language sql stable security definer
set search_path to 'public'
as $$
  select i.id, s.decrypted_secret
    from public.integracao i
    join vault.decrypted_secrets s on s.id = i.secret_id
   where i.empresa_id = _empresa_id and i.tipo = _tipo and i.ativa
$$;
revoke execute on function public.integracao_segredo(uuid, text) from authenticated;
