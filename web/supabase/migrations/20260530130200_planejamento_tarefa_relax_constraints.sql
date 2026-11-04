-- InfraWork — Planejamento (Refator EAP/Marcos/Multi-tarefa, M3):
-- Relaxa constraints que travavam N tarefas/item, grupos e marcos.
--
-- 1) DROP UNIQUE (planejamento_id, item_orcamentario_id) — habilita N tarefas
--    paralelas pro mesmo item orçado (uma equipe por trecho/frente).
-- 2) item_orcamentario_id vira NULLABLE — grupos/marcos não têm item.
--    Validação fina (regra "tipo_no='tarefa' exige item servico_grupo") delega
--    para fn_tarefa_so_aceita_servico_grupo (atualizada em M5).
-- 3) trecho_id vira NULLABLE — grupos podem englobar múltiplos trechos;
--    marcos podem ser sem trecho. fn_tarefa_trecho_mesma_obra já tolera NULL.

-- Drop UNIQUE — nome auto-gerado pelo Postgres
alter table public.planejamento_tarefa
  drop constraint if exists planejamento_tarefa_planejamento_id_item_orcamentario_id_key;

-- Relax NOT NULL em item_orcamentario_id
alter table public.planejamento_tarefa
  alter column item_orcamentario_id drop not null;

-- Relax NOT NULL em trecho_id (estabelecido em 20260529120300)
alter table public.planejamento_tarefa
  alter column trecho_id drop not null;

comment on column public.planejamento_tarefa.item_orcamentario_id is
  'FK para item_orcamentario. NULL para tipo_no IN (grupo,marco). Trigger fn_tarefa_so_aceita_servico_grupo valida que tarefa-folha sempre tem item servico_grupo da mesma obra.';
comment on column public.planejamento_tarefa.trecho_id is
  'Trecho da obra. NULL aceito para grupos (englobam múltiplos trechos) e marcos opcionais. Trigger fn_tarefa_trecho_mesma_obra valida obra quando preenchido.';
