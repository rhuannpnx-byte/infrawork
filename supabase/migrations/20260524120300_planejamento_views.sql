-- InfraWork — Planejamento (Fase P1.A): view materializada-em-runtime
--
-- vw_planejamento_tarefa_completa: junta tarefa + servico_grupo + CPU snapshot
-- + equipes alocadas (jsonb_agg) + dependências (jsonb_agg). Usada pelo Gantt
-- para evitar 4+ queries por linha.

create or replace view public.vw_planejamento_tarefa_completa
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
  p.obra_id                     as obra_id,
  p.is_baseline                 as is_baseline,
  p.status                      as planejamento_status,
  -- Servico_grupo
  i.codigo                      as servico_grupo_codigo,
  i.descricao                   as servico_grupo_descricao,
  i.quantidade_referencia       as quantidade_referencia,
  i.servico_id                  as servico_id,
  s.codigo                      as servico_codigo,
  s.nome                        as servico_nome,
  s.unidade                     as unidade_servico,
  -- CPU snapshot (pode ser null se servico_grupo ainda não tem CPU vinculada)
  i.cpu_snapshot_id             as cpu_snapshot_id,
  snap.cpu_id_origem            as cpu_id_origem,
  snap.producao_diaria_qtde     as producao_diaria_qtde,
  snap.producao_diaria_unidade  as producao_diaria_unidade,
  snap.custo_unit               as custo_unit_snapshot,
  case
    when snap.custo_unit is not null and i.quantidade_referencia is not null
      then (snap.custo_unit * i.quantidade_referencia)::numeric(14,2)
    else 0::numeric(14,2)
  end                           as custo_total_tarefa,
  -- Equipes alocadas
  coalesce(
    (select jsonb_agg(jsonb_build_object(
              'id',           e.id,
              'nome',         e.nome,
              'cor',          e.cor,
              'tipo',         e.tipo,
              'qtd_equipes',  pte.qtd_equipes
            ) order by e.nome)
       from public.planejamento_tarefa_equipe pte
       join public.equipe e on e.id = pte.equipe_id
      where pte.tarefa_id = t.id),
    '[]'::jsonb
  )                             as equipes,
  -- Predecessoras
  coalesce(
    (select jsonb_agg(jsonb_build_object(
              'id',               d.id,
              'predecessora_id',  d.predecessora_id,
              'tipo',             d.tipo,
              'lag_dias',         d.lag_dias
            ))
       from public.planejamento_dependencia d
      where d.sucessora_id = t.id),
    '[]'::jsonb
  )                             as predecessoras,
  -- Sucessoras
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
  )                             as sucessoras
from public.planejamento_tarefa t
join public.planejamento p           on p.id = t.planejamento_id
join public.item_orcamentario i      on i.id = t.item_orcamentario_id
left join public.servico s           on s.id = i.servico_id
left join public.cpu_snapshot snap   on snap.id = i.cpu_snapshot_id;

grant select on public.vw_planejamento_tarefa_completa to authenticated;
