-- Documentação Oficial v2 — busca FTS ranqueada para o agente (RAG lexical)
-- ─────────────────────────────────────────────────────────────────────────
-- Recupera chunks por full-text com ts_rank (relevância) e semântica OR dos
-- termos significativos (≥4 letras), tolerante a pergunta em linguagem natural.
-- Usada server-side pelo documentacao-perguntar (após validar acesso à obra).
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.buscar_chunks_fts(
  _obra_id uuid,
  _q text,
  _match int default 8
)
returns table (id uuid, documento_id uuid, conteudo text, pagina int, rank real)
language sql
stable
as $$
  with termos as (
    select string_agg(t, ' | ') as orq
    from (
      select regexp_replace(lower(palavra), '[^a-zà-ÿ0-9]', '', 'g') as t
      from unnest(regexp_split_to_array(coalesce(_q, ''), '\s+')) as palavra
    ) x
    where length(t) >= 4
  )
  select c.id, c.documento_id, c.conteudo, c.pagina,
         ts_rank(c.tsv, to_tsquery('portuguese', (select orq from termos))) as rank
  from public.documento_chunk c
  where coalesce((select orq from termos), '') <> ''
    and c.obra_id = _obra_id
    and c.tsv @@ to_tsquery('portuguese', (select orq from termos))
  order by rank desc
  limit greatest(_match, 1)
$$;

comment on function public.buscar_chunks_fts is
  'RAG lexical: chunks por full-text (OR dos termos ≥4 letras) ranqueados por ts_rank, escopado por obra.';
