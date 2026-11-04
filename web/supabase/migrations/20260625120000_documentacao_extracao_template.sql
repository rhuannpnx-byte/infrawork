-- Documentação Oficial — Extração por TEMPLATE (estrutura fixa, editável, copiável)
-- ─────────────────────────────────────────────────────────────────────────
-- O template dita EXATAMENTE quais campos/perguntas a IA responde a partir dos
-- documentos (nada além dele é obtido). Há um template BASE por empresa
-- (obra_id null) e 1 por obra (clonado do base/default), editável e copiável
-- entre obras. A extração grava CANDIDATOS por (campo, documento); a resolução
-- ancorada por categoria escolhe o canônico (escalar) ou une+dedup (incremental).
-- O validador grava findings (regras R-XX) que travam a emissão do TAP.
-- ─────────────────────────────────────────────────────────────────────────

-- ─── extracao_template ─────────────────────────────────────────────────────
create table if not exists public.extracao_template (
  id                 uuid primary key default gen_random_uuid(),
  obra_id            uuid references public.obras(id)    on delete cascade,  -- null = base da empresa
  empresa_id         uuid not null references public.empresas(id) on delete cascade,
  nome               text not null default 'Template padrão',
  descricao          text,
  campos             jsonb not null default '[]'::jsonb,
  origem_template_id uuid references public.extracao_template(id) on delete set null,
  versao             int  not null default 1,
  criado_por         uuid,
  atualizado_em      timestamptz not null default now(),
  created_at         timestamptz not null default now()
);
-- 1 template por obra; e 1 base por empresa (obra_id null).
create unique index if not exists uq_extracao_template_obra
  on public.extracao_template(obra_id) where obra_id is not null;
create unique index if not exists uq_extracao_template_base
  on public.extracao_template(empresa_id) where obra_id is null;
create index if not exists idx_extracao_template_empresa on public.extracao_template(empresa_id);

-- Trigger de empresa: obra → empresa da obra; base → empresa do chamador (ou a já informada).
create or replace function public.fn_extracao_template_empresa()
returns trigger language plpgsql as $$
begin
  if new.obra_id is not null then
    select empresa_id into new.empresa_id from public.obras where id = new.obra_id;
  end if;
  if new.empresa_id is null then
    new.empresa_id := public.auth_empresa_id();
  end if;
  if new.empresa_id is null then
    raise exception 'empresa_id indefinido para o template';
  end if;
  return new;
end $$;

drop trigger if exists trg_extracao_template_empresa on public.extracao_template;
create trigger trg_extracao_template_empresa
  before insert on public.extracao_template
  for each row execute function public.fn_extracao_template_empresa();

-- RLS por empresa (cobre base e por-obra): god tudo; adm/eng/apoio da empresa.
-- Edição (write) só god/adm; engenheiro/apoio leem (config da empresa).
alter table public.extracao_template enable row level security;
drop policy if exists extracao_template_god_all   on public.extracao_template;
drop policy if exists extracao_template_adm_all    on public.extracao_template;
drop policy if exists extracao_template_eng_sel    on public.extracao_template;
drop policy if exists extracao_template_apoio_sel  on public.extracao_template;

create policy extracao_template_god_all on public.extracao_template for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');
create policy extracao_template_adm_all on public.extracao_template for all to authenticated
  using      (public.auth_role() = 'adm' and empresa_id = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and empresa_id = public.auth_empresa_id());
create policy extracao_template_eng_sel on public.extracao_template for select to authenticated
  using (public.auth_role() = 'engenheiro' and empresa_id = public.auth_empresa_id());
create policy extracao_template_apoio_sel on public.extracao_template for select to authenticated
  using (public.auth_role() = 'apoio' and empresa_id = public.auth_empresa_id());

-- ─── extracao_candidato ────────────────────────────────────────────────────
-- Cada documento contribui candidatos por campo (com fonte+confiança). A
-- resolução ancorada escolhe o canônico (escalar) ou une+dedup (incremental).
create table if not exists public.extracao_candidato (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  obra_id       uuid not null references public.obras(id)    on delete cascade,
  doc_id        uuid references public.documento(id) on delete cascade,
  campo_chave   text not null,
  item_key      text not null default '',   -- incrementais: distingue itens do mesmo doc
  valor_json    jsonb,
  pagina        int,
  confianca     numeric,
  doc_categoria text,
  assinado      boolean,
  doc_data      date,                        -- p/ desempate recência (data do doc/evento)
  criado_em     timestamptz not null default now(),
  unique (obra_id, doc_id, campo_chave, item_key)
);
create index if not exists idx_extracao_candidato_obra  on public.extracao_candidato(obra_id);
create index if not exists idx_extracao_candidato_campo on public.extracao_candidato(obra_id, campo_chave);

drop trigger if exists trg_extracao_candidato_empresa on public.extracao_candidato;
create trigger trg_extracao_candidato_empresa
  before insert on public.extracao_candidato
  for each row execute function public.fn_doc_empresa_from_obra();
select public.fn_doc_apply_obra_rls('extracao_candidato');

-- ─── documentacao_finding ──────────────────────────────────────────────────
-- Resultado do validador (regras R-XX). pode_emitir_definitivo = sem BLOCKER.
create table if not exists public.documentacao_finding (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  obra_id     uuid not null references public.obras(id)    on delete cascade,
  regra_id    text not null,
  severidade  text not null,                 -- BLOCKER|WARN|INFO
  campo       text,
  mensagem    text not null,
  esperado    text,
  encontrado  text,
  fonte       jsonb,
  aberto      boolean not null default true,
  criado_em   timestamptz not null default now()
);
create index if not exists idx_doc_finding_obra on public.documentacao_finding(obra_id);

drop trigger if exists trg_doc_finding_empresa on public.documentacao_finding;
create trigger trg_doc_finding_empresa
  before insert on public.documentacao_finding
  for each row execute function public.fn_doc_empresa_from_obra();
select public.fn_doc_apply_obra_rls('documentacao_finding');

comment on table public.extracao_template  is 'Documentação Oficial — template de extração (estrutura fixa de campos/perguntas), base por empresa + 1 por obra.';
comment on table public.extracao_candidato is 'Documentação Oficial — candidatos de extração por (campo, documento); resolvidos por âncora de categoria.';
comment on table public.documentacao_finding is 'Documentação Oficial — findings do validador de TAP (regras R-XX).';
