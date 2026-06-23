-- InfraWork — Documentação Oficial (Fase 1): núcleo do repositório
--
-- Repositório DEFINITIVO dos documentos da obra (spec v2.0 EGP/TECPAV). Modela:
--   - contrato            : o contrato de obra (público/privado), amarrado à obra
--                           e ao processo administrativo (SEI). É o nó central.
--   - tipo_documento      : taxonomia canônica de 20 categorias (referência fixa).
--   - documento           : UM nome visível por documento, classificado na taxonomia,
--                           com status descritivo (minuta..encerrado) — SEM aprovação.
--   - documento_versao    : histórico por baixo; a versão `vigente` é a destacada.
--
-- Princípios (ver Guia do módulo): metadado-não-pasta, versão única visível,
-- classificação semântica. A IA (classificação/OCR/extração) entra na Fase 3.
--
-- empresa_id é derivado da obra por TRIGGER (não confia no client). RLS espelha a
-- matriz dos catálogos por obra: god / adm-empresa / engenheiro-permissão para
-- escrita; apoio só leitura. CLIENTE não tem policy alguma → não enxerga nada.

-- ─────────────────────────────────────────────────────────────────────────
-- Taxonomia canônica — 20 categorias (referência fixa, empresa-agnóstica)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.tipo_documento (
  codigo          text        primary key,          -- '01'..'20'
  nome            text        not null,
  obrigatoriedade text        not null,             -- essencial|recomendado|condicional|operacional|final|apoio
  ordem           int         not null
);

insert into public.tipo_documento (codigo, nome, obrigatoriedade, ordem) values
  ('01', 'Edital e Anexos',                         'essencial',   1),
  ('02', 'Proposta (Téc./Comercial)',               'recomendado', 2),
  ('03', 'Contrato',                                 'essencial',   3),
  ('04', 'Ordem de Serviço (e NPO)',                 'essencial',   4),
  ('05', 'ART / CAT',                                'essencial',   5),
  ('06', 'Segurança do Trabalho (PGR/PCMSO)',        'essencial',   6),
  ('07', 'Aditivos',                                 'condicional', 7),
  ('08', 'Reprogramação',                            'condicional', 8),
  ('09', 'Reajuste / Apostilamento',                 'condicional', 9),
  ('10', 'Licenças Ambientais (LP/LI/LO, ASV, Outorga)', 'essencial', 10),
  ('11', 'CNO / CEI',                                'essencial',  11),
  ('12', 'Seguro Garantia',                          'condicional', 12),
  ('13', 'Doc. Consórcio / Contratada',              'recomendado', 13),
  ('14', 'Cartas e Ofícios',                         'operacional', 14),
  ('15', 'Tribunal de Contas (TCM/TCE)',             'condicional', 15),
  ('16', 'Certidões / Matrícula / Desapropriação',   'condicional', 16),
  ('17', 'Qualidade (SGQ/PGQ/PVEGQ)',                'recomendado', 17),
  ('18', 'Termo de Entrega/Recebimento (TRP/TRD)',   'final',      18),
  ('19', 'Portarias / Designação de Fiscal',         'operacional', 19),
  ('20', 'Outros / Diversos',                        'apoio',      20)
on conflict (codigo) do update
  set nome = excluded.nome,
      obrigatoriedade = excluded.obrigatoriedade,
      ordem = excluded.ordem;

-- tipo_documento é catálogo público de leitura para qualquer autenticado.
alter table public.tipo_documento enable row level security;
drop policy if exists tipo_documento_read on public.tipo_documento;
create policy tipo_documento_read on public.tipo_documento
  for select to authenticated using (true);

