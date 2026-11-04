-- InfraWork — Planejamento: eixo espacial (posicao km/m/estaca) por tarefa
--
-- Adiciona posicao_inicio_m e posicao_fim_m em planejamento_tarefa (armazenamento
-- SEMPRE em metros; unidade só rege display/entrada via unidade_espaco_display).
-- Default por obra em obras.unidade_espaco_padrao.
--
-- Imutabilidade: as 3 colunas novas em planejamento_tarefa entram na lista
-- de BEFORE UPDATE OF do trigger trg_baseline_imutavel_tarefa — são metadado
-- estrutural, não devem ser editáveis em baseline.

-- ─────────────────────────────────────────────────────────────────────────
-- (1) obras: unidade default
-- ─────────────────────────────────────────────────────────────────────────
alter table public.obras
  add column if not exists unidade_espaco_padrao text not null default 'km';

do $$ begin
  alter table public.obras
    add constraint chk_obras_unidade_espaco
    check (unidade_espaco_padrao in ('km', 'm', 'estaca'));
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- (2) planejamento_tarefa: posições + unidade display
-- ─────────────────────────────────────────────────────────────────────────
alter table public.planejamento_tarefa
  add column if not exists posicao_inicio_m       numeric,
  add column if not exists posicao_fim_m          numeric,
  add column if not exists unidade_espaco_display text;

do $$ begin
  alter table public.planejamento_tarefa
    add constraint chk_plan_tar_unid_espaco
    check (unidade_espaco_display is null
           or unidade_espaco_display in ('km', 'm', 'estaca'));
exception when duplicate_object then null; end $$;

-- "Os dois ou nenhum"
do $$ begin
  alter table public.planejamento_tarefa
    add constraint chk_plan_tar_pos_par
    check ((posicao_inicio_m is null) = (posicao_fim_m is null));
exception when duplicate_object then null; end $$;

-- Fim >= início quando preenchido
do $$ begin
  alter table public.planejamento_tarefa
    add constraint chk_plan_tar_pos_ordem
    check (posicao_inicio_m is null or posicao_fim_m >= posicao_inicio_m);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- (3) Atualizar trigger de imutabilidade para incluir as colunas novas.
--     PG não tem ALTER TRIGGER ... ADD COLUMN — padrão: DROP + CREATE.
--     A função fn_planejamento_baseline_imutavel não muda; só a lista de
--     colunas que disparam o trigger.
-- ─────────────────────────────────────────────────────────────────────────
drop trigger if exists trg_baseline_imutavel_tarefa on public.planejamento_tarefa;
create trigger trg_baseline_imutavel_tarefa
  before delete or update of
    item_orcamentario_id,
    data_inicio_manual,
    notas,
    ordem,
    posicao_inicio_m,
    posicao_fim_m,
    unidade_espaco_display
  on public.planejamento_tarefa
  for each row execute function public.fn_planejamento_baseline_imutavel();
