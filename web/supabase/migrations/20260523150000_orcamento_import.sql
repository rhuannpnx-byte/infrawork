-- InfraWork — Orçamento (Fase 4.A): Importação Excel/PDF
--
-- Tabelas criadas:
--   - template_importacao:  mapeamento (colunas, abas, cabeçalho) por empresa.
--                           Um template é reusável entre obras da mesma empresa.
--   - import_job:           uma execução de importação. Guarda payload parseado
--                           (itens extraídos do arquivo, antes de aplicar) e
--                           payload de match (resultados do match com catálogo).
--   - import_match_fraco:   um registro por item com match fraco que precisa
--                           da decisão do usuário (qual serviço usar).
--
-- Helpers SECURITY DEFINER:
--   - template_empresa(_id), job_obra(_id), job_empresa(_id)
--
-- Triggers locais:
--   - fn_template_default_unico:  garante que cada empresa tem no máximo 1
--                                 template marcado eh_default=true.
--   - fn_import_job_updated_at:   touch updated_at em UPDATE.
--
-- Status do import_job (transições válidas):
--   criado → parseado → mapeado → aplicado
--                              ↘ erro / cancelado
-- (transições controladas em Edge Function — sem trigger pra manter flexibilidade)

-- ─────────────────────────────────────────────────────────────────────────
-- template_importacao
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.template_importacao (
  id            uuid          primary key default gen_random_uuid(),
  empresa_id    uuid          not null references public.empresas(id) on delete cascade,
  nome          text          not null,
  descricao     text,
  formato       text          not null,
  mapping       jsonb         not null,
  eh_default    boolean       not null default false,
  ativo         boolean       not null default true,
  criado_por    uuid          references public.profiles(id) on delete set null,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now(),
  unique (empresa_id, nome)
);

do $$ begin
  alter table public.template_importacao
    add constraint chk_template_formato check (formato in ('xlsx', 'pdf'));
exception when duplicate_object then null; end $$;

create index if not exists idx_template_empresa on public.template_importacao(empresa_id);
create index if not exists idx_template_default on public.template_importacao(empresa_id) where eh_default = true;

-- ─────────────────────────────────────────────────────────────────────────
-- import_job
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.import_job (
  id                  uuid          primary key default gen_random_uuid(),
  empresa_id          uuid          not null references public.empresas(id)            on delete cascade,
  obra_id             uuid          not null references public.obras(id)               on delete cascade,
  template_id         uuid          references public.template_importacao(id)          on delete set null,
  arquivo_nome        text          not null,
  arquivo_tamanho     bigint,
  arquivo_storage_path text,
  status              text          not null default 'criado',
  payload_parse       jsonb,
  payload_match       jsonb,
  total_itens         int           not null default 0,
  matches_fortes      int           not null default 0,
  matches_fracos      int           not null default 0,
  sem_match           int           not null default 0,
  error_msg           text,
  itens_aplicados     int,
  raiz_item_id        uuid          references public.item_orcamentario(id) on delete set null,
  criado_por          uuid          references public.profiles(id) on delete set null,
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now(),
  finished_at         timestamptz
);

do $$ begin
  alter table public.import_job
    add constraint chk_import_job_status
    check (status in ('criado', 'parseado', 'mapeado', 'aplicado', 'erro', 'cancelado'));
exception when duplicate_object then null; end $$;

create index if not exists idx_import_job_obra    on public.import_job(obra_id, created_at desc);
create index if not exists idx_import_job_empresa on public.import_job(empresa_id);
create index if not exists idx_import_job_status  on public.import_job(obra_id, status);

-- ─────────────────────────────────────────────────────────────────────────
-- import_match_fraco
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.import_match_fraco (
  id                  uuid          primary key default gen_random_uuid(),
  job_id              uuid          not null references public.import_job(id) on delete cascade,
  item_idx            int           not null,
  codigo_origem       text,
  descricao_origem    text          not null,
  sugestoes           jsonb         not null default '[]'::jsonb,
  escolha_servico_id  uuid          references public.servico(id) on delete set null,
  escolha_em          timestamptz,
  escolha_por         uuid          references public.profiles(id) on delete set null,
  unique (job_id, item_idx)
);

create index if not exists idx_match_fraco_job on public.import_match_fraco(job_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Triggers locais
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.fn_template_default_unico()
returns trigger
language plpgsql
as $$
begin
  if new.eh_default is true then
    update public.template_importacao
       set eh_default = false
     where empresa_id = new.empresa_id
       and id <> new.id
       and eh_default = true;
  end if;
  return new;
end $$;

drop trigger if exists trg_template_default_unico on public.template_importacao;
create trigger trg_template_default_unico
  after insert or update of eh_default on public.template_importacao
  for each row
  when (new.eh_default is true)
  execute function public.fn_template_default_unico();

create or replace function public.fn_template_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_template_touch on public.template_importacao;
create trigger trg_template_touch
  before update on public.template_importacao
  for each row execute function public.fn_template_touch();

create or replace function public.fn_import_job_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.status in ('aplicado','erro','cancelado') and new.finished_at is null then
    new.finished_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_import_job_touch on public.import_job;
create trigger trg_import_job_touch
  before update on public.import_job
  for each row execute function public.fn_import_job_touch();

-- ─────────────────────────────────────────────────────────────────────────
-- Helpers SECURITY DEFINER
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.template_empresa(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select empresa_id from public.template_importacao where id = _id $$;

create or replace function public.job_obra(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select obra_id from public.import_job where id = _id $$;

create or replace function public.job_empresa(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select empresa_id from public.import_job where id = _id $$;

create or replace function public.match_fraco_obra(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select j.obra_id
    from public.import_match_fraco f
    join public.import_job j on j.id = f.job_id
   where f.id = _id
$$;

alter function public.template_empresa(uuid)   owner to postgres;
alter function public.job_obra(uuid)           owner to postgres;
alter function public.job_empresa(uuid)        owner to postgres;
alter function public.match_fraco_obra(uuid)   owner to postgres;

revoke all on function public.template_empresa(uuid)   from public;
revoke all on function public.job_obra(uuid)           from public;
revoke all on function public.job_empresa(uuid)        from public;
revoke all on function public.match_fraco_obra(uuid)   from public;

grant execute on function public.template_empresa(uuid)   to authenticated;
grant execute on function public.job_obra(uuid)           to authenticated;
grant execute on function public.job_empresa(uuid)        to authenticated;
grant execute on function public.match_fraco_obra(uuid)   to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Template default TecPav v1.8 (seed)
-- ─────────────────────────────────────────────────────────────────────────
-- O template default é criado por trigger AFTER INSERT em empresas
-- via uma rotina de seed. Aqui só registramos a função; o INSERT do
-- registro propriamente vai ser feito pela Edge Function ou via UI.

create or replace function public.fn_template_default_tecpav_payload()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'formato', 'xlsx',
    'descricao', 'Template TecPav v1.8 (planilha legada com abas Plan_Orc + Indiretos + 30 CPUs)',
    'aba_plan_orc', jsonb_build_object(
      'nome', 'Plan_Orc',
      'linhas_cabecalho', 5,
      'colunas', jsonb_build_object(
        'codigo', 'A',
        'descricao', 'B',
        'unidade', 'C',
        'quantidade', 'D',
        'venda_unitaria', 'E'
      )
    ),
    'aba_indireto', jsonb_build_object(
      'nome', 'Indiretos',
      'linhas_cabecalho', 3,
      'colunas', jsonb_build_object(
        'codigo', 'A',
        'descricao', 'B',
        'tipo', 'C',
        'valor_total', 'D'
      )
    )
  )
$$;
