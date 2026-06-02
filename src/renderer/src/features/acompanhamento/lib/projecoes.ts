// Projeção de término por serviço, baseada no RITMO REALIZADO (média móvel),
// não na produção diária teórica da CPU. Espelha a lógica da projeção "atual"
// do gráfico CurvaSComProjecoes (mesma fonte: pontos da curva-S), pra que a
// coluna "Δ dias" da tabela e a linha "Proj. atual" do gráfico batam.

import type { CurvaSPonto } from '@/types/acompanhamento'

export interface ProjecaoItem {
  /** Média móvel dos últimos dias trabalhados (qtd/dia). */
  mediaAtual: number | null
  /** Data de término projetada no ritmo atual (ISO yyyy-mm-dd). */
  fimProjetado: string | null
  /** data_fim_plan − fimProjetado, em dias corridos. Negativo = atraso. */
  desvioDias: number | null
}

interface RowReal {
  data: string
  real: number
}

/** Agrega pontos da curva-S por data (soma realizado_acumulado), ordenado por data. */
function agregarReal(pontos: CurvaSPonto[]): RowReal[] {
  const map = new Map<string, number>()
  for (const p of pontos) {
    map.set(p.data, (map.get(p.data) ?? 0) + Number(p.realizado_acumulado ?? 0))
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([data, real]) => ({ data, real }))
}

/** Média dos últimos 15 dias trabalhados (deltas positivos do acumulado realizado). */
function calcMediaAtual(rows: RowReal[]): number | null {
  let idxUltimoReal = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].real > 0) { idxUltimoReal = i; break }
  }
  if (idxUltimoReal < 0) return null

  const trabalhados: number[] = []
  for (let i = idxUltimoReal; i >= 0 && trabalhados.length < 15; i--) {
    const ant = i > 0 ? rows[i - 1].real : 0
    const delta = rows[i].real - ant
    if (delta > 0) trabalhados.unshift(delta)
  }
  if (trabalhados.length < 2) return null
  return trabalhados.reduce((a, b) => a + b, 0) / trabalhados.length
}

/** Último valor de realizado acumulado conhecido com data ≤ hoje. */
function realAteHoje(rows: RowReal[], hojeIso: string): number {
  let v = 0
  for (const r of rows) {
    if (r.data <= hojeIso && r.real > 0) v = r.real
  }
  return v
}

/**
 * Projeta o término de um item no ritmo realizado e o desvio vs. o fim planejado.
 * Retorna desvioDias = null quando não há dados suficientes pra projetar
 * (sem produção / sem plano), em vez de inventar um valor.
 */
export function projetarItem(
  pontos: CurvaSPonto[],
  qtdPlan: number | null,
  dataFimPlan: string | null,
  hojeIso: string
): ProjecaoItem {
  const rows = agregarReal(pontos)
  const mediaAtual = calcMediaAtual(rows)
  const realHoje = realAteHoje(rows, hojeIso)

  let fimProjetado: string | null = null
  if (qtdPlan != null && qtdPlan > 0) {
    const restante = Math.max(0, qtdPlan - realHoje)
    if (restante <= 0) {
      // já atingiu o planejado → fim projetado = última data com produção
      const ult = [...rows].reverse().find((r) => r.real > 0)
      fimProjetado = ult ? ult.data : hojeIso
    } else if (mediaAtual != null && mediaAtual > 0) {
      const dias = Math.ceil(restante / mediaAtual)
      const dt = new Date(hojeIso + 'T00:00:00')
      dt.setDate(dt.getDate() + dias)
      fimProjetado = dt.toISOString().slice(0, 10)
    }
  }

  let desvioDias: number | null = null
  if (fimProjetado && dataFimPlan) {
    const fimPlan = new Date(dataFimPlan + 'T00:00:00').getTime()
    const fimProj = new Date(fimProjetado + 'T00:00:00').getTime()
    desvioDias = Math.round((fimPlan - fimProj) / 86_400_000)
  }

  return { mediaAtual, fimProjetado, desvioDias }
}
