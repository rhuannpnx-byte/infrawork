-- InfraWork — Acompanhamento (Fase B): aplica fator_conversao nas views
--
-- vw_acompanhamento_previsto_x_realizado, vw_acompanhamento_curva_s e
-- vw_acompanhamento_produtividade_equipe agora multiplicam p.qtd pelo
-- fator_conversao do servico_match antes de agregar.

create or replace view public.vw_acompanhamento_previsto_x_realizado
with (security_invoker = true)
as
with baseline as (
  select pl.obra_id,
         pl.id                                    as planejamento_id,
         pt.id                                    as tarefa_id,
         pt.item_orcamentario_id                  as item_id,
         pt.data_inicio,
         pt.data_fim,
         io.codigo                                as servico_grupo_codigo,
         io.descricao                             as servico_grupo_descricao,
         io.quantidade_referencia                 as quantidade_planejada,
         io.unidade_referencia                    as unidade,
         snap.producao_diaria_qtde                as producao_diaria_cpu
    from public.planejamento pl
    join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
    join public.item_orcamentario io on io.id = pt.item_orcamentario_id
    left join public.cpu_snapshot snap on snap.id = io.cpu_snapshot_id
   where pl.is_baseline = true
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
  end                                                             as status
from baseline b
left join realizado r
       on r.obra_id = b.obra_id and r.item_id = b.item_id;

grant select on public.vw_acompanhamento_previsto_x_realizado to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_acompanhamento_curva_s
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
    cross join lateral generate_series(
      b.data_inicio,
      greatest(b.data_fim, current_date),
      interval '1 day'
    ) gs
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
)
select
  r.obra_id,
  r.item_id                                                       as item_orcamentario_id,
  r.codigo                                                        as servico_grupo_codigo,
  r.descricao                                                     as servico_grupo_descricao,
  r.data                                                          as data,
  case
    when r.data <= r.data_fim and r.dias_plan > 0
      then r.qtd_plan / r.dias_plan
    else 0
  end                                                             as planejado_dia,
  sum(case
        when r.data <= r.data_fim and r.dias_plan > 0
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

-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_acompanhamento_produtividade_equipe
with (security_invoker = true)
as
with prod as (
  select p.obra_id,
         p.equipe_nome                                            as siga_equipe_nome,
         em.equipe_id                                             as equipe_planejamento_id,
         e.nome                                                   as equipe_display_nome,
         e.cor                                                    as equipe_cor,
         em.id                                                    as equipe_match_id,
         p.servico_id                                             as siga_servico_id,
         p.servico_nome                                           as servico_nome,
         sm.servico_id                                            as servico_planejamento_id,
         sm.item_orcamentario_id                                  as item_orcamentario_id,
         p.data                                                   as data,
         p.qtd * coalesce(sm.fator_conversao, 1)                  as qtd
    from public.acompanhamento_producao p
    left join public.acompanhamento_equipe_match em
           on em.obra_id = p.obra_id and em.siga_equipe_nome = p.equipe_nome
    left join public.equipe e on e.id = em.equipe_id
    left join public.acompanhamento_servico_match sm
           on sm.obra_id = p.obra_id and sm.siga_servico_executado_id = p.servico_id
   where p.qtd is not null and p.qtd > 0
)
select
  obra_id,
  siga_equipe_nome,
  equipe_match_id,
  equipe_planejamento_id,
  coalesce(equipe_display_nome, siga_equipe_nome)                 as equipe_display_nome,
  coalesce(equipe_cor, '#94a3b8')                                 as equipe_cor,
  servico_nome,
  siga_servico_id,
  servico_planejamento_id,
  item_orcamentario_id,
  count(*)                                                        as registros,
  count(distinct data)                                            as dias_trabalhados,
  sum(qtd)                                                        as qtd_total,
  avg(qtd)                                                        as qtd_media,
  min(qtd)                                                        as qtd_min,
  max(qtd)                                                        as qtd_max,
  percentile_cont(0.5) within group (order by qtd)                as qtd_p50,
  percentile_cont(0.9) within group (order by qtd)                as qtd_p90,
  (select snap.producao_diaria_qtde
     from public.item_orcamentario io2
     left join public.cpu_snapshot snap on snap.id = io2.cpu_snapshot_id
    where io2.id = prod.item_orcamentario_id
    limit 1)                                                      as producao_diaria_cpu,
  case
    when (select snap.producao_diaria_qtde
            from public.item_orcamentario io2
            left join public.cpu_snapshot snap on snap.id = io2.cpu_snapshot_id
           where io2.id = prod.item_orcamentario_id limit 1) is null then null
    else round((percentile_cont(0.5) within group (order by qtd)
                / nullif((select snap.producao_diaria_qtde
                            from public.item_orcamentario io2
                            left join public.cpu_snapshot snap on snap.id = io2.cpu_snapshot_id
                           where io2.id = prod.item_orcamentario_id limit 1), 0))::numeric, 4)
  end                                                             as pct_aderencia_cpu,
  min(data)                                                       as primeira_data,
  max(data)                                                       as ultima_data
from prod
group by obra_id, siga_equipe_nome, equipe_match_id, equipe_planejamento_id,
         equipe_display_nome, equipe_cor, servico_nome, siga_servico_id,
         servico_planejamento_id, item_orcamentario_id;

grant select on public.vw_acompanhamento_produtividade_equipe to authenticated;
