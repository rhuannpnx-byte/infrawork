-- InfraWork — Acompanhamento (Fase B): views enriquecidas
--
-- 4 views base que juntam:
--   - produção / fotos do cache
--   - matches confirmados (equipe / encarregado / serviço)
--   - tarefa do baseline ativo do Planejamento
--   - CPU snapshot (produção diária esperada)
--
-- security_invoker=true porque queremos que RLS do chamador valha
-- (não bypassar via owner). Cada view acaba sendo filtrada pela RLS
-- de `acompanhamento_producao` / `acompanhamento_foto`.

-- ─────────────────────────────────────────────────────────────────────────
-- vw_acompanhamento_producao_enriquecida
--   Produção + display de equipe (cor cinza se não vinculada) + serviço
--   planejado (servico_id e item_orcamentario) + tarefa do baseline.
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_acompanhamento_producao_enriquecida
with (security_invoker = true)
as
select
  p.id                                                            as id,
  p.obra_id                                                       as obra_id,
  p.siga_producao_id                                              as siga_producao_id,
  p.data                                                          as data,
  p.servico_id                                                    as siga_servico_id,
  p.servico_nome                                                  as siga_servico_nome,
  p.encarregado_id                                                as siga_encarregado_id,
  p.encarregado_nome                                              as siga_encarregado_nome,
  p.equipe_id                                                     as siga_equipe_id,
  p.equipe_nome                                                   as siga_equipe_nome,
  p.qtd                                                           as qtd,
  p.trecho                                                        as trecho,
  p.estaca_inicial                                                as estaca_inicial,
  p.estaca_final                                                  as estaca_final,
  p.obs                                                           as obs,
  p.frente                                                        as frente,
  p.siga_created_at                                               as siga_created_at,
  p.siga_updated_at                                               as siga_updated_at,
  p.sincronizado_em                                               as sincronizado_em,
  -- Match equipe
  em.id                                                           as equipe_match_id,
  em.equipe_id                                                    as equipe_planejamento_id,
  coalesce(e.nome, p.equipe_nome)                                 as equipe_display_nome,
  coalesce(e.cor, '#94a3b8')                                      as equipe_display_cor,
  em.origem                                                       as equipe_match_origem,
  e.tipo                                                          as equipe_tipo,
  -- Match encarregado
  enm.id                                                          as encarregado_match_id,
  coalesce(enm.apelido_canonico, p.encarregado_nome)              as encarregado_display_nome,
  enm.origem                                                      as encarregado_match_origem,
  -- Match serviço
  sm.id                                                           as servico_match_id,
  sm.servico_id                                                   as servico_planejamento_id,
  sm.item_orcamentario_id                                         as item_orcamentario_id,
  s.codigo                                                        as servico_codigo,
  s.nome                                                          as servico_display_nome,
  s.unidade                                                       as servico_unidade,
  io.codigo                                                       as servico_grupo_codigo,
  io.descricao                                                    as servico_grupo_descricao,
  -- Tarefa do baseline
  pt.id                                                           as tarefa_baseline_id,
  pt.data_inicio                                                  as tarefa_data_inicio,
  pt.data_fim                                                     as tarefa_data_fim,
  -- Quantidade de fotos vinculadas
  (select count(*) from public.acompanhamento_foto f
     where f.obra_id = p.obra_id
       and (f.producao_siga_id = p.siga_producao_id
            or (f.servico_executado_id = p.servico_id
                and f.captured_at::date between p.data - interval '1 day' and p.data + interval '1 day')))
                                                                  as fotos_count
from public.acompanhamento_producao p
left join public.acompanhamento_equipe_match em
       on em.obra_id = p.obra_id and em.siga_equipe_nome = p.equipe_nome
left join public.equipe e
       on e.id = em.equipe_id
left join public.acompanhamento_encarregado_match enm
       on enm.obra_id = p.obra_id and enm.siga_encarregado_nome = p.encarregado_nome
left join public.acompanhamento_servico_match sm
       on sm.obra_id = p.obra_id and sm.siga_servico_executado_id = p.servico_id
left join public.servico s
       on s.id = sm.servico_id
left join public.item_orcamentario io
       on io.id = sm.item_orcamentario_id
left join public.planejamento pl
       on pl.obra_id = p.obra_id and pl.is_baseline = true
left join public.planejamento_tarefa pt
       on pt.planejamento_id = pl.id and pt.item_orcamentario_id = sm.item_orcamentario_id;

