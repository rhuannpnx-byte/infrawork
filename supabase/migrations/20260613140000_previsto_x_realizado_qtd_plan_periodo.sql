-- InfraWork — vw_acompanhamento_previsto_x_realizado: nova coluna
-- qtd_plan_periodo = quantidade PLANEJADA acumulada ATÉ HOJE (current_date),
-- segundo o cronograma do baseline (mesma distribuição diária da curva-S:
-- quantidade da semana / 5 nos dias úteis seg–sex).
--
-- Pareia com qtd_real (realizado até hoje) para mostrar, em quantidade
-- absoluta, se o item está adiantado/atrasado em relação ao previsto até a
-- data — mais preciso que pct_esperado_hoje (interpolação linear de tempo).
--
-- Para cada perfil_semana, conta os dias úteis (i = 0..4, seg–sex a partir de
-- semana_segunda) que caem em/antes de current_date:
--   dias = least(5, greatest(0, (current_date - semana_segunda) + 1))
-- e soma (quantidade_planejada / 5) * dias. Indiretos não têm perfil_semana →
-- qtd_plan_periodo = 0.
--
-- Coluna ADICIONADA ao final → create or replace (sem cascade).

create or replace view public.vw_acompanhamento_previsto_x_realizado
with (security_invoker = true)
as
with baseline as (
  select pl.obra_id,
         min(pt.id::text)::uuid                   as tarefa_id,
         pt.item_orcamentario_id                  as item_id,
         min(pt.data_inicio)                      as data_inicio,
         max(pt.data_fim)                         as data_fim,
         io.codigo                                as servico_grupo_codigo,
         io.descricao                             as servico_grupo_descricao,
         sum(pt.quantidade_alocada)::numeric(14,4) as quantidade_planejada,
         io.unidade_referencia                    as unidade,
         snap.producao_diaria_qtde                as producao_diaria_cpu
    from public.planejamento pl
    join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
    join public.item_orcamentario io on io.id = pt.item_orcamentario_id
    left join public.cpu_snapshot snap on snap.id = io.cpu_snapshot_id
   where pl.is_baseline = true
   group by pl.obra_id, pt.item_orcamentario_id, io.codigo, io.descricao,
            io.unidade_referencia, snap.producao_diaria_qtde
),
plan_periodo as (
  -- Planejado acumulado até current_date (distribuição diária da curva-S).
  select pl.obra_id,
         pt.item_orcamentario_id                  as item_id,
         sum(
           (ps.quantidade_planejada / 5.0)
           * least(5, greatest(0, (current_date - ps.semana_segunda) + 1))
         )::numeric(14,4)                          as qtd_plan_periodo
    from public.planejamento pl
    join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
    join public.planejamento_tarefa_perfil_semana ps on ps.tarefa_id = pt.id
   where pl.is_baseline = true
   group by pl.obra_id, pt.item_orcamentario_id
),
realizado as (
  select sm.obra_id,
         sm.item_orcamentario_id                  as item_id,
         sum(p.qtd * coalesce(sm.fator_conversao, 1))  as quantidade_realizada,
         count(distinct p.data)                   as dias_realizado,
         min(p.data)                              as data_primeira,
         max(p.data)                              as data_ultima
    from public.acompanhamento_producao p
    join public.acompanhamento_servico_match sm
      on sm.obra_id = p.obra_id and sm.siga_servico_executado_id = p.servico_id
   where sm.item_orcamentario_id is not null
   group by sm.obra_id, sm.item_orcamentario_id
)
select
  b.obra_id                                                       as obra_id,
  b.tarefa_id                                                     as tarefa_id,
  b.item_id                                                       as item_orcamentario_id,
  b.servico_grupo_codigo                                          as codigo,
  b.servico_grupo_descricao                                       as descricao,
  b.unidade                                                       as unidade,
  b.quantidade_planejada                                          as qtd_plan,
  coalesce(r.quantidade_realizada, 0)                             as qtd_real,
  case
    when b.quantidade_planejada is null or b.quantidade_planejada = 0 then null
    else round((coalesce(r.quantidade_realizada, 0) / b.quantidade_planejada)::numeric, 4)
  end                                                             as pct_avanco,
  b.data_inicio                                                   as data_inicio_plan,
  b.data_fim                                                      as data_fim_plan,
  case
    when b.data_fim is null or b.data_inicio is null then null
    else greatest(1, (b.data_fim - b.data_inicio) + 1)
  end                                                             as dias_plan,
  r.dias_realizado                                                as dias_real,
  r.data_primeira                                                 as data_primeira_realizacao,
  r.data_ultima                                                   as data_ultima_realizacao,
  case
    when b.data_inicio is null or b.data_fim is null then null
    when current_date < b.data_inicio then 0
    when current_date > b.data_fim then 1
    else round((((current_date - b.data_inicio)::numeric)
                / nullif((b.data_fim - b.data_inicio)::numeric, 0))::numeric, 4)
  end                                                             as pct_esperado_hoje,
  case
    when b.data_fim is null then null
    when r.data_ultima is null then null
    when b.producao_diaria_cpu is null or b.producao_diaria_cpu = 0 then null
    else (b.data_fim - (r.data_ultima
                        + ceil(greatest(0, (b.quantidade_planejada - coalesce(r.quantidade_realizada,0)))
                               / b.producao_diaria_cpu)::int))::int
  end                                                             as desvio_dias_estimado,
  case
    when b.quantidade_planejada is null then 'sem_plano'
    when r.quantidade_realizada is null then 'nao_iniciado'
    when r.quantidade_realizada >= b.quantidade_planejada then 'concluido'
    when b.data_inicio is null or b.data_fim is null then 'em_andamento'
    when current_date > b.data_fim then 'atrasado'
    else
      case
        when (case
                when current_date < b.data_inicio then 0
                else ((current_date - b.data_inicio)::numeric
                      / nullif((b.data_fim - b.data_inicio)::numeric, 0))
              end) = 0 then 'em_andamento'
        when (coalesce(r.quantidade_realizada,0) / nullif(b.quantidade_planejada, 0))
             / nullif((case when current_date < b.data_inicio then 0
                            else ((current_date - b.data_inicio)::numeric
                                  / nullif((b.data_fim - b.data_inicio)::numeric, 0))
                       end), 0)
             >= 1.05 then 'adiantado'
        when (coalesce(r.quantidade_realizada,0) / nullif(b.quantidade_planejada, 0))
             / nullif((case when current_date < b.data_inicio then 0
                            else ((current_date - b.data_inicio)::numeric
                                  / nullif((b.data_fim - b.data_inicio)::numeric, 0))
                       end), 0)
             < 0.7 then 'atrasado'
        when (coalesce(r.quantidade_realizada,0) / nullif(b.quantidade_planejada, 0))
             / nullif((case when current_date < b.data_inicio then 0
                            else ((current_date - b.data_inicio)::numeric
                                  / nullif((b.data_fim - b.data_inicio)::numeric, 0))
                       end), 0)
             < 0.95 then 'em_risco'
        else 'no_prazo'
      end
  end                                                             as status,
  coalesce(pp.qtd_plan_periodo, 0)                                as qtd_plan_periodo
from baseline b
left join plan_periodo pp on pp.obra_id = b.obra_id and pp.item_id = b.item_id
left join realizado r      on r.obra_id = b.obra_id and r.item_id = b.item_id;

grant select on public.vw_acompanhamento_previsto_x_realizado to authenticated;
