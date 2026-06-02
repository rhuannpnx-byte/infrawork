-- InfraWork — Planejamento: amplia constraint_type com SNLT e FNET.
--
-- A migration original (20260602120000_planejamento_constraints.sql) shipou 4
-- dos 6 tipos de constraint do MS Project: snet, fnlt, mso, mfo. Faltavam:
--
--   SNLT — Start No Later Than — "Não iniciar depois de" (soft, puxa LS no
--          backward pass; se predecessores forçam ES > SNLT, sinaliza via
--          TF negativo + warning).
--   FNET — Finish No Earlier Than — "Não terminar antes de" (soft, atrasa
--          início no forward pra terminar não-antes-de a data alvo).
--
-- A semântica completa fica:
--   "Deve iniciar em"         → MSO  (hard, força ES)
--   "Deve terminar em"        → MFO  (hard, força LF)
--   "Não iniciar antes de"    → SNET (soft, empurra ES)
--   "Não iniciar depois de"   → SNLT (soft, puxa LS)         ← NOVO
--   "Não terminar antes de"   → FNET (soft, empurra EF)      ← NOVO
--   "Não terminar depois de"  → FNLT (soft, puxa LF)
--   "O mais cedo possível"    → schedule_mode = 'asap'
--   "O mais tarde possível"   → schedule_mode = 'alap'

alter table public.planejamento_tarefa
  drop constraint if exists chk_plan_tar_constraint_type;

alter table public.planejamento_tarefa
  add constraint chk_plan_tar_constraint_type
  check (constraint_type is null
         or constraint_type in ('snet', 'snlt', 'fnet', 'fnlt', 'mso', 'mfo'));

comment on column public.planejamento_tarefa.constraint_type is
  'Constraint formal MS Project: snet | snlt | fnet | fnlt | mso | mfo. NULL = sem constraint formal. Vide 20260610120000 pra semântica completa.';
