import type { Material, Secao4D } from './contrato'
import { cotaNaGrade, cotaNoPerfil, materialDaClasse, type ModeloPronto } from './preparar'

/** Uma camada cortada pela seção: polígono fechado (com espessura ou contra o terreno) ou linha (película). */
export interface FormaDaSecao {
  classe: number
  nome: string
  material: Material
  /** Pontos `[afastamento, cota]`. */
  pontos: [number, number][]
  fechada: boolean
  espessura: number | null
  /** Peça da cena que corresponde à camada nessa estaca (para o estado na data). */
  peca: number | null
}

/** Um dispositivo que passa pela estaca (sarjeta, meio-fio, bueiro, cerca), no lugar em que cruza a seção. */
export interface MarcaDaSecao {
  classe: number
  nome: string
  material: Material
  o: number
  z: number
  peca: number
}

export interface SecaoDesenho {
  eixo: number
  s: number
  /** Perfil acabado, do off-set esquerdo ao direito. */
  perfil: [number, number][]
  /** Terreno natural do levantamento, quando o modelo o traz. */
  natural: [number, number][]
  formas: FormaDaSecao[]
  marcas: MarcaDaSecao[]
  caixa: { o0: number; o1: number; z0: number; z1: number }
}

const SALTO = 80
const MARGEM = 6

/** Corta a obra por uma estaca: o que o painel da seção transversal desenha. */
export class LeitorDeSecoes {
  private readonly secoes: Secao4D[][]
  private readonly fatiaDe = new Map<string, number>()
  private readonly soltas: number[][]

  constructor(private readonly pronto: ModeloPronto) {
    const id = new Map(pronto.modelo.eixos.map((e, i) => [e.id, i]))
    this.secoes = pronto.modelo.eixos.map(() => [])
    for (const sc of pronto.modelo.secoes ?? [])
      this.secoes[sc.eixo ? (id.get(sc.eixo) ?? 0) : 0].push(sc)
    for (const l of this.secoes) l.sort((a, b) => a.s - b.s)
    const emFatia = new Uint8Array(pronto.pecas.length)
    pronto.fatias.forEach((f, k) => {
      this.fatiaDe.set(`${f.eixo}|${f.s0}`, k)
      for (const i of f.pecas) emFatia[i] = 1
    })
    // peças que não são camada da plataforma: os dispositivos
    this.soltas = pronto.modelo.eixos.map(() => [])
    pronto.pecas.forEach((p, i) => {
      if (!emFatia[i]) this.soltas[p.eixo]?.push(i)
    })
  }

  /** Limites de estaca em que há seção para o eixo. */
  limites(eixo: number): [number, number] | null {
    const ss = this.secoes[eixo]
    return ss && ss.length >= 2 ? [ss[0].s, ss[ss.length - 1].s] : null
  }

  em(eixo: number, s: number): SecaoDesenho | null {
    const ss = this.secoes[eixo]
    const ex = this.pronto.eixos[eixo]
    if (!ss || ss.length < 2 || !ex || s < ss[0].s || s > ss[ss.length - 1].s) return null
    let lo = 0
    let hi = ss.length - 1
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (ss[m].s <= s) lo = m
      else hi = m
    }
    const A = ss[lo]
    const B = ss[lo + 1]
    if (B.s - A.s > SALTO) return null
    const f = (s - A.s) / (B.s - A.s || 1)
    const mix = (a: number, b: number): number => a + (b - a) * f
    const o0 = mix(A.perfil[0][0], B.perfil[0][0])
    const o1 = mix(A.perfil[A.perfil.length - 1][0], B.perfil[B.perfil.length - 1][0])
    const cota = (o: number): number => mix(cotaNoPerfil(A.perfil, o), cotaNoPerfil(B.perfil, o))
    const quebras = [...new Set([...A.perfil, ...B.perfil].map((p) => p[0]))]
      .filter((o) => o > o0 && o < o1)
      .sort((a, b) => a - b)
    const perfil = [o0, ...quebras, o1].map((o): [number, number] => [o, cota(o)])

    const natural: [number, number][] = []
    for (let o = Math.floor(o0 - MARGEM); o <= o1 + MARGEM; o += 1) {
      const p = ex.ponto(s, o)
      const z = cotaNaGrade(this.pronto.grades, p[0], p[1], 'atual')
      if (!Number.isNaN(z)) natural.push([o, z])
    }
    const noNatural = (o: number): number | null =>
      natural.length >= 2 && o >= natural[0][0] && o <= natural[natural.length - 1][0]
        ? cotaNoPerfil(natural, o)
        : null

