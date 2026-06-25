-- Documentação Oficial v2 — Emissor de TAP (Termo de Abertura do Projeto)
-- ─────────────────────────────────────────────────────────────────────────
-- O bloco "auto" do TAP é derivado do ObraDossier em tempo de render (contrato,
-- financeiro, partes, eventos). Aqui persistimos apenas os campos MANUAIS — os
-- que não vêm dos documentos do contrato (% participação, retenções, riscos R$,
-- lucratividades) — 1 linha por obra. RLS por obra (god/adm/eng escrita · apoio
-- leitura · cliente invisível), empresa_id derivado por trigger.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.documentacao_tap (
  obra_id       uuid primary key references public.obras(id)    on delete cascade,
  empresa_id    uuid not null     references public.empresas(id) on delete cascade,
  manual        jsonb not null default '{}'::jsonb,   -- { campo: { valor, doc_fonte } }
  emitido_em    timestamptz,
  atualizado_em timestamptz not null default now()
);

drop trigger if exists trg_doc_tap_empresa on public.documentacao_tap;
create trigger trg_doc_tap_empresa
  before insert on public.documentacao_tap
  for each row execute function public.fn_doc_empresa_from_obra();

select public.fn_doc_apply_obra_rls('documentacao_tap');
