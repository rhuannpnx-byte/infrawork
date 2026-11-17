import { divisorMetrosPorUnidade, marcadorToMetros, type TrechoCtx } from '@/lib/format/posicao'
import type { ModeloPronto } from './preparar'

/** Um trecho de tarefa da linha de base (`planejamento_tarefa_wp`), com os instantes em ms. */
export interface TrechoPlano {
  tarefa_id: string
  item_id: string
  /** Sem local: vale o eixo inteiro. */
  trecho_id: string | null
  inicio_m: number | null
  fim_m: number | null
  inicio: number
  fim: number
  quantidade: number
  crescente: boolean
}

export interface Lancamento {
  id: string
  item_id: string
  trecho_id: string | null
  inicio_m: number | null
  fim_m: number | null
  /** Meio-dia do dia do lançamento, em ms. */
  dia: number
  quantidade: number
}

export interface Vinculos {
  /** id do eixo do modelo → local da obra. */
  eixos: Record<string, (TrechoCtx & { id: string; comprimento_m: number | null }) | undefined>
  /** id da classe do modelo → serviço (item orçamentário). */
  classes: Record<string, string | undefined>
}

export type Situacao = 'concluido' | 'adiantado' | 'execucao' | 'atrasado' | 'nao_iniciado'

const CHEIO = 0.999
const VAZIO = 0.001
/** Diferença entre previsto e realizado que ainda não conta como atraso. */
const FOLGA = 0.02

/**
 * Situação de uma peça na data: pronta (no prazo ou antes dele), com menos feito do que o plano previa para ela
 * (atrasada), em execução no ritmo do plano ou ainda sem nada previsto nem feito.
 */
export function situacao(prev: number, real: number): Situacao {
  if (real >= CHEIO) return prev >= CHEIO ? 'concluido' : 'adiantado'
  if (real + FOLGA < prev) return 'atrasado'
  return real > VAZIO ? 'execucao' : 'nao_iniciado'
}

export interface ResumoServico {
  item_id: string
  previsto: number
  realizado: number
  total: number
}

interface Contribuicao {
  wp: number
  f0: number
  f1: number
  peso: number
}

const limita = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v)

/**
 * Previsto e realizado de cada peça do modelo no tempo. A montagem cruza as peças com os trechos de tarefa e com os
 * lançamentos uma vez; `calcular(t)` só percorre o que foi montado.
 *
 * - Previsto: a frente de cada trecho de tarefa anda pela faixa no sentido da tarefa, no ritmo do perfil diário
 *   (ou linear entre início e fim). A quantidade do trecho de tarefa se reparte pelas peças que ele cobre.
 * - Realizado: cada lançamento com estaca reparte a sua quantidade pelas peças cobertas; o grau é o lançado sobre a
 *   peça ÷ o previsto para ela (sem previsto, a quantidade da peça; sem ela, a parte da peça coberta).
 */
export class Estado4D {
  readonly prev: Float32Array
  readonly real: Float32Array
  /** Peça entra no 4D (classe vinculada a um serviço, num eixo vinculado a um local). */
  readonly vinculada: Uint8Array
  /** Faixa da peça em metros do local da obra. */
  readonly m0: Float32Array
  readonly m1: Float32Array
  readonly semEstaca: Lancamento[] = []
  readonly inicio: number
  readonly fim: number

  private readonly contribs: Contribuicao[][]
  private readonly somaPeso: Float32Array
  /** Por peça: pares [dia, acumulado] em ordem de dia. */
  private readonly serie: Float64Array[]
  private readonly den: Float32Array
  private readonly fracWp: Float32Array
  private readonly itemDaPeca: (string | undefined)[]
  private readonly trechoDaPeca: (string | undefined)[]

