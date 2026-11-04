-- ─────────────────────────────────────────────────────────────────────────
-- Recria vw_orcamento_consolidado expondo os indiretos vinculados.
-- ─────────────────────────────────────────────────────────────────────────
-- Contexto: o card "Custo Indireto" na página Lucratividade mostrava apenas
-- os indiretos STANDALONE (não vinculados a nenhum agrupador da planilha).
-- Os indiretos VINCULADOS estavam embutidos em `custo_direto_calc` (porque
-- o agrupador da planilha tem `custo_total_calc = qtd_ref × indireto.valor`
-- via trigger). Isso enganava o usuário — visualmente parecia que faltavam
-- indiretos.
--
-- Nova apresentação:
--   custo_direto_real      = custo_direto_calc − custo_indireto_vinculado
--   custo_indireto_total   = custo_indireto_standalone + custo_indireto_vinculado
--   custo_total            = igual (não muda)
--   lucro_liquido          = igual (não muda)
--
-- Os campos antigos continuam expostos pra manter compat com outros consumers.

drop view if exists public.vw_orcamento_consolidado cascade;

create view public.vw_orcamento_consolidado
with (security_invoker = true)
as
with
raizes as (
  select obra_id,
         coalesce(sum(venda_total_calc), 0)::numeric(14, 2)  as venda_total,
         coalesce(sum(custo_total_calc), 0)::numeric(14, 2)  as custo_direto_calc
    from public.item_orcamentario
   where parent_id is null
   group by obra_id
),
vinculados as (
  select obra_id, indireto_id
    from public.item_orcamentario
   where indireto_id is not null
   group by obra_id, indireto_id
),
-- Soma dos indiretos VINCULADOS a agrupadores da planilha. Cada item desses
-- já contribuiu pra `custo_direto_calc` via rollup das raízes; aqui apenas
-- expomos esse subtotal pra exibição separada no card "Custo Indireto".
indireto_vinc as (
  select io.obra_id,
         coalesce(sum(io.custo_total_calc), 0)::numeric(14, 2) as custo_indireto_vinculado
    from public.item_orcamentario io
   where io.indireto_id is not null
   group by io.obra_id
),
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
  coalesce(v.custo_indireto_vinculado, 0)                                       as custo_indireto_vinculado,
  (coalesce(r.custo_direto_calc, 0) - coalesce(v.custo_indireto_vinculado, 0))  as custo_direto_real,
  (coalesce(s.custo_indireto_standalone, 0) + coalesce(v.custo_indireto_vinculado, 0))
                                                                                as custo_indireto_total,
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
left join indireto_vinc  v on v.obra_id = o.id
left join taxa           t on t.obra_id = o.id;

grant select on public.vw_orcamento_consolidado to authenticated;

comment on view public.vw_orcamento_consolidado is
  'Lucratividade real por obra. Expõe indiretos VINCULADOS (custo_indireto_vinculado) separado dos standalone, e custo_direto_real (sem indiretos embutidos), pra a UI mostrar os cards corretamente sem duplicar o lucro.';
