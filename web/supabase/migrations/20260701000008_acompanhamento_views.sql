-- InfraWork Web — Views do acompanhamento religadas ao modelo NATIVO de produção.
--
-- Todas as views comparam plano × real pelo `item_orcamentario_id` (servico_grupo)
-- do lançamento e usam `quantidade × fator_conversao` como quantidade na unidade
-- do plano. Mantém algumas colunas-alias legadas (equipe_planejamento_id,
-- servico_planejamento_id, producao_diaria_cpu, pct_aderencia_cpu) para reduzir
-- o churn no front.

-- ─────────────────────────────────────────────────────────────────────────
-- vw_acompanhamento_producao_enriquecida
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_acompanhamento_producao_enriquecida
with (security_invoker = true)
as
select
  p.id                                                            as id,
  p.obra_id                                                       as obra_id,
  p.data                                                          as data,
  p.item_orcamentario_id                                          as item_orcamentario_id,
  p.servico_id                                                    as servico_id,
  p.servico_id                                                    as servico_planejamento_id,
  p.servico_nome                                                  as servico_nome,
  p.quantidade                                                    as qtd,
  (p.quantidade * p.fator_conversao)::numeric(14,4)               as qtd_convertida,
  p.fator_conversao                                               as fator_conversao,
  p.unidade                                                       as unidade,
  coalesce(s.unidade, io.unidade_referencia, p.unidade)           as unidade_plano,
  coalesce(nullif(trim(p.frente), ''), '(sem frente)')            as frente,
  p.frente                                                        as frente_raw,
  p.estaca_inicial                                                as estaca_inicial,
  p.estaca_final                                                  as estaca_final,
  p.obs                                                           as obs,
  p.origem                                                        as origem,
  p.importacao_id                                                 as importacao_id,
  p.criado_por                                                    as criado_por,
  pr.nome                                                         as criado_por_nome,
  p.created_at                                                    as created_at,
  p.updated_at                                                    as updated_at,
  p.equipe_id                                                     as equipe_id,
  p.equipe_id                                                     as equipe_planejamento_id,
  coalesce(e.nome, '—')                                           as equipe_display_nome,
  coalesce(e.cor, '#94a3b8')                                      as equipe_display_cor,
  e.tipo                                                          as equipe_tipo,
  p.encarregado_id                                                as encarregado_id,
  coalesce(en.apelido, en.nome)                                   as encarregado_display_nome,
  s.codigo                                                        as servico_codigo,
  coalesce(s.nome, p.servico_nome)                                as servico_display_nome,
  s.unidade                                                       as servico_unidade,
  io.codigo                                                       as servico_grupo_codigo,
  io.descricao                                                    as servico_grupo_descricao,
  pta.tarefa_id                                                   as tarefa_baseline_id,
  pta.data_inicio                                                 as tarefa_data_inicio,
  pta.data_fim                                                    as tarefa_data_fim,
  (select count(*) from public.acompanhamento_foto f
     where f.producao_id = p.id and f.excluida_em is null)         as fotos_count
from public.acompanhamento_producao p
left join public.equipe e            on e.id = p.equipe_id
left join public.encarregado en      on en.id = p.encarregado_id
left join public.item_orcamentario io on io.id = p.item_orcamentario_id
left join public.servico s           on s.id = p.servico_id
left join public.profiles pr         on pr.id = p.criado_por
left join public.planejamento pl     on pl.obra_id = p.obra_id and pl.is_baseline = true
left join (
  select
    pt.planejamento_id,
    pt.item_orcamentario_id,
    min(pt.data_inicio)                                            as data_inicio,
    max(pt.data_fim)                                               as data_fim,
    (array_agg(pt.id order by pt.data_inicio asc nulls last))[1]   as tarefa_id
  from public.planejamento_tarefa pt
  where pt.item_orcamentario_id is not null
  group by pt.planejamento_id, pt.item_orcamentario_id
) pta on pta.planejamento_id = pl.id and pta.item_orcamentario_id = p.item_orcamentario_id;

