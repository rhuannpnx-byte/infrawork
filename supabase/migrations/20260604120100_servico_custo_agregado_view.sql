-- ─────────────────────────────────────────────────────────────────────────
-- vw_servico_custo_agregado: custo unitário do servico-agregador
-- ─────────────────────────────────────────────────────────────────────────
-- Custo = Σ (cpu.custo_unit_calc / link.fator) sobre todas as CPUs
-- vinculadas via servico_cpu_link.
--
-- Produção diária efetiva: se servico.producao_diaria_qtde IS NULL, herda
-- da 1ª CPU vinculada (ordem 1, ou menor ordem). Se nenhuma CPU vinculada,
-- producao_diaria fica NULL e custo_unit_agregado também.
--
-- Servicos sem vínculos (servico-folha clássico) aparecem na view com
-- 0 cpus_vinculadas e custo_unit_agregado NULL — frontend interpreta como
-- "ainda usa o modelo legado (1 CPU vigente)".

create or replace view public.vw_servico_custo_agregado as
with link_custos as (
  select
    l.servico_id,
    l.cpu_id,
    l.fator,
    l.ordem,
    c.custo_unit_calc,
    c.producao_diaria_qtde   as cpu_producao_qtde,
    c.producao_diaria_unidade as cpu_producao_unidade,
    case
      when l.fator is null or l.fator = 0 then null
      else c.custo_unit_calc / l.fator
    end as contribuicao_custo
  from public.servico_cpu_link l
  join public.cpu c on c.id = l.cpu_id
),
agregado as (
  select
    servico_id,
    count(*)                                  as cpus_vinculadas,
    sum(contribuicao_custo)                   as custo_unit_agregado,
    (
      select cpu_producao_qtde
        from link_custos l2
       where l2.servico_id = lc.servico_id
       order by l2.ordem, l2.cpu_id
       limit 1
    ) as primeira_cpu_producao_qtde,
    (
      select cpu_producao_unidade
        from link_custos l2
       where l2.servico_id = lc.servico_id
       order by l2.ordem, l2.cpu_id
       limit 1
    ) as primeira_cpu_producao_unidade
  from link_custos lc
  group by servico_id
)
select
  s.id                              as servico_id,
  s.obra_id                         as obra_id,
  s.codigo                          as codigo,
  s.nome                            as nome,
  s.unidade                         as unidade,
  coalesce(a.cpus_vinculadas, 0)    as cpus_vinculadas,
  a.custo_unit_agregado             as custo_unit_agregado,
  coalesce(s.producao_diaria_qtde, a.primeira_cpu_producao_qtde) as producao_diaria_efetiva,
  coalesce(s.producao_diaria_unidade, a.primeira_cpu_producao_unidade, 'DIA') as producao_diaria_unidade_efetiva,
  case
    when coalesce(a.cpus_vinculadas, 0) > 0 then 'agregador'
    else 'legado'
  end as modo
from public.servico s
left join agregado a on a.servico_id = s.id;

comment on view public.vw_servico_custo_agregado is
  'Custo unitário agregado do servico (= Σ cpu.custo_unit / fator). Servicos sem vínculos retornam modo=legado e custo_unit_agregado NULL.';
