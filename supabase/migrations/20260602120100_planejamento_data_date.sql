-- InfraWork — Planejamento (Motor CPM, Fase 2):
-- Data Date (Status Date) — separa passado executado de futuro replanejado.
--
-- Quando data_date é NULL (default): comportamento atual, sempre replaneja
-- a partir de data_referencia_inicio (Project Start).
--
-- Quando data_date é preenchida: tarefas com data_fim <= data_date E que têm
-- avanço 100% (via acompanhamento_link_servico mapeando execução à tarefa)
-- ficam frozen no CPM — não shiftam mesmo se predecessoras mudam.
-- Tarefas atravessando data_date têm ES = max(ES_calculado, data_date),
-- preservando o que já foi executado.
--
-- Integração com módulo acompanhamento: o cliente pode setar manualmente OU
-- a UI pode sugerir `max(data_producao)` de acompanhamento_producao da obra
-- (ainda manual nessa fase; automação via cron ou trigger é debt futuro).

alter table public.planejamento
  add column if not exists data_date date;

comment on column public.planejamento.data_date is
  'Status date / Data Date — fronteira entre passado executado e futuro replanejado. NULL = sem freeze (sempre replaneja).';