grant select on public.vw_acompanhamento_producao_enriquecida to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- vw_acompanhamento_foto_enriquecida
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_acompanhamento_foto_enriquecida
with (security_invoker = true)
as
select
  f.id                                                            as id,
  f.obra_id                                                       as obra_id,
  f.producao_id                                                   as producao_id,
  f.item_orcamentario_id                                          as item_orcamentario_id,
  f.lat                                                           as lat,
  f.lng                                                           as lng,
  f.captured_at                                                   as captured_at,
  (f.captured_at at time zone 'America/Sao_Paulo')::date          as captured_date,
  f.storage_bucket                                                as storage_bucket,
  f.storage_key                                                   as storage_key,
  f.obs                                                           as obs,
  f.size_bytes                                                    as size_bytes,
  f.mime                                                          as mime,
  f.width                                                         as width,
  f.height                                                        as height,
  f.enviado_por                                                   as enviado_por,
  f.created_at                                                    as created_at,
  f.servico_nome                                                  as servico_nome,
  coalesce(s.nome, f.servico_nome)                                as servico_display_nome,
  s.codigo                                                        as servico_codigo,
  f.encarregado_id                                                as encarregado_id,
  coalesce(en.apelido, en.nome)                                   as encarregado_display_nome,
  p.equipe_id                                                     as equipe_id,
  coalesce(e.nome, '—')                                           as equipe_display_nome,
  coalesce(e.cor, '#94a3b8')                                      as equipe_display_cor,
  case
    when f.producao_id is not null then 'direto'
    when inf.id is not null then 'inferido'
    else 'avulso'
  end                                                             as correlacao_producao,
  inf.id                                                          as producao_inferida_id,
  coalesce(nullif(trim(p.frente), ''), nullif(trim(inf.frente), ''), '(sem frente)') as frente
from public.acompanhamento_foto f
left join public.acompanhamento_producao p on p.id = f.producao_id
left join public.equipe e                  on e.id = p.equipe_id
left join public.encarregado en            on en.id = f.encarregado_id
left join public.item_orcamentario io      on io.id = f.item_orcamentario_id
left join public.servico s                 on s.id = io.servico_id
left join lateral (
  select p2.id, p2.frente
    from public.acompanhamento_producao p2
   where f.producao_id is null
     and f.item_orcamentario_id is not null
     and p2.obra_id = f.obra_id
     and p2.item_orcamentario_id = f.item_orcamentario_id
     and p2.data between (f.captured_at at time zone 'America/Sao_Paulo')::date - 1
                     and (f.captured_at at time zone 'America/Sao_Paulo')::date + 1
   order by abs(extract(epoch from (p2.data::timestamp - f.captured_at)))
   limit 1
) inf on true
where f.excluida_em is null;

