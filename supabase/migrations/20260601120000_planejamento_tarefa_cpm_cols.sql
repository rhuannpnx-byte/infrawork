-- InfraWork — Planejamento (Motor CPM, Fase 1):
-- Persistência de campos derivados do CPM.
--
-- Hoje o `calcular-cronograma` computa ES (`dataInicio`/`data_inicio`),
-- EF (`dataFim`/`data_fim`) e identifica caminho crítico via slack ≤ 0 em
-- memória, persistindo apenas data_inicio/data_fim/duracao. Total Float (TF),
-- Free Float (FF), Late Start (LS) e Late Finish (LF) são descartados —
-- qualquer análise post-hoc exige rerun.
--
-- Esta migration adiciona as 7 colunas pra que:
--   * Curva-S, dashboards e relatórios consultem direto sem recálculo;
--   * Re-abrir cronograma seja instantâneo (sem botão "Recalcular" piscando);
--   * UI possa pintar tarefas críticas + folga sem dependência de runtime;
--   * Fase 3 (motor hybrid) possa diff client vs server pra detectar drift.
--
-- Aditiva (defaults seguros). Backfill via próximo recálculo Edge — não há
-- garantia de coerência até o próximo `calcular-cronograma`; UI tolera NULL.

alter table public.planejamento_tarefa
  add column if not exists early_start    date,
  add column if not exists early_finish   date,
  add column if not exists late_start     date,
  add column if not exists late_finish    date,
  -- Floats em dias úteis (mesma unidade do cálculo). Pode ser negativo se
  -- constraint violado força tarefa pra trás da predecessora — o motor
  -- registra warning, mas persiste o valor literal pra UI exibir.
  add column if not exists total_float    integer,
  add column if not exists free_float     integer,
  -- Caminho crítico: TF ≤ 0 (com tolerância). Boolean evita recálculo
  -- redundante na UI. Edge function popula; client read-only.
  add column if not exists is_critico     boolean not null default false;

comment on column public.planejamento_tarefa.early_start is
  'Early Start (CPM forward pass). NULL antes do primeiro recálculo ou em grupos.';
comment on column public.planejamento_tarefa.early_finish is
  'Early Finish (CPM forward pass). NULL antes do primeiro recálculo ou em grupos.';
comment on column public.planejamento_tarefa.late_start is
  'Late Start (CPM backward pass). NULL antes do primeiro recálculo ou em grupos.';
comment on column public.planejamento_tarefa.late_finish is
  'Late Finish (CPM backward pass). NULL antes do primeiro recálculo ou em grupos.';
comment on column public.planejamento_tarefa.total_float is
  'Folga total em dias úteis = LS - ES. ≤ 0 = caminho crítico.';
comment on column public.planejamento_tarefa.free_float is
  'Folga livre em dias úteis = min(ES sucessoras) - EF. Quanto pode atrasar sem afetar nenhuma sucessora.';
comment on column public.planejamento_tarefa.is_critico is
  'true quando total_float ≤ 0 (tolerância 0 dia útil). Populado pela edge function calcular-cronograma.';
