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
  let sx = 0,
    sy = 0,
    sxy = 0,
    sxx = 0,
    syy = 0
  for (const { x, y } of pontos) {
    sx += x
    sy += y
    sxy += x * y
    sxx += x * x
    syy += y * y
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

/**
 * Classifica a tendência a partir do slope relativo à média (robusto à escala).
 * Só rotula subindo/caindo quando há sinal real: inclinação ≥ 1%/dia da média,
 * ajuste minimamente explicativo (r² ≥ `r2Min`) e amostra suficiente
 * (`n ≥ nMin`). Caso contrário é ruído → "estável". Sem r²/n informados,
 * mantém o comportamento antigo (só pelo slope).
 */
export function classificarTendencia(
  slope: number,
  mediaSerie: number,
  r2?: number,
  n?: number,
  r2Min = 0.1,
  nMin = 5
): { rotulo: 'subindo' | 'estavel' | 'caindo'; pctPorDia: number } {
  const base = Math.abs(mediaSerie) > 1e-9 ? mediaSerie : 1
  const pctPorDia = slope / base // fração da média por dia
  const semSinal =
    (r2 != null && r2 < r2Min) || (n != null && n < nMin) || Math.abs(pctPorDia) <= 0.01
  if (semSinal) return { rotulo: 'estavel', pctPorDia }
  return { rotulo: pctPorDia > 0 ? 'subindo' : 'caindo', pctPorDia }
}