grant select on public.vw_acompanhamento_foto_enriquecida to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- vw_acompanhamento_previsto_x_realizado
-- ─────────────────────────────────────────────────────────────────────────
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
         snap.producao_diaria_qtde                as producao_diaria_cpu,
         case when coalesce(sum(pt.duracao_dias_uteis_calc), 0) > 0
              then (sum(pt.quantidade_alocada) / sum(pt.duracao_dias_uteis_calc))::numeric(14,4)
              else null end                       as producao_diaria_plan
    from public.planejamento pl
    join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
    join public.item_orcamentario io on io.id = pt.item_orcamentario_id
    left join public.cpu_snapshot snap on snap.id = io.cpu_snapshot_id
   where pl.is_baseline = true
     and io.indireto_id is null
   group by pl.obra_id, pt.item_orcamentario_id, io.codigo, io.descricao,
            io.unidade_referencia, snap.producao_diaria_qtde
),
plan_periodo as (
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
  select p.obra_id,
         p.item_orcamentario_id                   as item_id,
         sum(p.quantidade * p.fator_conversao)    as quantidade_realizada,
         count(distinct p.data)                   as dias_realizado,
         min(p.data)                              as data_primeira,
         max(p.data)                              as data_ultima
    from public.acompanhamento_producao p
   where p.item_orcamentario_id is not null
   group by p.obra_id, p.item_orcamentario_id
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
    when b.quantidade_planejada is null or b.quantidade_planejada = 0 then null
    else least(1, round((coalesce(pp.qtd_plan_periodo, 0) / b.quantidade_planejada)::numeric, 4))
  end                                                             as pct_esperado_hoje,
  case
    when b.data_fim is null then null
    when r.data_ultima is null then null
    when coalesce(b.producao_diaria_plan, b.producao_diaria_cpu) is null
      or coalesce(b.producao_diaria_plan, b.producao_diaria_cpu) = 0 then null
    else (b.data_fim - (r.data_ultima
                        + ceil(greatest(0, (b.quantidade_planejada - coalesce(r.quantidade_realizada,0)))
                               / coalesce(b.producao_diaria_plan, b.producao_diaria_cpu))::int))::int
  end                                                             as desvio_dias_estimado,
  case
    when b.quantidade_planejada is null then 'sem_plano'
    when r.quantidade_realizada is null then 'nao_iniciado'
    when r.quantidade_realizada >= b.quantidade_planejada then 'concluido'
    when b.data_inicio is null or b.data_fim is null then 'em_andamento'
    when current_date > b.data_fim then 'atrasado'
    when coalesce(pp.qtd_plan_periodo, 0) <= 0 then 'em_andamento'
    else
      case
        when coalesce(r.quantidade_realizada, 0) / nullif(pp.qtd_plan_periodo, 0) >= 1.05 then 'adiantado'
        when coalesce(r.quantidade_realizada, 0) / nullif(pp.qtd_plan_periodo, 0) <  0.7  then 'atrasado'
        when coalesce(r.quantidade_realizada, 0) / nullif(pp.qtd_plan_periodo, 0) <  0.95 then 'em_risco'
        else 'no_prazo'
      end
  end                                                             as status,
  coalesce(pp.qtd_plan_periodo, 0)                                as qtd_plan_periodo,
  coalesce(b.producao_diaria_plan, b.producao_diaria_cpu)         as producao_diaria_plan
from baseline b
left join plan_periodo pp on pp.obra_id = b.obra_id and pp.item_id = b.item_id
left join realizado r      on r.obra_id = b.obra_id and r.item_id = b.item_id;

grant select on public.vw_acompanhamento_previsto_x_realizado to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- vw_acompanhamento_curva_s
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_acompanhamento_curva_s
with (security_invoker = true)
as
with baseline_meta as (
  select pl.obra_id,
         pt.item_orcamentario_id          as item_id,
         io.codigo,
         io.descricao,
         sum(pt.quantidade_alocada)::numeric(14,4) as qtd_plan
    from public.planejamento pl
    join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
    join public.item_orcamentario   io on io.id = pt.item_orcamentario_id
   where pl.is_baseline = true
     and pt.quantidade_alocada is not null
   group by pl.obra_id, pt.item_orcamentario_id, io.codigo, io.descricao
),
planejado_dia_raw as (
  select pl.obra_id,
         pt.item_orcamentario_id              as item_id,
         (ps.semana_segunda + (i || ' days')::interval)::date  as data,
         (ps.quantidade_planejada / 5.0)      as planejado_dia
    from public.planejamento pl
    join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
    join public.planejamento_tarefa_perfil_semana ps on ps.tarefa_id = pt.id
    cross join generate_series(0, 4) as i
   where pl.is_baseline = true
),
real_dia as (
  select p.obra_id,
         p.item_orcamentario_id               as item_id,
         p.data,
         sum(p.quantidade * p.fator_conversao) as qtd
    from public.acompanhamento_producao p
   where p.item_orcamentario_id is not null
   group by p.obra_id, p.item_orcamentario_id, p.data
),
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
                   where pp.obra_id = tp.obra_id and pp.item_id = tp.item_id and pp.data = tp.data), 0) as planejado_dia,
         coalesce((select qtd from real_dia rd
                   where rd.obra_id = tp.obra_id and rd.item_id = tp.item_id and rd.data = tp.data), 0)   as realizado_dia
    from todos_pares tp
)
select
  a.obra_id,
  a.item_id                                                      as item_orcamentario_id,
  bm.codigo                                                      as servico_grupo_codigo,
  bm.descricao                                                   as servico_grupo_descricao,
  a.data                                                         as data,
  a.planejado_dia                                                as planejado_dia,
  sum(a.planejado_dia) over (partition by a.obra_id, a.item_id order by a.data) as planejado_acumulado,
  a.realizado_dia                                                as realizado_dia,
  sum(a.realizado_dia) over (partition by a.obra_id, a.item_id order by a.data) as realizado_acumulado,
  bm.qtd_plan                                                    as qtd_planejada_total
from agregado a
left join baseline_meta bm on bm.obra_id = a.obra_id and bm.item_id = a.item_id;

