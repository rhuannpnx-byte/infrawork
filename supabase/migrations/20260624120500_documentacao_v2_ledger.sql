-- Documentação Oficial v2 — (6/7) Ledger (memória do agente / incremental)
-- ─────────────────────────────────────────────────────────────────────────
-- Registro por arquivo: garante idempotência (incremental real via quick_fp),
-- agrupamento de versões, resumibilidade (status) e antifragilidade (quarentena
-- com error_count/backoff). Escopado por obra (RLS).
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.ledger (
  file_id          text        primary key,        -- hash(obra_id + path normalizado)
  empresa_id       uuid        not null references public.empresas(id) on delete cascade,
  obra_id          uuid        not null references public.obras(id)    on delete cascade,
  content_hash     text,                            -- SHA-256 do conteúdo (dedup/mudança)
  quick_fp         text,                            -- size+mtime+bordas (fingerprint barato)
  path             text        not null,
  size             bigint,
  mtime            double precision,
  classe           text,                            -- documento|dado|auxiliar|lixo|arquivo
  categoria        text,                            -- palpite/confirmada (tipo_codigo)
  especie          text,
  status           text        not null default 'DESCOBERTO',
  confianca        numeric,
  version_cluster  uuid,
  is_vigente       boolean     not null default false,
  documento_id     uuid        references public.documento(id) on delete set null,
  schema_version   int         not null default 1,
  error_count      int         not null default 0,
  last_error       text,
  first_seen       timestamptz not null default now(),
  last_seen        timestamptz not null default now(),
  processed_at     timestamptz
);

create index if not exists idx_ledger_obra_status on public.ledger(obra_id, status);
create index if not exists idx_ledger_obra_fp     on public.ledger(obra_id, quick_fp);

drop trigger if exists trg_ledger_empresa on public.ledger;
create trigger trg_ledger_empresa before insert on public.ledger
  for each row execute function public.fn_doc_empresa_from_obra();

select public.fn_doc_apply_obra_rls('ledger');

comment on table public.ledger is
  'Documentação Oficial v2 — memória do agente: incremental (quick_fp), clustering de versões, quarentena/backoff.';
