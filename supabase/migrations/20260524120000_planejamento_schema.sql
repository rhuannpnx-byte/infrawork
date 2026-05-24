-- InfraWork — Planejamento (Fase P1.A): schema base
--
-- Módulo de planejamento de obra: distribui no tempo os servico_grupo do
-- Plan_Orc, calcula durações a partir da produção diária das CPUs, aloca
-- equipes nomeadas, suporta dependências (FS/SS/FF + lag) e mantém linha
-- de base + revisões nomeadas.
--
-- Tabelas criadas:
--   obra_calendario              — config 1:1 de dias úteis por obra
--   obra_calendario_excecao      — feriados / paralisações
--   obra_produtividade_mes       — fator multiplicador por ano-mês
--   equipe                       — equipes/frentes nomeadas
--   planejamento                 — cabeçalho de uma revisão de cronograma
--   planejamento_tarefa          — uma linha por servico_grupo
--   planejamento_tarefa_equipe   — N:N tarefa × equipe
--   planejamento_dependencia     — FS/SS/FF com lag
--   planejamento_baseline_snapshot — payload imutável da baseline

-- ─────────────────────────────────────────────────────────────────────────
-- Extensão em obras: âncoras de planejamento
-- ─────────────────────────────────────────────────────────────────────────
alter table public.obras
  add column if not exists data_inicio_planejada date,
  add column if not exists data_fim_planejada    date;

-- ─────────────────────────────────────────────────────────────────────────
-- obra_calendario (1:1 com obra; criado via trigger)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.obra_calendario (
  obra_id              uuid          primary key references public.obras(id) on delete cascade,
  -- Bitmask de dias úteis: bit0=seg, bit1=ter, ..., bit6=dom
  -- 31 = 0011111 = seg-sex (padrão construção)
  dias_uteis_bitmask   smallint      not null default 31,
  created_at           timestamptz   not null default now(),
  updated_at           timestamptz   not null default now()
);

do $$ begin
  alter table public.obra_calendario
    add constraint chk_obra_cal_bitmask
    check (dias_uteis_bitmask between 0 and 127);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- obra_calendario_excecao (feriados / paralisações / dias liberados)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.obra_calendario_excecao (
  id          uuid          primary key default gen_random_uuid(),
  obra_id     uuid          not null references public.obras(id) on delete cascade,
  data        date          not null,
  motivo      text          not null,
  eh_util     boolean       not null default false,
  created_at  timestamptz   not null default now(),
  unique (obra_id, data)
);
create index if not exists idx_obra_cal_exc_obra on public.obra_calendario_excecao(obra_id);

-- ─────────────────────────────────────────────────────────────────────────
-- obra_produtividade_mes (fator multiplicador por ano-mês)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.obra_produtividade_mes (
  obra_id     uuid          not null references public.obras(id) on delete cascade,
  ano_mes     date          not null,
  fator       numeric(4,2)  not null default 1.0,
  motivo      text,
  created_at  timestamptz   not null default now(),
  primary key (obra_id, ano_mes)
);

do $$ begin
  alter table public.obra_produtividade_mes
    add constraint chk_obra_prod_dia1
    check (extract(day from ano_mes) = 1);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.obra_produtividade_mes
    add constraint chk_obra_prod_fator
    check (fator between 0.1 and 2.0);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- equipe (equipes/frentes nomeadas por obra)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.equipe (
  id          uuid          primary key default gen_random_uuid(),
  obra_id     uuid          not null references public.obras(id) on delete cascade,
  nome        text          not null,
  tipo        text          not null,
  cor         text          not null default '#3b82f6',
  ativo       boolean       not null default true,
  created_at  timestamptz   not null default now(),
  created_by  uuid          references public.profiles(id) on delete set null,
  unique (obra_id, nome)
);

do $$ begin
  alter table public.equipe
    add constraint chk_equipe_cor_hex
    check (cor ~ '^#[0-9a-fA-F]{6}$');
exception when duplicate_object then null; end $$;

create index if not exists idx_equipe_obra on public.equipe(obra_id);

-- ─────────────────────────────────────────────────────────────────────────
-- planejamento (cabeçalho de uma revisão de cronograma)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.planejamento (
  id                       uuid          primary key default gen_random_uuid(),
  obra_id                  uuid          not null references public.obras(id) on delete cascade,
  nome                     text          not null,
  descricao                text,
  is_baseline              boolean       not null default false,
  status                   text          not null default 'rascunho',
  data_referencia_inicio   date          not null,
  criado_por               uuid          references public.profiles(id) on delete set null,
  created_at               timestamptz   not null default now(),
  updated_at               timestamptz   not null default now(),
  unique (obra_id, nome)
);

