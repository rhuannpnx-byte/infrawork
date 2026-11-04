-- InfraWork — vw_acompanhamento_produtividade_equipe ganha:
--   * unidade (do orcamento; mesmo unidade que qtd_total/qtd_p50 etc apos
--     o fator_conversao do match)
--
-- Sem isso, o card "Produtividade por equipe" no dashboard nao tem como
-- mostrar a unidade certa quando agrega multiplos servicos com unidades
-- distintas (m² / m³ / t).

drop view if exists public.vw_acompanhamento_produtividade_equipe cascade;

create view public.vw_acompanhamento_produtividade_equipe
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
         coalesce(s.unidade, io.unidade_referencia, io.unidade)   as unidade_plano,
         p.data                                                   as data,
         p.qtd * coalesce(sm.fator_conversao, 1)                  as qtd
    from public.acompanhamento_producao p
    left join public.acompanhamento_equipe_match em
           on em.obra_id = p.obra_id and em.siga_equipe_nome = p.equipe_nome
    left join public.equipe e on e.id = em.equipe_id
    left join public.acompanhamento_servico_match sm
           on sm.obra_id = p.obra_id and sm.siga_servico_executado_id = p.servico_id
    left join public.servico s on s.id = sm.servico_id
    left join public.item_orcamentario io on io.id = sm.item_orcamentario_id
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
  unidade_plano                                                   as unidade,
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
         servico_planejamento_id, item_orcamentario_id, unidade_plano;

grant select on public.vw_acompanhamento_produtividade_equipe to authenticated;