  constructor(
    readonly modelo: ModeloPronto,
    readonly plano: TrechoPlano[],
    readonly lancamentos: Lancamento[],
    readonly vinculos: Vinculos,
    /** Por tarefa: pontos [instante em ms, quantidade acumulada até ele], em ordem; entre dois pontos, linear. */
    private readonly perfis: Map<string, [number, number][]> = new Map()
  ) {
    const { pecas } = modelo
    const n = pecas.length
    this.prev = new Float32Array(n)
    this.real = new Float32Array(n)
    this.vinculada = new Uint8Array(n)
    this.m0 = new Float32Array(n)
    this.m1 = new Float32Array(n)
    this.somaPeso = new Float32Array(n)
    this.den = new Float32Array(n)
    this.fracWp = new Float32Array(plano.length)
    this.contribs = Array.from({ length: n }, () => [])
    this.itemDaPeca = new Array(n)
    this.trechoDaPeca = new Array(n)

    // peso da peça: a quantidade quando a classe inteira tem, senão o comprimento
    const comQtd = modelo.malhas.map(
      (m) => m.pecas.length > 0 && m.pecas.every((i) => pecas[i].qtd != null)
    )
    const peso = new Float32Array(n)
    const grupos = new Map<string, number[]>()
    for (let i = 0; i < n; i++) {
      const p = pecas[i]
      const item = vinculos.classes[modelo.modelo.classes[p.classe].id]
      const tr = vinculos.eixos[modelo.modelo.eixos[p.eixo].id]
      peso[i] = comQtd[p.classe] ? Math.max(p.qtd ?? 0, 1e-6) : Math.max(p.s1 - p.s0, 1)
      if (!item || !tr) continue
      const d = divisorMetrosPorUnidade(tr)
      const a = marcadorToMetros(p.s0 / d, tr)
      const b = marcadorToMetros(p.s1 / d, tr)
      this.m0[i] = Math.min(a, b)
      this.m1[i] = Math.max(a, b)
      this.vinculada[i] = 1
      this.itemDaPeca[i] = item
      this.trechoDaPeca[i] = tr.id
      const k = `${item}|${tr.id}`
      const g = grupos.get(k)
      if (g) g.push(i)
      else grupos.set(k, [i])
    }
    const trechos = Object.values(vinculos.eixos).filter((t) => !!t)
    const cobertas = (
      item: string,
      trecho: string | null,
      a: number | null,
      b: number | null
    ): [number[], number, number][] => {
      // tarefa ou lançamento sem local vale para todos os locais vinculados, de ponta a ponta
      const alvos = trecho ? [trecho] : trechos.map((t) => t!.id)
      return alvos.flatMap((t) => {
        const g = grupos.get(`${item}|${t}`)
        if (!g) return []
        const comp = trechos.find((x) => x!.id === t)?.comprimento_m
        const ini = trecho && a != null ? a : 0
        const fim = trecho && b != null ? b : (comp ?? Infinity)
        return [[g, Math.min(ini, fim), Math.max(ini, fim)] as [number[], number, number]]
      })
    }
    const sobre = (i: number, a: number, b: number): number => {
      const c = this.m1[i] - this.m0[i]
      if (c <= 1e-6) return this.m0[i] >= a - 1e-6 && this.m0[i] <= b + 1e-6 ? 1 : 0
      return Math.max(0, Math.min(this.m1[i], b) - Math.max(this.m0[i], a)) / c
    }

    // parte de uma faixa do local que o modelo cobre: plano e lançamento que passam do modelo só contam nela
    const extensao = new Map<string, [number, number]>()
    for (let i = 0; i < n; i++) {
      const tr = this.trechoDaPeca[i]
      if (!tr) continue
      const e = extensao.get(tr)
      if (!e) extensao.set(tr, [this.m0[i], this.m1[i]])
      else {
        e[0] = Math.min(e[0], this.m0[i])
        e[1] = Math.max(e[1], this.m1[i])
      }
    }
    const noModelo = (g: number[], a: number, b: number): number => {
      const e = extensao.get(this.trechoDaPeca[g[0]]!)
      if (!e || !(b - a > 1e-6)) return 1
      return limita((Math.min(b, e[1]) - Math.max(a, e[0])) / (b - a))
    }

    let t0 = Infinity
    let t1 = -Infinity
    plano.forEach((w, iw) => {
      t0 = Math.min(t0, w.inicio)
      t1 = Math.max(t1, w.fim)
      for (const [g, a, b] of cobertas(w.item_id, w.trecho_id, w.inicio_m, w.fim_m)) {
        const fim = Number.isFinite(b) ? b : Math.max(...g.map((i) => this.m1[i]))
        const comp = fim - a || 1
        const toca: [number, number][] = []
        let soma = 0
        for (const i of g) {
          const ov = sobre(i, a, fim)
          if (ov <= 0) continue
          toca.push([i, ov * peso[i]])
          soma += ov * peso[i]
        }
        for (const [i, wv] of toca) {
          const x0 = (Math.max(this.m0[i], a) - a) / comp
          const x1 = (Math.min(this.m1[i], fim) - a) / comp
          const q = (w.quantidade * noModelo(g, a, fim) * wv) / soma
          this.contribs[i].push({
            wp: iw,
            f0: w.crescente ? x0 : 1 - x1,
            f1: w.crescente ? x1 : 1 - x0,
            peso: q || wv
          })
          this.somaPeso[i] += q || wv
          this.den[i] += q
        }
      }
    })
    this.inicio = t0
    this.fim = t1

    const pares: [number, number][][] = Array.from({ length: n }, () => [])
    for (const l of lancamentos) {
      if (l.trecho_id == null || l.inicio_m == null || l.fim_m == null) {
        this.semEstaca.push(l)
        continue
      }
      for (const [g, a, b] of cobertas(l.item_id, l.trecho_id, l.inicio_m, l.fim_m)) {
        const toca: [number, number, number][] = []
        let soma = 0
        for (const i of g) {
          const ov = sobre(i, a, b)
          if (ov <= 0) continue
          toca.push([i, ov * peso[i], ov])
          soma += ov * peso[i]
        }
        for (const [i, wv, ov] of toca) {
          const p = pecas[i]
          // com previsto ou quantidade na peça, conta a quantidade lançada; sem nada, a parte coberta
          const medida = this.den[i] > 0 || (comQtd[p.classe] && p.qtd != null)
          pares[i].push([l.dia, medida ? (l.quantidade * noModelo(g, a, b) * wv) / soma : ov])
        }
      }
    }
    this.serie = pares.map((ps, i) => {
      const p = pecas[i]
      if (!(this.den[i] > 0))
        this.den[i] = comQtd[p.classe] && p.qtd != null ? Math.max(p.qtd, 1e-6) : 1
      ps.sort((x, y) => x[0] - y[0])
      const out = new Float64Array(ps.length * 2)
      let ac = 0
      ps.forEach(([d, q], k) => {
        ac += q
        out[2 * k] = d
        out[2 * k + 1] = ac
      })
      return out
    })
  }

