-- InfraWork — Planejamento (redesign Gantt, Fase 2):
-- Adiciona qtd_link em planejamento_tarefa.
--
-- Quando setado, quantidade_alocada é auto-calculada a partir da métrica
-- vinculada do template de quantidades do trecho. O valor armazenado é o
-- NOME de uma coluna do template (ex: "Área pavimentada"), não o UUID — o
-- nome é estável entre versões do template (clonado em useNovaVersao), o
-- UUID muda.
--
-- A resolução é feita no client (features/planejamento/lib/trecho-metricas.ts):
-- carrega template ativo do trecho via useTrechoQuantidadeTemplateAtual e
-- soma valores dos segmentos que interseccionam com posicao_inicio_m/fim_m
-- da tarefa, ponderado pela fração de interseção.
--
-- Edge function calcular-cronograma (será atualizada na Fase 4) também
-- resolve qtd_link server-side antes do forward pass.

alter table public.planejamento_tarefa
  add column if not exists qtd_link text;

comment on column public.planejamento_tarefa.qtd_link is
  'Quando setado, quantidade_alocada é auto-calculada a partir da coluna homônima do template de quantidades ativo do trecho. Ver features/planejamento/lib/trecho-metricas.ts pra lógica de cálculo.';
