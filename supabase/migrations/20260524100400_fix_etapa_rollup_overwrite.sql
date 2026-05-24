-- InfraWork — Orçamento — fix rollup das etapas
--
-- Bug: fn_item_orc_linha_calc é BEFORE INSERT/UPDATE e, para tipo='etapa',
-- forçava `venda_total_calc := 0` e `custo_total_calc := 0`. Quando
-- recalcular_orcamento dispara o UPDATE da rollup (SET venda_total_calc = SUM(filhos)),
-- o trigger sobrescrevia os valores com 0 → pais sempre ficavam zerados.
--
-- Fix: para etapas, o trigger NÃO mexe nos *_calc — eles são responsabilidade
-- exclusiva da função recalcular_orcamento. Defaults da tabela (DEFAULT 0)
-- garantem que INSERT sem valor explícito comece em zero.
--
-- Receitas e servico_grupo continuam idênticos.
create or replace function public.fn_item_orc_linha_calc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  snap_custo_unit numeric(14,4);
begin
  new.updated_at := now();

  if new.tipo = 'receita' then
    new.custo_unitario_calc     := null;
    new.custo_total_calc        := 0;
    new.venda_total_calc        := coalesce(new.quantidade, 0) * coalesce(new.venda_unitaria, 0);
    new.lucratividade_perc_calc := null;
  elsif new.tipo = 'servico_grupo' then
    if new.cpu_snapshot_id is not null then
      select custo_unit into snap_custo_unit
        from public.cpu_snapshot where id = new.cpu_snapshot_id;
    else
      snap_custo_unit := 0;
    end if;
    new.custo_unitario_calc := coalesce(snap_custo_unit, 0);
    new.custo_total_calc    := coalesce(new.quantidade_referencia, 0) * new.custo_unitario_calc;
    -- venda_total_calc e lucratividade_perc_calc preenchidos por recalcular_orcamento
  else
    -- etapa: NÃO mexe nos *_calc. Eles são gerenciados exclusivamente pela
    -- função recalcular_orcamento (rollup). custo_unitario_calc fica null.
    new.custo_unitario_calc := null;
  end if;

  return new;
end
$$;

alter function public.fn_item_orc_linha_calc() owner to postgres;

-- Reaplica rollup pra obras existentes (recálculo seguro pós-fix)
-- (não executa automaticamente; usuário precisa clicar em "Recalcular" ou
-- abrir a página — o frontend dispara automaticamente em algumas ações)
