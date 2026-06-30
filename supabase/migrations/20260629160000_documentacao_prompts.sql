-- Documentação Oficial — prompts de processamento editáveis por obra
-- ─────────────────────────────────────────────────────────────────────────
-- Os "system prompts" das etapas de IA (extração, aderência, análise de
-- cláusula, agente/RAG, transcrição) deixam de ser hardcode e passam a ser
-- editáveis: ficam em extracao_template.prompts (mapa chave→texto). Vazio/sem
-- chave = usa o DEFAULT embutido na edge. Clonável/copiável como o resto do
-- template (campos/grupos).
-- ─────────────────────────────────────────────────────────────────────────

alter table public.extracao_template
  add column if not exists prompts jsonb not null default '{}'::jsonb;

comment on column public.extracao_template.prompts is
  'Overrides dos system prompts de processamento (chave→texto). Vazio = DEFAULT da edge.';
