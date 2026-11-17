import type { Eixo4D, Pt } from './contrato'

/** Contas sobre o eixo: posição numa estaca, ponto afastado e projeção de um ponto qualquer. */
export class EixoCalc {
  readonly id: string
  readonly nome: string
  readonly p: Eixo4D['pontos']
  readonly sMin: number
  readonly sMax: number
  private readonly tan: [number, number][]

  constructor(eixo: Eixo4D) {
    this.id = eixo.id
    this.nome = eixo.nome
    this.p = eixo.pontos
    const n = this.p.length
    this.sMin = this.p[0][0]
    this.sMax = this.p[n - 1][0]
    this.tan = this.p.map((_, i) => {
      const a = this.p[Math.max(0, i - 1)]
      const b = this.p[Math.min(n - 1, i + 1)]
      const dx = b[1] - a[1]
      const dn = b[2] - a[2]
      const l = Math.hypot(dx, dn) || 1
      return [dx / l, dn / l]
    })
  }

  private indice(s: number): number {
    let lo = 0
    let hi = this.p.length - 1
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (this.p[m][0] <= s) lo = m
      else hi = m
    }
    return lo
  }

  em(s: number): { x: number; n: number; z: number; tx: number; tn: number } {
    const sc = Math.max(this.sMin, Math.min(this.sMax, s))
    const i = Math.min(this.p.length - 2, this.indice(sc))
    const a = this.p[i]
    const b = this.p[i + 1]
    const f = (sc - a[0]) / (b[0] - a[0] || 1)
    const tx = this.tan[i][0] + (this.tan[i + 1][0] - this.tan[i][0]) * f
    const tn = this.tan[i][1] + (this.tan[i + 1][1] - this.tan[i][1]) * f
    const l = Math.hypot(tx, tn) || 1
    return {
      x: a[1] + (b[1] - a[1]) * f,
      n: a[2] + (b[2] - a[2]) * f,
      z: a[3] + (b[3] - a[3]) * f,
      tx: tx / l,
      tn: tn / l
    }
  }

  /** Ponto na estaca `s`, afastado `o` metros do eixo (positivo = lado direito). */
  ponto(s: number, o = 0): Pt {
    const q = this.em(s)
    return [q.x + q.tn * o, q.n - q.tx * o, q.z]
  }

  /** Estaca e afastamento do ponto do eixo mais próximo de (x, n). */
  projetar(x: number, n: number): { d: number; s: number; o: number } {
    const p = this.p
    let bi = 0
    let bd = Infinity
    for (let i = 0; i < p.length; i += 4) {
      const d = (p[i][1] - x) ** 2 + (p[i][2] - n) ** 2
      if (d < bd) {
        bd = d
        bi = i
      }
    }
    let melhor = { d: Infinity, s: p[bi][0], o: 0 }
    for (let i = Math.max(0, bi - 6); i < Math.min(p.length - 1, bi + 6); i++) {
      const a = p[i]
      const b = p[i + 1]
      const dx = b[1] - a[1]
      const dn = b[2] - a[2]
      const l2 = dx * dx + dn * dn || 1
      const t = Math.max(0, Math.min(1, ((x - a[1]) * dx + (n - a[2]) * dn) / l2))
      const d = Math.hypot(x - (a[1] + dx * t), n - (a[2] + dn * t))
      if (d < melhor.d) {
        const cr = dx * (n - a[2]) - dn * (x - a[1])
        melhor = { d, s: a[0] + (b[0] - a[0]) * t, o: cr > 0 ? -d : d }
      }
    }
    return melhor
  }
}
