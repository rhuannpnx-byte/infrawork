-- InfraWork — Acompanhamento: agrega serviços por item_orcamentario_id.
--
-- Contexto: depois que a UNIQUE (planejamento_id, item_orcamentario_id) foi
-- removida (20260530130200), um mesmo item orçado pode ter N tarefas no
-- baseline (várias frentes/trechos). As views de acompanhamento ainda
-- materializavam UMA LINHA POR TAREFA, mas usam io.quantidade_referencia
-- (total do item) como quantidade planejada — igual em todas as tarefas.
-- Resultado: o comparativo mostrava N linhas idênticas do mesmo serviço
-- (ex.: 2 tarefas → duas linhas de 1.000.000) e a curva-S dobrava os
-- acumulados. Nenhum consumidor frontend usa tarefa_id (filtro/seleção é
-- sempre por item_orcamentario_id), então agregamos por item.
--
-- 1) vw_acompanhamento_previsto_x_realizado: baseline passa a agregar por
--    (obra_id, item_orcamentario_id). Datas viram min(data_inicio)/max(data_fim)
--    (janela total do serviço). tarefa_id vira min(pt.id::text)::uuid
--    (representante; Postgres não tem min(uuid)), mantendo a coluna pro tipo
--    PrevistoRealizadoItem.
-- 2) vw_acompanhamento_curva_s: baseline_meta agora tem group by de verdade
--    (era 1 linha por tarefa apesar do comentário), eliminando a multiplicação
--    no left join final.
--
-- Colunas de saída inalteradas em ambas → create or replace view (sem cascade),
-- preservando a view dependente vw_acompanhamento_obra_resumo (cujo avanco_pct
-- lê de previsto_x_realizado e se corrige sozinho).

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
         io.quantidade_referencia                 as quantidade_planejada,
         io.unidade_referencia                    as unidade,
         snap.producao_diaria_qtde                as producao_diaria_cpu
    from public.planejamento pl
    join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
    join public.item_orcamentario io on io.id = pt.item_orcamentario_id
    left join public.cpu_snapshot snap on snap.id = io.cpu_snapshot_id
   where pl.is_baseline = true
   group by pl.obra_id, pt.item_orcamentario_id, io.codigo, io.descricao,
            io.quantidade_referencia, io.unidade_referencia, snap.producao_diaria_qtde
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
with baseline_meta as (
  -- 1 linha por (obra, item) — agora com group by de verdade (era 1 por tarefa,
  -- o que duplicava o left join final e dobrava os acumulados).
  select pl.obra_id,
         pt.item_orcamentario_id          as item_id,
         io.codigo,
         io.descricao,
         io.quantidade_referencia         as qtd_plan
    from public.planejamento pl
    join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
    join public.item_orcamentario   io on io.id = pt.item_orcamentario_id
   where pl.is_baseline = true
     and io.quantidade_referencia is not null
   group by pl.obra_id, pt.item_orcamentario_id, io.codigo, io.descricao, io.quantidade_referencia
),
planejado_dia_raw as (
  -- expande cada semana do perfil em 5 dias uteis (seg-sex), cada dia
  -- recebe qtd_semana / 5. Soma as porções de todas as tarefas do item.
  select pl.obra_id,
         pt.item_orcamentario_id              as item_id,
         (ps.semana_segunda + (i || ' days')::interval)::date  as data,
         (ps.quantidade_planejada / 5.0)      as planejado_dia
    from public.planejamento pl
    join public.planejamento_tarefa pt
      on pt.planejamento_id = pl.id
    join public.planejamento_tarefa_perfil_semana ps
      on ps.tarefa_id = pt.id
    cross join generate_series(0, 4) as i
   where pl.is_baseline = true
),
real_dia as (
  select sm.obra_id,
         sm.item_orcamentario_id              as item_id,
         p.data,
         sum(p.qtd * coalesce(sm.fator_conversao, 1)) as qtd
    from public.acompanhamento_producao p
    join public.acompanhamento_servico_match sm
      on sm.obra_id = p.obra_id and sm.siga_servico_executado_id = p.servico_id
   where sm.item_orcamentario_id is not null
   group by sm.obra_id, sm.item_orcamentario_id, p.data
),
-- Universo de pares (obra, item, data) = uniao dos dias com planejado ou realizado
todos_pares as (
  select obra_id, item_id, data from planejado_dia_raw
  union
  select obra_id, item_id, data from real_dia
),
agregado as (
  select tp.obra_id,
         tp.item_id,
         tp.data,
         coalesce((select sum(planejado_dia) from planejado_dia_raw pp
                   where pp.obra_id = tp.obra_id
                     and pp.item_id = tp.item_id
                     and pp.data = tp.data), 0)   as planejado_dia,
         coalesce((select qtd from real_dia rd
                   where rd.obra_id = tp.obra_id
                     and rd.item_id = tp.item_id
                     and rd.data = tp.data), 0)   as realizado_dia
    from todos_pares tp
)
select
  a.obra_id,
  a.item_id                                                      as item_orcamentario_id,
  bm.codigo                                                      as servico_grupo_codigo,
  bm.descricao                                                   as servico_grupo_descricao,
  a.data                                                         as data,
  a.planejado_dia                                                as planejado_dia,
  sum(a.planejado_dia) over (partition by a.obra_id, a.item_id order by a.data)
                                                                 as planejado_acumulado,
  a.realizado_dia                                                as realizado_dia,
  sum(a.realizado_dia) over (partition by a.obra_id, a.item_id order by a.data)
                                                                 as realizado_acumulado,
  bm.qtd_plan                                                    as qtd_planejada_total
from agregado a
left join baseline_meta bm on bm.obra_id = a.obra_id and bm.item_id = a.item_id;

grant select on public.vw_acompanhamento_curva_s to authenticated;
