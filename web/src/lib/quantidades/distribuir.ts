// Distribui um valor escalar de uma faixa do usuário (modo Simplificado) entre
// os segmentos analíticos. Proporcional ao comprimento de interseção.
//
// Exemplo: faixa user [0, 10500m] com valor=1000m³, grade km=10 segmentos
// completos + 1 parcial de 500m. Cada km recebe 1000 × (1000/10500) ≈ 95.24.
// O parcial recebe 1000 × (500/10500) ≈ 47.62. Soma = 1000 (a menos de erro
// de ponto flutuante).

import type { SegmentoAnalitico } from './grade'

/**
 * Retorna Map<ordem, valor_distribuido>. Segmentos fora da faixa não aparecem
 * no map (caller trata como 0/ausente). Faixa vazia/invertida retorna Map vazio.
 */
export function distribuirProporcional(
  faixaInicioM: number,
  faixaFimM: number,
  valor: number,
  grade: SegmentoAnalitico[]
): Map<number, number> {
  const out = new Map<number, number>()
  if (!Number.isFinite(faixaInicioM) || !Number.isFinite(faixaFimM)) return out
  if (faixaFimM <= faixaInicioM) return out
  if (!Number.isFinite(valor)) return out
  const faixaComp = faixaFimM - faixaInicioM

  for (const seg of grade) {
    const intIni = Math.max(faixaInicioM, seg.posicao_inicio_m)
    const intFim = Math.min(faixaFimM, seg.posicao_fim_m)
    const intComp = Math.max(0, intFim - intIni)
    if (intComp === 0) continue
    out.set(seg.ordem, valor * (intComp / faixaComp))
  }
  return out
}
