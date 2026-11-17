import type { BlocoTerreno4D, Camada4D, Elemento4D, Modelo4D, Pt, Secao4D } from './contrato'
import { EixoCalc } from './eixo'

/** Um pedaço do modelo com estado próprio no 4D: uma fatia de camada, um trecho de linha ou um elemento inteiro. */
export interface Peca {
  /** Índice em `modelo.classes`. */
  classe: number
  /** Índice em `modelo.eixos`. */
  eixo: number
  s0: number
  s1: number
  qtd: number | null
  nome: string | null
  /** Camada empilhada sobre outra (pavimento): enquanto não começa, não se desenha, para não cobrir a de baixo. */
  sobre: boolean
  /** Faixa de vértices da peça na malha da classe. */
  v0: number
  v1: number
}

export interface MalhaClasse {
  /** Triângulos soltos (9 números por triângulo), em coordenadas de cena. */
  pos: Float32Array
  /** Peças da classe, em ordem de `v0`. */
  pecas: number[]
}

export interface BlocoPronto {
  nx: number
  ny: number
  /** Posições de cena com a cota atual. */
  pos: Float32Array
  /** Projeto − atual em cada vértice (0 onde não há projeto). */
  dz: Float32Array
  /** Estaca do eixo mais próximo, o índice dele e a distância até ele. */
  s: Float32Array
  eixo: Uint8Array
  afastamento: Float32Array
  uv: Float32Array
  idx: Uint32Array
  imagem: string | null
}

export interface ModeloPronto {
  modelo: Modelo4D
  eixos: EixoCalc[]
  pecas: Peca[]
  malhas: MalhaClasse[]
  terreno: BlocoPronto[]
  /** Origem da cena no modelo: x, n e cota de referência. */
  centro: Pt
  /** Caixa da cena (x, y = cota, z = −norte). */
  min: Pt
  max: Pt
}

/** Maior comprimento de eixo que uma peça de linha cobre. */
const PASSO = 20
/** Intervalo entre seções acima disto é falha do levantamento: não se desenha. */
const SALTO = 80

class Construtor {
  readonly buf: number[] = []
  constructor(private readonly c: Pt) {}

  get vertices(): number {
    return this.buf.length / 3
  }

  private v(p: Pt): void {
    this.buf.push(p[0] - this.c[0], p[2] - this.c[2], -(p[1] - this.c[1]))
  }

  tri(a: Pt, b: Pt, c: Pt): void {
    this.v(a)
    this.v(b)
    this.v(c)
  }

  quad(a0: Pt, a1: Pt, b0: Pt, b1: Pt): void {
    this.tri(a0, b0, a1)
    this.tri(a1, b0, b1)
  }

  /** Faixa entre duas linhas de pontos com a mesma contagem. */
  faixa(a: Pt[], b: Pt[]): void {
    for (let k = 0; k < a.length - 1; k++) this.quad(a[k], a[k + 1], b[k], b[k + 1])
  }

  segmento(a: Pt, b: Pt, largura: number, altura: number): void {
    const dx = b[0] - a[0]
    const dn = b[1] - a[1]
    const l = Math.hypot(dx, dn)
    if (l < 1e-3) return
    const ox = ((-dn / l) * largura) / 2
    const on = ((dx / l) * largura) / 2
    const h = altura + 0.08
    const a1: Pt = [a[0] + ox, a[1] + on, a[2] + h]
    const a2: Pt = [a[0] - ox, a[1] - on, a[2] + h]
    const b1: Pt = [b[0] + ox, b[1] + on, b[2] + h]
    const b2: Pt = [b[0] - ox, b[1] - on, b[2] + h]
    this.quad(a1, a2, b1, b2)
    if (altura >= 0.15) {
      const baixo = (p: Pt): Pt => [p[0], p[1], p[2] - h]
      this.quad(a1, baixo(a1), b1, baixo(b1))
      this.quad(a2, baixo(a2), b2, baixo(b2))
    }
  }

