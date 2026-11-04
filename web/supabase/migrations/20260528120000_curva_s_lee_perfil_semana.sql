-- InfraWork — vw_acompanhamento_curva_s passa a ler de planejamento_tarefa_perfil_semana.
--
-- Antes: planejado_dia = quantidade_referencia / dias_plan, distribuido
-- uniformemente entre data_inicio e data_fim da tarefa baseline (ignorando
-- shape real e dias uteis).
--
-- Agora: planejado_dia vem do perfil_semana. Pra cada semana do perfil
-- (segunda-feira ISO), distribui quantidade_planejada igualmente entre os
-- 5 dias uteis padrao (seg-sex) daquela semana.
--
-- Limitacoes assumidas pra simplificar (todas documentadas, fica como
-- follow-up se precisar fidelidade total):
--   * Usa 5 dias uteis fixos (seg-sex) por semana, NAO o obra_calendario
--     real. Semanas com feriado/excecao ainda dividem por 5.
--   * Nao aplica fator_mes na granularidade DIARIA aqui — o fator ja foi
--     aplicado no edge function calcular-cronograma ao GERAR o perfil_semana,
--     entao quantidade_planejada na coluna ja reflete o fator. So a
--     distribuicao por dia dentro da semana e simplificada.
--   * Tarefas baseline sem perfil_semana (nao rodou backfill ainda) somem
--     do planejado — aparecerao apenas via realizado se houver SIGA.
--
-- Compat de schema: a view continua expondo o MESMO conjunto de colunas
-- (obra_id, item_orcamentario_id, servico_grupo_codigo, servico_grupo_descricao,
-- data, planejado_dia, planejado_acumulado, realizado_dia,
-- realizado_acumulado, qtd_planejada_total). Consumidores nao mudam.

drop view if exists public.vw_acompanhamento_curva_s cascade;

create view public.vw_acompanhamento_curva_s
with (security_invoker = true)
as
with baseline_meta as (
  -- 1 linha por (obra, item) — info base do item baseline (sem expandir por semana)
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
),
planejado_dia_raw as (
  -- expande cada semana do perfil em 5 dias uteis (seg-sex), cada dia
  -- recebe qtd_semana / 5.
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
