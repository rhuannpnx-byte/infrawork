-- InfraWork — Acompanhamento (Fase B): views agregadas pro dashboard
--
-- Views otimizadas pra render do dashboard estratégico. Cada uma responde
-- uma pergunta específica de gestão e é consumida 1:1 por um hook do front.

-- ─────────────────────────────────────────────────────────────────────────
-- vw_acompanhamento_obra_resumo
--   KPIs gerais da obra (uma linha por obra com link ativo)
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_acompanhamento_obra_resumo
with (security_invoker = true)
as
select
  l.obra_id                                                       as obra_id,
  -- Avanço físico (média ponderada do pct_avanco em todas tarefas baseline)
  (select round(
            (sum(coalesce(vr.qtd_real, 0) * coalesce(snap.custo_unit, 1))
             / nullif(sum(coalesce(vr.qtd_plan, 0) * coalesce(snap.custo_unit, 1)), 0))::numeric,
            4)
     from public.vw_acompanhamento_previsto_x_realizado vr
     join public.item_orcamentario io on io.id = vr.item_orcamentario_id
     left join public.cpu_snapshot snap on snap.id = io.cpu_snapshot_id
    where vr.obra_id = l.obra_id)                                 as avanco_pct,
  -- Produção total da obra
  (select count(*)         from public.acompanhamento_producao p where p.obra_id = l.obra_id) as producao_total_registros,
  (select count(distinct data) from public.acompanhamento_producao p where p.obra_id = l.obra_id) as dias_com_apontamento,
  (select min(data)        from public.acompanhamento_producao p where p.obra_id = l.obra_id) as data_primeira_producao,
  (select max(data)        from public.acompanhamento_producao p where p.obra_id = l.obra_id) as data_ultima_producao,
  -- Equipes ativas hoje
  (select count(distinct equipe_nome)
     from public.acompanhamento_producao p
    where p.obra_id = l.obra_id and p.data = current_date)        as equipes_ativas_hoje,
  -- Equipes na última semana
  (select count(distinct equipe_nome)
     from public.acompanhamento_producao p
    where p.obra_id = l.obra_id and p.data >= current_date - interval '7 days') as equipes_ativas_semana,
  -- Fotos
  (select count(*) from public.acompanhamento_foto f where f.obra_id = l.obra_id) as fotos_total,
  (select count(*) from public.acompanhamento_foto f where f.obra_id = l.obra_id and f.lat is not null) as fotos_com_geo,
  -- Cobertura fotográfica últimos 30 dias (dias com >=1 foto / dias com apontamento)
  (with dias_prod as (
     select distinct data from public.acompanhamento_producao
      where obra_id = l.obra_id and data >= current_date - interval '30 days'),
   dias_foto as (
     select distinct (captured_at at time zone 'America/Sao_Paulo')::date as d
       from public.acompanhamento_foto
      where obra_id = l.obra_id and captured_at >= now() - interval '30 days')
   select case when (select count(*) from dias_prod) = 0 then null
               else round(((select count(*) from dias_foto)::numeric
                           / (select count(*) from dias_prod))::numeric, 4)
          end)                                                    as cobertura_fotografica_pct,
  -- Alertas
  (select count(*) from public.acompanhamento_alerta a
    where a.obra_id = l.obra_id and a.status = 'aberto' and a.severidade = 'critical') as alertas_criticos,
  (select count(*) from public.acompanhamento_alerta a
    where a.obra_id = l.obra_id and a.status = 'aberto') as alertas_abertos_total,
  -- Sync
  l.ultimo_sync_em,
  l.ultimo_sync_status,
  l.siga_projeto_codigo,
  l.siga_projeto_nome
from public.obra_acompanhamento_link l
where l.ativo = true;

grant select on public.vw_acompanhamento_obra_resumo to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- vw_acompanhamento_curva_s
--   Por (obra_id, item_orcamentario_id, data) — calcula:
--    - planejado_dia      = quantidade_planejada / dias_uteis (linear)
--    - planejado_acumulado= window SUM OVER ORDER BY data
--    - realizado_dia      = SUM produção do dia
--    - realizado_acumulado
--
--   Range: data_inicio do baseline ao max(data_fim, hoje)+30d.
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_acompanhamento_curva_s
with (security_invoker = true)
as
with baseline as (
  select pl.obra_id,
         pt.item_orcamentario_id      as item_id,
         pt.data_inicio,
         pt.data_fim,
         io.quantidade                as qtd_plan,
         io.descricao                 as descricao,
         io.codigo                    as codigo,
         greatest(1, (pt.data_fim - pt.data_inicio) + 1) as dias_plan
    from public.planejamento pl
    join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
    join public.item_orcamentario io on io.id = pt.item_orcamentario_id
   where pl.is_baseline = true
     and pt.data_inicio is not null and pt.data_fim is not null
     and io.quantidade is not null
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
         sm.item_orcamentario_id      as item_id,
         p.data,
         sum(p.qtd)                   as qtd
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
-- vw_acompanhamento_heatmap_dia_servico
--   Por (obra_id, data, servico_grupo) — célula do heatmap
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_acompanhamento_heatmap_dia_servico
with (security_invoker = true)
as
select
  p.obra_id                                                       as obra_id,
  p.data                                                          as data,
  coalesce(io.codigo, p.servico_nome, 'sem_servico')              as servico_label,
  sm.item_orcamentario_id                                         as item_orcamentario_id,
  sum(p.qtd)                                                      as qtd,
  count(*)                                                        as registros
from public.acompanhamento_producao p
left join public.acompanhamento_servico_match sm
       on sm.obra_id = p.obra_id and sm.siga_servico_executado_id = p.servico_id
left join public.item_orcamentario io on io.id = sm.item_orcamentario_id
where p.data is not null
group by p.obra_id, p.data, io.codigo, p.servico_nome, sm.item_orcamentario_id;

grant select on public.vw_acompanhamento_heatmap_dia_servico to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- vw_acompanhamento_frente_kpis
--   Por (obra_id, frente) — atividade recente, equipes, último apontamento
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_acompanhamento_frente_kpis
with (security_invoker = true)
as
select
  p.obra_id                                                       as obra_id,
  p.frente                                                        as frente,
  count(*)                                                        as registros,
  count(distinct p.data)                                          as dias_ativos,
  count(distinct p.equipe_nome)                                   as equipes_distintas,
  array_agg(distinct p.equipe_nome order by p.equipe_nome)        as equipes,
  count(distinct p.servico_id)                                    as servicos_distintos,
  sum(p.qtd)                                                      as qtd_total,
  min(p.data)                                                     as primeira_data,
  max(p.data)                                                     as ultima_data,
  count(*) filter (where p.data >= current_date - interval '7 days')
                                                                  as registros_ultima_semana
from public.acompanhamento_producao p
where p.frente is not null
group by p.obra_id, p.frente;

grant select on public.vw_acompanhamento_frente_kpis to authenticated;
