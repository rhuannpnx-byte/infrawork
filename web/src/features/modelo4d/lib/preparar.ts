import type {
  BlocoTerreno4D,
  Camada4D,
  Classe4D,
  Elemento4D,
  Material,
  Modelo4D,
  Pt,
  Secao4D
} from './contrato'
import { EixoCalc } from './eixo'
import { lerFuso, type Fuso } from './geo'

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
  /** Índice em `ModeloPronto.materiais`. */
  material: number
  /** Faixa de vértices da peça na malha da classe. */
  v0: number
  v1: number
}

export interface MalhaClasse {
  /** Triângulos soltos (9 números por triângulo): x e n relativos a `centro`, z = cota. */
  pos: Float32Array
  /** Peças da classe, em ordem de `v0`. */
  pecas: number[]
}

/** Grade do terreno do projeto, já em cotas. */
export interface Grade {
  nx: number
  ny: number
  res: number
  x0: number
  ytop: number
  atual: Float32Array
  projeto: Float32Array | null
}

/** Pegada da obra entre duas seções (de off-set a off-set): onde a terraplenagem avança, o terreno natural sai. */
export interface Fatia {
  eixo: number
  s0: number
  s1: number
  /** Contorno em x, n (esquerda de A, direita de A, direita de B, esquerda de B). */
  contorno: [number, number][]
  /** Peças das camadas da fatia (terraplenagem, pavimento, pintura). */
  pecas: number[]
}

export interface ModeloPronto {
  modelo: Modelo4D
  eixos: EixoCalc[]
  pecas: Peca[]
  malhas: MalhaClasse[]
  materiais: Material[]
  grades: Grade[]
  fatias: Fatia[]
  /** Origem das malhas no modelo (x, n); a cota não é deslocada. */
  centro: [number, number]
  /** Fuso UTM e origem, quando o modelo é georreferenciado. */
  fuso: Fuso | null
}

/** Maior comprimento de eixo que uma peça de linha cobre. */
const PASSO = 20
/** Intervalo entre seções acima disto é falha do levantamento: não se desenha. */
const SALTO = 80
/** Quanto a pegada passa do off-set, para o recorte do terreno não deixar fresta. */
const FOLGA = 0.6

const sem = (t: string): string => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Material de uma classe pelo nome, quando o modelo não diz. */
export function materialDaClasse(c: Classe4D): Material {
  if (c.material) return c.material
  if (c.contexto) return 'contexto'
  const t = sem(`${c.id} ${c.nome} ${c.disciplina}`)
  if (/sinaliza|placa|pintura de faixa/.test(t)) return 'sinal-branco'
  if (/semead|grama|vegeta|hidrossem/.test(t)) return 'grama'
  if (/corte|escava/.test(t)) return 'corte'
  if (/aterro|terraplen|compacta/.test(t)) return 'aterro'
  if (/imprima|pintura de liga|betum/.test(t)) return 'betume'
  if (/tratamento superficial|tsd|cbuq|cauq|asfalt|micro|revest|capa/.test(t)) return 'asfalto'
  if (/sub-?base|base|regulariza|subleito|granul|brita|paviment/.test(t)) return 'granular'
  if (/cerca/.test(t)) return 'madeira'
  if (/defensa|metal|terminal/.test(t)) return 'metal'
  return 'concreto'
}

class Construtor {
  readonly buf: number[] = []
  constructor(private readonly c: [number, number]) {}

  get vertices(): number {
    return this.buf.length / 3
  }

  tri(a: Pt, b: Pt, c: Pt): void {
    this.buf.push(a[0] - this.c[0], a[1] - this.c[1], a[2])
    this.buf.push(b[0] - this.c[0], b[1] - this.c[1], b[2])
    this.buf.push(c[0] - this.c[0], c[1] - this.c[1], c[2])
  }

  quad(a0: Pt, a1: Pt, b0: Pt, b1: Pt): void {
    this.tri(a0, b0, a1)
    this.tri(a1, b0, b1)
  }

