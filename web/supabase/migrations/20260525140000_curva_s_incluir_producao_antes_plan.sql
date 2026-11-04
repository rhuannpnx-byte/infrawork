-- InfraWork — vw_acompanhamento_curva_s passa a incluir producao SIGA
-- apontada ANTES de data_inicio da tarefa do baseline.
--
-- Bug anterior: range_dias gerava dias de [data_inicio, max(data_fim, today)].
-- Producao com data < data_inicio caia fora do LEFT JOIN. Resultado:
-- realizado_acumulado final < qtd_real (de previsto_x_realizado).
--
-- Fix: range_dias agora comeca em least(data_inicio, MIN(p.data)) por item.
-- planejado_dia continua so contando dentro de [data_inicio, data_fim] via
-- o CASE existente — nao infla o planejado.

drop view if exists public.vw_acompanhamento_curva_s cascade;

create view public.vw_acompanhamento_curva_s
with (security_invoker = true)
as
with baseline as (
  select pl.obra_id,
         pt.item_orcamentario_id                  as item_id,
         pt.data_inicio,
         pt.data_fim,
         io.quantidade_referencia                 as qtd_plan,
         io.descricao                             as descricao,
         io.codigo                                as codigo,
         greatest(1, (pt.data_fim - pt.data_inicio) + 1) as dias_plan
    from public.planejamento pl
    join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
    join public.item_orcamentario io on io.id = pt.item_orcamentario_id
   where pl.is_baseline = true
     and pt.data_inicio is not null and pt.data_fim is not null
     and io.quantidade_referencia is not null
),
real_dia as (
  select sm.obra_id,
         sm.item_orcamentario_id                  as item_id,
         p.data,
         sum(p.qtd * coalesce(sm.fator_conversao, 1)) as qtd
    from public.acompanhamento_producao p
    join public.acompanhamento_servico_match sm
      on sm.obra_id = p.obra_id and sm.siga_servico_executado_id = p.servico_id
   where sm.item_orcamentario_id is not null
   group by sm.obra_id, sm.item_orcamentario_id, p.data
),
-- min data de producao por (obra, item), para estender range_dias quando
-- houver producao antes do data_inicio planejado
prod_first as (
  select obra_id, item_id, min(data) as data_primeira
    from real_dia
   group by obra_id, item_id
),
range_dias as (
  select b.obra_id,
         b.item_id,
         b.codigo,
         b.descricao,
         b.qtd_plan,
         b.data_inicio,
         b.data_fim,
         b.dias_plan,
         gs::date as data
    from baseline b
    left join prod_first pf on pf.obra_id = b.obra_id and pf.item_id = b.item_id
    cross join lateral generate_series(
      least(b.data_inicio, coalesce(pf.data_primeira, b.data_inicio)),
      greatest(b.data_fim, current_date),
      interval '1 day'
    ) gs
)
select
  r.obra_id,
  r.item_id                                                       as item_orcamentario_id,
  r.codigo                                                        as servico_grupo_codigo,
  r.descricao                                                     as servico_grupo_descricao,
  r.data                                                          as data,
  case
    when r.data >= r.data_inicio and r.data <= r.data_fim and r.dias_plan > 0
      then r.qtd_plan / r.dias_plan
    else 0
  end                                                             as planejado_dia,
  sum(case
        when r.data >= r.data_inicio and r.data <= r.data_fim and r.dias_plan > 0
          then r.qtd_plan / r.dias_plan
        else 0
      end) over (partition by r.obra_id, r.item_id order by r.data)
                                                                  as planejado_acumulado,
  coalesce(rd.qtd, 0)                                             as realizado_dia,
  sum(coalesce(rd.qtd, 0)) over (partition by r.obra_id, r.item_id order by r.data)
                                                                  as realizado_acumulado,
  r.qtd_plan                                                      as qtd_planejada_total
from range_dias r
left join real_dia rd
       on rd.obra_id = r.obra_id and rd.item_id = r.item_id and rd.data = r.data;

grant select on public.vw_acompanhamento_curva_s to authenticated;