grant select on public.vw_acompanhamento_curva_s to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- vw_acompanhamento_produtividade_equipe (soma por dia antes dos percentis)
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_acompanhamento_produtividade_equipe
with (security_invoker = true)
as
with dia as (
  select p.obra_id, p.equipe_id, p.item_orcamentario_id, p.servico_id, p.data,
         max(p.servico_nome)                     as servico_nome,
         sum(p.quantidade * p.fator_conversao)   as qtd
    from public.acompanhamento_producao p
   where p.quantidade > 0
   group by p.obra_id, p.equipe_id, p.item_orcamentario_id, p.servico_id, p.data
),
base as (
  select d.*,
         e.nome                                               as equipe_nome,
         e.cor                                                as equipe_cor,
         coalesce(s.unidade, io.unidade_referencia)           as unidade_plano,
         coalesce(ep.producao_diaria, snap.producao_diaria_qtde) as meta
    from dia d
    left join public.equipe e             on e.id = d.equipe_id
    left join public.item_orcamentario io on io.id = d.item_orcamentario_id
    left join public.servico s            on s.id = d.servico_id
    left join public.cpu_snapshot snap    on snap.id = io.cpu_snapshot_id
    left join public.equipe_produtividade ep on ep.equipe_id = d.equipe_id and ep.servico_id = d.servico_id
)
select
  obra_id,
  equipe_id,
  equipe_id                                                       as equipe_planejamento_id,
  coalesce(equipe_nome, '—')                                      as equipe_display_nome,
  coalesce(equipe_nome, '—')                                      as siga_equipe_nome,
  coalesce(equipe_cor, '#94a3b8')                                 as equipe_cor,
  servico_nome,
  servico_id,
  servico_id                                                      as servico_planejamento_id,
  item_orcamentario_id,
  unidade_plano                                                   as unidade,
  count(*)                                                        as registros,
  count(distinct data)                                            as dias_trabalhados,
  sum(qtd)                                                        as qtd_total,
  avg(qtd)                                                        as qtd_media,
  min(qtd)                                                        as qtd_min,
  max(qtd)                                                        as qtd_max,
  percentile_cont(0.5) within group (order by qtd)                as qtd_p50,
  percentile_cont(0.9) within group (order by qtd)                as qtd_p90,
  meta                                                            as producao_diaria_meta,
  meta                                                            as producao_diaria_cpu,
  case when meta is null or meta = 0 then null
       else round((percentile_cont(0.5) within group (order by qtd) / meta)::numeric, 4) end
                                                                  as pct_aderencia_meta,
  case when meta is null or meta = 0 then null
       else round((percentile_cont(0.5) within group (order by qtd) / meta)::numeric, 4) end
                                                                  as pct_aderencia_cpu,
  min(data)                                                       as primeira_data,
  max(data)                                                       as ultima_data
from base
group by obra_id, equipe_id, equipe_nome, equipe_cor, servico_nome, servico_id,
         item_orcamentario_id, unidade_plano, meta;

grant select on public.vw_acompanhamento_produtividade_equipe to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- vw_acompanhamento_heatmap_dia_servico / vw_acompanhamento_frente_kpis
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_acompanhamento_heatmap_dia_servico
with (security_invoker = true)
as
select
  p.obra_id                                                       as obra_id,
  p.data                                                          as data,
  coalesce(io.codigo, p.servico_nome, 'sem_servico')              as servico_label,
  p.item_orcamentario_id                                          as item_orcamentario_id,
  sum(p.quantidade * p.fator_conversao)                           as qtd,
  count(*)                                                        as registros
from public.acompanhamento_producao p
left join public.item_orcamentario io on io.id = p.item_orcamentario_id
group by p.obra_id, p.data, io.codigo, p.servico_nome, p.item_orcamentario_id;

grant select on public.vw_acompanhamento_heatmap_dia_servico to authenticated;

create or replace view public.vw_acompanhamento_frente_kpis
with (security_invoker = true)
as
select
  p.obra_id                                                       as obra_id,
  coalesce(nullif(trim(p.frente), ''), '(sem frente)')            as frente,
  count(*)                                                        as registros,
  count(distinct p.data)                                          as dias_ativos,
  count(distinct p.equipe_id)                                     as equipes_distintas,
  array_remove(array_agg(distinct e.nome order by e.nome), null)  as equipes,
  count(distinct p.item_orcamentario_id)                          as servicos_distintos,
  sum(p.quantidade * p.fator_conversao)                           as qtd_total,
  min(p.data)                                                     as primeira_data,
  max(p.data)                                                     as ultima_data,
  count(*) filter (where p.data >= current_date - interval '7 days') as registros_ultima_semana
