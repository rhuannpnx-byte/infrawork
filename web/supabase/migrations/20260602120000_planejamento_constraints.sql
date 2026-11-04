-- InfraWork — Planejamento (Motor CPM, Fase 2):
-- Constraints formais (SNET/FNLT/MSO/MFO + ASAP/ALAP) e Data Date.
--
-- Hoje o "lock" de data é boolean `data_inicio_manual` que força a tarefa a
-- iniciar na `data_inicio` lida do banco. Funciona como MSO informal. Esta
-- migration formaliza o conceito em duas dimensões:
--
--   schedule_mode (asap|alap):
--     ASAP = padrão CPM atual (early dates).
--     ALAP = "o mais tarde possível dentro da folga". Agenda tarefa nas
--            late dates (LS/LF) preservando deadline do projeto.
--
--   constraint_type + constraint_date (par):
--     SNET = Start No Earlier Than — não inicia antes da data X (janela soft)
--     FNLT = Finish No Later Than — não termina depois da data X
--     MSO  = Must Start On — força início exatamente em X (hard)
--     MFO  = Must Finish On — força fim exatamente em X (hard)
--
-- Hard constraints (MSO/MFO) sempre ganham de dependência. Se predecessora
-- força ES > MSO, o motor registra warning `constraint_violated` mas mantém
-- a MSO — UI exibe alerta visível.
--
-- Soft constraints (SNET/FNLT) modulam early/late dates dentro do range.

alter table public.planejamento_tarefa
  add column if not exists schedule_mode text not null default 'asap',
  add column if not exists constraint_type text,
  add column if not exists constraint_date date;

do $$ begin
  alter table public.planejamento_tarefa
    add constraint chk_plan_tar_schedule_mode
    check (schedule_mode in ('asap', 'alap'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.planejamento_tarefa
    add constraint chk_plan_tar_constraint_type
    check (constraint_type is null or constraint_type in ('snet','fnlt','mso','mfo'));
exception when duplicate_object then null; end $$;

-- Coerência: tipo e data só fazem sentido juntos.
do $$ begin
  alter table public.planejamento_tarefa
    add constraint chk_plan_tar_constraint_par
    check ((constraint_type is null) = (constraint_date is null));
exception when duplicate_object then null; end $$;

comment on column public.planejamento_tarefa.schedule_mode is
  'CPM scheduling mode: asap (default, early dates) | alap (late dates within float).';
comment on column public.planejamento_tarefa.constraint_type is
  'Constraint formal: snet (start no earlier than) | fnlt (finish no later than) | mso (must start on, hard) | mfo (must finish on, hard). NULL = sem constraint.';
comment on column public.planejamento_tarefa.constraint_date is
  'Data-alvo da constraint. NULL quando constraint_type é NULL.';

-- Backfill: tarefas com data_inicio_manual=true viram MSO formal apontando
-- pra data_inicio atual. data_inicio_manual continua existindo por
-- compatibilidade temporária (próxima release a deprecaremos).
update public.planejamento_tarefa
   set constraint_type = 'mso',
       constraint_date = data_inicio
 where data_inicio_manual = true
   and data_inicio is not null
   and constraint_type is null;