  /** Superfície entre duas linhas de pontos com a mesma contagem. */
  faixa(a: Pt[], b: Pt[]): void {
    for (let k = 0; k < a.length - 1; k++) this.quad(a[k], a[k + 1], b[k], b[k + 1])
  }

  /** Laje entre duas linhas: o topo e os dois bordos, com `esp` de espessura para baixo (as fatias vizinhas se encostam). */
  laje(a: Pt[], b: Pt[], esp: number): void {
    const baixo = (p: Pt): Pt => [p[0], p[1], p[2] - esp]
    this.faixa(a, b)
    const n = a.length - 1
    this.quad(a[0], baixo(a[0]), b[0], baixo(b[0]))
    this.quad(a[n], baixo(a[n]), b[n], baixo(b[n]))
  }

  /** Fio: fita vertical fina entre dois pontos, à altura `h`. */
  fio(a: Pt, b: Pt, h: number): void {
    const e = 0.03
    this.quad(
      [a[0], a[1], a[2] + h],
      [a[0], a[1], a[2] + h + e],
      [b[0], b[1], b[2] + h],
      [b[0], b[1], b[2] + h + e]
    )
  }

  /** Prisma entre dois pontos, com a seção dada no plano transversal (lateral, vertical). */
  prisma(p0: Pt, p1: Pt, secao: [number, number][], tampas = true): void {
    const dx = p1[0] - p0[0]
    const dn = p1[1] - p0[1]
    const l = Math.hypot(dx, dn)
    if (l < 1e-4) return
    // lateral positiva = à direita de quem vai de p0 para p1
    const ux = dn / l
    const un = -dx / l
    const em = (p: Pt, q: [number, number]): Pt => [p[0] + ux * q[0], p[1] + un * q[0], p[2] + q[1]]
    for (let k = 0; k < secao.length; k++) {
      const q0 = secao[k]
      const q1 = secao[(k + 1) % secao.length]
      this.quad(em(p0, q0), em(p0, q1), em(p1, q0), em(p1, q1))
    }
    if (!tampas) return
    for (const p of [p0, p1])
      for (let k = 1; k < secao.length - 1; k++)
        this.tri(em(p, secao[0]), em(p, secao[k]), em(p, secao[k + 1]))
  }

  /** Caixa com a base em `p`: `dim` = [ao longo do rumo, transversal, altura]. */
  caixa(p: Pt, dim: [number, number, number], rumo = 0): void {
    const [l, c, h] = dim
    const cs = Math.cos(rumo)
    const sn = Math.sin(rumo)
    this.prisma(
      [p[0] - (cs * l) / 2, p[1] - (sn * l) / 2, p[2]],
      [p[0] + (cs * l) / 2, p[1] + (sn * l) / 2, p[2]],
      [
        [-c / 2, 0],
        [c / 2, 0],
        [c / 2, h],
        [-c / 2, h]
      ]
    )
  }

  /** Poste vertical de seção quadrada: as quatro faces e o topo. */
  poste(p: Pt, lado: number, altura: number): void {
    const m = lado / 2
    const c: Pt[] = [
      [p[0] - m, p[1] - m, p[2]],
      [p[0] + m, p[1] - m, p[2]],
      [p[0] + m, p[1] + m, p[2]],
      [p[0] - m, p[1] + m, p[2]]
    ]
    const t = c.map((q): Pt => [q[0], q[1], q[2] + altura])
    for (let k = 0; k < 4; k++) this.quad(c[k], c[(k + 1) % 4], t[k], t[(k + 1) % 4])
    this.quad(t[0], t[1], t[3], t[2])
  }

  /** Chapa vertical centrada em `p`, de frente para `rumo`, com o contorno dado em (lateral, vertical). */
  chapa(p: Pt, rumo: number, contorno: [number, number][], esp = 0.04): void {
    const cs = Math.cos(rumo)
    const sn = Math.sin(rumo)
    const em = (q: [number, number], f: number): Pt => [
      p[0] - sn * q[0] + cs * f,
      p[1] + cs * q[0] + sn * f,
      p[2] + q[1]
    ]
    for (const f of [esp / 2, -esp / 2])
      for (let k = 1; k < contorno.length - 1; k++)
        this.tri(em(contorno[0], f), em(contorno[k], f), em(contorno[k + 1], f))
    for (let k = 0; k < contorno.length; k++) {
      const a = contorno[k]
      const b = contorno[(k + 1) % contorno.length]
      this.quad(em(a, esp / 2), em(b, esp / 2), em(a, -esp / 2), em(b, -esp / 2))
    }
  }
}

