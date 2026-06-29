-- Documentação Oficial — RAG híbrido ATIVADO (vetor + FTS)
-- ─────────────────────────────────────────────────────────────────────────
-- O embedding passa a ser POPULADO (provedor externo Mistral `mistral-embed`,
-- 1024-dim). Sobe a dimensão de 384→1024, recria o índice ivfflat e as RPCs de
-- recuperação, agora com filtro opcional por documento (RAG por documento no
-- visualizador). Chunks existentes ficam com embedding NULL até reingestão — o
-- híbrido (RRF) degrada graciosamente para só-FTS nesses casos.
-- ─────────────────────────────────────────────────────────────────────────

-- Funções dependem da coluna → derrubar antes de trocar a dimensão.
drop function if exists public.match_documento_chunks(vector, uuid, int);
drop function if exists public.match_documento_chunks_hibrido(vector, text, uuid, int, int);

drop index if exists public.idx_doc_chunk_embedding;
alter table public.documento_chunk drop column if exists embedding;
alter table public.documento_chunk add column embedding vector(1024);

create index if not exists idx_doc_chunk_embedding
  on public.documento_chunk using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Recuperação vetorial pura (escopo obra + opcional documento) — retorna página.
create or replace function public.match_documento_chunks(
  query_embedding vector(1024),
  _obra_id uuid,
  _match_count int default 8,
  _documento_id uuid default null
)
returns table (chunk_id uuid, documento_id uuid, conteudo text, pagina int, metadados jsonb, similaridade float)
language sql stable as $$
  select c.id, c.documento_id, c.conteudo, c.pagina, c.metadados,
         1 - (c.embedding <=> query_embedding) as similaridade
  from public.documento_chunk c
  where c.obra_id = _obra_id
    and c.embedding is not null
    and (_documento_id is null or c.documento_id = _documento_id)
  order by c.embedding <=> query_embedding
  limit greatest(_match_count, 1)
$$;

-- Recuperação HÍBRIDA: fusão de ranks (RRF) entre vetor e FTS (websearch).
-- _documento_id não-nulo escopa a busca a UM documento (RAG por documento).
create or replace function public.match_documento_chunks_hibrido(
  query_embedding vector(1024),
  query_text text,
  _obra_id uuid,
  _match_count int default 8,
  _documento_id uuid default null,
  _k int default 60
)
returns table (chunk_id uuid, documento_id uuid, conteudo text, pagina int, metadados jsonb, score float)
language sql stable as $$
  with vetor as (
    select c.id, row_number() over (order by c.embedding <=> query_embedding) as r
    from public.documento_chunk c
    where c.obra_id = _obra_id
      and c.embedding is not null
      and (_documento_id is null or c.documento_id = _documento_id)
    order by c.embedding <=> query_embedding
    limit 40
  ),
  lexical as (
    select c.id, row_number() over (
             order by ts_rank(c.tsv, websearch_to_tsquery('portuguese', query_text)) desc) as r
    from public.documento_chunk c
    where c.obra_id = _obra_id
      and (_documento_id is null or c.documento_id = _documento_id)
      and c.tsv @@ websearch_to_tsquery('portuguese', query_text)
    limit 40
  ),
  fundido as (
    select coalesce(v.id, l.id) as id,
           coalesce(1.0 / (_k + v.r), 0) + coalesce(1.0 / (_k + l.r), 0) as score
    from vetor v
    full outer join lexical l on l.id = v.id
  )
  select c.id, c.documento_id, c.conteudo, c.pagina, c.metadados, f.score
  from fundido f
  join public.documento_chunk c on c.id = f.id
  order by f.score desc
  limit greatest(_match_count, 1)
$$;

comment on function public.match_documento_chunks_hibrido is
  'RAG híbrido (RRF vetor+FTS websearch), escopo obra e opcional por documento. Server-side após validar acesso.';
