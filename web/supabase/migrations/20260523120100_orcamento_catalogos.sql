-- InfraWork — Orçamento (Fase 1.1): catálogos por empresa
--
-- Cada empresa tem seu próprio catálogo isolado:
--   - encargos_sociais_regime: parametriza percentuais sobre salário base
--   - recurso                 : insumo atômico (MO/MVE/COMB/MAT/ADM) com unidade
--   - recurso_preco           : histórico de preços vigentes por recurso
--   - servico                 : item hierárquico do catálogo de serviços
--   - cpu                     : composição de preço unitário (receita versionada)
--   - cpu_item                : linha da composição (recurso + qtd + horas)
--
-- Todas as tabelas com `empresa_id` direto para simplificar RLS. RLS é aplicada
-- na migration 20260523120300; triggers de cálculo na 20260523120200.

-- ─────────────────────────────────────────────────────────────────────────
-- encargos_sociais_regime
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.encargos_sociais_regime (
  id                     uuid          primary key default gen_random_uuid(),
  empresa_id             uuid          not null references public.empresas(id) on delete restrict,
  nome                   text          not null,
  inss_perc              numeric(7,4)  not null default 0,
  sat_rat_perc           numeric(7,4)  not null default 0,
  salario_educacao_perc  numeric(7,4)  not null default 0,
  sesi_senai_sebrae_perc numeric(7,4)  not null default 0,
  incra_perc             numeric(7,4)  not null default 0,
  fgts_perc              numeric(7,4)  not null default 0,
  ferias_terco_perc      numeric(7,4)  not null default 0,
  decimo_terceiro_perc   numeric(7,4)  not null default 0,
  fgts_rescisao_perc     numeric(7,4)  not null default 0,
  outros_perc            numeric(7,4)  not null default 0,
  total_perc_calc        numeric(7,4)  not null default 0,
  vigencia_inicio        date,
  vigencia_fim           date,
  ativo                  boolean       not null default true,
  created_at             timestamptz   not null default now(),
  unique (empresa_id, nome)
);
create index if not exists idx_encargos_empresa on public.encargos_sociais_regime(empresa_id);

-- ─────────────────────────────────────────────────────────────────────────
-- recurso
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.recurso (
  id          uuid        primary key default gen_random_uuid(),
  empresa_id  uuid        not null references public.empresas(id) on delete restrict,
  codigo      text,                                       -- código externo (SINAPI 87.412, etc) — opcional
  grupo       text        not null,
  nome        text        not null,
  unidade     text        not null,
  ativo       boolean     not null default true,
  fonte       text,                                       -- 'manual', 'cotacao-XYZ', 'sinapi-2024-03', etc
  observacao  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (empresa_id, grupo, nome)
);

do $$ begin
  alter table public.recurso
    add constraint chk_recurso_grupo
    check (grupo in ('MO', 'MVE', 'COMBUSTIVEL', 'MATERIAL', 'ADM'));
exception when duplicate_object then null; end $$;

create unique index if not exists uq_recurso_empresa_codigo
  on public.recurso (empresa_id, codigo) where codigo is not null;
create index if not exists idx_recurso_empresa on public.recurso(empresa_id);
create index if not exists idx_recurso_grupo   on public.recurso(empresa_id, grupo);

-- ─────────────────────────────────────────────────────────────────────────
-- recurso_preco
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.recurso_preco (
  id              uuid          primary key default gen_random_uuid(),
  recurso_id      uuid          not null references public.recurso(id) on delete cascade,
  custo_unitario  numeric(14,4) not null,
  vigencia_inicio date          not null,
  vigencia_fim    date,
  origem          text,                                    -- 'cotacao-fornecedor-X', 'contrato-N123', etc
  documento_url   text,                                    -- link pra Supabase Storage
  observacao      text,
  criado_por      uuid          references public.profiles(id) on delete set null,
  created_at      timestamptz   not null default now(),
  unique (recurso_id, vigencia_inicio)
);

do $$ begin
  alter table public.recurso_preco
    add constraint chk_recurso_preco_vigencia
    check (vigencia_fim is null or vigencia_fim > vigencia_inicio);