const circulo = (r: number, lados = 12, cz = r): [number, number][] =>
  Array.from({ length: lados }, (_, k) => {
    const a = (k / lados) * Math.PI * 2
    return [Math.cos(a) * r, cz + Math.sin(a) * r]
  })

function contornoDaPlaca(forma: string, larg: number, alt: number): [number, number][] {
  const r = larg / 2
  if (forma === 'circulo') return circulo(r, 16, 0)
  if (forma === 'octogono')
    return circulo(r / Math.cos(Math.PI / 8), 8, 0).map(([x, z]) => {
      const a = Math.PI / 8
      return [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)]
    })
  if (forma === 'losango')
    return [
      [0, -r],
      [r, 0],
      [0, r],
      [-r, 0]
    ]
  if (forma === 'triangulo')
    return [
      [-r, -r * 0.6],
      [r, -r * 0.6],
      [0, r * 1.1]
    ]
  return [
    [-r, -alt / 2],
    [r, -alt / 2],
    [r, alt / 2],
    [-r, alt / 2]
  ]
}

export function cotaNoPerfil(perfil: [number, number][], o: number): number {
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

const grade = (b: BlocoTerreno4D): Grade => ({
  nx: b.nx,
  ny: b.ny,
  res: b.res,
  x0: b.x0,
  ytop: b.ytop,
  atual: decodificar(b.atual, b.zb),
  projeto: b.projeto ? decodificar(b.projeto, b.zb) : null
})

/** Cota do terreno do projeto (natural ou acabado) em (x, n), por interpolação na grade; NaN fora dela. */
export function cotaNaGrade(
  grades: Grade[],
  x: number,
  n: number,
  qual: 'atual' | 'projeto'
): number {
  for (const g of grades) {
    const v = qual === 'atual' ? g.atual : g.projeto
    if (!v) continue
    const fx = (x - g.x0) / g.res
    const fy = (g.ytop - n) / g.res
    if (fx < 0 || fy < 0 || fx > g.nx - 1 || fy > g.ny - 1) continue
    const ix = Math.min(g.nx - 2, Math.floor(fx))
    const iy = Math.min(g.ny - 2, Math.floor(fy))
    const tx = fx - ix
    const ty = fy - iy
    const a = v[iy * g.nx + ix]
    const b = v[iy * g.nx + ix + 1]
    const c = v[(iy + 1) * g.nx + ix]
    const d = v[(iy + 1) * g.nx + ix + 1]
    if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) continue
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
  }
  return NaN
}