do $$ begin
  alter table public.planejamento
    add constraint chk_planejamento_status
    check (status in ('rascunho', 'ativo', 'arquivado'));
exception when duplicate_object then null; end $$;

-- Apenas 1 baseline por obra
create unique index if not exists idx_planejamento_baseline_unica
  on public.planejamento(obra_id)
  where is_baseline = true;

create index if not exists idx_planejamento_obra on public.planejamento(obra_id);

-- ─────────────────────────────────────────────────────────────────────────
-- planejamento_tarefa (uma linha por servico_grupo do orçamento)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.planejamento_tarefa (
  id                          uuid          primary key default gen_random_uuid(),
  planejamento_id             uuid          not null references public.planejamento(id) on delete cascade,
  item_orcamentario_id        uuid          not null references public.item_orcamentario(id) on delete restrict,
  data_inicio                 date,
  data_fim                    date,
  duracao_dias_uteis_calc     numeric(12,2),
  data_inicio_manual          boolean       not null default false,
  notas                       text,
  ordem                       int           not null default 0,
  created_at                  timestamptz   not null default now(),
  updated_at                  timestamptz   not null default now(),
  unique (planejamento_id, item_orcamentario_id)
);
create index if not exists idx_plan_tarefa_plan  on public.planejamento_tarefa(planejamento_id);
create index if not exists idx_plan_tarefa_item  on public.planejamento_tarefa(item_orcamentario_id);

-- ─────────────────────────────────────────────────────────────────────────
-- planejamento_tarefa_equipe (N:N tarefa × equipe)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.planejamento_tarefa_equipe (
  tarefa_id    uuid     not null references public.planejamento_tarefa(id) on delete cascade,
  equipe_id    uuid     not null references public.equipe(id) on delete restrict,
  qtd_equipes  smallint not null default 1,
  primary key (tarefa_id, equipe_id)
);

do $$ begin
  alter table public.planejamento_tarefa_equipe
    add constraint chk_plan_tar_eq_qtd
    check (qtd_equipes between 1 and 10);
exception when duplicate_object then null; end $$;

create index if not exists idx_plan_tar_eq_equipe on public.planejamento_tarefa_equipe(equipe_id);

-- ─────────────────────────────────────────────────────────────────────────
-- planejamento_dependencia
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.planejamento_dependencia (
  id                uuid     primary key default gen_random_uuid(),
  planejamento_id   uuid     not null references public.planejamento(id) on delete cascade,
  predecessora_id   uuid     not null references public.planejamento_tarefa(id) on delete cascade,
  sucessora_id      uuid     not null references public.planejamento_tarefa(id) on delete cascade,
  tipo              text     not null default 'FS',
  lag_dias          smallint not null default 0,
  created_at        timestamptz not null default now(),
  unique (predecessora_id, sucessora_id)
);

do $$ begin
  alter table public.planejamento_dependencia
    add constraint chk_plan_dep_tipo
    check (tipo in ('FS', 'SS', 'FF'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.planejamento_dependencia
    add constraint chk_plan_dep_distintos
    check (predecessora_id <> sucessora_id);
exception when duplicate_object then null; end $$;

create index if not exists idx_plan_dep_plan on public.planejamento_dependencia(planejamento_id);
create index if not exists idx_plan_dep_pred on public.planejamento_dependencia(predecessora_id);
create index if not exists idx_plan_dep_suc  on public.planejamento_dependencia(sucessora_id);

-- ─────────────────────────────────────────────────────────────────────────
-- planejamento_baseline_snapshot (imutável; só Edge Function escreve)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.planejamento_baseline_snapshot (
  id                uuid          primary key default gen_random_uuid(),
  planejamento_id   uuid          not null references public.planejamento(id) on delete restrict,
  obra_id           uuid          not null references public.obras(id) on delete cascade,
  payload           jsonb         not null,
  criado_por        uuid          references public.profiles(id) on delete set null,
  created_at        timestamptz   not null default now()
);
create index if not exists idx_plan_baseline_obra on public.planejamento_baseline_snapshot(obra_id);
create index if not exists idx_plan_baseline_plan on public.planejamento_baseline_snapshot(planejamento_id);
