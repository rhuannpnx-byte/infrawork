-- InfraWork — Planejamento (Fase 1 da refatoração EAP/marcos/multi-tarefa):
-- adiciona 'SF' (Start-to-Finish) ao CHECK de planejamento_dependencia.tipo.
--
-- Semântica SF: a sucessora não pode TERMINAR antes da predecessora COMEÇAR
-- (mais lag). Raro mas usado em janelas just-in-time (ex: produção concluída
-- quando a coleta começa). CHECK original em 20260524120000:188-191.

alter table public.planejamento_dependencia
  drop constraint if exists chk_plan_dep_tipo;

alter table public.planejamento_dependencia
  add constraint chk_plan_dep_tipo
  check (tipo in ('FS', 'SS', 'FF', 'SF'));