-- ─────────────────────────────────────────────────────────────────────────
-- contrato — o nó central; amarrado à obra e ao processo administrativo
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.contrato (
  id                 uuid        primary key default gen_random_uuid(),
  empresa_id         uuid        not null references public.empresas(id) on delete cascade,
  obra_id            uuid        not null references public.obras(id)    on delete cascade,
  numero             text        not null,                 -- ex.: 02/2025-GOINFRA
  processo_sei       text,                                 -- nº SEI / processo DNIT
  contratante        text,                                 -- GOINFRA, DNIT, SANEAGO...
  natureza           text        not null default 'publico', -- publico | privado
  consorcio          jsonb       not null default '{}'::jsonb, -- {is:bool, composicao:[...]}
  objeto             text,
  modalidade_regime  text,                                 -- Concorrência · Contratação integrada...
  lei                text,                                 -- '14.133/2021' | contrato privado
  vigencia_inicio    date,
  vigencia_fim       date,
  valor_original     numeric,
  valor_atual        numeric,
  pct_aditado        numeric     not null default 0,
  fiscal_responsavel text,
  status             text        not null default 'vigente', -- descritivo
  created_by         uuid        references public.profiles(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now()
);

do $$ begin
  alter table public.contrato
    add constraint chk_contrato_natureza check (natureza in ('publico', 'privado'));
exception when duplicate_object then null; end $$;

create index if not exists idx_contrato_obra    on public.contrato(obra_id);
create index if not exists idx_contrato_empresa on public.contrato(empresa_id);

-- ─────────────────────────────────────────────────────────────────────────
-- documento — UM nome visível; status descritivo; classificado na taxonomia
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.documento (
  id                     uuid        primary key default gen_random_uuid(),
  empresa_id             uuid        not null references public.empresas(id) on delete cascade,
  obra_id                uuid        not null references public.obras(id)    on delete cascade,
  contrato_id            uuid        not null references public.contrato(id)  on delete cascade,
  tipo_codigo            text        not null references public.tipo_documento(codigo),
  titulo                 text        not null,
  status                 text        not null default 'vigente',
  -- origem da ingestão: directory | drag_drop | onedrive | email | scanner
  origem                 text        not null default 'drag_drop',
  classificacao_confianca numeric,                          -- 0..1 (IA, Fase 3)
  classificacao_origem   text        not null default 'manual', -- manual | ia
  created_by             uuid        references public.profiles(id) on delete set null default auth.uid(),
  created_at             timestamptz not null default now()
);

do $$ begin
  alter table public.documento
    add constraint chk_documento_status
    check (status in ('minuta','em_analise','assinado','vigente','substituido','encerrado'));
exception when duplicate_object then null; end $$;

create index if not exists idx_documento_obra      on public.documento(obra_id);
create index if not exists idx_documento_contrato  on public.documento(contrato_id);
create index if not exists idx_documento_tipo      on public.documento(tipo_codigo);

-- ─────────────────────────────────────────────────────────────────────────
-- documento_versao — histórico por baixo; a `vigente` é a destacada
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.documento_versao (
  id              uuid        primary key default gen_random_uuid(),
  documento_id    uuid        not null references public.documento(id) on delete cascade,
  versao          int         not null,
  vigente         boolean     not null default true,
  storage_bucket  text        not null default 'documentacao',
  storage_key     text        not null,
  hash_sha256     text,                                    -- dedup por conteúdo
  nome_original   text        not null,
  mime            text,
  tamanho_bytes   bigint,
  observacao      text,
  created_by      uuid        references public.profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (documento_id, versao)
);

create index if not exists idx_doc_versao_documento on public.documento_versao(documento_id);
-- dedup: o mesmo conteúdo (hash) não entra duas vezes no mesmo documento
create unique index if not exists uq_doc_versao_hash
  on public.documento_versao(documento_id, hash_sha256)
  where hash_sha256 is not null;
-- no máximo UMA versão vigente por documento
create unique index if not exists uq_doc_versao_vigente
  on public.documento_versao(documento_id)
  where vigente;

-- ─────────────────────────────────────────────────────────────────────────
-- Triggers: derivam empresa_id da obra (não confia no client)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_doc_empresa_from_obra()
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

drop trigger if exists trg_contrato_empresa on public.contrato;
create trigger trg_contrato_empresa
  before insert on public.contrato
  for each row execute function public.fn_doc_empresa_from_obra();

drop trigger if exists trg_documento_empresa on public.documento;
create trigger trg_documento_empresa
  before insert on public.documento
  for each row execute function public.fn_doc_empresa_from_obra();

-- ═════════════════════════════════════════════════════════════════════════
-- RLS — matriz por obra: god / adm-empresa / eng-permissão (escrita); apoio só
-- leitura. CLIENTE não tem policy → o módulo é invisível ao perfil cliente.
-- ═════════════════════════════════════════════════════════════════════════

-- Macro de policies por tabela com coluna obra_id, via DO block reutilizável.
-- (Escrevemos explicitamente por clareza/auditabilidade — mesma forma de
-- agrupamento_feedback, acrescido do SELECT de apoio.)

-- ─── contrato ──────────────────────────────────────────────────────────────
alter table public.contrato enable row level security;

drop policy if exists contrato_god_all   on public.contrato;
drop policy if exists contrato_adm_all   on public.contrato;
drop policy if exists contrato_eng_all   on public.contrato;
drop policy if exists contrato_apoio_sel on public.contrato;

create policy contrato_god_all on public.contrato
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

create policy contrato_adm_all on public.contrato
  for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

create policy contrato_eng_all on public.contrato
  for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

create policy contrato_apoio_sel on public.contrato
  for select to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- ─── documento ───────────────────────────────────────────────────────────
alter table public.documento enable row level security;

drop policy if exists documento_god_all   on public.documento;
drop policy if exists documento_adm_all   on public.documento;
drop policy if exists documento_eng_all   on public.documento;
drop policy if exists documento_apoio_sel on public.documento;

create policy documento_god_all on public.documento
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

create policy documento_adm_all on public.documento
  for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

create policy documento_eng_all on public.documento
  for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

create policy documento_apoio_sel on public.documento
  for select to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- ─── documento_versao (herda obra via documento) ──────────────────────────
alter table public.documento_versao enable row level security;

drop policy if exists doc_versao_god_all   on public.documento_versao;
drop policy if exists doc_versao_adm_all   on public.documento_versao;
drop policy if exists doc_versao_eng_all   on public.documento_versao;
drop policy if exists doc_versao_apoio_sel on public.documento_versao;

-- helper inline: a obra da versão vem do documento pai
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
     where d.id = documento_id
       and public.has_obra_permissao(d.obra_id, public.auth_engenheiro_id())));

comment on table public.contrato is
  'Documentação Oficial — contrato de obra (nó central). RLS por obra; cliente sem acesso.';
comment on table public.documento is
  'Documentação Oficial — documento com nome único e status descritivo (sem aprovação).';
comment on table public.documento_versao is
  'Documentação Oficial — histórico de versões; a `vigente` é a destacada. Dedup por hash.';