  /** Fração do trecho de tarefa `iw` executada no instante `t`, no ritmo do perfil da tarefa. */
  private fracao(iw: number, t: number): number {
    const w = this.plano[iw]
    if (t <= w.inicio) return 0
    if (t >= w.fim) return 1
    const perfil = this.perfis.get(w.tarefa_id)
    if (perfil && perfil.length > 1) {
      const F = (x: number): number => {
        if (x <= perfil[0][0]) return perfil[0][1]
        let lo = 0
        let hi = perfil.length - 1
        while (hi - lo > 1) {
          const m = (lo + hi) >> 1
          if (perfil[m][0] <= x) lo = m
          else hi = m
        }
        const a = perfil[lo]
        const b = perfil[hi]
        return x >= b[0] ? b[1] : a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1)
      }
      const a = F(w.inicio)
      const b = F(w.fim)
      if (b > a) return limita((F(t) - a) / (b - a))
    }
    return (t - w.inicio) / (w.fim - w.inicio || 1)
  }

  /** Preenche `prev` e `real` (0 a 1) com a situação no instante `t`. */
  calcular(t: number): void {
    this.calcularEm(t, this.prev, this.real)
  }

  /** Como `calcular`, mas em vetores do chamador (para comparar duas datas). */
  calcularEm(t: number, prev: Float32Array, real: Float32Array): void {
    for (let i = 0; i < this.plano.length; i++) this.fracWp[i] = this.fracao(i, t)
    for (let i = 0; i < prev.length; i++) {
      if (!this.vinculada[i]) {
        prev[i] = NaN
        real[i] = NaN
        continue
      }
      let ac = 0
      for (const c of this.contribs[i]) {
        const f = this.fracWp[c.wp]
        ac +=
          c.peso *
          (c.f1 - c.f0 > 1e-9 ? limita((f - c.f0) / (c.f1 - c.f0)) : f >= c.f0 && f > 0 ? 1 : 0)
      }
      prev[i] = this.somaPeso[i] > 0 ? limita(ac / this.somaPeso[i]) : 0
      const s = this.serie[i]
      let lo = 0
      let hi = s.length / 2
      while (lo < hi) {
        const m = (lo + hi) >> 1
        if (s[2 * m] <= t) lo = m + 1
        else hi = m
      }
      real[i] = lo ? limita(s[2 * lo - 1] / this.den[i]) : 0
    }
  }

  /** Quando o plano começa e termina a peça (ms), ou null se o plano não passa por ela. */
  janelaPrevista(i: number): [number, number] | null {
    if (!this.contribs[i].length) return null
    let a = Infinity
    let b = -Infinity
    for (const c of this.contribs[i]) {
      a = Math.min(a, this.instante(c.wp, c.f0))
      b = Math.max(b, this.instante(c.wp, c.f1))
    }
    return [a, b]
  }

  private instante(iw: number, f: number): number {
    const w = this.plano[iw]
    let lo = w.inicio
    let hi = w.fim
    for (let k = 0; k < 24; k++) {
      const m = (lo + hi) / 2
      if (this.fracao(iw, m) < f) lo = m
      else hi = m
    }
    return hi
  }

  /** Lançamentos com estaca que cobrem a peça. */
  lancamentosDaPeca(i: number): Lancamento[] {
    const item = this.itemDaPeca[i]
    const tr = this.trechoDaPeca[i]
    if (!item) return []
    const pontual = this.m1[i] - this.m0[i] <= 1e-6
    return this.lancamentos.filter((l) => {
      if (l.item_id !== item || l.trecho_id !== tr || l.inicio_m == null || l.fim_m == null)
        return false
      const a = Math.min(l.inicio_m, l.fim_m)
      const b = Math.max(l.inicio_m, l.fim_m)
      return pontual
        ? this.m0[i] >= a && this.m0[i] <= b
        : Math.min(this.m1[i], b) > Math.max(this.m0[i], a)
    })
  }

  /** Previsto e realizado de cada serviço vinculado no instante `t`, em quantidade (inclui o que não tem estaca). */
  resumo(t: number): ResumoServico[] {
    const itens = new Map<string, ResumoServico>()
    const de = (item: string): ResumoServico => {
      let r = itens.get(item)
      if (!r) itens.set(item, (r = { item_id: item, previsto: 0, realizado: 0, total: 0 }))
      return r
    }
    for (const item of new Set(Object.values(this.vinculos.classes))) if (item) de(item)
    this.plano.forEach((w, i) => {
      if (!itens.has(w.item_id)) return
      const r = de(w.item_id)
      r.total += w.quantidade
      r.previsto += w.quantidade * this.fracao(i, t)
    })
    for (const l of this.lancamentos)
      if (l.dia <= t && itens.has(l.item_id)) de(l.item_id).realizado += l.quantidade
    return [...itens.values()]
  }

  /**
   * Avanço da terraplenagem ao longo de cada eixo, em trechos de `passo` metros: média de `valores` (previsto ou
   * realizado) das peças das classes que movem o terreno. Sem classe vinculada, o terreno fica no de projeto.
   */
  terreno(valores: Float32Array, passo = 20): Float32Array[] {
    const { modelo } = this
    const classes = modelo.modelo.classes
    return modelo.eixos.map((e, ie) => {
      const n = Math.max(1, Math.ceil((e.sMax - e.sMin) / passo) + 1)
      const soma = new Float32Array(n)
      const cont = new Float32Array(n)
      let alguma = false
      for (let ic = 0; ic < classes.length; ic++) {
        if (!classes[ic].terreno) continue
        for (const i of modelo.malhas[ic].pecas) {
          const p = modelo.pecas[i]
          if (p.eixo !== ie || !this.vinculada[i]) continue
          alguma = true
          const a = Math.max(0, Math.floor((p.s0 - e.sMin) / passo))
          const b = Math.min(n - 1, Math.floor((p.s1 - e.sMin - 1e-6) / passo))
          for (let k = a; k <= Math.max(a, b); k++) {
            soma[k] += valores[i]
            cont[k]++
          }
        }
      }
      const out = new Float32Array(n)
      for (let k = 0; k < n; k++) out[k] = !alguma ? 1 : cont[k] ? soma[k] / cont[k] : 1
      return out
    })
  }
}