from public.acompanhamento_producao p
left join public.equipe e on e.id = p.equipe_id
group by p.obra_id, coalesce(nullif(trim(p.frente), ''), '(sem frente)');

grant select on public.vw_acompanhamento_frente_kpis to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- vw_acompanhamento_obra_resumo (chaveada em obras, não no vínculo SIGA)
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_acompanhamento_obra_resumo
with (security_invoker = true)
as
select
  o.id                                                            as obra_id,
  (select round(
    coalesce(
      sum(coalesce(pr.qtd_real,0) * coalesce(
            io.venda_unitaria,
            io.venda_total_calc / nullif(io.quantidade_referencia, 0),
            0))
      / nullif(sum(coalesce(pr.qtd_plan,0) * coalesce(
            io.venda_unitaria,
            io.venda_total_calc / nullif(io.quantidade_referencia, 0),
            0)), 0),
      0
    )::numeric, 4)
   from public.vw_acompanhamento_previsto_x_realizado pr
   join public.item_orcamentario io on io.id = pr.item_orcamentario_id
   where pr.obra_id = o.id
     and io.indireto_id is null)                                  as avanco_pct,
  (select coalesce(sum(p.quantidade * p.fator_conversao), 0)
     from public.acompanhamento_producao p
    where p.obra_id = o.id and p.data >= current_date - interval '30 days')  as producao_30d_qtd,
  (select count(*)
     from public.acompanhamento_producao p
    where p.obra_id = o.id and p.data >= current_date - interval '30 days')  as producao_30d_registros,
  (select count(distinct data)
     from public.acompanhamento_producao p
    where p.obra_id = o.id and p.data >= current_date - interval '30 days')  as dias_com_apontamento,
  (select count(distinct equipe_id)
     from public.acompanhamento_producao p
    where p.obra_id = o.id and p.data = current_date)             as equipes_ativas_hoje,
  (select count(distinct equipe_id)
     from public.acompanhamento_producao p
    where p.obra_id = o.id and p.data >= current_date - interval '7 days') as equipes_ativas_semana,
  (select count(*) from public.acompanhamento_foto f
    where f.obra_id = o.id and f.excluida_em is null)             as fotos_total,
  (select count(*) from public.acompanhamento_foto f
    where f.obra_id = o.id and f.lat is not null and f.excluida_em is null) as fotos_com_geo,
  (with dias_prod as (
     select distinct data from public.acompanhamento_producao
      where obra_id = o.id and data >= current_date - interval '30 days'),
   dias_foto as (
     select distinct (captured_at at time zone 'America/Sao_Paulo')::date as d
       from public.acompanhamento_foto
      where obra_id = o.id
        and captured_at >= now() - interval '30 days'
        and excluida_em is null)
   select case when (select count(*) from dias_prod) = 0 then null
               else round(((select count(*) from dias_foto)::numeric
                           / (select count(*) from dias_prod))::numeric, 4)
          end)                                                    as cobertura_fotografica_pct,
  (select count(*) from public.acompanhamento_alerta a
    where a.obra_id = o.id and a.status = 'aberto' and a.severidade = 'critical') as alertas_criticos,
  (select count(*) from public.acompanhamento_alerta a
    where a.obra_id = o.id and a.status = 'aberto')               as alertas_abertos_total,
  (select max(p.created_at) from public.acompanhamento_producao p where p.obra_id = o.id) as ultimo_lancamento_em,
  (select max(p.data) from public.acompanhamento_producao p where p.obra_id = o.id)       as data_ultima_producao,
  (select count(*) from public.acompanhamento_producao p where p.obra_id = o.id)          as lancamentos_total
from public.obras o
where o.ativa = true;

grant select on public.vw_acompanhamento_obra_resumo to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- RPCs do CLIENTE (SECURITY DEFINER; escondem preços)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.cliente_curva_s(_obra_id uuid)
returns setof public.vw_acompanhamento_curva_s
language sql stable security definer set search_path = public as $$
  select v.* from public.vw_acompanhamento_curva_s v
   where v.obra_id = _obra_id and public.has_obra_permissao(_obra_id, auth.uid())
