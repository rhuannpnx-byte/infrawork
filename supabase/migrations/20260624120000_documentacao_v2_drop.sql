-- InfraWork — Documentação Oficial v2 (reformulação Raio-X / ObraDossier)
-- ─────────────────────────────────────────────────────────────────────────
-- (1/7) DROP do schema v1. A v2 é centrada no ObraDossier (1 JSON por obra,
-- todo valor com proveniência), produzido por um agente-harness incremental.
-- O schema v1 (contrato/documento centrado) é descartado por decisão de produto.
--
-- ATENÇÃO: destrutivo. Apaga contrato/documento/versões/chunks/feedback v1.
-- O BUCKET de storage `documentacao` é MANTIDO (os arquivos WORM permanecem).
-- ─────────────────────────────────────────────────────────────────────────

-- Tabelas v1 em ordem reversa de dependência (CASCADE remove policies/triggers/idx/FKs).
drop table if exists public.documento_chunk                cascade;
drop table if exists public.documento_classificacao_feedback cascade;
drop table if exists public.documento_versao               cascade;
drop table if exists public.documento                      cascade;
drop table if exists public.contrato                       cascade;
drop table if exists public.tipo_documento                 cascade;

-- Funções v1 (CASCADE acima já dropou triggers que as usavam).
drop function if exists public.match_documento_chunks(vector, uuid, int) cascade;
drop function if exists public.fn_doc_chunk_escopo()      cascade;
drop function if exists public.fn_doc_clf_empresa()       cascade;
drop function if exists public.fn_doc_empresa_from_obra() cascade;
