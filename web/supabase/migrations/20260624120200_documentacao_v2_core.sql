-- Documentação Oficial v2 — (3/7) Núcleo: perfil da obra, contrato, documento, versão
-- ─────────────────────────────────────────────────────────────────────────
-- empresa_id derivado da obra por trigger (nunca confia no client). RLS por obra:
-- god / adm-empresa / engenheiro-permissão (escrita) · apoio só leitura · cliente
-- sem policy (invisível). Aplicada via macro reutilizável fn_doc_apply_obra_rls.
-- ─────────────────────────────────────────────────────────────────────────

-- Trigger genérico: deriva empresa_id de obras a partir de obra_id.
create or replace function public.fn_doc_empresa_from_obra()
returns trigger language plpgsql as $$
begin
  select empresa_id into new.empresa_id from public.obras where id = new.obra_id;
  if new.empresa_id is null then
    raise exception 'obra_id % sem empresa', new.obra_id;
  end if;
  return new;
end $$;

-- Macro: aplica a matriz RLS por obra (god/adm/eng all + apoio select) a uma
-- tabela que tenha coluna obra_id. Idempotente.
create or replace function public.fn_doc_apply_obra_rls(_tbl text)
returns void language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', _tbl);
  execute format('drop policy if exists %I on public.%I', _tbl||'_god_all',   _tbl);
  execute format('drop policy if exists %I on public.%I', _tbl||'_adm_all',   _tbl);
  execute format('drop policy if exists %I on public.%I', _tbl||'_eng_all',   _tbl);
  execute format('drop policy if exists %I on public.%I', _tbl||'_apoio_sel', _tbl);

  execute format($f$create policy %I on public.%I for all to authenticated
    using (public.auth_role() = 'god') with check (public.auth_role() = 'god')$f$,
    _tbl||'_god_all', _tbl);

  execute format($f$create policy %I on public.%I for all to authenticated
    using      (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
    with check (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())$f$,
    _tbl||'_adm_all', _tbl);

  execute format($f$create policy %I on public.%I for all to authenticated
    using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()))
    with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()))$f$,
    _tbl||'_eng_all', _tbl);

  execute format($f$create policy %I on public.%I for select to authenticated
    using (public.auth_role() = 'apoio' and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()))$f$,
    _tbl||'_apoio_sel', _tbl);
end $$;

-- ─── obra_perfil — bloco `obra` do dossiê + perfil de órgão (gap engine) ───
create table if not exists public.obra_perfil (
  obra_id       uuid primary key references public.obras(id)    on delete cascade,
  empresa_id    uuid not null     references public.empresas(id) on delete cascade,
  perfil_orgao  text not null default 'DNIT',  -- DNIT|GOINFRA|PREFEITURA|SANEAGO|PRIVADO
  orgao         text,
  natureza      text not null default 'publico', -- publico|privado
  regime        text,
  codigo_obra   text,
  nome_exibicao text,
  atualizado_em timestamptz not null default now()
);

