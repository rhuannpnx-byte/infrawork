-- Documentação Oficial — camada de GRUPOS no template de extração
-- ─────────────────────────────────────────────────────────────────────────
-- A taxonomia de documentos deixa de ser hardcoded (constante TAXONOMIA_CANONICA
-- + prompt do classificador + seed tipo_documento) e passa a ser DADO editável,
-- versionado dentro de extracao_template.grupos (acima dos campos[]).
-- Cada grupo: codigo (slug estável), tipo_codigo_base (01..20 p/ FK + gap/vence),
-- regras, contribuição, cardinalidade, criticidade, aplicavel_se, ordem.
-- tipo_documento e documento.tipo_codigo permanecem intactos (sem migração
-- destrutiva): grupo_codigo é a dimensão fina; tipo_codigo a coarse (FK/gap).
-- ─────────────────────────────────────────────────────────────────────────

alter table public.extracao_template
  add column if not exists grupos jsonb not null default '[]'::jsonb;

comment on column public.extracao_template.grupos is
  'Grupos de documentos (taxonomia editável por obra): {codigo, nome, tipo_codigo_base, regras, contribuicao, campos_chaves, cardinalidade, criticidade, vence, aplicavel_se, aliases, ordem}.';

-- O documento passa a registrar também o grupo (slug do template), além do
-- tipo_codigo canônico (01..20) que continua sendo a FK/coarse para o gap engine.
alter table public.documento
  add column if not exists grupo_codigo text;

comment on column public.documento.grupo_codigo is
  'Grupo do template (slug) ao qual o documento foi classificado/arquivado; tipo_codigo segue como categoria canônica 01..20.';
