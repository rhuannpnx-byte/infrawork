import type { Secao4D } from './contrato'
import { cotaNoPerfil, type ModeloPronto } from './preparar'

/** Onde um ponto cai na obra: a cota acabada, a posição no eixo e a fatia (para saber se ela já existe na data). */
export interface PontoDaObra {
  z: number
  eixo: number
  s: number
  o: number
  /** Índice em `ModeloPronto.fatias`. */
  fatia: number
}

/** Intervalo entre seções acima disto é falha do levantamento (o mesmo critério de `preparar.ts`). */
const SALTO = 80

/**
 * Superfície acabada da obra, para quem anda pela cena: dado um ponto (x, n), diz a cota da plataforma, do talude
 * ou da berma ali. Fora dos off-sets devolve `null`, e quem chama usa o terreno.
 */
export class Superficie {
  private readonly secoes: Secao4D[][]
  private readonly fatiaDe = new Map<string, number>()

  constructor(private readonly pronto: ModeloPronto) {
    const id = new Map(pronto.modelo.eixos.map((e, i) => [e.id, i]))
    this.secoes = pronto.modelo.eixos.map(() => [])
    for (const sc of pronto.modelo.secoes ?? [])
      this.secoes[sc.eixo ? (id.get(sc.eixo) ?? 0) : 0].push(sc)
    for (const l of this.secoes) l.sort((a, b) => a.s - b.s)
    pronto.fatias.forEach((f, k) => this.fatiaDe.set(`${f.eixo}|${f.s0}`, k))
  }

  /** `perto` é o índice de um ponto do eixo já sabido próximo (o da consulta anterior), para não procurar tudo. */
  em(x: number, n: number, perto?: number): (PontoDaObra & { i: number }) | null {
    let melhor: (PontoDaObra & { i: number }) | null = null
    let dist = Infinity
    this.pronto.eixos.forEach((eixo, ie) => {
      const ss = this.secoes[ie]
      if (ss.length < 2) return
      const q = eixo.projetar(x, n, perto)
      if (q.d >= dist || q.s < ss[0].s || q.s > ss[ss.length - 1].s) return
      let lo = 0
      let hi = ss.length - 1
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1
        if (ss[m].s <= q.s) lo = m
        else hi = m
      }
      const A = ss[lo]
      const B = ss[lo + 1]
      if (B.s - A.s > SALTO) return
      const f = (q.s - A.s) / (B.s - A.s || 1)
      const borda = (sc: Secao4D, k: 0 | 1): number =>
        k ? sc.perfil[sc.perfil.length - 1][0] : sc.perfil[0][0]
      const esq = borda(A, 0) + (borda(B, 0) - borda(A, 0)) * f
      const dir = borda(A, 1) + (borda(B, 1) - borda(A, 1)) * f
      if (q.o < esq || q.o > dir) return
      const fatia = this.fatiaDe.get(`${ie}|${A.s}`)
      if (fatia == null) return
      const za = cotaNoPerfil(A.perfil, q.o)
      dist = q.d
      melhor = {
        z: za + (cotaNoPerfil(B.perfil, q.o) - za) * f,
        eixo: ie,
        s: q.s,
        o: q.o,
        fatia,
        i: q.i
      }
    })
    return melhor
  }
}