grant select on public.vw_acompanhamento_producao_enriquecida to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- vw_acompanhamento_foto_enriquecida
--   Foto + serviço + match equipe + correlação com produção
--   (por producao_siga_id direto OU por (servico + data ± 1d) inferida)
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_acompanhamento_foto_enriquecida
with (security_invoker = true)
as
select
  f.id                                                            as id,
  f.obra_id                                                       as obra_id,
  f.siga_foto_id                                                  as siga_foto_id,
  f.producao_siga_id                                              as producao_siga_id,
  f.lat                                                           as lat,
  f.lng                                                           as lng,
  f.servico_executado_id                                          as siga_servico_id,
  f.servico_executado_nome                                        as siga_servico_nome,
  f.encarregado_id                                                as siga_encarregado_id,
  f.encarregado_nome                                              as siga_encarregado_nome,
  f.captured_at                                                   as captured_at,
  (f.captured_at at time zone 'America/Sao_Paulo')::date          as captured_date,
  f.storage_bucket                                                as storage_bucket,
  f.storage_key                                                   as storage_key,
  f.obs                                                           as obs,
  f.size_bytes                                                    as size_bytes,
  f.mime                                                          as mime,
  f.sincronizado_em                                               as sincronizado_em,
  -- match serviço (mesmo do producao)
  sm.id                                                           as servico_match_id,
  sm.servico_id                                                   as servico_planejamento_id,
  s.nome                                                          as servico_display_nome,
  -- match encarregado
  enm.id                                                          as encarregado_match_id,
  coalesce(enm.apelido_canonico, f.encarregado_nome)              as encarregado_display_nome,
  -- match equipe inferido via encarregado vinculado a equipe
  em.id                                                           as equipe_match_id,
  coalesce(e.nome, enm.apelido_canonico, f.encarregado_nome)      as equipe_display_nome,
  coalesce(e.cor, '#94a3b8')                                      as equipe_display_cor,
  -- correlação com produção
  case
    when f.producao_siga_id is not null then 'direto'
    when prod_inferido.id is not null then 'inferido'
    else 'avulso'
  end                                                             as correlacao_producao,
  prod_inferido.id                                                as producao_inferida_id,
  prod_inferido.frente                                            as frente
from public.acompanhamento_foto f
left join public.acompanhamento_servico_match sm
       on sm.obra_id = f.obra_id and sm.siga_servico_executado_id = f.servico_executado_id
left join public.servico s
       on s.id = sm.servico_id
left join public.acompanhamento_encarregado_match enm
       on enm.obra_id = f.obra_id and enm.siga_encarregado_nome = f.encarregado_nome
left join public.acompanhamento_equipe_match em
       on em.id = enm.equipe_match_id
left join public.equipe e
       on e.id = em.equipe_id
left join lateral (
  select p.id, p.frente
    from public.acompanhamento_producao p
   where p.obra_id = f.obra_id
     and p.servico_id = f.servico_executado_id
     and p.data between (f.captured_at at time zone 'America/Sao_Paulo')::date - interval '1 day'
                    and (f.captured_at at time zone 'America/Sao_Paulo')::date + interval '1 day'
   order by abs(extract(epoch from (p.data::timestamp - f.captured_at)))
   limit 1
) prod_inferido on f.producao_siga_id is null;

grant select on public.vw_acompanhamento_foto_enriquecida to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- vw_acompanhamento_previsto_x_realizado
--   Por servico_grupo do baseline ativo: qtd plan vs real, status, datas.
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_acompanhamento_previsto_x_realizado
with (security_invoker = true)
as
with baseline as (
  select pl.obra_id,
         pl.id                       as planejamento_id,
         pt.id                       as tarefa_id,
         pt.item_orcamentario_id     as item_id,
         pt.data_inicio,
         pt.data_fim,
         io.codigo                   as servico_grupo_codigo,
         io.descricao                as servico_grupo_descricao,
         io.quantidade               as quantidade_planejada,
         io.unidade                  as unidade,
         snap.producao_diaria_qtde   as producao_diaria_cpu
    from public.planejamento pl
    join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
    join public.item_orcamentario io on io.id = pt.item_orcamentario_id
    left join public.cpu_snapshot snap on snap.id = io.cpu_snapshot_id
   where pl.is_baseline = true
),
realizado as (
  select sm.obra_id,
         sm.item_orcamentario_id     as item_id,
         sum(p.qtd)                  as quantidade_realizada,
         count(distinct p.data)      as dias_realizado,
         min(p.data)                 as data_primeira,
         max(p.data)                 as data_ultima
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
-- vw_acompanhamento_produtividade_equipe
--   Por (equipe_siga, serviço), agregados de janela: p50/p90, total, %aderência
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
         p.qtd                                                    as qtd
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
  -- aderência à CPU snapshot (precisa join com item_orcamentario.cpu_snapshot_id)
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
