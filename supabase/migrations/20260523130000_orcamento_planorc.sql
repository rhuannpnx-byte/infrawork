-- InfraWork — Orçamento (Fase 2.A): schema do Plan_Orc da obra
--
-- Tabelas criadas:
--   - cpu_snapshot:      foto imutável de uma CPU + itens + preços vigentes no
--                        momento; criada apenas via Edge Function (service_role)
--                        para garantir blindagem.
--   - item_orcamentario: árvore Plan_Orc da obra; folha tem unidade+quantidade
--                        + venda + BDI; agrupador tem unidade=NULL e recebe
--                        rollup de filhos via Edge Function.
--   - indireto_item:     custos indiretos da obra (mobilização, admin local,
--                        etc); estrutura paralela ao Plan_Orc, sem CPU.
--
-- Helpers SECURITY DEFINER (owner=postgres, BYPASSRLS) — necessários para
-- evitar recursão em policies que precisam de JOIN cross-tabela:
--   - item_orc_obra(_id), item_orc_empresa(_id)
--   - cpu_snap_obra(_id), cpu_snap_empresa(_id)
--   - indireto_obra(_id), indireto_empresa(_id)
--   - pode_editar_orcamento(_obra_id) — encapsula matriz de permissão

-- ─────────────────────────────────────────────────────────────────────────
-- cpu_snapshot
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.cpu_snapshot (
  id                       uuid          primary key default gen_random_uuid(),
  empresa_id               uuid          not null references public.empresas(id) on delete restrict,
  obra_id                  uuid          not null references public.obras(id)    on delete cascade,
  cpu_id_origem            uuid          references public.cpu(id)               on delete set null,
  versao_origem            int,
  snapshot_em              timestamptz   not null default now(),
  criado_por               uuid          references public.profiles(id)          on delete set null,
  -- Materializados (cópia do CPU origem, blindados)
  custo_unit               numeric(14,4) not null default 0,
  custo_eq_dia             numeric(14,4) not null default 0,
  custo_comb_dia           numeric(14,4) not null default 0,
  custo_mo_dia             numeric(14,4) not null default 0,
  custo_mat_dia            numeric(14,4) not null default 0,
  producao_diaria_qtde     numeric(14,4) not null default 1,
  producao_diaria_unidade  text          not null default 'DIA',
  servico_codigo           text,
  servico_nome             text,
  servico_unidade          text,
  -- Payload completo (CPU + itens + recurso + preço vigente) para auditoria/UI
  payload                  jsonb         not null
);
create index if not exists idx_cpu_snap_obra   on public.cpu_snapshot(obra_id);
create index if not exists idx_cpu_snap_origem on public.cpu_snapshot(cpu_id_origem);
create index if not exists idx_cpu_snap_empresa on public.cpu_snapshot(empresa_id);

-- ─────────────────────────────────────────────────────────────────────────
-- item_orcamentario (Plan_Orc)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.item_orcamentario (
  id                       uuid          primary key default gen_random_uuid(),
  obra_id                  uuid          not null references public.obras(id)        on delete cascade,
  parent_id                uuid          references public.item_orcamentario(id)     on delete restrict,
  nivel                    smallint      not null default 1,
  codigo                   text          not null,
  descricao                text          not null,
  unidade                  text,                                                  -- NULL ⇒ agrupador
  servico_id               uuid          references public.servico(id)             on delete restrict,
  quantidade               numeric(14,4),
  venda_unitaria           numeric(14,2),
  bdi_perc                 numeric(7,4),                                          -- NULL ⇒ herda obras.bdi_padrao_perc
  cpu_snapshot_id          uuid          references public.cpu_snapshot(id)        on delete set null,
  ordem                    int           not null default 0,
  -- Calculados (folha via trigger; agrupador via Edge Function)
  custo_unitario_calc      numeric(14,4),
  custo_total_calc         numeric(14,2) not null default 0,
  venda_total_calc         numeric(14,2) not null default 0,
  lucratividade_perc_calc  numeric(7,4),
  created_at               timestamptz   not null default now(),
  updated_at               timestamptz   not null default now(),
  unique (obra_id, codigo)
);

