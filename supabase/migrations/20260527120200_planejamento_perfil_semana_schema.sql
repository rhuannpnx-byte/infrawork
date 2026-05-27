-- InfraWork — Planejamento: tabela planejamento_tarefa_perfil_semana
--
-- Cada linha representa a quantidade que se planeja produzir em uma semana
-- (segunda-feira ISO) de uma tarefa. Soma das semanas e validada por trigger
-- DEFERRABLE INITIALLY DEFERRED contra item_orcamentario.quantidade_referencia
-- com tolerancia 0.1% (definida no arquivo .120300_).
--
-- Granularidade semanal (vs diaria) foi escolha de produto:
--   * Distribuicao realista de obra rodoviaria opera em semanas, nao em dias.
--   * Reduz volume de linhas em ~5x (5 dias uteis / semana).
--   * Curva-S Gantt UI sao semanais — match natural.

create table if not exists public.planejamento_tarefa_perfil_semana (
  tarefa_id            uuid not null
                       references public.planejamento_tarefa(id) on delete cascade,
  semana_segunda       date not null,
  quantidade_planejada numeric(18, 6) not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (tarefa_id, semana_segunda)
);

do $$ begin
  alter table public.planejamento_tarefa_perfil_semana
    add constraint chk_ptps_qtd_nao_neg
    check (quantidade_planejada >= 0);
exception when duplicate_object then null; end $$;

-- ISO: 1=Mon (extract(isodow ...) — nao confundir com dow que retorna 0=Sun).
-- Padronizacao: TS sempre envia ISO Monday via startOfWeekMondayUTC do
-- _shared/cronograma-pure.ts. SQL valida via isodow.
do $$ begin
  alter table public.planejamento_tarefa_perfil_semana
    add constraint chk_ptps_segunda
    check (extract(isodow from semana_segunda) = 1);
exception when duplicate_object then null; end $$;

create index if not exists idx_ptps_tarefa on public.planejamento_tarefa_perfil_semana(tarefa_id);
create index if not exists idx_ptps_semana on public.planejamento_tarefa_perfil_semana(semana_segunda);

drop trigger if exists trg_ptps_updated_at on public.planejamento_tarefa_perfil_semana;
create trigger trg_ptps_updated_at
  before update on public.planejamento_tarefa_perfil_semana
  for each row execute function public.fn_touch_updated_at();
