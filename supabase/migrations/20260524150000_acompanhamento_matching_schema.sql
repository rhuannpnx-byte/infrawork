-- InfraWork — Acompanhamento (Fase B): matching SIGA ↔ Planejamento
--
-- Cria 3 tabelas de mapeamento (equipe / encarregado / serviço) que ligam
-- os nomes "crus" denormalizados que chegam do SIGA aos cadastros do
-- Planejamento/Orçamento do InfraWork. O usuário confirma matches manualmente
-- (ou aceita auto-sugestões com confianca >= 0.85).
--
-- Também adiciona coluna gerada `frente` em acompanhamento_producao e índices
-- de performance para as queries do dashboard.
--
-- Extensões usadas para similaridade fuzzy:
--   pg_trgm     — operador % e função similarity()
--   unaccent    — normalização de acentos pra match cross-tipografia

create extension if not exists pg_trgm    with schema extensions;
create extension if not exists unaccent   with schema extensions;

-- ─────────────────────────────────────────────────────────────────────────
-- acompanhamento_equipe_match
--   - equipe_id NULL + origem='rejeitado' = "vi e decidi não vincular"
--   - equipe_id NULL + origem='auto'      = sugestão pendente
--   - equipe_id != NULL                   = vínculo efetivo
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.acompanhamento_equipe_match (
  id                    uuid          primary key default gen_random_uuid(),
  obra_id               uuid          not null references public.obras(id) on delete cascade,
  siga_equipe_nome      text          not null,
  equipe_id             uuid          references public.equipe(id) on delete set null,
  confianca_sugestao    numeric(4,3),
  origem                text          not null default 'manual',
  confirmado_por        uuid          references public.profiles(id) on delete set null,
  confirmado_em         timestamptz,
  criado_em             timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  unique (obra_id, siga_equipe_nome)
);

do $$ begin
  alter table public.acompanhamento_equipe_match
    add constraint chk_acomp_eq_match_origem
    check (origem in ('auto', 'manual', 'rejeitado'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.acompanhamento_equipe_match
    add constraint chk_acomp_eq_match_confianca
    check (confianca_sugestao is null or (confianca_sugestao >= 0 and confianca_sugestao <= 1));
exception when duplicate_object then null; end $$;

create index if not exists idx_acomp_eq_match_obra
  on public.acompanhamento_equipe_match(obra_id);
create index if not exists idx_acomp_eq_match_equipe
  on public.acompanhamento_equipe_match(equipe_id)
  where equipe_id is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- acompanhamento_encarregado_match
--   Sem FK pra `pessoa` (módulo de RH não existe ainda).
--   `apelido_canonico` normaliza variações de digitação ("Joao", "João").
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.acompanhamento_encarregado_match (
  id                    uuid          primary key default gen_random_uuid(),
  obra_id               uuid          not null references public.obras(id) on delete cascade,
  siga_encarregado_nome text          not null,
  apelido_canonico      text,
  equipe_match_id       uuid          references public.acompanhamento_equipe_match(id) on delete set null,
  confianca_sugestao    numeric(4,3),
  origem                text          not null default 'manual',
  confirmado_por        uuid          references public.profiles(id) on delete set null,
  confirmado_em         timestamptz,
  criado_em             timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  unique (obra_id, siga_encarregado_nome)
);

do $$ begin
  alter table public.acompanhamento_encarregado_match
    add constraint chk_acomp_enc_match_origem
    check (origem in ('auto', 'manual', 'rejeitado'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.acompanhamento_encarregado_match
    add constraint chk_acomp_enc_match_confianca
    check (confianca_sugestao is null or (confianca_sugestao >= 0 and confianca_sugestao <= 1));
exception when duplicate_object then null; end $$;

create index if not exists idx_acomp_enc_match_obra
  on public.acompanhamento_encarregado_match(obra_id);

-- ─────────────────────────────────────────────────────────────────────────
-- acompanhamento_servico_match
--   Mapeia controle_producao_servico_executado_id (SIGA) ↔ servico (catálogo)
--   E opcionalmente ↔ item_orcamentario do servico_grupo da obra
--   (atalho pra ligar produção a tarefa do baseline).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.acompanhamento_servico_match (
  id                            uuid          primary key default gen_random_uuid(),
  obra_id                       uuid          not null references public.obras(id) on delete cascade,
  siga_servico_executado_id     bigint        not null,
  siga_servico_nome             text,
  servico_id                    uuid          references public.servico(id) on delete set null,
  item_orcamentario_id          uuid          references public.item_orcamentario(id) on delete set null,
  confianca_sugestao            numeric(4,3),
  origem                        text          not null default 'manual',
  confirmado_por                uuid          references public.profiles(id) on delete set null,
  confirmado_em                 timestamptz,
  criado_em                     timestamptz   not null default now(),
  updated_at                    timestamptz   not null default now(),
  unique (obra_id, siga_servico_executado_id)
);

do $$ begin
  alter table public.acompanhamento_servico_match
    add constraint chk_acomp_serv_match_origem
    check (origem in ('auto', 'manual', 'rejeitado'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.acompanhamento_servico_match
    add constraint chk_acomp_serv_match_confianca
    check (confianca_sugestao is null or (confianca_sugestao >= 0 and confianca_sugestao <= 1));
exception when duplicate_object then null; end $$;

create index if not exists idx_acomp_serv_match_obra
  on public.acompanhamento_servico_match(obra_id);
create index if not exists idx_acomp_serv_match_item
  on public.acompanhamento_servico_match(item_orcamentario_id)
  where item_orcamentario_id is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- ALTER acompanhamento_producao: coluna gerada `frente` + índices novos
-- ─────────────────────────────────────────────────────────────────────────
do $$ begin
  alter table public.acompanhamento_producao
    add column frente text generated always as (coalesce(nullif(trim(trecho), ''), '(sem frente)')) stored;
exception when duplicate_column then null; end $$;

create index if not exists idx_acomp_prod_frente
  on public.acompanhamento_producao(obra_id, frente, data);
create index if not exists idx_acomp_prod_encarregado
  on public.acompanhamento_producao(obra_id, encarregado_id);
create index if not exists idx_acomp_prod_obra_data_equipe
  on public.acompanhamento_producao(obra_id, data desc, equipe_id);
create index if not exists idx_acomp_prod_equipe_nome
  on public.acompanhamento_producao(obra_id, equipe_nome);

create index if not exists idx_acomp_foto_obra_servico
  on public.acompanhamento_foto(obra_id, captured_at desc, servico_executado_id);

-- ─────────────────────────────────────────────────────────────────────────
-- updated_at triggers (reaproveitam o padrão do link)
-- ─────────────────────────────────────────────────────────────────────────
drop trigger if exists trg_acomp_eq_match_updated_at  on public.acompanhamento_equipe_match;
create trigger trg_acomp_eq_match_updated_at
  before update on public.acompanhamento_equipe_match
  for each row execute function public.fn_acomp_link_updated_at();

drop trigger if exists trg_acomp_enc_match_updated_at on public.acompanhamento_encarregado_match;
create trigger trg_acomp_enc_match_updated_at
  before update on public.acompanhamento_encarregado_match
  for each row execute function public.fn_acomp_link_updated_at();

drop trigger if exists trg_acomp_serv_match_updated_at on public.acompanhamento_servico_match;
create trigger trg_acomp_serv_match_updated_at
  before update on public.acompanhamento_servico_match
  for each row execute function public.fn_acomp_link_updated_at();
