-- InfraWork — Planejamento (Refator EAP/Marcos/Multi-tarefa, M6):
-- Atualiza whitelist do trigger trg_baseline_imutavel_tarefa para incluir as
-- novas colunas estruturais. Sem essa migration, edições em tipo_no/parent_id/
-- nivel/quantidade_alocada/codigo_eap/nome_custom de tarefas pertencentes a um
-- planejamento baseline passariam silenciosamente (trigger não dispararia).
--
-- Última versão em 20260529120300:26-34 incluía:
--   item_orcamentario_id, data_inicio_manual, notas, ordem,
--   posicao_inicio_m, posicao_fim_m, unidade_espaco_display,
--   perfil_default, usa_perfil_customizado, trecho_id
-- Acrescenta nesta versão:
--   tipo_no, parent_id, nivel, quantidade_alocada, codigo_eap, nome_custom

drop trigger if exists trg_baseline_imutavel_tarefa on public.planejamento_tarefa;
create trigger trg_baseline_imutavel_tarefa
  before delete or update of
    item_orcamentario_id, data_inicio_manual, notas, ordem,
    posicao_inicio_m, posicao_fim_m, unidade_espaco_display,
    perfil_default, usa_perfil_customizado, trecho_id,
    tipo_no, parent_id, nivel, quantidade_alocada, codigo_eap, nome_custom
  on public.planejamento_tarefa
  for each row execute function public.fn_planejamento_baseline_imutavel();
