/**
 * Cálculo de custo de CPU no client (preview).
 *
 * IMPORTANTE: a fonte da verdade é o backend (triggers Postgres). Estas
 * funções existem só para mostrar o custo recalculando ao vivo enquanto o
 * usuário edita itens — antes de salvar. Após save, o servidor reescreve os
 * campos `*_calc` e o React Query refetch-a o registro.
 */

import Decimal from 'decimal.js'
import { add, dec, div, mul, sum } from '@/lib/money'
import type { CpuItemGrupo } from '@/types/orcamento'

export interface CpuItemPreview {
  grupo: CpuItemGrupo
  quantidade: number | string
  horas_dia: number | string | null
  consumo_combustivel_lh: number | string | null
  indice_produtividade: number | string
  consumo_material_por_unid: number | string | null
  /** Preço vigente do recurso. */
  preco_unitario: number | string
}

/**
 * Custo de uma única linha. Espelha `fn_cpu_item_calc()`.
 */
export function calcCpuItemCusto(
  item: CpuItemPreview,
  contextoCombustivel: CpuItemPreview[] = []
): Decimal {
  const preco = dec(item.preco_unitario)
  switch (item.grupo) {
    case 'EQUIPAMENTO':
    case 'MO':
      return mul(mul(dec(item.quantidade), preco), dec(item.horas_dia))
    case 'MATERIAL':
      if (item.consumo_material_por_unid !== null && item.consumo_material_por_unid !== '') {
        // Quem chama precisa passar producao_diaria como `quantidade` aqui;
        // o caller passa `consumo_material_por_unid * producao_diaria * preco`.
        // Para simplificar, exigimos `quantidade` = producao_diaria_qtde.
        return mul(mul(dec(item.consumo_material_por_unid), dec(item.quantidade)), preco)
      }
      return mul(dec(item.quantidade), preco)
    case 'COMBUSTIVEL': {
      // SOMA sobre EQUIPAMENTOS do contexto.
      const totalCombustivelDia = sum(
        contextoCombustivel
          .filter((it) => it.grupo === 'EQUIPAMENTO')
          .map((it) =>
            mul(
              mul(mul(dec(it.quantidade), dec(it.consumo_combustivel_lh)), dec(it.horas_dia)),
              dec(it.indice_produtividade ?? 1)
            )
          )
      )
      return mul(totalCombustivelDia, preco)
    }
  }
}

/** Soma de custos por grupo (dia). */
export function calcCustosPorGrupo(itens: CpuItemPreview[]): {
  eq: Decimal
  comb: Decimal
  mo: Decimal
  mat: Decimal
} {
  let eq = new Decimal(0)
  let comb = new Decimal(0)
  let mo = new Decimal(0)
  let mat = new Decimal(0)

  for (const it of itens) {
    const custo = calcCpuItemCusto(it, itens)
    switch (it.grupo) {
      case 'EQUIPAMENTO':
        eq = add(eq, custo)
        break
      case 'COMBUSTIVEL':
        comb = add(comb, custo)
        break
      case 'MO':
        mo = add(mo, custo)
        break
      case 'MATERIAL':
        mat = add(mat, custo)
        break
    }
  }
  return { eq, comb, mo, mat }
}

/** Custo total por dia (soma dos 4 grupos). */
export function calcCustoTotalDia(itens: CpuItemPreview[]): Decimal {
  const c = calcCustosPorGrupo(itens)
  return add(add(c.eq, c.comb), add(c.mo, c.mat))
}

/** Custo unitário = custo_dia / producao_diaria. */
export function calcCustoUnitario(
  itens: CpuItemPreview[],
  producaoDiaria: number | string
): Decimal {
  const total = calcCustoTotalDia(itens)
  return div(total, producaoDiaria)
}