exception when duplicate_object then null; end $$;

create index if not exists idx_recurso_preco_recurso on public.recurso_preco(recurso_id, vigencia_inicio desc);

-- ─────────────────────────────────────────────────────────────────────────
-- servico (catálogo hierárquico)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.servico (
  id                  uuid        primary key default gen_random_uuid(),
  empresa_id          uuid        not null references public.empresas(id) on delete restrict,
  codigo              text        not null,                 -- "02.03.50" (livre)
  nome                text        not null,
  parent_id           uuid        references public.servico(id) on delete restrict,
  nivel               smallint    not null default 1,
  unidade             text,                                 -- NULL = agrupador puro
  ativo               boolean     not null default true,
  descricao           text,
  referencia_externa  text,                                 -- SINAPI / SICRO se mapeado
  created_at          timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index if not exists idx_servico_empresa    on public.servico(empresa_id);
create index if not exists idx_servico_parent     on public.servico(parent_id);
create index if not exists idx_servico_empresa_codigo on public.servico(empresa_id, codigo);

-- ─────────────────────────────────────────────────────────────────────────
-- cpu (composição de preço unitário)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.cpu (
  id                       uuid          primary key default gen_random_uuid(),
  empresa_id               uuid          not null references public.empresas(id) on delete restrict,
  servico_id               uuid          not null references public.servico(id)  on delete restrict,
  versao                   int           not null default 1,
  producao_diaria_qtde     numeric(14,4) not null default 1,
  producao_diaria_unidade  text          not null default 'DIA',
  encargos_sociais_id      uuid          references public.encargos_sociais_regime(id) on delete set null,
  notas                    text,
  custo_eq_dia_calc        numeric(14,4) not null default 0,
  custo_comb_dia_calc      numeric(14,4) not null default 0,
  custo_mo_dia_calc        numeric(14,4) not null default 0,
  custo_mat_dia_calc       numeric(14,4) not null default 0,
  custo_unit_calc          numeric(14,4) not null default 0,
  is_vigente               boolean       not null default true,
  criado_por               uuid          references public.profiles(id) on delete set null,
  created_at               timestamptz   not null default now(),
  unique (servico_id, versao)
);

-- Garante uma única versão vigente por serviço.
create unique index if not exists uq_cpu_vigente
  on public.cpu (servico_id) where is_vigente = true;

create index if not exists idx_cpu_empresa on public.cpu(empresa_id);
create index if not exists idx_cpu_servico on public.cpu(servico_id);

-- ─────────────────────────────────────────────────────────────────────────
-- cpu_item (linha da composição)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.cpu_item (
  id                          uuid          primary key default gen_random_uuid(),
  cpu_id                      uuid          not null references public.cpu(id) on delete cascade,
  grupo                       text          not null,
  recurso_id                  uuid          not null references public.recurso(id) on delete restrict,
  quantidade                  numeric(14,4) not null default 0,
  horas_dia                   numeric(6,2),                  -- EQ/MO
  consumo_combustivel_lh      numeric(8,4),                  -- EQ
  indice_produtividade        numeric(5,4)  not null default 1.0,
  consumo_material_por_unid   numeric(14,6),                 -- MATERIAL
  ordem                       int           not null default 0,
  custo_total_calc            numeric(14,4) not null default 0,
  created_at                  timestamptz   not null default now(),
  updated_at                  timestamptz   not null default now()
);

do $$ begin
  alter table public.cpu_item
    add constraint chk_cpu_item_grupo
    check (grupo in ('EQUIPAMENTO', 'COMBUSTIVEL', 'MO', 'MATERIAL'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.cpu_item
    add constraint chk_cpu_item_horas
    check (
      (grupo in ('EQUIPAMENTO', 'MO') and horas_dia is not null) or
      (grupo not in ('EQUIPAMENTO', 'MO'))
    );
exception when duplicate_object then null; end $$;

create index if not exists idx_cpu_item_cpu     on public.cpu_item(cpu_id, ordem);
create index if not exists idx_cpu_item_recurso on public.cpu_item(recurso_id);
create index if not exists idx_cpu_item_grupo   on public.cpu_item(cpu_id, grupo);
