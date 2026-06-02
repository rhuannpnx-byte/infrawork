-- InfraWork — Planejamento (redesign Gantt, polish pós-Fase 4):
-- vw_planejamento_tarefa_completa v9 — REVERTE v8.
--
-- Motivo: o usuário lança medições por TAREFA do acompanhamento (uma única).
-- No cronograma, essa mesma tarefa pode ser desmembrada em N tarefas
-- (multi-trecho). A v8 propagava o mesmo qtd_realizada para todas as N
-- tarefas-filhas (agregação por item_orcamentario_id), o que causaria a
-- impressão de "todas estão x% concluídas" quando na verdade só uma soma
-- centralizada existe. Comportamento confuso, então removido.
--
-- Esta v9 é idêntica à v7 (expõe qtd_link mas NÃO progresso). Para futuras
-- iterações de progresso, será preciso definir um rateio explícito por
-- trecho/posição antes de re-expor o campo.

drop view if exists public.vw_planejamento_tarefa_completa cascade;

create view public.vw_planejamento_tarefa_completa
with (security_invoker = true)
as
select
  t.id                          as id,
  t.planejamento_id             as planejamento_id,
  t.item_orcamentario_id        as item_orcamentario_id,
  t.data_inicio                 as data_inicio,
  t.data_fim                    as data_fim,
  t.duracao_dias_uteis_calc     as duracao_dias_uteis_calc,
  t.data_inicio_manual          as data_inicio_manual,
  t.notas                       as notas,
  t.ordem                       as ordem,
  t.created_at                  as created_at,
  t.updated_at                  as updated_at,
  -- EAP / multi-tarefa (M2)
  t.tipo_no                     as tipo_no,
  t.parent_id                   as parent_id,
  t.nivel                       as nivel,
  t.codigo_eap                  as codigo_eap,
  t.nome_custom                 as nome_custom,
  t.quantidade_alocada          as quantidade_alocada,
  -- Redesign Gantt Fase 2: vínculo de qtd a métrica de template
  t.qtd_link                    as qtd_link,
  -- CPM Fase 1
  t.early_start                 as early_start,
  t.early_finish                as early_finish,
  t.late_start                  as late_start,
  t.late_finish                 as late_finish,
  t.total_float                 as total_float,
  t.free_float                  as free_float,
  t.is_critico                  as is_critico,
  -- CPM Fase 2: constraints + scheduling mode
  t.schedule_mode               as schedule_mode,
  t.constraint_type             as constraint_type,
  t.constraint_date             as constraint_date,
  -- Eixo espacial
  t.posicao_inicio_m            as posicao_inicio_m,
  t.posicao_fim_m               as posicao_fim_m,
  t.unidade_espaco_display      as unidade_espaco_display,
  coalesce(t.unidade_espaco_display, tr.unidade_espaco_padrao)
                                as unidade_espaco_efetiva,
  -- Trecho (LEFT — pode ser NULL em grupo/marco)
  t.trecho_id                   as trecho_id,
  tr.nome                       as trecho_nome,
  tr.ordem                      as trecho_ordem,
  -- Perfil
  t.perfil_default              as perfil_default,
  t.usa_perfil_customizado      as usa_perfil_customizado,

  p.obra_id                     as obra_id,
  p.is_baseline                 as is_baseline,
  p.status                      as planejamento_status,
  p.data_date                   as planejamento_data_date,

  -- Item orçamentário (LEFT — NULL em grupo/marco)
  i.codigo                      as servico_grupo_codigo,
  i.descricao                   as servico_grupo_descricao,
  i.quantidade_referencia       as quantidade_referencia,
  i.servico_id                  as servico_id,
  s.codigo                      as servico_codigo,
  s.nome                        as servico_nome,
  s.unidade                     as unidade_servico,
  i.cpu_snapshot_id             as cpu_snapshot_id,
  snap.cpu_id_origem            as cpu_id_origem,
  snap.producao_diaria_qtde     as producao_diaria_qtde,
  snap.producao_diaria_unidade  as producao_diaria_unidade,
  snap.custo_unit               as custo_unit_snapshot,
  case
    when snap.custo_unit is not null and t.quantidade_alocada is not null
      then (snap.custo_unit * t.quantidade_alocada)::numeric(14, 2)
    else 0::numeric(14, 2)
  end                           as custo_total_tarefa,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
              'id',          e.id,
              'nome',        e.nome,
              'cor',         e.cor,
              'tipo',        e.tipo,
              'qtd_equipes', pte.qtd_equipes
            ) order by e.nome)
       from public.planejamento_tarefa_equipe pte
       join public.equipe e on e.id = pte.equipe_id
      where pte.tarefa_id = t.id),
    '[]'::jsonb
  )                             as equipes,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
              'id',              d.id,
              'predecessora_id', d.predecessora_id,
              'tipo',            d.tipo,
              'lag_dias',        d.lag_dias
            ))
       from public.planejamento_dependencia d
      where d.sucessora_id = t.id),
    '[]'::jsonb
  )                             as predecessoras,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
              'id',           d.id,
              'sucessora_id', d.sucessora_id,
              'tipo',         d.tipo,
              'lag_dias',     d.lag_dias
            ))
       from public.planejamento_dependencia d
      where d.predecessora_id = t.id),
    '[]'::jsonb
  )                             as sucessoras,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
              'semana_segunda',       ps.semana_segunda,
              'quantidade_planejada', ps.quantidade_planejada
            ) order by ps.semana_segunda)
       from public.planejamento_tarefa_perfil_semana ps
      where ps.tarefa_id = t.id),
    '[]'::jsonb
  )                             as perfil_semanas
from public.planejamento_tarefa t
join public.planejamento p           on p.id = t.planejamento_id
left join public.obra_trecho tr      on tr.id = t.trecho_id
left join public.item_orcamentario i on i.id = t.item_orcamentario_id
left join public.servico s           on s.id = i.servico_id
left join public.cpu_snapshot snap   on snap.id = i.cpu_snapshot_id;

grant select on public.vw_planejamento_tarefa_completa to authenticated;