do $$ begin
  alter table public.item_orcamentario
    add constraint chk_item_orc_codigo
    check (codigo ~ '^[0-9]+(\.[0-9]+)*$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.item_orcamentario
    add constraint chk_item_orc_bdi
    check (bdi_perc is null or (bdi_perc >= -1 and bdi_perc <= 10));
exception when duplicate_object then null; end $$;

-- folha ↔ agrupador: (unidade IS NULL) ↔ (quantidade IS NULL AND venda_unitaria IS NULL)
do $$ begin
  alter table public.item_orcamentario
    add constraint chk_item_orc_folha_agrupador
    check (
      (unidade is null and quantidade is null and venda_unitaria is null) or
      (unidade is not null and quantidade is not null)
    );
exception when duplicate_object then null; end $$;

create index if not exists idx_item_orc_obra        on public.item_orcamentario(obra_id);
create index if not exists idx_item_orc_parent      on public.item_orcamentario(parent_id);
create index if not exists idx_item_orc_servico     on public.item_orcamentario(servico_id);
create index if not exists idx_item_orc_obra_parent on public.item_orcamentario(obra_id, parent_id, ordem);
create index if not exists idx_item_orc_nivel       on public.item_orcamentario(obra_id, nivel);

-- ─────────────────────────────────────────────────────────────────────────
-- indireto_item (custos indiretos da obra)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.indireto_item (
  id                  uuid          primary key default gen_random_uuid(),
  obra_id             uuid          not null references public.obras(id)         on delete cascade,
  parent_id           uuid          references public.indireto_item(id)          on delete restrict,
  codigo              text          not null,
  descricao           text          not null,
  tipo                text          not null,
  valor_total         numeric(14,2) not null default 0,
  distribuicao_perc   numeric(7,4)  not null default 1.0,                       -- 1.0 = 100%
  ordem               int           not null default 0,
  created_at          timestamptz   not null default now(),
  unique (obra_id, codigo)
);

do $$ begin
  alter table public.indireto_item
    add constraint chk_indireto_tipo
    check (tipo in ('mobilizacao', 'desmob', 'admin_local', 'outros'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.indireto_item
    add constraint chk_indireto_distribuicao
    check (distribuicao_perc >= 0 and distribuicao_perc <= 1);
exception when duplicate_object then null; end $$;

create index if not exists idx_indireto_obra on public.indireto_item(obra_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Helpers SECURITY DEFINER (owner=postgres, BYPASSRLS)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.item_orc_obra(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select obra_id from public.item_orcamentario where id = _id
$$;

create or replace function public.item_orc_empresa(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select o.empresa_id
    from public.item_orcamentario i
    join public.obras o on o.id = i.obra_id
   where i.id = _id
$$;

create or replace function public.cpu_snap_obra(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select obra_id from public.cpu_snapshot where id = _id
$$;

create or replace function public.cpu_snap_empresa(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select empresa_id from public.cpu_snapshot where id = _id
$$;

create or replace function public.indireto_obra(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select obra_id from public.indireto_item where id = _id
$$;

create or replace function public.indireto_empresa(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select o.empresa_id
    from public.indireto_item i
    join public.obras o on o.id = i.obra_id
   where i.id = _id
$$;

-- Encapsula a matriz de permissão de edição do orçamento de uma obra:
--   God: sempre
--   Adm: empresa_id da obra == empresa do caller
--   Engenheiro: tem permissão direta na obra (has_obra_permissao)
--   Apoio: nunca
create or replace function public.pode_editar_orcamento(_obra_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case public.auth_role()
    when 'god'        then true
    when 'adm'        then public.obra_empresa(_obra_id) = public.auth_empresa_id()
    when 'engenheiro' then public.has_obra_permissao(_obra_id, auth.uid())
    else false
  end
$$;

alter function public.item_orc_obra(uuid)         owner to postgres;
alter function public.item_orc_empresa(uuid)      owner to postgres;
alter function public.cpu_snap_obra(uuid)         owner to postgres;
alter function public.cpu_snap_empresa(uuid)      owner to postgres;
alter function public.indireto_obra(uuid)         owner to postgres;
alter function public.indireto_empresa(uuid)      owner to postgres;
alter function public.pode_editar_orcamento(uuid) owner to postgres;

revoke all on function public.item_orc_obra(uuid)         from public;
revoke all on function public.item_orc_empresa(uuid)      from public;
revoke all on function public.cpu_snap_obra(uuid)         from public;
revoke all on function public.cpu_snap_empresa(uuid)      from public;
revoke all on function public.indireto_obra(uuid)         from public;
revoke all on function public.indireto_empresa(uuid)      from public;
revoke all on function public.pode_editar_orcamento(uuid) from public;

grant execute on function public.item_orc_obra(uuid)         to authenticated;
grant execute on function public.item_orc_empresa(uuid)      to authenticated;
grant execute on function public.cpu_snap_obra(uuid)         to authenticated;
grant execute on function public.cpu_snap_empresa(uuid)      to authenticated;
grant execute on function public.indireto_obra(uuid)         to authenticated;
grant execute on function public.indireto_empresa(uuid)      to authenticated;
grant execute on function public.pode_editar_orcamento(uuid) to authenticated;
