-- Diagnóstico: duplicação de lançamentos na página Produção (acompanhamento)
-- Read-only. Mede fan-out dos JOINs da vw_acompanhamento_producao_enriquecida.

\echo '== 1) Fan-out global: linhas da view-skeleton vs lançamentos distintos =='
select
  count(*)                       as total_linhas_join,
  count(distinct p.id)           as producoes_distintas,
  count(*) - count(distinct p.id) as linhas_duplicadas
from public.acompanhamento_producao p
left join public.acompanhamento_equipe_match em
       on em.obra_id = p.obra_id and em.siga_equipe_nome = p.equipe_nome
left join public.acompanhamento_encarregado_match enm
       on enm.obra_id = p.obra_id and enm.siga_encarregado_nome = p.encarregado_nome
left join public.acompanhamento_servico_match sm
       on sm.obra_id = p.obra_id and sm.siga_servico_executado_id = p.servico_id
left join public.planejamento pl
       on pl.obra_id = p.obra_id and pl.is_baseline = true
left join public.planejamento_tarefa pt
       on pt.planejamento_id = pl.id and pt.item_orcamentario_id = sm.item_orcamentario_id;

\echo '== 2) Por obra: lançamentos distintos vs linhas geradas pelo join =='
select
  p.obra_id,
  count(distinct p.id)                       as producoes,
  count(*)                                   as linhas_join,
  round(count(*)::numeric / nullif(count(distinct p.id),0), 2) as fator
from public.acompanhamento_producao p
left join public.acompanhamento_equipe_match em
       on em.obra_id = p.obra_id and em.siga_equipe_nome = p.equipe_nome
left join public.acompanhamento_encarregado_match enm
       on enm.obra_id = p.obra_id and enm.siga_encarregado_nome = p.encarregado_nome
left join public.acompanhamento_servico_match sm
       on sm.obra_id = p.obra_id and sm.siga_servico_executado_id = p.servico_id
left join public.planejamento pl
       on pl.obra_id = p.obra_id and pl.is_baseline = true
left join public.planejamento_tarefa pt
       on pt.planejamento_id = pl.id and pt.item_orcamentario_id = sm.item_orcamentario_id
group by p.obra_id
having count(*) > count(distinct p.id)
order by fator desc;

\echo '== 3) Suspeito #1: obras com MAIS DE UMA baseline (is_baseline=true) =='
select obra_id, count(*) as n_baselines
from public.planejamento
where is_baseline = true
group by obra_id
having count(*) > 1
order by n_baselines desc;

\echo '== 4) Suspeito #2: item_orcamentario repetido em tarefas da MESMA baseline =='
select pl.obra_id, pt.planejamento_id, pt.item_orcamentario_id, count(*) as n_tarefas
from public.planejamento pl
join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
where pl.is_baseline = true and pt.item_orcamentario_id is not null
group by pl.obra_id, pt.planejamento_id, pt.item_orcamentario_id
having count(*) > 1
order by n_tarefas desc
limit 30;

\echo '== 5) Suspeito #3: match de equipe duplicado (mesmo obra_id+nome) =='
select obra_id, siga_equipe_nome, count(*) as n
from public.acompanhamento_equipe_match
group by obra_id, siga_equipe_nome having count(*) > 1 order by n desc limit 20;

\echo '== 6) Suspeito #4: match de encarregado duplicado =='
select obra_id, siga_encarregado_nome, count(*) as n
from public.acompanhamento_encarregado_match
group by obra_id, siga_encarregado_nome having count(*) > 1 order by n desc limit 20;

\echo '== 7) Suspeito #5: match de servico duplicado =='
select obra_id, siga_servico_executado_id, count(*) as n
from public.acompanhamento_servico_match
group by obra_id, siga_servico_executado_id having count(*) > 1 order by n desc limit 20;

\echo '== 8) Confirmacao final: ids da view que aparecem >1 vez (amostra) =='
select id as siga_producao_view_id, count(*) as repeticoes
from public.vw_acompanhamento_producao_enriquecida
group by id
having count(*) > 1
order by repeticoes desc
limit 20;
