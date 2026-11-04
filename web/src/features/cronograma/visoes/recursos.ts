/**
 * Visão de recursos: o empilhamento da `ResourceView` do ApeX (`views/time/resource.ts`, `stackRects`) sobre o uso
 * calculado pelo motor (`ResourceCalculator`).
 */

export interface Faixa {
  b: number
  e: number
  q: number
}

/** `QuantitySpanContainer::Merge` [O]: soma intervalos com quantidade. */
export class Acumulado {
  spans: Faixa[] = []
  somar(b: number, e: number, q: number): void {
    if (q === 0 || !(b < e)) return
    const cortes = new Set<number>([b, e])
    for (const s of this.spans) if (s.e > b && s.b < e) cortes.add(s.b).add(s.e)
    const pts = [...cortes].sort((x, y) => x - y)
    const fica = this.spans.filter((s) => s.e <= b || s.b >= e)
    const tocados = this.spans.filter((s) => s.e > b && s.b < e)
    const pedacos: Faixa[] = []
    for (let i = 0; i + 1 < pts.length; i++) {
      const x = pts[i]!,
        y = pts[i + 1]!
      let qq = x >= b && y <= e ? q : 0
      for (const s of tocados) if (s.b <= x && y <= s.e) qq += s.q
      if (qq !== 0) pedacos.push({ b: x, e: y, q: qq })
    }
    this.spans = [...fica, ...pedacos].sort((x, y) => x.b - y.b)
  }
  valor(t0: number, t1: number): number {
    return this.spans.find((s) => s.b <= t0 && t1 <= s.e)?.q ?? 0
  }
  pico(): number {
    return this.spans.reduce((m, s) => Math.max(m, s.q), 0)
  }
}

export interface Retangulo {
  t0: number
  t1: number
  /** base e topo em unidades */
  base: number
  topo: number
}

/**
 * Empilhamento de `OnUpdate` [O]: cada intervalo do recurso é cortado nos limites do acumulado; a fatia fica sobre o
 * valor acumulado; fatias contíguas de mesma base e mesmo topo se fundem; depois o acumulado recebe o recurso.
 */
export function empilhar(spans: readonly Faixa[], acc: Acumulado): Retangulo[] {
  const out: Retangulo[] = []
  let cur: Retangulo | null = null
  for (const s of spans) {
    if (!(s.e > s.b) || s.q === 0) continue
    const cortes = new Set<number>([s.b, s.e])
    for (const a of acc.spans) {
      if (a.b > s.b && a.b < s.e) cortes.add(a.b)
      if (a.e > s.b && a.e < s.e) cortes.add(a.e)
    }
    const ts = [...cortes].sort((a, b) => a - b)
    for (let i = 0; i + 1 < ts.length; i++) {
      const t0 = ts[i]!,
        t1 = ts[i + 1]!
      const base = acc.valor(t0, t1)
      const r: Retangulo = { t0, t1, base, topo: base + s.q }
      if (
        cur &&
        cur.t1 === r.t0 &&
        Math.abs(cur.base - r.base) < 1e-9 &&
        Math.abs(cur.topo - r.topo) < 1e-9
      )
        cur.t1 = r.t1
      else {
        if (cur) out.push(cur)
        cur = { ...r }
      }
    }
  }
  if (cur) out.push(cur)
  for (const s of spans) acc.somar(s.b, s.e, s.q)
  return out
}

/**
 * Horas de uso: Σ unidades × horas de trabalho do intervalo no calendário dado (o `GetTotalHours` do ApeX conta o
 * tempo corrido; aqui só o expediente, que é o que a equipe trabalha).
 */
export function horasTrabalhadas(
  spans: readonly Faixa[],
  cal: { AS2WS(t: number): number }
): number {
  return spans.reduce((t, s) => t + (s.q * (cal.AS2WS(s.e) - cal.AS2WS(s.b))) / 3600, 0)
}