  /** Prisma entre dois pontos, com a seção dada no plano transversal (lateral, vertical). */
  prisma(p0: Pt, p1: Pt, secao: [number, number][], lateral = 0): void {
    const dx = p1[0] - p0[0]
    const dn = p1[1] - p0[1]
    const l = Math.hypot(dx, dn) || 1
    const ux = -dn / l
    const un = dx / l
    const em = (p: Pt, q: [number, number]): Pt => [
      p[0] + ux * (q[0] + lateral),
      p[1] + un * (q[0] + lateral),
      p[2] + q[1]
    ]
    for (let k = 0; k < secao.length; k++) {
      const q0 = secao[k]
      const q1 = secao[(k + 1) % secao.length]
      this.quad(em(p0, q0), em(p0, q1), em(p1, q0), em(p1, q1))
    }
    for (const p of [p0, p1])
      for (let k = 1; k < secao.length - 1; k++)
        this.tri(em(p, secao[0]), em(p, secao[k]), em(p, secao[k + 1]))
  }

  caixa(p: Pt, dim: [number, number, number], rumo = 0): void {
    const [l, c, h] = dim
    const cs = Math.cos(rumo)
    const sn = Math.sin(rumo)
    const p0: Pt = [p[0] - (cs * l) / 2, p[1] - (sn * l) / 2, p[2]]
    const p1: Pt = [p[0] + (cs * l) / 2, p[1] + (sn * l) / 2, p[2]]
    this.prisma(p0, p1, [
      [-c / 2, 0],
      [c / 2, 0],
      [c / 2, h],
      [-c / 2, h]
    ])
  }
}

const circulo = (r: number): [number, number][] =>
  Array.from({ length: 10 }, (_, k) => {
    const a = (k / 10) * Math.PI * 2
    return [Math.cos(a) * r, r + Math.sin(a) * r]
  })

function cotaNoPerfil(perfil: [number, number][], o: number): number {
  if (o <= perfil[0][0]) return perfil[0][1]
  for (let k = 0; k < perfil.length - 1; k++) {
    const a = perfil[k]
    const b = perfil[k + 1]
    if (o <= b[0]) return a[1] + ((b[1] - a[1]) * (o - a[0])) / (b[0] - a[0] || 1)
  }
  return perfil[perfil.length - 1][1]
}

function decodificar(b64: string, zb: number): Float32Array {
  const bin = atob(b64)
  const out = new Float32Array(bin.length / 2)
  for (let i = 0; i < out.length; i++) {
    const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)
    out[i] = v === 65535 ? NaN : v / 100 + zb
  }
  return out
}

function prepararBloco(b: BlocoTerreno4D, eixos: EixoCalc[], c: Pt): BlocoPronto {
  const n = b.nx * b.ny
  const atual = decodificar(b.atual, b.zb)
  const projeto = b.projeto ? decodificar(b.projeto, b.zb) : null
  const pos = new Float32Array(n * 3)
  const dz = new Float32Array(n)
  const s = new Float32Array(n)
  const eixo = new Uint8Array(n)
  const afastamento = new Float32Array(n)
  const uv = new Float32Array(n * 2)
  const larg = b.imagem_larg ?? ((b.nx - 1) * b.res || 1)
  const alt = b.imagem_alt ?? ((b.ny - 1) * b.res || 1)
  for (let r = 0; r < b.ny; r++) {
    for (let k = 0; k < b.nx; k++) {
      const i = r * b.nx + k
      const x = b.x0 + k * b.res
      const nn = b.ytop - r * b.res
      const h = Number.isNaN(atual[i]) ? c[2] : atual[i]
      pos[3 * i] = x - c[0]
      pos[3 * i + 1] = h - c[2]
      pos[3 * i + 2] = -(nn - c[1])
      uv[2 * i] = (x - b.x0) / larg
      uv[2 * i + 1] = 1 - (b.ytop - nn) / alt
      const d = projeto ? projeto[i] - atual[i] : 0
      dz[i] = Number.isNaN(d) ? 0 : d
      let melhor = Infinity
      for (let e = 0; e < eixos.length; e++) {
        const q = eixos[e].projetar(x, nn)
        if (q.d < melhor) {
          melhor = q.d
          s[i] = q.s
          eixo[i] = e
          afastamento[i] = q.d
        }
      }
    }
  }
  const idx: number[] = []
  for (let r = 0; r < b.ny - 1; r++) {
    for (let k = 0; k < b.nx - 1; k++) {
      const a = r * b.nx + k
      const d = a + b.nx
      if ([a, a + 1, d, d + 1].some((i) => Number.isNaN(atual[i]))) continue
      idx.push(a, d, a + 1, a + 1, d, d + 1)
    }
  }
  return {
    nx: b.nx,
    ny: b.ny,
    pos,
    dz,
    s,
    eixo,
    afastamento,
    uv,
    idx: new Uint32Array(idx),
    imagem: b.imagem ?? null
  }
}