$$;

create or replace function public.cliente_previsto_realizado(_obra_id uuid)
returns setof public.vw_acompanhamento_previsto_x_realizado
language sql stable security definer set search_path = public as $$
  select v.* from public.vw_acompanhamento_previsto_x_realizado v
   where v.obra_id = _obra_id and public.has_obra_permissao(_obra_id, auth.uid())
$$;

create or replace function public.cliente_producao(_obra_id uuid)
returns setof public.vw_acompanhamento_producao_enriquecida
language sql stable security definer set search_path = public as $$
  select v.* from public.vw_acompanhamento_producao_enriquecida v
   where v.obra_id = _obra_id and public.has_obra_permissao(_obra_id, auth.uid())
$$;

alter function public.cliente_curva_s(uuid)            owner to postgres;
alter function public.cliente_previsto_realizado(uuid) owner to postgres;
alter function public.cliente_producao(uuid)           owner to postgres;
revoke all on function public.cliente_curva_s(uuid)            from public;
revoke all on function public.cliente_previsto_realizado(uuid) from public;
revoke all on function public.cliente_producao(uuid)           from public;
grant execute on function public.cliente_curva_s(uuid)            to authenticated;
grant execute on function public.cliente_previsto_realizado(uuid) to authenticated;
grant execute on function public.cliente_producao(uuid)           to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Benchmark histórico por código do serviço (obras da mesma empresa)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.acompanhamento_perf_historico(
  p_servico_codigos text[],
  p_obra_atual      uuid
)
returns table (
  n_amostras   int,
  n_outliers   int,
  p25          numeric,
  p50          numeric,
  p75          numeric,
  media_trim   numeric,
  media_bruta  numeric,
  n_obras      int,
  unidade      text
)
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    select o.id
      from public.obras o
     where o.id <> p_obra_atual
       and (
            public.auth_role() = 'god'
         or (public.auth_role() = 'adm'
             and public.obra_empresa(o.id) = public.auth_empresa_id())
         or (public.auth_role() = 'engenheiro'
             and public.has_obra_permissao(o.id, auth.uid()))
         or (public.auth_role() = 'apoio'
             and public.has_obra_permissao(o.id, public.auth_engenheiro_id()))
       )
  ),
  amostras as (
    select p.obra_id, p.equipe_id, p.data,
           sum(p.quantidade * p.fator_conversao) as qtd_dia,
           max(coalesce(s.unidade, p.unidade))   as unidade
      from public.acompanhamento_producao p
      join allowed a on a.id = p.obra_id
      join public.servico s on s.id = p.servico_id
     where s.codigo = any (p_servico_codigos)
       and p.quantidade > 0
     group by p.obra_id, p.equipe_id, p.data
  ),
  bounds as (
    select percentile_cont(0.25) within group (order by qtd_dia) as q1,
           percentile_cont(0.75) within group (order by qtd_dia) as q3
      from amostras
  ),
  marcadas as (
    select a.obra_id, a.qtd_dia, a.unidade,
           (a.qtd_dia < b.q1 - 1.5 * (b.q3 - b.q1)
            or a.qtd_dia > b.q3 + 1.5 * (b.q3 - b.q1)) as is_outlier
      from amostras a
      cross join bounds b
  )
  select count(*) filter (where not is_outlier)::int                                          as n_amostras,
         count(*) filter (where is_outlier)::int                                              as n_outliers,
         percentile_cont(0.25) within group (order by qtd_dia) filter (where not is_outlier)  as p25,
         percentile_cont(0.50) within group (order by qtd_dia) filter (where not is_outlier)  as p50,
         percentile_cont(0.75) within group (order by qtd_dia) filter (where not is_outlier)  as p75,
         avg(qtd_dia) filter (where not is_outlier)                                           as media_trim,
         avg(qtd_dia)                                                                         as media_bruta,
         count(distinct obra_id)::int                                                         as n_obras,
         max(unidade)                                                                         as unidade
    from marcadas;
$$;

alter function public.acompanhamento_perf_historico(text[], uuid) owner to postgres;
revoke all on function public.acompanhamento_perf_historico(text[], uuid) from public;
grant execute on function public.acompanhamento_perf_historico(text[], uuid) to authenticated;