/** Expande o modelo em peças com geometria: fatia as camadas pelas seções e as linhas por comprimento. */
export function prepararModelo(modelo: Modelo4D): ModeloPronto {
  const eixos = modelo.eixos.map((e) => new EixoCalc(e))
  const idEixo = new Map(modelo.eixos.map((e, i) => [e.id, i]))
  const idClasse = new Map(modelo.classes.map((c, i) => [c.id, i]))
  let xa = Infinity
  let xb = -Infinity
  let na = Infinity
  let nb = -Infinity
  for (const e of modelo.eixos)
    for (const p of e.pontos) {
      xa = Math.min(xa, p[1])
      xb = Math.max(xb, p[1])
      na = Math.min(na, p[2])
      nb = Math.max(nb, p[2])
    }
  const centro: [number, number] = [(xa + xb) / 2, (na + nb) / 2]
  const grades = (modelo.terreno ?? []).map(grade)

  const materiais: Material[] = []
  const idMaterial = (m: Material): number => {
    const i = materiais.indexOf(m)
    return i >= 0 ? i : materiais.push(m) - 1
  }
  const materialClasse = modelo.classes.map((c) => idMaterial(materialDaClasse(c)))

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
    material?: Material
  ): number => {
    const v1 = construtores[classe].vertices
    if (v1 === v0) return -1
    porClasse[classe].push(pecas.length)
    pecas.push({
      classe,
      eixo,
      s0: Math.min(s0, s1),
      s1: Math.max(s0, s1),
      qtd,
      nome,
      material: material ? idMaterial(material) : materialClasse[classe],
      v0,
      v1
    })
    return pecas.length - 1
  }

  const secoes: Secao4D[][] = modelo.eixos.map(() => [])
  for (const sc of modelo.secoes ?? []) secoes[sc.eixo ? (idEixo.get(sc.eixo) ?? 0) : 0].push(sc)
  for (const l of secoes) l.sort((a, b) => a.s - b.s)

  // pegada da obra por intervalo de seção, para o recorte do terreno
  const fatias: Fatia[] = []
  const fatiaDe = new Map<string, number>()
  secoes.forEach((ss, ie) => {
    for (let i = 0; i < ss.length - 1; i++) {
      const A = ss[i]
      const B = ss[i + 1]
      if (B.s - A.s > SALTO) continue
      const ponta = (sc: Secao4D, k: 0 | 1): [number, number] => {
        const o = k ? sc.perfil[sc.perfil.length - 1][0] + FOLGA : sc.perfil[0][0] - FOLGA
        const q = eixos[ie].ponto(sc.s, o)
        return [q[0], q[1]]
      }
      fatiaDe.set(`${ie}|${i}`, fatias.length)
      fatias.push({
        eixo: ie,
        s0: A.s,
        s1: B.s,
        contorno: [ponta(A, 0), ponta(A, 1), ponta(B, 1), ponta(B, 0)],
        pecas: []
      })
    }
  })

  const linhaDaSecao = (ex: EixoCalc, sc: Secao4D, ofs: number[], sobe: number): Pt[] =>
    ofs.map((o) => {
      const q = ex.ponto(sc.s, o)
      return [q[0], q[1], cotaNoPerfil(sc.perfil, o) + sobe] as Pt
    })

  const fatiar = (c: Camada4D): void => {
    const classe = idClasse.get(c.classe)!
    const ie = c.eixo ? (idEixo.get(c.eixo) ?? 0) : 0
    const ex = eixos[ie]
    const ss = secoes[ie]
    const intervalos: [number, number][] = []
    for (let i = 0; i < ss.length - 1; i++) {
      const meio = (ss[i].s + ss[i + 1].s) / 2
      if (meio >= c.s0 && meio <= c.s1 && ss[i + 1].s - ss[i].s <= SALTO)
        intervalos.push([i, ss[i + 1].s - ss[i].s])
    }
    const total = intervalos.reduce((t, f) => t + f[1], 0)
    const terreno = !!modelo.classes[classe].terreno
    for (const [i, comp] of intervalos) {
      const A = ss[i]
      const B = ss[i + 1]
      const k = construtores[classe]
      const v0 = k.vertices
      const fimA = A.perfil[A.perfil.length - 1][0]
      const fimB = B.perfil[B.perfil.length - 1][0]
      for (const [de, ate, sobeFaixa] of c.faixas) {
        const sobe = (c.elevacao ?? 0) + (sobeFaixa ?? 0)
        const iniA = Math.max(de, A.perfil[0][0])
        const iniB = Math.max(de, B.perfil[0][0])
        const ateA = Math.min(ate, fimA)
        const ateB = Math.min(ate, fimB)
        if (!(ateA > iniA) || !(ateB > iniB)) continue
        const ini = Math.max(iniA, iniB)
        const fim = Math.min(ateA, ateB)
        const meio = [
          ...new Set([...A.perfil, ...B.perfil].map((p) => p[0]).filter((o) => o > ini && o < fim))
        ].sort((x, y) => x - y)
        const la = linhaDaSecao(ex, A, [iniA, ...meio, ateA], sobe)
        const lb = linhaDaSecao(ex, B, [iniB, ...meio, ateB], sobe)
        if (c.espessura && c.espessura > 0) k.laje(la, lb, c.espessura)
        else k.faixa(la, lb)
        // a terraplenagem que chega à ponta da seção ganha uma saia, para não aparecer fresta junto ao terreno
        if (terreno) {
          const saia = (p: Pt): Pt => [p[0], p[1], p[2] - 2.5]
          if (de < A.perfil[0][0] + 1e-6) k.quad(la[0], saia(la[0]), lb[0], saia(lb[0]))
          const n = la.length - 1
          if (ate > fimA - 1e-6) k.quad(la[n], saia(la[n]), lb[n], saia(lb[n]))
        }
      }
      const qtd = c.quantidade != null && total > 0 ? (c.quantidade * comp) / total : null
      const ip = nova(classe, ie, A.s, B.s, qtd, c.nome ?? null, v0, c.material)
      const f = fatiaDe.get(`${ie}|${i}`)
      if (ip >= 0 && f != null) fatias[f].pecas.push(ip)
    }
  }
  for (const c of modelo.camadas ?? []) fatiar(c)

  const assentar = (p: Pt): Pt => {
    const z = cotaNaGrade(grades, p[0], p[1], 'atual')
    return Number.isNaN(z) ? p : [p[0], p[1], z]
  }

  const elemento = (el: Elemento4D): void => {
    const classe = idClasse.get(el.classe)!
    const ie = el.eixo ? (idEixo.get(el.eixo) ?? 0) : 0
    const ex = eixos[ie]
    const k = construtores[classe]
    const g = el.geo
    const chao = (p: Pt): Pt => (el.no_terreno ? assentar(p) : p)
    if (g.t === 'linha') {
      // segmento mais longo que o passo ganha pontos no meio, para cada peça cobrir pouco eixo
      const pts: Pt[] = [chao(g.pts[0])]
      for (let i = 1; i < g.pts.length; i++) {
        const a = g.pts[i - 1]
        const b = g.pts[i]
        const partes = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / PASSO))
        for (let j = 1; j <= partes; j++) {
          const f = j / partes
          pts.push(
            chao([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])
          )
        }
      }
      const s = pts.map((p) => ex.projetar(p[0], p[1]).s)
      const comp = pts.map((p, i) =>
        i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0
      )
      const total = comp.reduce((a, b) => a + b, 0)
      const alt = g.altura ?? 0
      const secao: [number, number][] = g.perfil ?? [
        [-g.largura / 2, 0],
        [g.largura / 2, 0],
        [g.largura / 2, Math.max(alt, 0.06)],
        [-g.largura / 2, Math.max(alt, 0.06)]
      ]
      let andado = 0
      let proximoPoste = 0
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
          const a = pts[j]
          const b = pts[j + 1]
          if (g.fios?.length) for (const h of g.fios) k.fio(a, b, h)
          // tampa só nas pontas da peça: os segmentos do meio se encostam
          else k.prisma(a, b, secao, false)
          if (g.postes) {
            // postes a cada `passo` metros ao longo da linha
            while (proximoPoste <= andado + comp[j + 1] + 1e-6) {
              const f = comp[j + 1] > 0 ? (proximoPoste - andado) / comp[j + 1] : 0
              k.poste(
                [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f],
                g.postes.lado ?? 0.1,
                g.postes.altura
              )
              proximoPoste += g.postes.passo
            }
          }
          andado += comp[j + 1]
          len += comp[j + 1]
          j++
        }
        const qtd = el.quantidade != null && total > 0 ? (el.quantidade * len) / total : null
        nova(classe, ie, lo, hi, qtd, el.nome ?? null, v0, el.material)
        i0 = j
      }
      return
    }
    const v0 = k.vertices
    let ref: Pt[]
    if (g.t === 'caixa') {
      k.caixa(chao(g.p), g.dim, g.rumo)
      ref = [g.p]
    } else if (g.t === 'placa') {
      const p = chao(g.p)
      const alt = g.altura ?? g.largura
      const centroChapa = 2.1 + alt / 2
      k.poste(p, 0.07, centroChapa)
      k.chapa([p[0], p[1], p[2] + centroChapa], g.rumo, contornoDaPlaca(g.forma, g.largura, alt))
      ref = [g.p]
    } else if (g.t === 'tubo') {
      const n = Math.max(1, g.linhas ?? 1)
      const larg = g.diametro ?? g.largura ?? 1
      const alt = g.diametro ?? g.altura ?? 1
      const passo = larg + (g.diametro ? 0.4 : 0.25)
      const parede = 0.1
      const dx = g.p1[0] - g.p0[0]
      const dn = g.p1[1] - g.p0[1]
      const l = Math.hypot(dx, dn) || 1
      const u: [number, number] = [dx / l, dn / l]
      const v: [number, number] = [u[1], -u[0]]
      const secao: [number, number][] = g.diametro
        ? circulo(g.diametro / 2 + parede, 14, g.diametro / 2)
        : [
            [-larg / 2 - parede, -parede],
            [larg / 2 + parede, -parede],
            [larg / 2 + parede, alt + parede],
            [-larg / 2 - parede, alt + parede]
          ]
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * passo
        const d = (p: Pt): Pt => [p[0] + v[0] * o, p[1] + v[1] * o, p[2]]
        k.prisma(d(g.p0), d(g.p1), secao)
      }
      // bocas: testa, soleira e duas alas abertas
      const largT = n * passo + 0.6
      const rumo = Math.atan2(u[1], u[0])
      for (const [e, sinal] of [
        [g.p0, -1],
        [g.p1, 1]
      ] as [Pt, number][]) {
        const z0 = e[2] - 0.25
        k.caixa([e[0], e[1], z0], [0.3, largT, alt + 0.85], rumo)
        k.caixa(
          [e[0] + u[0] * sinal * 0.9, e[1] + u[1] * sinal * 0.9, z0 - 0.05],
          [1.8, largT + 0.6, 0.2],
          rumo
        )
        for (const lado of [-1, 1]) {
          const ang = rumo + (sinal > 0 ? 0 : Math.PI) + lado * 0.5
          const comp = Math.max(1.2, alt * 1.4)
          k.caixa(
            [
              e[0] + v[0] * lado * (largT / 2) + (Math.cos(ang) * comp) / 2,
              e[1] + v[1] * lado * (largT / 2) + (Math.sin(ang) * comp) / 2,
              z0
            ],
            [comp, 0.25, alt * 0.75 + 0.3],
            ang
          )
        }
      }
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
    nova(classe, ie, s0, s1, el.quantidade ?? null, el.nome ?? null, v0, el.material)
  }
  for (const el of modelo.elementos) elemento(el)

  const malhas = construtores.map((k, i) => ({ pos: new Float32Array(k.buf), pecas: porClasse[i] }))
  const fuso = modelo.origem ? lerFuso(modelo.origem.fuso) : null
  return { modelo, eixos, pecas, malhas, materiais, grades, fatias, centro, fuso }
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
  /** O modelo traz origem e fuso: a cena o põe sobre o terreno e a imagem de satélite. */
  georreferenciado: boolean
}

export function resumirModelo(p: ModeloPronto): ResumoModelo {
  const classes = p.modelo.classes.map((c, i) => {
    const ps = p.malhas[i].pecas.map((j) => p.pecas[j])
    let s0 = Infinity
    let s1 = -Infinity
    for (const q of ps) {
      if (q.s0 < s0) s0 = q.s0
      if (q.s1 > s1) s1 = q.s1
    }
    return {
      id: c.id,
      nome: c.nome,
      disciplina: c.disciplina,
      servico: c.servico ?? null,
      contexto: !!c.contexto,
      pecas: ps.length,
      s0: ps.length ? s0 : null,
      s1: ps.length ? s1 : null
    }
  })
  return {
    extensao_m: Math.max(...p.eixos.map((e) => e.sMax - e.sMin)),
    eixos: p.eixos.map((e) => ({ id: e.id, nome: e.nome, s0: e.sMin, s1: e.sMax })),
    classes,
    terreno: p.grades.length > 0,
    georreferenciado: !!p.fuso
  }
}