/** Expande o modelo em peças com geometria: fatia as camadas pelas seções e as linhas por comprimento. */
export function prepararModelo(modelo: Modelo4D): ModeloPronto {
  const eixos = modelo.eixos.map((e) => new EixoCalc(e))
  const idEixo = new Map(modelo.eixos.map((e, i) => [e.id, i]))
  const idClasse = new Map(modelo.classes.map((c, i) => [c.id, i]))
  const e0 = modelo.eixos[0].pontos
  let zMin = Infinity
  let xa = Infinity
  let xb = -Infinity
  let na = Infinity
  let nb = -Infinity
  for (const e of modelo.eixos)
    for (const p of e.pontos) {
      zMin = Math.min(zMin, p[3])
      xa = Math.min(xa, p[1])
      xb = Math.max(xb, p[1])
      na = Math.min(na, p[2])
      nb = Math.max(nb, p[2])
    }
  const centro: Pt = e0.length ? [(xa + xb) / 2, (na + nb) / 2, Math.floor(zMin) - 2] : [0, 0, 0]

  const construtores = modelo.classes.map(() => new Construtor(centro))
  const pecas: Peca[] = []
  const porClasse: number[][] = modelo.classes.map(() => [])
  const nova = (
    classe: number,
    eixo: number,
    s0: number,
    s1: number,
    qtd: number | null,
    nome: string | null,
    v0: number,
    sobre = false
  ): void => {
    const v1 = construtores[classe].vertices
    if (v1 === v0) return
    porClasse[classe].push(pecas.length)
    pecas.push({
      classe,
      eixo,
      s0: Math.min(s0, s1),
      s1: Math.max(s0, s1),
      qtd,
      nome,
      sobre,
      v0,
      v1
    })
  }

  const secoes: Secao4D[][] = modelo.eixos.map(() => [])
  for (const sc of modelo.secoes ?? []) secoes[sc.eixo ? (idEixo.get(sc.eixo) ?? 0) : 0].push(sc)
  for (const l of secoes) l.sort((a, b) => a.s - b.s)

  const linhaDaSecao = (
    ex: EixoCalc,
    sc: Secao4D,
    de: number,
    ate: number,
    meio: number[],
    sobe: number
  ): Pt[] => {
    const a = Math.max(de, sc.perfil[0][0])
    const b = Math.min(ate, sc.perfil[sc.perfil.length - 1][0])
    return [a, ...meio, b].map((o) => {
      const q = ex.ponto(sc.s, o)
      return [q[0], q[1], cotaNoPerfil(sc.perfil, o) + sobe] as Pt
    })
  }

  const fatiar = (c: Camada4D): void => {
    const classe = idClasse.get(c.classe)!
    const ie = c.eixo ? (idEixo.get(c.eixo) ?? 0) : 0
    const ex = eixos[ie]
    const ss = secoes[ie]
    const fatias: [number, number][] = []
    for (let i = 0; i < ss.length - 1; i++) {
      const meio = (ss[i].s + ss[i + 1].s) / 2
      if (meio >= c.s0 && meio <= c.s1 && ss[i + 1].s - ss[i].s <= SALTO)
        fatias.push([i, ss[i + 1].s - ss[i].s])
    }
    const total = fatias.reduce((t, f) => t + f[1], 0)
    for (const [i, comp] of fatias) {
      const A = ss[i]
      const B = ss[i + 1]
      const k = construtores[classe]
      const v0 = k.vertices
      for (const [de, ate] of c.faixas) {
        const ini = Math.max(de, A.perfil[0][0], B.perfil[0][0])
        const fim = Math.min(
          ate,
          A.perfil[A.perfil.length - 1][0],
          B.perfil[B.perfil.length - 1][0]
        )
        if (!(fim > ini)) continue
        const meio = [
          ...new Set([...A.perfil, ...B.perfil].map((p) => p[0]).filter((o) => o > ini && o < fim))
        ].sort((x, y) => x - y)
        k.faixa(
          linhaDaSecao(ex, A, de, ate, meio, c.elevacao ?? 0),
          linhaDaSecao(ex, B, de, ate, meio, c.elevacao ?? 0)
        )
      }
      const qtd = c.quantidade != null && total > 0 ? (c.quantidade * comp) / total : null
      nova(classe, ie, A.s, B.s, qtd, c.nome ?? null, v0, (c.elevacao ?? 0) > 0)
    }
  }
  for (const c of modelo.camadas ?? []) fatiar(c)

  const elemento = (el: Elemento4D): void => {
    const classe = idClasse.get(el.classe)!
    const ie = el.eixo ? (idEixo.get(el.eixo) ?? 0) : 0
    const ex = eixos[ie]
    const k = construtores[classe]
    const g = el.geo
    if (g.t === 'linha') {
      // segmento mais longo que o passo ganha pontos no meio, para cada peça cobrir pouco eixo
      const pts: Pt[] = [g.pts[0]]
      for (let i = 1; i < g.pts.length; i++) {
        const a = g.pts[i - 1]
        const b = g.pts[i]
        const partes = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / PASSO)
        for (let k = 1; k <= Math.max(1, partes); k++) {
          const f = k / Math.max(1, partes)
          pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])
        }
      }
      const s = pts.map((p) => ex.projetar(p[0], p[1]).s)
      const comp = pts.map((p, i) =>
        i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0
      )
      const total = comp.reduce((a, b) => a + b, 0)
      let i0 = 0
      while (i0 < pts.length - 1) {
        let lo = s[i0]
        let hi = s[i0]
        let j = i0
        let len = 0
        const v0 = k.vertices
        while (j < pts.length - 1) {
          const nlo = Math.min(lo, s[j + 1])
          const nhi = Math.max(hi, s[j + 1])
          if (j > i0 && nhi - nlo > PASSO + 1e-6) break
          lo = nlo
          hi = nhi
          k.segmento(pts[j], pts[j + 1], g.largura, g.altura ?? 0)
          len += comp[j + 1]
          j++
        }
        const qtd = el.quantidade != null && total > 0 ? (el.quantidade * len) / total : null
        nova(classe, ie, lo, hi, qtd, el.nome ?? null, v0)
        i0 = j
      }
      return
    }
    const v0 = k.vertices
    let ref: Pt[]
    if (g.t === 'caixa') {
      k.caixa(g.p, g.dim, g.rumo)
      ref = [g.p]
    } else if (g.t === 'tubo') {
      const n = Math.max(1, g.linhas ?? 1)
      const larg = g.diametro ?? g.largura ?? 1
      const alt = g.diametro ?? g.altura ?? 1
      const passo = larg * 1.25
      const secao: [number, number][] = g.diametro
        ? circulo(g.diametro / 2)
        : [
            [-larg / 2, 0],
            [larg / 2, 0],
            [larg / 2, alt],
            [-larg / 2, alt]
          ]
      for (let i = 0; i < n; i++) k.prisma(g.p0, g.p1, secao, (i - (n - 1) / 2) * passo)
      const rumo = Math.atan2(g.p1[1] - g.p0[1], g.p1[0] - g.p0[0])
      for (const p of [g.p0, g.p1])
        k.caixa([p[0], p[1], p[2] - 0.2], [0.3, n * passo + 0.8, alt + 0.7], rumo)
      ref = [g.p0, g.p1]
    } else {
      const P = (i: number): Pt => [g.pos[3 * i], g.pos[3 * i + 1], g.pos[3 * i + 2]]
      const n = g.idx ? g.idx.length : g.pos.length / 3
      for (let i = 0; i + 2 < n; i += 3)
        k.tri(
          P(g.idx ? g.idx[i] : i),
          P(g.idx ? g.idx[i + 1] : i + 1),
          P(g.idx ? g.idx[i + 2] : i + 2)
        )
      ref = Array.from({ length: Math.min(40, g.pos.length / 3) }, (_, i) =>
        P(i * Math.max(1, Math.floor(g.pos.length / 120)))
      )
    }
    let s0 = el.s0
    let s1 = el.s1
    if (s0 == null || s1 == null) {
      const ps = ref.filter((p) => p.every(Number.isFinite)).map((p) => ex.projetar(p[0], p[1]).s)
      s0 = el.s0 ?? Math.min(...ps)
      s1 = el.s1 ?? Math.max(...ps)
    }
    nova(classe, ie, s0, s1, el.quantidade ?? null, el.nome ?? null, v0)
  }
  for (const el of modelo.elementos) elemento(el)

  const malhas = construtores.map((k, i) => ({ pos: new Float32Array(k.buf), pecas: porClasse[i] }))
  const terreno = (modelo.terreno ?? []).map((b) => prepararBloco(b, eixos, centro))

  const min: Pt = [Infinity, Infinity, Infinity]
  const max: Pt = [-Infinity, -Infinity, -Infinity]
  const cresce = (a: Float32Array): void => {
    for (let i = 0; i < a.length; i += 3)
      for (let d = 0; d < 3; d++) {
        if (a[i + d] < min[d]) min[d] = a[i + d]
        if (a[i + d] > max[d]) max[d] = a[i + d]
      }
  }
  for (const m of malhas) cresce(m.pos)
  for (const e of modelo.eixos)
    cresce(
      new Float32Array(
        e.pontos.flatMap((p) => [p[1] - centro[0], p[3] - centro[2], -(p[2] - centro[1])])
      )
    )

  return { modelo, eixos, pecas, malhas, terreno, centro, min, max }
}

