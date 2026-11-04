-- Documentação Oficial v2 — (4/7) Camada do Dossiê (proveniência + blocos)
-- ─────────────────────────────────────────────────────────────────────────
-- Tabelas granulares que são a FONTE DA VERDADE do ObraDossier. Escalares com
-- proveniência ficam em campo_dossie (unique por caminho); listas (partes, RTs,
-- eventos) têm tabela própria com proveniência inline. Todas RLS por obra.
-- ─────────────────────────────────────────────────────────────────────────

-- campo_dossie — proveniência de valores escalares (1 valor canônico por caminho)
create table if not exists public.campo_dossie (
  id              uuid        primary key default gen_random_uuid(),
  empresa_id      uuid        not null references public.empresas(id) on delete cascade,
  obra_id         uuid        not null references public.obras(id)    on delete cascade,
  caminho         text        not null,                  -- json-path: 'contrato.valor_p0'
  valor_json      jsonb,
  doc_id          uuid        references public.documento(id)        on delete set null,
  versao_id       uuid        references public.documento_versao(id) on delete set null,
  pagina          int,
  confianca       numeric,
  derivado        boolean     not null default false,
  validado_humano boolean     not null default false,
  atualizado_em   timestamptz not null default now(),
  unique (obra_id, caminho)
);
create index if not exists idx_campo_dossie_obra on public.campo_dossie(obra_id);

-- parte — partes do contrato (contratante/consórcio/consorciada)
create table if not exists public.parte (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  obra_id    uuid not null references public.obras(id)    on delete cascade,
  papel      text not null,                               -- contratante|consorcio_lider|consorciada|...
  nome       text not null,
  cnpj       text,
  doc_id     uuid references public.documento(id) on delete set null,
  pagina     int,
  confianca  numeric
);
create index if not exists idx_parte_obra on public.parte(obra_id);

-- responsavel_tecnico — RTs (ART/CAT)
create table if not exists public.responsavel_tecnico (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  obra_id    uuid not null references public.obras(id)    on delete cascade,
  nome       text not null,
  crea       text,
  papel      text,
  art        text,
  doc_id     uuid references public.documento(id) on delete set null,
  pagina     int,
  confianca  numeric
);
create index if not exists idx_rt_obra on public.responsavel_tecnico(obra_id);

-- evento — timeline (assinatura/apostilamento/aditivo/ordem_servico/licenca)
create table if not exists public.evento (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas(id) on delete cascade,
  obra_id          uuid not null references public.obras(id)    on delete cascade,
  tipo             text not null,
  data_norm        date,                                  -- data normalizada (ordenação)
  data_rotulo      text,                                  -- como apareceu ('~ago/2024')
  rotulo           text not null,
  descricao        text,
  valor            numeric,
  delta            numeric,
  valor_resultante numeric,
  doc_id           uuid references public.documento(id) on delete set null,
  pagina           int,
  confianca        numeric
);
create index if not exists idx_evento_obra on public.evento(obra_id, data_norm);

-- no_grafo / aresta — grafo (Contrato como nó central)
create table if not exists public.no_grafo (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  obra_id    uuid not null references public.obras(id)    on delete cascade,
  no_id      text not null,
  tipo       text not null,
  label      text not null,
  sub        text,
  unique (obra_id, no_id)
);
create index if not exists idx_no_grafo_obra on public.no_grafo(obra_id);

create table if not exists public.aresta (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  obra_id    uuid not null references public.obras(id)    on delete cascade,
  de         text not null,
  para       text not null,
  rel        text not null
);
create index if not exists idx_aresta_obra on public.aresta(obra_id);

-- clausula — cláusulas & risco
create table if not exists public.clausula (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  obra_id    uuid not null references public.obras(id)    on delete cascade,
  doc_id     uuid references public.documento(id) on delete set null,
  titulo     text not null,
  categoria  text,
  texto      text,
  risco      text not null default 'baixo',               -- alto|medio|baixo
  observacao text,
  pagina     int,
  confianca  numeric
);
create index if not exists idx_clausula_obra on public.clausula(obra_id);
do $$ begin
  alter table public.clausula add constraint chk_clausula_risco
    check (risco in ('alto','medio','baixo'));
exception when duplicate_object then null; end $$;

-- lacuna — diagnóstico (gap engine; recomputada por inteiro)
create table if not exists public.lacuna (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  obra_id     uuid not null references public.obras(id)    on delete cascade,
  categoria   text,
  severidade  text not null default 'media',              -- alta|media|baixa
  tipo        text not null,                              -- ausente|vencimento|teto|assinatura
  mensagem    text not null,
  data_limite date,
  doc_id      uuid references public.documento(id) on delete set null,
  gerado_em   timestamptz not null default now()
);
create index if not exists idx_lacuna_obra on public.lacuna(obra_id);

-- empresa_id por trigger + RLS por obra (macro) para todas.
do $do$
declare t text;
begin
  foreach t in array array[
    'campo_dossie','parte','responsavel_tecnico','evento','no_grafo','aresta','clausula','lacuna'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_'||t||'_empresa', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.fn_doc_empresa_from_obra()',
                   'trg_'||t||'_empresa', t);
    perform public.fn_doc_apply_obra_rls(t);
  end loop;
end $do$;

comment on table public.campo_dossie is 'Documentação Oficial v2 — proveniência de escalares do dossiê (1 valor por caminho).';
comment on table public.evento is 'Documentação Oficial v2 — eventos (timeline).';
comment on table public.clausula is 'Documentação Oficial v2 — cláusulas extraídas + sinalização de risco.';
comment on table public.lacuna is 'Documentação Oficial v2 — lacunas do gap engine (presença/vencimento/teto/assinatura).';
