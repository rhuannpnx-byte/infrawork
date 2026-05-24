-- InfraWork — Orçamento (Fase 3.A): Revisões + Comentários + Memória + Anexos
--
-- Tabelas criadas:
--   - revisao_orcamento:     snapshot JSONB do Plan_Orc + Indireto + obra,
--                            com status (rascunho/em_revisao/aprovada/homologada/cancelada).
--                            Versão auto-incremental por obra.
--   - comentario_item:       comentários por item_orcamentario (autor + resolução).
--   - memoria_calculo_item:  1 memória markdown por item_orcamentario.
--   - anexo:                 metadados de arquivos (corpo fica em Supabase Storage)
--                            com escopo polimórfico (obra/item/revisao).
--
-- Helpers SECURITY DEFINER:
--   - revisao_obra(_id), revisao_empresa(_id)
--   - comentario_obra(_id)
--   - memoria_obra(_id)
--   - anexo_obra(_escopo, _escopo_id), anexo_empresa(_escopo, _escopo_id)

-- ─────────────────────────────────────────────────────────────────────────
-- revisao_orcamento
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.revisao_orcamento (
  id                  uuid          primary key default gen_random_uuid(),
  obra_id             uuid          not null references public.obras(id) on delete cascade,
  versao              int           not null,
  rotulo              text,
  status              text          not null default 'rascunho',
  snapshot            jsonb         not null,
  custo_total         numeric(14,2) not null default 0,
  venda_total         numeric(14,2) not null default 0,
  lucratividade_perc  numeric(7,4),
  observacao          text,
  criada_por          uuid          references public.profiles(id) on delete set null,
  criada_em           timestamptz   not null default now(),
  aprovada_por        uuid          references public.profiles(id) on delete set null,
  aprovada_em         timestamptz,
  homologada_por      uuid          references public.profiles(id) on delete set null,
  homologada_em       timestamptz,
  cancelada_por       uuid          references public.profiles(id) on delete set null,
  cancelada_em        timestamptz,
  unique (obra_id, versao)
);

do $$ begin
  alter table public.revisao_orcamento
    add constraint chk_revisao_status
    check (status in ('rascunho', 'em_revisao', 'aprovada', 'homologada', 'cancelada'));
exception when duplicate_object then null; end $$;

create index if not exists idx_revisao_obra        on public.revisao_orcamento(obra_id);
create index if not exists idx_revisao_status      on public.revisao_orcamento(obra_id, status);
create index if not exists idx_revisao_criada_em   on public.revisao_orcamento(obra_id, criada_em desc);

-- ─────────────────────────────────────────────────────────────────────────
-- comentario_item
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.comentario_item (
  id              uuid        primary key default gen_random_uuid(),
  item_id         uuid        not null references public.item_orcamentario(id) on delete cascade,
  obra_id         uuid        not null references public.obras(id)            on delete cascade,
  autor_id        uuid        references public.profiles(id)                  on delete set null,
  texto           text        not null,
  resolvido       boolean     not null default false,
  resolvido_por   uuid        references public.profiles(id)                  on delete set null,
  resolvido_em    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_comentario_item on public.comentario_item(item_id, created_at desc);
create index if not exists idx_comentario_obra on public.comentario_item(obra_id);

-- ─────────────────────────────────────────────────────────────────────────
-- memoria_calculo_item (1:1 com item_orcamentario)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.memoria_calculo_item (
  id              uuid        primary key default gen_random_uuid(),
  item_id         uuid        not null unique references public.item_orcamentario(id) on delete cascade,
  obra_id         uuid        not null references public.obras(id)                    on delete cascade,
  body_md         text        not null default '',
  estaca_inicio   text,
  estaca_fim      text,
  autor_id        uuid        references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_memoria_obra on public.memoria_calculo_item(obra_id);

-- ─────────────────────────────────────────────────────────────────────────
-- anexo (polimórfico: obra/item/revisao)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.anexo (
  id              uuid          primary key default gen_random_uuid(),
  obra_id         uuid          not null references public.obras(id) on delete cascade,
  escopo          text          not null,
  escopo_id       uuid          not null,
  nome            text          not null,
  storage_path    text          not null unique,
  mime            text,
  tamanho_bytes   bigint,
  autor_id        uuid          references public.profiles(id) on delete set null,
  created_at      timestamptz   not null default now()
);

do $$ begin
  alter table public.anexo
    add constraint chk_anexo_escopo
    check (escopo in ('obra', 'item', 'revisao'));
exception when duplicate_object then null; end $$;

create index if not exists idx_anexo_obra   on public.anexo(obra_id);
create index if not exists idx_anexo_escopo on public.anexo(escopo, escopo_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Helpers SECURITY DEFINER
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.revisao_obra(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select obra_id from public.revisao_orcamento where id = _id
$$;

create or replace function public.revisao_empresa(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select o.empresa_id
    from public.revisao_orcamento r
    join public.obras o on o.id = r.obra_id
   where r.id = _id
$$;

create or replace function public.comentario_obra(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select obra_id from public.comentario_item where id = _id
$$;

create or replace function public.memoria_obra(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select obra_id from public.memoria_calculo_item where id = _id
$$;

alter function public.revisao_obra(uuid)     owner to postgres;
alter function public.revisao_empresa(uuid)  owner to postgres;
alter function public.comentario_obra(uuid)  owner to postgres;
alter function public.memoria_obra(uuid)     owner to postgres;

revoke all on function public.revisao_obra(uuid)     from public;
revoke all on function public.revisao_empresa(uuid)  from public;
revoke all on function public.comentario_obra(uuid)  from public;
revoke all on function public.memoria_obra(uuid)     from public;

grant execute on function public.revisao_obra(uuid)     to authenticated;
grant execute on function public.revisao_empresa(uuid)  to authenticated;
grant execute on function public.comentario_obra(uuid)  to authenticated;
grant execute on function public.memoria_obra(uuid)     to authenticated;
