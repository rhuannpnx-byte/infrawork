-- InfraWork — Documentação Oficial (Fase 3): IA documental
--
-- Estrutura para (a) classificação inteligente na ingestão, (b) busca semântica
-- e (c) um AGENTE sobre o acervo:
--   - documento_versao.texto_extraido : texto pós-OCR/parse da versão (fonte dos chunks)
--   - documento_chunk                 : pedaços do texto + embedding (pgvector)
--   - match_documento_chunks()        : recuperação por similaridade (RAG do agente)
--   - documento_classificacao_feedback: aprendizado da classificação (few-shot)
--
-- Embeddings gerados pela IA nativa das Edge Functions do Supabase (gte-small,
-- 384 dimensões) — sem chave/serviço externo. Cascade: chunks caem ao excluir o
-- documento (ON DELETE CASCADE), atendendo "excluir documento e seus embeddings".

create extension if not exists vector;

alter table public.documento_versao
  add column if not exists texto_extraido text;

-- ─────────────────────────────────────────────────────────────────────────
-- documento_chunk — pedaços vetorizados (obra/empresa derivados por trigger)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.documento_chunk (
  id            uuid         primary key default gen_random_uuid(),
  documento_id  uuid         not null references public.documento(id)         on delete cascade,
  versao_id     uuid         not null references public.documento_versao(id)  on delete cascade,
  obra_id       uuid         not null references public.obras(id)             on delete cascade,
  empresa_id    uuid         not null references public.empresas(id)          on delete cascade,
  ordem         int          not null,
  conteudo      text         not null,
  embedding     vector(384),
  metadados     jsonb        not null default '{}'::jsonb,
  created_at    timestamptz  not null default now()
);

create index if not exists idx_doc_chunk_documento on public.documento_chunk(documento_id);
create index if not exists idx_doc_chunk_obra       on public.documento_chunk(obra_id);
-- Índice ANN para busca por similaridade (cosine).
create index if not exists idx_doc_chunk_embedding
  on public.documento_chunk using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Deriva obra_id/empresa_id do documento pai (não confia no client).
create or replace function public.fn_doc_chunk_escopo()
returns trigger
language plpgsql
as $$
begin
  select d.obra_id, d.empresa_id into new.obra_id, new.empresa_id
    from public.documento d where d.id = new.documento_id;
  if new.obra_id is null then
    raise exception 'documento_id % inexistente', new.documento_id;
  end if;
  return new;
end
$$;

drop trigger if exists trg_doc_chunk_escopo on public.documento_chunk;
create trigger trg_doc_chunk_escopo
  before insert on public.documento_chunk
  for each row execute function public.fn_doc_chunk_escopo();

-- RLS: mesma matriz por obra (god / adm-empresa / eng-permissão; apoio leitura).
alter table public.documento_chunk enable row level security;

drop policy if exists doc_chunk_god_all   on public.documento_chunk;
drop policy if exists doc_chunk_adm_all   on public.documento_chunk;
drop policy if exists doc_chunk_eng_all   on public.documento_chunk;
drop policy if exists doc_chunk_apoio_sel on public.documento_chunk;

create policy doc_chunk_god_all on public.documento_chunk
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

create policy doc_chunk_adm_all on public.documento_chunk
  for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

create policy doc_chunk_eng_all on public.documento_chunk
  for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

create policy doc_chunk_apoio_sel on public.documento_chunk
  for select to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- ─────────────────────────────────────────────────────────────────────────
-- match_documento_chunks — recuperação por similaridade (usada pelo agente)
-- Chamada server-side (service_role) pela Edge Function, após assertObraAccess.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.match_documento_chunks(
  query_embedding vector(384),
  _obra_id uuid,
  _match_count int default 8
)
returns table (
  chunk_id uuid,
  documento_id uuid,
  conteudo text,
  metadados jsonb,
  similaridade float
)
language sql
stable
as $$
  select
    c.id,
    c.documento_id,
    c.conteudo,
    c.metadados,
    1 - (c.embedding <=> query_embedding) as similaridade
  from public.documento_chunk c
  where c.obra_id = _obra_id
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit greatest(_match_count, 1)
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- documento_classificacao_feedback — aprendizado da classificação por IA
-- (espelha agrupamento_feedback: aceito/corrigido/rejeitado; few-shot empresa)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.documento_classificacao_feedback (
  id              uuid        primary key default gen_random_uuid(),
  empresa_id      uuid        not null references public.empresas(id) on delete cascade,
  obra_id         uuid        not null references public.obras(id)    on delete cascade,
  documento_id    uuid        references public.documento(id) on delete set null,
  nome_arquivo    text        not null,
  pasta_origem    text,
  tipo_sugerido   text,
  tipo_final      text        not null,
  acao            text        not null default 'aceito',
  created_by      uuid        references public.profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now()
);

do $$ begin
  alter table public.documento_classificacao_feedback
    add constraint chk_doc_clf_acao check (acao in ('aceito', 'corrigido', 'rejeitado'));
exception when duplicate_object then null; end $$;

create index if not exists idx_doc_clf_empresa on public.documento_classificacao_feedback(empresa_id, created_at desc);

create or replace function public.fn_doc_clf_empresa()
returns trigger
language plpgsql
as $$
begin
  select empresa_id into new.empresa_id from public.obras where id = new.obra_id;
  if new.empresa_id is null then
    raise exception 'obra_id % sem empresa', new.obra_id;
  end if;
  return new;
end
$$;

drop trigger if exists trg_doc_clf_empresa on public.documento_classificacao_feedback;
create trigger trg_doc_clf_empresa
  before insert on public.documento_classificacao_feedback
  for each row execute function public.fn_doc_clf_empresa();

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

comment on table public.documento_chunk is
  'Chunks vetorizados (gte-small/384) do texto dos documentos. Base do RAG do agente. Cascade ao excluir documento.';
comment on function public.match_documento_chunks is
  'Recuperação por similaridade de cosseno, escopada por obra. Use server-side após validar acesso.';
