-- InfraWork — Orçamento: view consolidada (lucratividade real, sem duplicar indireto).
--
-- Motivo: o cálculo client-side anterior em useLucratividade() somava indiretos
-- STANDALONE + custo das raízes da planilha (que JÁ inclui indiretos vinculados
-- via FK item_orcamentario.indireto_id → trigger fn_item_orc_linha_calc).
-- Resultado: indireto vinculado contado 2×.
--
-- Esta view server-side filtra os indiretos: soma SÓ os standalone (não-linkados).
-- Os vinculados continuam embutidos no custo_total_calc das raízes do plan_orc.
--
-- Colunas retornadas (1 linha por obra):
--   obra_id, venda_total, custo_direto_calc, custo_indireto_standalone,
--   custo_total, aliquota_total_perc, impostos, lucro_liquido, lucratividade_perc.
--
-- Notas semânticas:
--   * custo_direto_calc inclui indiretos VINCULADOS embutidos como custo de
--     agrupamentos (semântica do schema atual, sem alterar trigger).
--   * custo_indireto_standalone = indiretos da tabela indireto_item que NÃO
--     estão vinculados a nenhum item_orcamentario.indireto_id, ponderados por
--     distribuicao_perc.
--   * lucratividade_perc = lucro_liquido / venda_total (NULL se venda = 0).

drop view if exists public.vw_orcamento_consolidado cascade;

create view public.vw_orcamento_consolidado
with (security_invoker = true)
as
with
-- Soma raízes da planilha: já inclui indiretos vinculados via custo_total_calc.
raizes as (
  select obra_id,
         coalesce(sum(venda_total_calc), 0)::numeric(14, 2)  as venda_total,
         coalesce(sum(custo_total_calc), 0)::numeric(14, 2)  as custo_direto_calc
    from public.item_orcamentario
   where parent_id is null
   group by obra_id
),
-- IDs de indiretos JÁ vinculados a algum item_orcamentario (custo já contabilizado em raizes).
vinculados as (
  select obra_id, indireto_id
    from public.item_orcamentario
   where indireto_id is not null
   group by obra_id, indireto_id
),
-- Soma apenas indiretos STANDALONE (não vinculados), aplicando distribuicao_perc.
indireto_stand as (
  select i.obra_id,
         coalesce(sum(coalesce(i.valor_total, 0) * coalesce(i.distribuicao_perc, 1)), 0)::numeric(14, 2)
           as custo_indireto_standalone
    from public.indireto_item i
   where not exists (
           select 1 from vinculados v
            where v.obra_id = i.obra_id and v.indireto_id = i.id
         )
   group by i.obra_id
),
-- Taxa vigente: pega o registro mais recente com vigência ativa hoje.
taxa as (
  select distinct on (obra_id)
         obra_id,
         coalesce(total_perc_calc, 0)::numeric(7, 4) as aliquota_total_perc
    from public.encargos_sociais_regime
   where ativo = true
     and (vigencia_inicio is null or vigencia_inicio <= current_date)
     and (vigencia_fim    is null or vigencia_fim    >= current_date)
   order by obra_id, vigencia_inicio desc nulls last
)
select
  o.id                                                                          as obra_id,
  coalesce(r.venda_total, 0)                                                    as venda_total,
  coalesce(r.custo_direto_calc, 0)                                              as custo_direto_calc,
  coalesce(s.custo_indireto_standalone, 0)                                      as custo_indireto_standalone,
  (coalesce(r.custo_direto_calc, 0) + coalesce(s.custo_indireto_standalone, 0)) as custo_total,
  coalesce(t.aliquota_total_perc, 0)                                            as aliquota_total_perc,
  (coalesce(r.venda_total, 0) * coalesce(t.aliquota_total_perc, 0))::numeric(14, 2)
                                                                                as impostos,
  (
    coalesce(r.venda_total, 0)
    - coalesce(r.custo_direto_calc, 0)
    - coalesce(s.custo_indireto_standalone, 0)
    - (coalesce(r.venda_total, 0) * coalesce(t.aliquota_total_perc, 0))
  )::numeric(14, 2)                                                             as lucro_liquido,
  case
    when coalesce(r.venda_total, 0) = 0 then null
    else round(
      (
        (
          coalesce(r.venda_total, 0)
          - coalesce(r.custo_direto_calc, 0)
          - coalesce(s.custo_indireto_standalone, 0)
          - (coalesce(r.venda_total, 0) * coalesce(t.aliquota_total_perc, 0))
        )
        / nullif(coalesce(r.venda_total, 0), 0)
      )::numeric, 4
    )
  end                                                                           as lucratividade_perc
from public.obras o
left join raizes         r on r.obra_id = o.id
left join indireto_stand s on s.obra_id = o.id
left join taxa           t on t.obra_id = o.id;

grant select on public.vw_orcamento_consolidado to authenticated;

comment on view public.vw_orcamento_consolidado is
  'Lucratividade real por obra. Filtra indiretos vinculados (já incluídos em custo_direto_calc via FK item_orcamentario.indireto_id) pra não duplicar. Single source of truth do hook useLucratividade.';
