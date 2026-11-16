import type { CurvaSPonto } from '@/types/acompanhamento'

export interface AcumuladoServico {
  plan: number
  real: number
}

/** Previsto e realizado acumulados de cada serviço no último ponto da curva S até `dataAte` (inclusive). */
export function acumuladoAte(
  curvaS: readonly CurvaSPonto[],
  dataAte: string
): Map<string, AcumuladoServico> {
  const ultimo = new Map<string, CurvaSPonto>()
  for (const p of curvaS) {
    const k = p.item_orcamentario_id
    if (!k || p.data > dataAte) continue
    const atual = ultimo.get(k)
    if (!atual || p.data > atual.data) ultimo.set(k, p)
  }
  const out = new Map<string, AcumuladoServico>()
  for (const [k, p] of ultimo) {
    out.set(k, {
      plan: Number(p.planejado_acumulado ?? 0),
      real: Number(p.realizado_acumulado ?? 0)
    })
  }
  return out
}
