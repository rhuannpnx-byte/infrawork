-- Permite que um servico_grupo da planilha orçamentária seja vinculado a um
-- indireto_item (alternativa ao link com CPU). Custo do agrupador passa a ser
-- = indireto_item.valor_total × quantidade_referencia.
--
-- Também relaxa a constraint chk_indireto_tipo (a planilha TecPav tem
-- categorias muito mais ricas que os 4 valores originais — mobilizacao,
-- desmob, admin_local, outros). Vira opcional/livre.

-- ─── 1. indireto_item.tipo livre ──────────────────────────────────────────
alter table public.indireto_item drop constraint if exists chk_indireto_tipo;
-- Mantém a coluna pra categorização, mas sem CHECK. Pode armazenar texto livre.

-- ─── 2. item_orcamentario.indireto_id ─────────────────────────────────────
alter table public.item_orcamentario
  add column if not exists indireto_id uuid
  references public.indireto_item(id) on delete set null;

create index if not exists idx_item_orc_indireto on public.item_orcamentario(indireto_id);

-- ─── 3. Atualiza chk_item_orc_tipo_coerencia ──────────────────────────────
alter table public.item_orcamentario drop constraint if exists chk_item_orc_tipo_coerencia;

do $$ begin
  alter table public.item_orcamentario
    add constraint chk_item_orc_tipo_coerencia
    check (
      (tipo = 'receita'
         and unidade is not null and quantidade is not null and venda_unitaria is not null
         and servico_id is null and cpu_snapshot_id is null and indireto_id is null
         and quantidade_referencia is null and unidade_referencia is null
         and qtd_ref_modo is null and qtd_ref_filhos is null)
      or
      (tipo = 'servico_grupo'
         -- Linkado a CPU OU a indireto (mutuamente exclusivos).
         and (
           (servico_id is not null and indireto_id is null)
           or (servico_id is null and indireto_id is not null)
         )
         and quantidade_referencia is not null and unidade_referencia is not null
         and qtd_ref_modo is not null
         and unidade is null and quantidade is null and venda_unitaria is null)
      or
      (tipo = 'etapa'
         and servico_id is null and cpu_snapshot_id is null and indireto_id is null
         and quantidade_referencia is null and unidade_referencia is null
         and qtd_ref_modo is null and qtd_ref_filhos is null
         and unidade is null and quantidade is null and venda_unitaria is null)
    );
exception when duplicate_object then null; end $$;

-- ─── 4. Trigger de cálculo: lida com indireto-linked servico_grupo ────────
create or replace function public.fn_item_orc_linha_calc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  snap_custo_unit numeric(14,4);
  ind_valor       numeric(14,2);
begin
  new.updated_at := now();

  if new.tipo = 'receita' then
    new.custo_unitario_calc     := null;
    new.custo_total_calc        := 0;
    new.venda_total_calc        := coalesce(new.quantidade, 0) * coalesce(new.venda_unitaria, 0);
    new.lucratividade_perc_calc := null;
  elsif new.tipo = 'servico_grupo' then
    if new.indireto_id is not null then
      -- Linkado a indireto: custo = indireto.valor_total × qtd_ref
      select valor_total into ind_valor
        from public.indireto_item where id = new.indireto_id;
      new.custo_unitario_calc := coalesce(ind_valor, 0);
      new.custo_total_calc    := coalesce(new.quantidade_referencia, 0)
                                 * new.custo_unitario_calc;
    else
      -- Linkado a CPU (comportamento legado)
      if new.cpu_snapshot_id is not null then
        select custo_unit into snap_custo_unit
          from public.cpu_snapshot where id = new.cpu_snapshot_id;
      else
        snap_custo_unit := 0;
      end if;
      new.custo_unitario_calc := coalesce(snap_custo_unit, 0);
      new.custo_total_calc    := coalesce(new.quantidade_referencia, 0)
                                 * new.custo_unitario_calc;
    end if;
    -- venda_total_calc e lucratividade_perc_calc são preenchidos por recalcular_orcamento
  else
    -- etapa: rollup gerencia *_calc
    new.custo_unitario_calc := null;
  end if;

  return new;
end
$$;

alter function public.fn_item_orc_linha_calc() owner to postgres;
