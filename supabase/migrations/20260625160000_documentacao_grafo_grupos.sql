-- Documentação Oficial — grafo radial centrado no contrato
-- ─────────────────────────────────────────────────────────────────────────
-- O nó do grafo passa a poder representar um HUB de grupo (com contagem de
-- documentos) ou um documento específico, além de contrato/empresa/profissional.
-- Expansão dos documentos é client-side (não materializa ~900 nós).
-- ─────────────────────────────────────────────────────────────────────────

alter table public.no_grafo
  add column if not exists grupo_codigo text,
  add column if not exists doc_id uuid,
  add column if not exists peso int;

comment on column public.no_grafo.grupo_codigo is 'Para nós tipo=grupo: o slug do grupo (hub).';
comment on column public.no_grafo.peso is 'Para hubs de grupo: quantidade de documentos no grupo.';
comment on column public.no_grafo.doc_id is 'Para nós tipo=documento: o documento de origem.';
