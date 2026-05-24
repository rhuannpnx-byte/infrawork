-- InfraWork — Acompanhamento (Fase A): schema base
--
-- Tabelas criadas:
--   obra_acompanhamento_link  — 1:1 obra ↔ projeto SIGA (god/adm write)
--   acompanhamento_producao   — cache de pnj_controle_producao do SIGA
--   acompanhamento_foto       — cache de pnj_foto do SIGA (metadados)
--
-- Sync popula essas tabelas via Edge Function `acompanhamento-sync`
-- (rodando como service_role; bypassa RLS). pg_cron agenda execução
-- a cada 30min.
--
-- pg_cron + pg_net são habilitados aqui (idempotente).

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ─────────────────────────────────────────────────────────────────────────
-- obra_acompanhamento_link
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.obra_acompanhamento_link (
  id                   uuid          primary key default gen_random_uuid(),
  obra_id              uuid          not null references public.obras(id) on delete cascade,
  siga_projeto_id      int           not null,
  siga_projeto_codigo  text          not null,
  siga_projeto_nome    text,
  ativo                boolean       not null default true,
  ultimo_sync_em       timestamptz,
  ultimo_sync_status   text,
  ultimo_sync_erro     text,
  ultimo_sync_stats    jsonb,
  criado_por           uuid          references public.profiles(id) on delete set null,
  criado_em            timestamptz   not null default now(),
  updated_at           timestamptz   not null default now(),
  unique (obra_id)
);

do $$ begin
  alter table public.obra_acompanhamento_link
    add constraint chk_acomp_link_status
    check (ultimo_sync_status is null or ultimo_sync_status in ('ok','erro','rodando'));
exception when duplicate_object then null; end $$;

create index if not exists idx_acomp_link_ativo
  on public.obra_acompanhamento_link(ativo) where ativo = true;

-- ─────────────────────────────────────────────────────────────────────────
-- acompanhamento_producao (cache pnj_controle_producao)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.acompanhamento_producao (
  id                   uuid          primary key default gen_random_uuid(),
  obra_id              uuid          not null references public.obras(id) on delete cascade,
  siga_producao_id     bigint        not null unique,
  data                 date,
  servico_id           bigint,
  servico_nome         text,
  encarregado_id       bigint,
  encarregado_nome     text,
  equipe_id            bigint,
  equipe_nome          text,
  qtd                  numeric(14,4),
  trecho               text,
  estaca_inicial       text,
  estaca_final         text,
  obs                  text,
  siga_created_at      timestamptz,
  siga_updated_at      timestamptz,
  payload_bruto        jsonb,                                    -- guarda row crua do SIGA pra debug + campos extras
  sincronizado_em      timestamptz   not null default now()
);

create index if not exists idx_acomp_prod_obra_data
  on public.acompanhamento_producao(obra_id, data desc);
create index if not exists idx_acomp_prod_servico
  on public.acompanhamento_producao(obra_id, servico_id);
create index if not exists idx_acomp_prod_siga_id
  on public.acompanhamento_producao(siga_producao_id);

-- ─────────────────────────────────────────────────────────────────────────
-- acompanhamento_foto (cache pnj_foto — metadados; binário no Storage)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.acompanhamento_foto (
  id                       uuid          primary key default gen_random_uuid(),
  obra_id                  uuid          not null references public.obras(id) on delete cascade,
  siga_foto_id             bigint        not null unique,
  app_uuid                 text,
  producao_siga_id         bigint,
  lat                      numeric(10,6),
  lng                      numeric(10,6),
  servico_executado_id     bigint,
  servico_executado_nome   text,
  encarregado_id           bigint,
  encarregado_nome         text,
  captured_at              timestamptz,
  storage_bucket           text,
  storage_key              text,
  obs                      text,
  size_bytes               bigint,
  mime                     text,
  siga_created_at          timestamptz,
  payload_bruto            jsonb,
  sincronizado_em          timestamptz   not null default now()
);

create index if not exists idx_acomp_foto_obra_data
  on public.acompanhamento_foto(obra_id, captured_at desc);
create index if not exists idx_acomp_foto_siga_id
  on public.acompanhamento_foto(siga_foto_id);
create index if not exists idx_acomp_foto_producao
  on public.acompanhamento_foto(obra_id, producao_siga_id);
create index if not exists idx_acomp_foto_geo
  on public.acompanhamento_foto(obra_id) where lat is not null and lng is not null;

-- touch updated_at em obra_acompanhamento_link
create or replace function public.fn_acomp_link_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_acomp_link_updated_at on public.obra_acompanhamento_link;
create trigger trg_acomp_link_updated_at
  before update on public.obra_acompanhamento_link
  for each row execute function public.fn_acomp_link_updated_at();