    const classes = this.pronto.modelo.classes
    const indice = new Map(classes.map((c, i) => [c.id, i]))
    const fatia = this.fatiaDe.get(`${eixo}|${A.s}`)
    const pecasDaFatia = fatia == null ? [] : this.pronto.fatias[fatia].pecas
    const meio = (A.s + B.s) / 2
    const idEixo = this.pronto.modelo.eixos[eixo].id
    const formas: FormaDaSecao[] = []
    for (const c of this.pronto.modelo.camadas ?? []) {
      if ((c.eixo ?? this.pronto.modelo.eixos[0].id) !== idEixo || meio < c.s0 || meio > c.s1)
        continue
      const ic = indice.get(c.classe)
      if (ic == null) continue
      const cl = classes[ic]
      const peca = pecasDaFatia.find((i) => this.pronto.pecas[i].classe === ic) ?? null
      for (const [de, ate, sobeFaixa] of c.faixas) {
        const a = Math.max(de, o0)
        const b = Math.min(ate, o1)
        if (!(b > a)) continue
        const sobe = (c.elevacao ?? 0) + (sobeFaixa ?? 0)
        const topo = [a, ...quebras.filter((o) => o > a && o < b), b].map((o): [number, number] => [
          o,
          cota(o) + sobe
        ])
        const base = { classe: ic, nome: c.nome ?? cl.nome, peca }
        const material = c.material ?? materialDaClasse(cl)
        if (c.espessura && c.espessura > 0) {
          const esp = c.espessura
          formas.push({
            ...base,
            material,
            pontos: [...topo, ...topo.map(([o, z]): [number, number] => [o, z - esp]).reverse()],
            fechada: true,
            espessura: esp
          })
        } else if (cl.terreno && topo.every(([o]) => noNatural(o) != null)) {
          // terraplenagem: o que há entre a superfície acabada e o terreno natural
          formas.push({
            ...base,
            material,
            pontos: [...topo, ...topo.map(([o]): [number, number] => [o, noNatural(o)!]).reverse()],
            fechada: true,
            espessura: null
          })
        } else formas.push({ ...base, material, pontos: topo, fechada: false, espessura: null })
      }
    }

    const marcas: MarcaDaSecao[] = []
    const [cx, cn] = this.pronto.centro
    for (const i of this.soltas[eixo] ?? []) {
      const p = this.pronto.pecas[i]
      const pontual = p.s1 - p.s0 < 0.5
      if (pontual ? Math.abs(s - p.s0) > 10 : s < p.s0 || s > p.s1) continue
      const pos = this.pronto.malhas[p.classe].pos
      const salto = Math.max(1, Math.floor((p.v1 - p.v0) / 40))
      let perto: { d: number; o: number; z: number } | null = null
      let dica: number | undefined
      for (let v = p.v0; v < p.v1; v += salto) {
        const q = ex.projetar(pos[3 * v] + cx, pos[3 * v + 1] + cn, dica)
        dica = q.i
        const d = Math.abs(q.s - s)
        if (!perto || d < perto.d) perto = { d, o: q.o, z: pos[3 * v + 2] }
      }
      if (!perto) continue
      const cl = classes[p.classe]
      marcas.push({
        classe: p.classe,
        nome: p.nome ?? cl.nome,
        material: this.pronto.materiais[p.material],
        o: perto.o,
        z: perto.z,
        peca: i
      })
    }

    const todos = [
      ...perfil,
      ...natural.filter(([o]) => o >= o0 - MARGEM && o <= o1 + MARGEM),
      ...formas.flatMap((x) => x.pontos),
      ...marcas
        .filter((m) => m.o >= o0 - MARGEM && m.o <= o1 + MARGEM)
        .map((m): [number, number] => [m.o, m.z])
    ]
    return {
      eixo,
      s,
      perfil,
      natural,
      formas,
      marcas,
      caixa: {
        o0: o0 - MARGEM,
        o1: o1 + MARGEM,
        z0: Math.min(...todos.map((p) => p[1])),
        z1: Math.max(...todos.map((p) => p[1]))
      }
    }
  }
}