/** Resumo gravado com o modelo: classes com contagem, extensão coberta e quantidade. */
export interface ResumoModelo {
  extensao_m: number
  eixos: { id: string; nome: string; s0: number; s1: number }[]
  classes: {
    id: string
    nome: string
    disciplina: string
    servico: string | null
    contexto: boolean
    pecas: number
    s0: number | null
    s1: number | null
  }[]
  terreno: boolean
}

export function resumirModelo(p: ModeloPronto): ResumoModelo {
  const classes = p.modelo.classes.map((c, i) => {
    const ps = p.malhas[i].pecas.map((j) => p.pecas[j])
    return {
      id: c.id,
      nome: c.nome,
      disciplina: c.disciplina,
      servico: c.servico ?? null,
      contexto: !!c.contexto,
      pecas: ps.length,
      s0: ps.length ? Math.min(...ps.map((q) => q.s0)) : null,
      s1: ps.length ? Math.max(...ps.map((q) => q.s1)) : null
    }
  })
  return {
    extensao_m: Math.max(...p.eixos.map((e) => e.sMax - e.sMin)),
    eixos: p.eixos.map((e) => ({ id: e.id, nome: e.nome, s0: e.sMin, s1: e.sMax })),
    classes,
    terreno: p.terreno.length > 0
  }
}
