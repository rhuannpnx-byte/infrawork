-- Documentação Oficial v2 — (5/7) Embeddings + RAG híbrido + feedback
-- ─────────────────────────────────────────────────────────────────────────
-- Chunks com página + tsvector (FTS) + embedding (gte-small/384). RAG híbrido
-- (vetor + lexical) via match_documento_chunks_hibrido (RRF). Classificação
-- aprende com documento_classificacao_feedback (few-shot).
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists vector;

create table if not exists public.documento_chunk (
  id            uuid        primary key default gen_random_uuid(),
  documento_id  uuid        not null references public.documento(id)        on delete cascade,
  versao_id     uuid        not null references public.documento_versao(id) on delete cascade,
  obra_id       uuid        not null references public.obras(id)            on delete cascade,
  empresa_id    uuid        not null references public.empresas(id)         on delete cascade,
  ordem         int         not null,
  pagina        int,
  conteudo      text        not null,
  tsv           tsvector    generated always as (to_tsvector('portuguese', coalesce(conteudo, ''))) stored,
  embedding     vector(384),
  metadados     jsonb       not null default '{}'::jsonb,   -- {embedding_model, ...}
  created_at    timestamptz not null default now()
);

create index if not exists idx_doc_chunk_documento on public.documento_chunk(documento_id);
create index if not exists idx_doc_chunk_obra       on public.documento_chunk(obra_id);
create index if not exists idx_doc_chunk_tsv         on public.documento_chunk using gin (tsv);
create index if not exists idx_doc_chunk_embedding
  on public.documento_chunk using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create or replace function public.fn_doc_chunk_escopo()
returns trigger language plpgsql as $$
begin
  select d.obra_id, d.empresa_id into new.obra_id, new.empresa_id
    from public.documento d where d.id = new.documento_id;
  if new.obra_id is null then
    raise exception 'documento_id % inexistente', new.documento_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_doc_chunk_escopo on public.documento_chunk;
create trigger trg_doc_chunk_escopo before insert on public.documento_chunk
  for each row execute function public.fn_doc_chunk_escopo();

select public.fn_doc_apply_obra_rls('documento_chunk');

-- Recuperação vetorial pura (escopada por obra) — retorna página p/ citação.
create or replace function public.match_documento_chunks(
  query_embedding vector(384),
  _obra_id uuid,
  _match_count int default 8
)
returns table (chunk_id uuid, documento_id uuid, conteudo text, pagina int, metadados jsonb, similaridade float)
language sql stable as $$
  select c.id, c.documento_id, c.conteudo, c.pagina, c.metadados,
         1 - (c.embedding <=> query_embedding) as similaridade
  from public.documento_chunk c
  where c.obra_id = _obra_id and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit greatest(_match_count, 1)
$$;

-- Recuperação HÍBRIDA: fusão de ranks (RRF) entre vetor e FTS (websearch).
create or replace function public.match_documento_chunks_hibrido(
  query_embedding vector(384),
  query_text text,
  _obra_id uuid,
  _match_count int default 8,
  _k int default 60
)
returns table (chunk_id uuid, documento_id uuid, conteudo text, pagina int, metadados jsonb, score float)
language sql stable as $$
  with vetor as (
    select c.id, row_number() over (order by c.embedding <=> query_embedding) as r
    from public.documento_chunk c
    where c.obra_id = _obra_id and c.embedding is not null
    order by c.embedding <=> query_embedding
    limit 40
  ),
  lexical as (
    select c.id, row_number() over (
             order by ts_rank(c.tsv, websearch_to_tsquery('portuguese', query_text)) desc) as r
    from public.documento_chunk c
    where c.obra_id = _obra_id
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

-- documento_classificacao_feedback — few-shot da classificação (god/adm/eng)
create table if not exists public.documento_classificacao_feedback (
  id            uuid        primary key default gen_random_uuid(),
  empresa_id    uuid        not null references public.empresas(id) on delete cascade,
  obra_id       uuid        not null references public.obras(id)    on delete cascade,
  documento_id  uuid        references public.documento(id) on delete set null,
  nome_arquivo  text        not null,
  pasta_origem  text,
  tipo_sugerido text,
  tipo_final    text        not null,
  acao          text        not null default 'aceito',
  created_by    uuid        references public.profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
do $$ begin
  alter table public.documento_classificacao_feedback
    add constraint chk_doc_clf_acao check (acao in ('aceito','corrigido','rejeitado'));
exception when duplicate_object then null; end $$;
create index if not exists idx_doc_clf_empresa
  on public.documento_classificacao_feedback(empresa_id, created_at desc);

drop trigger if exists trg_doc_clf_empresa on public.documento_classificacao_feedback;
create trigger trg_doc_clf_empresa before insert on public.documento_classificacao_feedback
  for each row execute function public.fn_doc_empresa_from_obra();

alter table public.documento_classificacao_feedback enable row level security;
drop policy if exists doc_clf_god_all on public.documento_classificacao_feedback;
drop policy if exists doc_clf_adm_all on public.documento_classificacao_feedback;
drop policy if exists doc_clf_eng_all on public.documento_classificacao_feedback;

create policy doc_clf_god_all on public.documento_classificacao_feedback
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');
create policy doc_clf_adm_all on public.documento_classificacao_feedback
  for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());
create policy doc_clf_eng_all on public.documento_classificacao_feedback
  for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

comment on function public.match_documento_chunks_hibrido is
  'RAG híbrido (RRF entre vetor e FTS websearch), escopado por obra. Server-side após validar acesso.';