do $$ begin
  alter table public.obra_perfil
    add constraint chk_obra_perfil_natureza check (natureza in ('publico','privado'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_obra_perfil_empresa on public.obra_perfil;
create trigger trg_obra_perfil_empresa before insert on public.obra_perfil
  for each row execute function public.fn_doc_empresa_from_obra();

-- ─── contrato — bloco `contrato` do dossiê ────────────────────────────────
create table if not exists public.contrato (
  id              uuid        primary key default gen_random_uuid(),
  empresa_id      uuid        not null references public.empresas(id) on delete cascade,
  obra_id         uuid        not null references public.obras(id)    on delete cascade,
  numero          text        not null,
  processo        text,
  sei             text,
  edital          text,
  lei             text,
  objeto          text,
  natureza        text        not null default 'publico',
  regime          text,
  consorcio       jsonb       not null default '{}'::jsonb,  -- {is, composicao:[{nome,cnpj,lider}]}
  valor_p0        numeric,
  valor_vigente   numeric,                                   -- derivado (consolidar)
  pct_aditado     numeric     not null default 0,
  pct_reajuste    numeric     not null default 0,
  data_base       text,                                      -- 'YYYY-MM'
  assinatura      date,
  publicacao      date,
  prazo_exec_dias int,
  prazo_vig_dias  int,
  inicio_exec     date,
  termino_exec    date,
  termino_vig     date,
  fiscal          text,
  created_by      uuid        references public.profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now()
);

do $$ begin
  alter table public.contrato
    add constraint chk_contrato_natureza check (natureza in ('publico','privado'));
exception when duplicate_object then null; end $$;

create index if not exists idx_contrato_obra    on public.contrato(obra_id);
create index if not exists idx_contrato_empresa on public.contrato(empresa_id);

drop trigger if exists trg_contrato_empresa on public.contrato;
create trigger trg_contrato_empresa before insert on public.contrato
  for each row execute function public.fn_doc_empresa_from_obra();

-- ─── documento — bloco `documentos[]`; contrato_id NULLABLE ───────────────
create table if not exists public.documento (
  id                      uuid        primary key default gen_random_uuid(),
  empresa_id              uuid        not null references public.empresas(id) on delete cascade,
  obra_id                 uuid        not null references public.obras(id)    on delete cascade,
  contrato_id             uuid        references public.contrato(id) on delete set null,  -- pode preceder o contrato
  tipo_codigo             text        not null references public.tipo_documento(codigo),
  categoria               text,                                   -- espelha tipo_codigo no dossiê
  especie                 text,                                   -- Contrato, ART, Aditivo...
  fonte_path              text,                                   -- caminho original no disco
  nome                    text,
  titulo                  text        not null,
  assinado                boolean     not null default false,
  vigente                 boolean     not null default true,
  version_cluster         uuid,                                   -- agrupa revisões
  validade                date,                                   -- gap de vencimento
  classificacao_confianca numeric,
  classificacao_origem    text        not null default 'manual',  -- manual|ia
  validado_humano         boolean     not null default false,
  created_by              uuid        references public.profiles(id) on delete set null default auth.uid(),
  created_at              timestamptz not null default now()
);

create index if not exists idx_documento_obra     on public.documento(obra_id);
create index if not exists idx_documento_contrato  on public.documento(contrato_id);
create index if not exists idx_documento_tipo      on public.documento(tipo_codigo);
create index if not exists idx_documento_cluster   on public.documento(version_cluster);
create index if not exists idx_documento_validade  on public.documento(validade) where validade is not null;

drop trigger if exists trg_documento_empresa on public.documento;
create trigger trg_documento_empresa before insert on public.documento
  for each row execute function public.fn_doc_empresa_from_obra();

-- ─── documento_versao — histórico; a `vigente` é destacada; texto/OCR ─────
create table if not exists public.documento_versao (
  id             uuid        primary key default gen_random_uuid(),
  documento_id   uuid        not null references public.documento(id) on delete cascade,
  versao         int         not null,
  vigente        boolean     not null default true,
  storage_bucket text        not null default 'documentacao',
  storage_key    text        not null,
  hash_sha256    text,
  nome_original  text        not null,
  mime           text,
  tamanho_bytes  bigint,
  texto_layer    boolean     not null default false,  -- tinha camada de texto nativa
  ocr            boolean     not null default false,   -- passou por OCR (Qwen-VL)
  texto_extraido text,
  observacao     text,
  created_by     uuid        references public.profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (documento_id, versao)
);

create index if not exists idx_doc_versao_documento on public.documento_versao(documento_id);
create unique index if not exists uq_doc_versao_hash
  on public.documento_versao(documento_id, hash_sha256) where hash_sha256 is not null;
create unique index if not exists uq_doc_versao_vigente
  on public.documento_versao(documento_id) where vigente;

-- RLS: obra_perfil/contrato/documento via macro; documento_versao herda via documento.
select public.fn_doc_apply_obra_rls('obra_perfil');
select public.fn_doc_apply_obra_rls('contrato');
select public.fn_doc_apply_obra_rls('documento');

alter table public.documento_versao enable row level security;
drop policy if exists doc_versao_god_all   on public.documento_versao;
drop policy if exists doc_versao_adm_all   on public.documento_versao;
drop policy if exists doc_versao_eng_all   on public.documento_versao;
drop policy if exists doc_versao_apoio_sel on public.documento_versao;

create policy doc_versao_god_all on public.documento_versao
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

create policy doc_versao_adm_all on public.documento_versao
  for all to authenticated
  using (public.auth_role() = 'adm' and exists (
    select 1 from public.documento d
     where d.id = documento_id and public.obra_empresa(d.obra_id) = public.auth_empresa_id()))
  with check (public.auth_role() = 'adm' and exists (
    select 1 from public.documento d
     where d.id = documento_id and public.obra_empresa(d.obra_id) = public.auth_empresa_id()));

create policy doc_versao_eng_all on public.documento_versao
  for all to authenticated
  using (public.auth_role() = 'engenheiro' and exists (
    select 1 from public.documento d
     where d.id = documento_id and public.has_obra_permissao(d.obra_id, auth.uid())))
  with check (public.auth_role() = 'engenheiro' and exists (
    select 1 from public.documento d
     where d.id = documento_id and public.has_obra_permissao(d.obra_id, auth.uid())));

create policy doc_versao_apoio_sel on public.documento_versao
  for select to authenticated
  using (public.auth_role() = 'apoio' and exists (
    select 1 from public.documento d
     where d.id = documento_id and public.has_obra_permissao(d.obra_id, public.auth_engenheiro_id())));

comment on table public.obra_perfil is 'Documentação Oficial v2 — perfil/órgão da obra (bloco `obra` do dossiê + gap engine).';
comment on table public.contrato is 'Documentação Oficial v2 — bloco `contrato` do dossiê.';
comment on table public.documento is 'Documentação Oficial v2 — documento (contrato_id nullable; pode preceder o contrato extraído).';
