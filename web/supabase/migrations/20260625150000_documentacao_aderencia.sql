-- Documentação Oficial — verdito de ADERÊNCIA da inserção manual
-- ─────────────────────────────────────────────────────────────────────────
-- Ao arquivar um documento manualmente num grupo escolhido, a IA avalia se ele
-- ADERE ao grupo e ORIENTA (sugere grupo melhor) — sem restringir. O verdito
-- fica em colunas do próprio documento (sem tabela à parte).
-- ─────────────────────────────────────────────────────────────────────────

alter table public.documento
  add column if not exists aderencia_score numeric,
  add column if not exists aderencia_grupo_sugerido text;

comment on column public.documento.aderencia_score is
  'Confiança (0..1) de que o documento adere ao grupo onde foi arquivado manualmente; null = não avaliado.';
comment on column public.documento.aderencia_grupo_sugerido is
  'Grupo sugerido pela IA quando o documento parece não aderir ao grupo escolhido; null = aderente/ok.';
