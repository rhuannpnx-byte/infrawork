-- Documentação Oficial v2 — (7/7) Cache do ObraDossier montado
-- ─────────────────────────────────────────────────────────────────────────
-- O frontend consome UM JSON por obra. As tabelas granulares são a fonte da
-- verdade; este cache guarda o dossiê montado (recomputado ao fim da ingestão
-- e no "Reavaliar"). `GET dossie` lê daqui; `?fresh=1` remonta.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.obra_dossie (
  obra_id                 uuid        primary key references public.obras(id) on delete cascade,
  empresa_id              uuid        not null references public.empresas(id) on delete cascade,
  dossie                  jsonb       not null default '{}'::jsonb,
  obra_hash               text,
  schema_version          int         not null default 2,
  cobertura_essencial_pct numeric     not null default 0,
  gerado_em               timestamptz not null default now()
);

drop trigger if exists trg_obra_dossie_empresa on public.obra_dossie;
create trigger trg_obra_dossie_empresa before insert on public.obra_dossie
  for each row execute function public.fn_doc_empresa_from_obra();

select public.fn_doc_apply_obra_rls('obra_dossie');

comment on table public.obra_dossie is
  'Documentação Oficial v2 — cache do ObraDossier montado (schema_version 2). Fonte da verdade são as tabelas granulares.';
