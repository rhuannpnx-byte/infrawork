-- Atualiza fn_cpu_item_calc para suportar quantidade explícita em items
-- COMBUSTIVEL.
--
-- Motivação: a planilha TecPav v1.8 tem CPUs (ex.: CPU_Conserva) com MAIS
-- de um combustível (diesel + gasolina). Cada COMB linha usa uma fórmula
-- customizada que aloca litros para o combustível específico — não é o
-- SUMPRODUCT total dos equipamentos. Importar fielmente exige que aceitemos
-- uma `quantidade` explícita na linha COMB; quando definida (> 0), o cálculo
-- usa esse valor direto em vez de agregar EQ items. Quando NULL/0, mantém
-- comportamento legado (SUMPRODUCT) — assim CPUs editadas no InfraWork (sem
-- planilha) continuam funcionando.

create or replace function public.fn_cpu_item_calc()
returns trigger
language plpgsql
as $$
declare
  preco              numeric(14,4);
  prod_diaria        numeric(14,4);
  total_combustivel  numeric(14,4);
begin
  preco := public.preco_vigente_recurso(new.recurso_id);
  if preco is null then preco := 0; end if;

  new.updated_at := now();

  case new.grupo
    when 'EQUIPAMENTO' then
      new.custo_total_calc := coalesce(new.quantidade, 0)
                             * preco
                             * coalesce(new.horas_dia, 0);
    when 'MO' then
      new.custo_total_calc := coalesce(new.quantidade, 0)
                             * preco
                             * coalesce(new.horas_dia, 0);
    when 'MATERIAL' then
      if new.consumo_material_por_unid is not null then
        select producao_diaria_qtde into prod_diaria
          from public.cpu where id = new.cpu_id;
        new.custo_total_calc := coalesce(new.consumo_material_por_unid, 0)
                               * coalesce(prod_diaria, 0)
                               * preco;
      else
        new.custo_total_calc := coalesce(new.quantidade, 0) * preco;
      end if;
    when 'COMBUSTIVEL' then
      -- Override: quando a planilha importou uma quantidade calculada
      -- específica (ex.: gasolina alocada só para a roçadeira), usa direto.
      if coalesce(new.quantidade, 0) > 0 then
        new.custo_total_calc := new.quantidade * preco;
      else
        -- Comportamento legado: agrega EQ items dessa CPU.
        select coalesce(sum(
                 coalesce(ci.quantidade, 0)
               * coalesce(ci.consumo_combustivel_lh, 0)
               * coalesce(ci.horas_dia, 0)
               * coalesce(ci.indice_produtividade, 1)
               ), 0)
          into total_combustivel
          from public.cpu_item ci
         where ci.cpu_id = new.cpu_id
           and ci.grupo  = 'EQUIPAMENTO';
        new.custo_total_calc := total_combustivel * preco;
      end if;
  end case;
  return new;
end
$$;
