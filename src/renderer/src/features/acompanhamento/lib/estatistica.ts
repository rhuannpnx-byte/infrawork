// Estatística pura para análise de produtividade (sem dependências).
// Reutilizável em toda a página de Performance. Trabalha sobre arrays de números
// (produção diária por equipe×serviço, em unidade do plano).

/** Média aritmética. 0 para vazio. */
export function media(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/** Quantil (interpolação linear, tipo R-7 / percentile_cont). p em [0,1]. */
export function quantil(xs: number[], p: number): number {
  if (xs.length === 0) return 0
  if (xs.length === 1) return xs[0]
  const s = [...xs].sort((a, b) => a - b)
  const idx = p * (s.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return s[lo]
  const frac = idx - lo
  return s[lo] * (1 - frac) + s[hi] * frac
}

/** Mediana (p50). */
export function mediana(xs: number[]): number {
  return quantil(xs, 0.5)
}

export interface ResumoEstatistico {
  n: number
  min: number
  max: number
  media: number
  mediana: number
  p25: number
  p75: number
  p90: number
  desvioPadrao: number
}

export function resumo(xs: number[]): ResumoEstatistico {
  if (xs.length === 0) {
    return { n: 0, min: 0, max: 0, media: 0, mediana: 0, p25: 0, p75: 0, p90: 0, desvioPadrao: 0 }
  }
  const m = media(xs)
  const variancia = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length
  return {
    n: xs.length,
    min: Math.min(...xs),
    max: Math.max(...xs),
    media: m,
    mediana: mediana(xs),
    p25: quantil(xs, 0.25),
    p75: quantil(xs, 0.75),
    p90: quantil(xs, 0.9),
    desvioPadrao: Math.sqrt(variancia)
  }
}

/** Limites de outlier pela regra 1.5×IQR. */
export function iqrLimites(xs: number[]): { q1: number; q3: number; lo: number; hi: number } {
  const q1 = quantil(xs, 0.25)
  const q3 = quantil(xs, 0.75)
  const iqr = q3 - q1
  return { q1, q3, lo: q1 - 1.5 * iqr, hi: q3 + 1.5 * iqr }
}

/** Remove outliers (1.5×IQR). Retorna os valores filtrados e quantos saíram. */
export function removerOutliers(xs: number[]): { limpos: number[]; removidos: number } {
  if (xs.length < 4) return { limpos: xs, removidos: 0 }
  const { lo, hi } = iqrLimites(xs)
  const limpos = xs.filter((v) => v >= lo && v <= hi)
  return { limpos, removidos: xs.length - limpos.length }
}

export interface Regressao {
  slope: number // variação por passo (dia)
  intercept: number
  r2: number
}

/**
 * Regressão linear simples por mínimos quadrados sobre pares (x, y).
 * Use x = índice do dia (0,1,2,…) para tendência temporal.
 */
export function regressaoLinear(pontos: Array<{ x: number; y: number }>): Regressao {
  const n = pontos.length
  if (n < 2) return { slope: 0, intercept: pontos[0]?.y ?? 0, r2: 0 }
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0
  for (const { x, y } of pontos) {
    sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y
  }
  const denom = n * sxx - sx * sx
  if (denom === 0) return { slope: 0, intercept: sy / n, r2: 0 }
  const slope = (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n
  const rNum = n * sxy - sx * sy
  const rDen = Math.sqrt(denom * (n * syy - sy * sy))
  const r = rDen === 0 ? 0 : rNum / rDen
  return { slope, intercept, r2: r * r }
}

/** Média móvel simples de janela `janela`. Mantém o tamanho do array. */
export function mediaMovel(xs: number[], janela: number): number[] {
  if (janela <= 1) return [...xs]
  const out: number[] = []
  for (let i = 0; i < xs.length; i++) {
    const ini = Math.max(0, i - janela + 1)
    const slice = xs.slice(ini, i + 1)
    out.push(media(slice))
  }
  return out
}

/** Classifica a tendência a partir do slope relativo à média (robusto à escala). */
export function classificarTendencia(
  slope: number,
  mediaSerie: number
): { rotulo: 'subindo' | 'estavel' | 'caindo'; pctPorDia: number } {
  const base = Math.abs(mediaSerie) > 1e-9 ? mediaSerie : 1
  const pctPorDia = slope / base // fração da média por dia
  if (pctPorDia > 0.01) return { rotulo: 'subindo', pctPorDia }
  if (pctPorDia < -0.01) return { rotulo: 'caindo', pctPorDia }
  return { rotulo: 'estavel', pctPorDia }
}
