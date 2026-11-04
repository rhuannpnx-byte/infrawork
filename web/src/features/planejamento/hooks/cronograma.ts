import type { PlanejamentoTarefaCompleta } from '@/types/planejamento'

// ─── Curva-S planejada (custo + receita) ────────────────────────────────
// Puxa de perfil_semanas (jsonb_agg da view v10). Por semana, distribui:
//   - Custo: quantidade_planejada × custo_unit_snapshot  (direta)
//            ou custo_total_indireto × fração_semana      (indireta — distribuído
//            pelo intervalo data_inicio..data_fim da indireta)
//   - Receita: quantidade_planejada × venda_unitaria_item (direta)
//              ou receita_total_indireto × fração_semana   (indireta)
//
// Tarefas indiretas não têm perfil semanal (são distribuídas linearmente entre
// data_inicio e data_fim por semana ISO, segunda-a-segunda).

export interface CurvaSBucket {
  periodo: string // 'YYYY-MM-DD' (segunda da semana)
  custo_periodo: number
  custo_acumulado: number
  receita_periodo: number
  receita_acumulada: number
  /** Mantido pra retrocompat com baseline antiga; agora derivado de custo_acumulado/total_custo. */
  perc_acumulado: number
}

export function segundaDaSemanaISO(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const dia = d.getUTCDay() // 0=dom, 1=seg, ..., 6=sab
  const ajuste = dia === 0 ? -6 : 1 - dia
  d.setUTCDate(d.getUTCDate() + ajuste)
  return d.toISOString().slice(0, 10)
}

export function semanasEntre(inicioIso: string, fimIso: string): string[] {
  const out: string[] = []
  let cur = segundaDaSemanaISO(inicioIso)
  const fimSeg = segundaDaSemanaISO(fimIso)
  let safety = 0
  while (cur <= fimSeg && safety++ < 520) {
    out.push(cur)
    const d = new Date(`${cur}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 7)
    cur = d.toISOString().slice(0, 10)
  }
  return out
}

export interface OpcoesCurvaS {
  /**
   * Fator de reajuste da venda do serviço no dia (1 = preço da premissa). A semana de cada tarefa é repartida pelo
   * perfil diário do cálculo (`perfilDia`), então a semana atravessada por um reajuste fica com cada dia ao seu preço.
   */
  fatorVenda?: (itemId: string, data: string) => number
  /** perfil diário do cronograma por tarefa (quantidade por dia de trabalho) — só é preciso com `fatorVenda` */
  perfilDia?: Map<string, { dia: string; quantidade: number }[]>
}

/** Dias úteis padrão (segunda a sexta) da semana que começa na segunda `seg` — sem perfil diário da tarefa. */
function segundaASexta(seg: string): string[] {
  const d0 = new Date(`${seg}T00:00:00Z`)
  return [0, 1, 2, 3, 4].map((k) => {
    const d = new Date(d0)
    d.setUTCDate(d.getUTCDate() + k)
    return d.toISOString().slice(0, 10)
  })
}

export function calcularCurvaSemanal(
  tarefas: PlanejamentoTarefaCompleta[],
  opcoes: OpcoesCurvaS = {}
): CurvaSBucket[] {
  if (!tarefas?.length) return []
  const { fatorVenda, perfilDia } = opcoes
  // fator da semana da tarefa: média do fator diário ponderada pela quantidade de cada dia
  const diasPorTarefa = new Map<string, Map<string, { dia: string; quantidade: number }[]>>()
  const fatorSemana = (t: PlanejamentoTarefaCompleta, seg: string): number => {
    if (!fatorVenda || !t.item_orcamentario_id) return 1
    const itemId = t.item_orcamentario_id
    let porSemana = diasPorTarefa.get(t.id)
    if (!porSemana) {
      porSemana = new Map()
      for (const d of perfilDia?.get(t.id) ?? []) {
        const k = segundaDaSemanaISO(d.dia)
        porSemana.set(k, [...(porSemana.get(k) ?? []), d])
      }
      diasPorTarefa.set(t.id, porSemana)
    }
    const dias = porSemana.get(seg)
    const total = dias?.reduce((a, d) => a + d.quantidade, 0) ?? 0
    if (dias && total > 0)
      return dias.reduce((a, d) => a + d.quantidade * fatorVenda(itemId, d.dia), 0) / total
    const uteis = segundaASexta(seg)
    return uteis.reduce((a, d) => a + fatorVenda(itemId, d), 0) / uteis.length
  }

  const custoPorSem = new Map<string, number>()
  const receitaPorSem = new Map<string, number>()

  for (const t of tarefas) {
    if (t.is_indireto) {
      // Distribui custo/receita TOTAL linearmente entre as semanas cobertas.
      if (!t.data_inicio || !t.data_fim) continue
      const sems = semanasEntre(t.data_inicio, t.data_fim)
      if (sems.length === 0) continue
      const custoTotal = Number(t.custo_total_calc ?? 0) + Number(t.custo_taxas_calc ?? 0)
      const receitaTotal = Number(t.receita_total_calc ?? 0)
      const fracPorSem = 1 / sems.length
      for (const s of sems) {
        custoPorSem.set(s, (custoPorSem.get(s) ?? 0) + custoTotal * fracPorSem)
        receitaPorSem.set(s, (receitaPorSem.get(s) ?? 0) + receitaTotal * fracPorSem)
      }
    } else {
      // Direta: usa perfil_semanas pra distribuir físico × preços unitários.
      const custoUnit = Number(t.custo_unit_snapshot ?? 0)
      const vendaUnit = Number(t.venda_unitaria_item ?? 0)
      const semanas = t.perfil_semanas ?? []
      for (const s of semanas) {
        const qty = Number(s.quantidade_planejada ?? 0)
        if (qty <= 0) continue
        if (custoUnit > 0) {
          custoPorSem.set(
            s.semana_segunda,
            (custoPorSem.get(s.semana_segunda) ?? 0) + qty * custoUnit
          )
        }
        if (vendaUnit > 0) {
          receitaPorSem.set(
            s.semana_segunda,
            (receitaPorSem.get(s.semana_segunda) ?? 0) +
              qty * vendaUnit * fatorSemana(t, s.semana_segunda)
          )
        }
      }
    }
  }

  const semanas = Array.from(new Set([...custoPorSem.keys(), ...receitaPorSem.keys()])).sort()
  const totalCusto = Array.from(custoPorSem.values()).reduce((a, b) => a + b, 0)
  let custoAcum = 0
  let receitaAcum = 0
  return semanas.map((periodo) => {
    const c = custoPorSem.get(periodo) ?? 0
    const r = receitaPorSem.get(periodo) ?? 0
    custoAcum += c
    receitaAcum += r
    return {
      periodo,
      custo_periodo: c,
      custo_acumulado: custoAcum,
      receita_periodo: r,
      receita_acumulada: receitaAcum,
      perc_acumulado: totalCusto > 0 ? custoAcum / totalCusto : 0
    }
  })
}
