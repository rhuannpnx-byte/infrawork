-- Documentação Oficial — cláusulas completas + análise IA por cláusula (cache)
-- ─────────────────────────────────────────────────────────────────────────
-- O módulo passa a separar TODAS as cláusulas do contrato (numeradas) e gerar
-- uma análise rica POR CLÁUSULA sob demanda (IA), integrada ao contexto das
-- demais cláusulas/documentos. A análise é cacheada na própria linha.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.clausula
  add column if not exists numero text,
  add column if not exists analise jsonb,
  add column if not exists analise_em timestamptz;

-- risco/observacao deixam de ser preenchidos na extração (vêm da análise IA);
-- mantidos por compatibilidade. risco passa a aceitar null.
alter table public.clausula alter column risco drop not null;
alter table public.clausula alter column risco drop default;

comment on column public.clausula.numero is 'Identificador da cláusula (ex.: "Cláusula Quinta", "5.2").';
comment on column public.clausula.analise is 'Análise IA cacheada: {resumo, risco, implicacoes[], referencias[], pontos_atencao[]}.';
