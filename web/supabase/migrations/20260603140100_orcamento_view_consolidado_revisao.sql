-- InfraWork — Orçamento: função consolidada por revisão (sem duplicar indireto).
--
-- Espelha a lógica de vw_orcamento_consolidado mas opera sobre o snapshot JSONB
-- de uma revisao_orcamento — usado pela tela de comparação entre revisões.
--
-- Para revisões 'aprovada'/'homologada', os totais ficam congelados em
-- revisao_orcamento.custo_total/venda_total/lucratividade_perc. Esta função
-- recalcula a partir do JSONB com a mesma fórmula da view atual (consistência
-- entre "revisão" e "estado vivo").
--
-- Retorna 1 linha com as mesmas colunas de vw_orcamento_consolidado +
-- revisao_id, versao, status, rotulo (pra cabeçalho dos cards).

create or replace function public.vw_orcamento_consolidado_revisao(_revisao_id uuid)
returns table (
  revisao_id uuid,
  versao int,
  status text,
  rotulo text,
  obra_id uuid,
  venda_total numeric,
  custo_direto_calc numeric,
  custo_indireto_standalone numeric,
  custo_total numeric,
  aliquota_total_perc numeric,
  impostos numeric,
  lucro_liquido numeric,
  lucratividade_perc numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  snap jsonb;
  v_obra_id uuid;
  v_venda numeric(14, 2) := 0;
  v_custo_direto numeric(14, 2) := 0;
  v_indireto_stand numeric(14, 2) := 0;
  v_aliquota numeric(7, 4) := 0;
  v_versao int;
  v_status text;
  v_rotulo text;
  vinculados_set jsonb;
begin
  -- Lê snapshot + metadata da revisão.
  select r.snapshot, r.obra_id, r.versao, r.status, r.rotulo
    into snap, v_obra_id, v_versao, v_status, v_rotulo
    from public.revisao_orcamento r
   where r.id = _revisao_id;

  if snap is null then
    return;
  end if;

  -- Set de IDs de indiretos vinculados a algum item via item_orcamentario.indireto_id.
  -- Coletado do array snapshot.itens (filtrando indireto_id IS NOT NULL).
  select coalesce(jsonb_agg(elem -> 'indireto_id'), '[]'::jsonb)
    into vinculados_set
    from jsonb_array_elements(coalesce(snap -> 'itens', '[]'::jsonb)) elem
   where elem ? 'indireto_id' and (elem ->> 'indireto_id') is not null;

  -- venda_total + custo_direto_calc: soma raízes (parent_id IS NULL) do snapshot.
  -- custo_total_calc das raízes já inclui indiretos vinculados via trigger no
  -- momento do snapshot (consistente com a view atual).
  select
    coalesce(sum((elem ->> 'venda_total_calc')::numeric), 0),
    coalesce(sum((elem ->> 'custo_total_calc')::numeric), 0)
    into v_venda, v_custo_direto
    from jsonb_array_elements(coalesce(snap -> 'itens', '[]'::jsonb)) elem
   where (elem ->> 'parent_id') is null;

  -- custo_indireto_standalone: indiretos do snapshot que NÃO estão em vinculados_set.
  select coalesce(sum(
            (elem ->> 'valor_total')::numeric
          * coalesce((elem ->> 'distribuicao_perc')::numeric, 1)
         ), 0)
    into v_indireto_stand
    from jsonb_array_elements(coalesce(snap -> 'indireto', '[]'::jsonb)) elem
   where not (vinculados_set @> jsonb_build_array(elem ->> 'id'));

  -- Alíquota total: pega do regime tributário VIGENTE NA OBRA HOJE (mesmo
  -- comportamento da view atual). Snapshot não captura taxa por design.
  select coalesce(total_perc_calc, 0)
    into v_aliquota
    from public.encargos_sociais_regime
   where obra_id = v_obra_id
     and ativo = true
     and (vigencia_inicio is null or vigencia_inicio <= current_date)
     and (vigencia_fim    is null or vigencia_fim    >= current_date)
   order by vigencia_inicio desc nulls last
   limit 1;

  return query
    select
      _revisao_id,
      v_versao,
      v_status,
      v_rotulo,
      v_obra_id,
      v_venda,
      v_custo_direto,
      v_indireto_stand,
      (v_custo_direto + v_indireto_stand)::numeric(14, 2)               as custo_total,
      v_aliquota,
      (v_venda * v_aliquota)::numeric(14, 2)                            as impostos,
      (v_venda - v_custo_direto - v_indireto_stand - v_venda * v_aliquota)::numeric(14, 2)
                                                                        as lucro_liquido,
      case
        when v_venda = 0 then null
        else round(((v_venda - v_custo_direto - v_indireto_stand - v_venda * v_aliquota)
                    / nullif(v_venda, 0))::numeric, 4)
      end                                                               as lucratividade_perc;
end
$$;

alter function public.vw_orcamento_consolidado_revisao(uuid) owner to postgres;
revoke all on function public.vw_orcamento_consolidado_revisao(uuid) from public;
grant execute on function public.vw_orcamento_consolidado_revisao(uuid) to authenticated, service_role;

comment on function public.vw_orcamento_consolidado_revisao(uuid) is
  'Recalcula lucratividade a partir do snapshot JSONB de uma revisão, usando a mesma fórmula de vw_orcamento_consolidado (filtra indiretos vinculados pra não duplicar). Usado na tela de comparação entre revisões.';
