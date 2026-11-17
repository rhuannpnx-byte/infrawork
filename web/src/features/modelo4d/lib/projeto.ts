import {
  CANAL_DESCIDA,
  LAMINA_DEFENSA,
  chapaDaPlaca,
  dispositivoDeDrenagem,
  espelhar,
  subir
} from './catalogo'
import type {
  BlocoTerreno4D,
  Camada4D,
  Classe4D,
  Eixo4D,
  Elemento4D,
  FaixaCamada,
  Material,
  Modelo4D,
  Pt,
  Secao4D
} from './contrato'
import { EixoCalc } from './eixo'
import { lerFuso } from './geo'
import { cotaNoPerfil } from './preparar'

/**
 * Dados de projeto (`infrawork-4d` versão 2): em vez de geometria pronta, o arquivo traz as tabelas do projeto
 * (notas de serviço, cubação, seção-tipo, quadros de drenagem, bueiros, defensas) e o InfraWork monta a geometria,
 * sempre do mesmo jeito. `montarProjeto` devolve o modelo na versão 1, que o resto do 4D já lê.
 */

export type Lado = 'E' | 'D'

/** Uma linha das notas de serviço (terraplenagem e pavimentação juntas). */
export interface EstacaNS {
  s: number
  /** Coordenadas UTM do eixo. */
  e: number
  n: number
  /** Cota do eixo acabado (topo do pavimento). */
  z: number
  /** Cota do eixo da terraplenagem; sem ela, `z` menos a espessura do pavimento. */
  zt?: number
  /** Cota do terreno natural no eixo. */
  zn?: number
  /** Caimento de cada lado em %, negativo quando o bordo é mais baixo que o eixo. */
  ie?: number
  id?: number
  /** Semilargura da pista de cada lado, quando difere da seção-tipo (superlargura). */
  le?: number
  ld?: number
  /** Terraplenagem do bordo da plataforma para fora: `[afastamento, cota]` do bordo, das bermas e do off-set. */
  esq?: [number, number][]
  dir?: [number, number][]
}

export interface CamadaPavimento {
  classe: string
  onde: 'pista' | 'acostamento' | 'tudo'
  /** Em metros; sem ela é película (imprimação, pintura de ligação). */
  espessura?: number
  /** Quanto a camada passa do bordo do acostamento, de cada lado. */
  sobra?: number
  material?: Material
}

interface NoEixo {
  eixo?: string
  s: number
  lado: Lado
  classe: string
  nome?: string
}

interface NoTrecho {
  eixo?: string
  s0: number
  s1: number
  lado: Lado
  classe: string
  nome?: string
  quantidade?: number
}

export interface Projeto4D {
  secao_tipo: {
    /** Semilargura da pista e largura do acostamento, em metros. */
    pista: number
    acostamento: number
    /** Caimento em tangente, em % (negativo). */
    caimento?: number
    /** Largura total da faixa de domínio. */
    faixa_dominio?: number
  }
  /** Estrutura do pavimento, de cima para baixo. */
  pavimento?: CamadaPavimento[]
  terraplenagem?: { corte: string; aterro: string; protecao_vegetal?: string }
  /** Classe da sinalização horizontal (bordos e eixo). */
  pintura?: string
  nota_servico: { eixo?: string; nome?: string; estacas: EstacaNS[] }[]
  /** Volume de corte e de aterro do intervalo que termina em cada estaca. */
  cubacao?: { eixo?: string; volumes: [s: number, corte: number, aterro: number][] }[]
  drenagem?: (NoTrecho & { tipo: string })[]
  descidas?: NoEixo[]
  bueiros?: {
    eixo?: string
    s: number
    classe: string
    /** BSTC, BDTC, BTTC, BSCC… */
    tipo: string
    diametro?: number
    largura?: number
    altura?: number
    comprimento: number
    /** Graus em relação à perpendicular ao eixo. */
    esconsidade?: number
    cota_montante?: number
    cota_jusante?: number
    montante?: Lado
    nome?: string
  }[]
  defensas?: NoTrecho[]
  cercas?: (NoTrecho & { afastamento?: number; fauna?: boolean })[]
  placas?: (NoEixo & { codigo: string; dimensoes?: string })[]
  postes?: NoEixo[]
}

export interface ArquivoProjeto {
  formato: 'infrawork-4d'
  versao: 2
  nome: string
  origem: { e: number; n: number; fuso: string }
  classes: Classe4D[]
  terreno?: BlocoTerreno4D[]
  projeto: Projeto4D
  eixos?: Eixo4D[]
  secoes?: Secao4D[]
  camadas?: Camada4D[]
  elementos?: Elemento4D[]
}

export const ehArquivoDeProjeto = (json: unknown): json is ArquivoProjeto =>
  !!json && typeof json === 'object' && typeof (json as ArquivoProjeto).projeto === 'object'

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const r2 = (v: number): number => Math.round(v * 100) / 100
const LONGE = 1e6
const estaca = (s: number): string =>
  `${Math.floor(s / 20)}+${(s - Math.floor(s / 20) * 20).toFixed(2).replace('.', ',')}`
const milhar = (v: number): string => Math.round(v).toLocaleString('pt-BR')

/** Um lado da terraplenagem numa estaca, já lido da nota de serviço. */
interface LadoSec {
  /** Bordo do acostamento (afastamento e cota do pavimento). */
  w: number
  zw: number
  /** Bordo da plataforma e off-set. */
  lb: number
  lbz: number
  lo: number
  loz: number
  corte: boolean
  /** Comprimento inclinado do talude, do bordo ao off-set. */
  talude: number
}

interface Sec {
  s: number
  z: number
  zt: number
  zn: number | null
  le: number
  ld: number
  E: LadoSec
  D: LadoSec
  perfil: [number, number][]
  /** Linha da terraplenagem acabada, para a conferência de volumes. */
  terra: [number, number][]
}

class Alinhamento {
  readonly secs: Sec[] = []
  constructor(
    readonly id: string,
    readonly eixo: EixoCalc
  ) {}

  get s0(): number {
    return this.secs[0].s
  }
  get s1(): number {
    return this.secs[this.secs.length - 1].s
  }

  private par(s: number): [Sec, Sec, number] {
    const ss = this.secs
    let lo = 0
    let hi = ss.length - 1
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (ss[m].s <= s) lo = m
      else hi = m
    }
    const a = ss[lo]
    const b = ss[Math.min(ss.length - 1, lo + 1)]
    const f = b.s > a.s ? Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s))) : 0
    return [a, b, f]
  }

  /** O lado da seção na estaca `s`, interpolado entre as duas estacas vizinhas. */
  lado(s: number, lado: Lado): LadoSec {
    const [a, b, f] = this.par(s)
    const A = a[lado]
    const B = b[lado]
    const m = (k: Exclude<keyof LadoSec, 'corte'>): number => A[k] + (B[k] - A[k]) * f
    return {
      w: m('w'),
      zw: m('zw'),
      lb: m('lb'),
      lbz: m('lbz'),
      lo: m('lo'),
      loz: m('loz'),
      corte: (f < 0.5 ? A : B).corte,
      talude: m('talude')
    }
  }

  /** Cota do perfil acabado na estaca `s` e no afastamento `o`. */
  cota(s: number, o: number): number {
    const [a, b, f] = this.par(s)
    const za = cotaNoPerfil(a.perfil, o)
    return za + (cotaNoPerfil(b.perfil, o) - za) * f
  }

  /** Polilinha ao longo do eixo entre duas estacas, com um ponto em cada seção. */
  linha(
    s0: number,
    s1: number,
    afastamento: (s: number) => number,
    cota: (s: number, o: number) => number
  ): Pt[] {
    const ss = [s0, ...this.secs.map((x) => x.s).filter((s) => s > s0 && s < s1), s1]
    return ss.map((s) => {
      const o = afastamento(s)
      const p = this.eixo.ponto(s, o)
      return [r2(p[0]), r2(p[1]), r2(cota(s, o))]
    })
  }
}

/** Área de corte e de aterro da seção: a terraplenagem acabada contra o terreno natural (off-set, eixo, off-set). */
function areas(sc: Sec): [corte: number, aterro: number] {
  if (sc.zn == null) return [0, 0]
  const nat: [number, number][] = [
    [-sc.E.lo, sc.E.loz],
    [0, sc.zn],
    [sc.D.lo, sc.D.loz]
  ]
  let corte = 0
  let aterro = 0
  const passo = 0.25
  for (let o = -sc.E.lo + passo / 2; o < sc.D.lo; o += passo) {
    const d = cotaNoPerfil(sc.terra, o) - cotaNoPerfil(nat, o)
    if (d > 0) aterro += d * passo
    else corte -= d * passo
  }
  return [corte, aterro]
}

export function montarProjeto(
  arq: ArquivoProjeto
): { modelo: Modelo4D; avisos: string[] } | { erros: string[] } {
  const erros: string[] = []
  const avisos: string[] = []
  const pj = arq.projeto
  const tipo = pj?.secao_tipo
  if (!num(arq.origem?.e) || !num(arq.origem?.n) || !lerFuso(arq.origem?.fuso))
    erros.push('Falta a `origem` com `e`, `n` e `fuso` (ex.: "22S").')
  if (!tipo || !num(tipo.pista) || !num(tipo.acostamento))
    erros.push('Falta `projeto.secao_tipo` com `pista` e `acostamento` (metros).')
  if (!Array.isArray(pj?.nota_servico) || !pj.nota_servico.length)
    erros.push('Falta `projeto.nota_servico`: é dela que saem o eixo e as seções.')
  if (!Array.isArray(arq.classes) || !arq.classes.length) erros.push('O arquivo não tem classes.')
  if (erros.length) return { erros }

  const classes = new Set(arq.classes.map((c) => c.id))
  const semClasse = new Set<string>()
  const ok = (c: string | undefined): c is string => {
    if (c && classes.has(c)) return true
    if (c) semClasse.add(c)
    return false
  }

  const pav = (pj.pavimento ?? []).filter((c) => ok(c.classe))
  const espessura = (zona: 'pista' | 'acostamento'): number =>
    pav.reduce((t, c) => t + (c.onde === 'tudo' || c.onde === zona ? (c.espessura ?? 0) : 0), 0)
  const espPista = espessura('pista')
  const espAcost = espessura('acostamento')

  // ---- eixos e seções
  const eixos: Eixo4D[] = arq.eixos ? [...arq.eixos] : []
  const alinhamentos: Alinhamento[] = []
  const secoes: Secao4D[] = []
  let emV = 0
  const trechosEmV: [number, number][] = []
  let estreitas = 0
  pj.nota_servico.forEach((ns, k) => {
    const id = ns.eixo ?? `E${k + 1}`
    const linhas = (ns.estacas ?? [])
      .filter((r) => num(r?.s) && num(r.e) && num(r.n) && num(r.z))
      .sort((a, b) => a.s - b.s)
      .filter((r, i, l) => i === 0 || r.s > l[i - 1].s)
    if (linhas.length < 2) {
      erros.push(`Nota de serviço do eixo "${id}" precisa de 2 estacas ou mais com s, e, n e z.`)
      return
    }
    let eixo = eixos.find((e) => e.id === id)
    if (!eixo) {
      eixo = {
        id,
        nome: ns.nome ?? id,
        pontos: linhas.map((r) => [r.s, r2(r.e - arq.origem.e), r2(r.n - arq.origem.n), r2(r.z)])
      }
      eixos.push(eixo)
    }
    const al = new Alinhamento(id, new EixoCalc(eixo))
    const temTerra = linhas.some((r) => r.esq?.length || r.dir?.length)
    for (const r of linhas) {
      if (temTerra && !(r.esq?.length && r.dir?.length)) continue
      const zt = r.zt ?? r.z - espPista
      const lado = (
        pts: [number, number][] | undefined,
        larg: number,
        i: number
      ): { l: LadoSec; pontos: [number, number][] } => {
        const w = larg + tipo.acostamento
        const zw = r.z + i * w
        const ext = (pts ?? [])
          .filter((p) => num(p?.[0]) && num(p[1]))
          .map((p): [number, number] => [Math.abs(p[0]), p[1]])
          .sort((a, b) => a[0] - b[0])
        if (!ext.length)
          return {
            l: { w, zw, lb: w, lbz: zw, lo: w, loz: zw, corte: false, talude: 0 },
            pontos: [[w, zw]]
          }
        const [lb, lbz] = ext[0]
        const [lo, loz] = ext[ext.length - 1]
        const corte = loz > lbz + 0.05
        const pontos: [number, number][] = [[w, zw]]
        if (lb > w + 0.05) {
          // no aterro, o bordo do pavimento desce 1,5:1 até a plataforma; no corte, a faixa da sarjeta vai direto ao bordo
          if (!corte) {
            const sub = (o: number): number => zt + ((lbz - zt) * o) / lb
            const d = Math.min(Math.max(0, zw - sub(w)) * 1.5, lb - w - 0.05)
            if (d > 0.05) pontos.push([w + d, sub(w + d)])
          }
        } else estreitas++
        let talude = 0
        let ant: [number, number] = [Math.max(lb, w), lbz]
        for (const p of ext) {
          if (p[0] <= pontos[pontos.length - 1][0] + 0.01) continue
          pontos.push([p[0], p[1]])
          talude += Math.hypot(p[0] - ant[0], p[1] - ant[1])
          ant = [p[0], p[1]]
        }
        return { l: { w, zw, lb, lbz, lo, loz, corte, talude }, pontos }
      }
      const ie = (r.ie ?? tipo.caimento ?? -2) / 100
      const id_ = (r.id ?? tipo.caimento ?? -2) / 100
      const le = r.le ?? tipo.pista
      const ld = r.ld ?? tipo.pista
      const E = lado(r.esq, le, ie)
      const D = lado(r.dir, ld, id_)
      if (ie > 0.005 && id_ > 0.005) {
        emV++
        const u = trechosEmV[trechosEmV.length - 1]
        if (u && r.s - u[1] <= 40) u[1] = r.s
        else trechosEmV.push([r.s, r.s])
      }
      const perfil: [number, number][] = [
        ...E.pontos.map(([o, z]): [number, number] => [-o, z]).reverse(),
        [-le, r.z + ie * le],
        [0, r.z],
        [ld, r.z + id_ * ld],
        ...D.pontos
      ]
      const terra: [number, number][] = [
        ...(r.esq ?? [])
          .map(([o, z]): [number, number] => [-Math.abs(o), z])
          .sort((a, b) => a[0] - b[0]),
        [0, zt],
        ...(r.dir ?? [])
          .map(([o, z]): [number, number] => [Math.abs(o), z])
          .sort((a, b) => a[0] - b[0])
      ]
      al.secs.push({ s: r.s, z: r.z, zt, zn: r.zn ?? null, le, ld, E: E.l, D: D.l, perfil, terra })
      secoes.push({ eixo: id, s: r.s, perfil: perfil.map(([o, z]) => [r2(o), r2(z)]) })
    }
    if (al.secs.length >= 2) alinhamentos.push(al)
    else erros.push(`Eixo "${id}": menos de 2 estacas com os dois lados da seção.`)
  })
  if (erros.length) return { erros }

  const camadas: Camada4D[] = []
  const elementos: Elemento4D[] = []
  let seq = 0
  const el = (e: Omit<Elemento4D, 'id'>): void => {
    elementos.push({ id: `${e.classe}#${++seq}`, ...e })
  }
  const al = (id: string | undefined): Alinhamento | undefined =>
    id ? alinhamentos.find((a) => a.id === id) : alinhamentos[0]

  // ---- plataforma: terraplenagem por intervalo (com a cubação) e pavimento por trecho de mesma largura
  const terra =
    pj.terraplenagem && ok(pj.terraplenagem.corte) && ok(pj.terraplenagem.aterro)
      ? pj.terraplenagem
      : null
  const vegetal = terra && ok(terra.protecao_vegetal) ? terra.protecao_vegetal : null
  const pintura = ok(pj.pintura) ? pj.pintura : null
  let semGeometria = 0
  let volCorte = 0
  let volAterro = 0
  let cubCorte = 0
  let cubAterro = 0
  for (const a of alinhamentos) {
    const cub = new Map<number, [number, number]>()
    for (const c of pj.cubacao ?? [])
      if ((c.eixo ?? alinhamentos[0].id) === a.id)
        for (const [s, vc, va] of c.volumes ?? []) cub.set(Math.round(s * 100), [vc, va])
    const ss = a.secs
    let ini = 0
    for (let i = 0; i < ss.length - 1; i++) {
      const A = ss[i]
      const B = ss[i + 1]
      const comp = B.s - A.s
      if (terra) {
        const [vc, va] = cub.get(Math.round(B.s * 100)) ?? [0, 0]
        cubCorte += vc
        cubAterro += va
        const [ca, aa] = areas(A)
        const [cb, ab] = areas(B)
        volCorte += ((ca + cb) / 2) * comp
        volAterro += ((aa + ab) / 2) * comp
        const miolo: FaixaCamada[] =
          espPista > 0
            ? [
                [-A.E.lb, -A.E.w],
                [-A.E.w, A.D.w, -Math.max(espPista, espAcost)],
                [A.D.w, A.D.lb]
              ]
            : [[-A.E.lb, A.D.lb]]
        const fc: FaixaCamada[] = []
        const fa: FaixaCamada[] = []
        ;(A.E.corte ? fc : fa).push([-LONGE, -A.E.lb])
        ;(A.D.corte ? fc : fa).push([A.D.lb, LONGE])
        ;(vc > va ? fc : fa).push(...miolo)
        const base = { eixo: a.id, s0: A.s, s1: B.s }
        if (fc.length)
          camadas.push({ ...base, classe: terra.corte, faixas: fc, quantidade: r2(vc) })
        else semGeometria += vc
        if (fa.length)
          camadas.push({ ...base, classe: terra.aterro, faixas: fa, quantidade: r2(va) })
        else semGeometria += va
        if (vegetal)
          camadas.push({
            ...base,
            classe: vegetal,
            faixas: [
              [-LONGE, -A.E.lb],
              [A.D.lb, LONGE]
            ],
            elevacao: 0.03,
            quantidade: r2(((A.E.talude + A.D.talude + B.E.talude + B.D.talude) / 2) * comp)
          })
      }
      // o trecho de pavimento fecha quando a largura muda ou o levantamento falha
      const fim =
        i === ss.length - 2 ||
        comp > 80 ||
        Math.abs(ss[i + 1].le - ss[ini].le) > 0.005 ||
        Math.abs(ss[i + 1].ld - ss[ini].ld) > 0.005
      if (!fim) continue
      const R = ss[ini]
      const s0 = R.s
      const s1 = comp > 80 ? A.s : B.s
      ini = i + 1
      if (!(s1 > s0)) continue
      const base = { eixo: a.id, s0, s1 }
      const compr = s1 - s0
      let acimaP = 0
      let acimaA = 0
      for (const c of pav) {
        const e = c.espessura ?? 0
        const fio = e > 0 ? 0 : 0.004
        const sobra = c.sobra ?? 0
        const comum = { ...base, classe: c.classe, material: c.material, espessura: e || undefined }
        if (c.onde === 'pista') {
          camadas.push({
            ...comum,
            faixas: [[-R.le, R.ld]],
            elevacao: r2(-acimaP + fio),
            quantidade: r2((R.le + R.ld) * compr)
          })
          acimaP += e
        } else if (c.onde === 'acostamento') {
          camadas.push({
            ...comum,
            faixas: [
              [-R.E.w, -R.le],
              [R.ld, R.D.w]
            ],
            elevacao: r2(-acimaA + fio),
            quantidade: r2(2 * tipo.acostamento * compr)
          })
          acimaA += e
        } else {
          camadas.push({
            ...comum,
            faixas: [
              [-R.E.w - sobra, -R.le, r2(-acimaA + fio)],
              [-R.le, R.ld, r2(-acimaP + fio)],
              [R.ld, R.D.w + sobra, r2(-acimaA + fio)]
            ],
            quantidade: r2((R.E.w + R.D.w + 2 * sobra) * compr)
          })
          acimaP += e
          acimaA += e
        }
      }
      if (pintura) {
        camadas.push({
          ...base,
          classe: pintura,
          material: 'sinal-branco',
          faixas: [
            [-R.le, -R.le + 0.12],
            [R.ld - 0.12, R.ld]
          ],
          elevacao: 0.012,
          quantidade: r2(compr)
        })
        camadas.push({
          ...base,
          classe: pintura,
          material: 'sinal-amarelo',
          faixas: [
            [-0.16, -0.04],
            [0.04, 0.16]
          ],
          elevacao: 0.012,
          quantidade: r2(compr)
        })
      }
    }
  }

  // ---- dispositivos ao longo do eixo
  const g = (lado: Lado): number => (lado === 'E' ? -1 : 1)
  let fora = 0
  const desconhecidos = new Set<string>()
  /** Recorta o trecho ao que a nota de serviço cobre; `null` quando fica todo fora. */
  const trecho = (a: Alinhamento, s0: number, s1: number): [number, number] | null => {
    const x0 = Math.max(a.s0, Math.min(s0, s1))
    const x1 = Math.min(a.s1, Math.max(s0, s1))
    if (!(x1 - x0 > 0.5)) {
      fora++
      return null
    }
    return [x0, x1]
  }

  for (const d of pj.drenagem ?? []) {
    const a = al(d.eixo)
    if (!a || !ok(d.classe)) continue
    const t = trecho(a, d.s0, d.s1)
    if (!t) continue
    const disp = dispositivoDeDrenagem(d.tipo)
    if (!disp) {
      desconhecidos.add(d.tipo.trim().split(/\s+/)[0])
      continue
    }
    const k = g(d.lado)
    const dentro = Math.min(...disp.perfil.map((p) => p[0]))
    const base: Omit<Elemento4D, 'id' | 'geo'> = {
      classe: d.classe,
      eixo: a.id,
      nome: d.nome ?? `${d.tipo} · est. ${estaca(d.s0)} a ${estaca(d.s1)} L${d.lado}`,
      s0: t[0],
      s1: t[1],
      quantidade: d.quantidade ?? r2(t[1] - t[0]),
      material: disp.material === 'concreto' ? undefined : disp.material
    }
    const perfil = k > 0 ? disp.perfil : espelhar(disp.perfil)
    let pts: Pt[]
    let noTerreno = false
    if (disp.posicao === 'crista' || disp.posicao === 'pe') {
      noTerreno = true
      pts = a.linha(
        t[0],
        t[1],
        (s) => k * (a.lado(s, d.lado).lo + 3 + disp.largura / 2),
        (s) => a.lado(s, d.lado).loz
      )
    } else if (disp.posicao === 'dreno')
      pts = a.linha(
        t[0],
        t[1],
        (s) => k * (a.lado(s, d.lado).w + 0.5),
        (s, o) => a.cota(s, o) - 1.5
      )
    else
      pts = a.linha(
        t[0],
        t[1],
        (s) => k * (a.lado(s, d.lado).w + 0.03 - dentro),
        (s) => a.lado(s, d.lado).zw
      )
    el({
      ...base,
      no_terreno: noTerreno || undefined,
      geo: { t: 'linha', pts, largura: disp.largura, perfil }
    })
  }

  let descidasSemAterro = 0
  for (const d of pj.descidas ?? []) {
    const a = al(d.eixo)
    if (!a || !ok(d.classe) || d.s < a.s0 || d.s > a.s1) continue
    const L = a.lado(d.s, d.lado)
    if (L.corte || L.lbz - L.loz < 0.3) {
      descidasSemAterro++
      continue
    }
    const k = g(d.lado)
    const em = (o: number, z: number): Pt => {
      const p = a.eixo.ponto(d.s, k * o)
      return [r2(p[0]), r2(p[1]), r2(z)]
    }
    const q = a.eixo.em(d.s)
    const base = {
      classe: d.classe,
      eixo: a.id,
      nome: d.nome ?? `Descida d'água · est. ${estaca(d.s)} L${d.lado}`,
      s0: d.s,
      s1: d.s
    }
    el({
      ...base,
      quantidade: r2(Math.hypot(L.lo - L.w, L.zw - L.loz)),
      geo: {
        t: 'linha',
        pts: [
          em(L.w + 0.35, L.zw - 0.05),
          em(L.lb, L.lbz),
          em(L.lo, L.loz),
          em(L.lo + 0.8, L.loz - 0.05)
        ],
        largura: 0.8,
        perfil: CANAL_DESCIDA
      }
    })
    // dissipador no pé do aterro
    el({
      ...base,
      geo: {
        t: 'caixa',
        p: em(L.lo + 1.6, L.loz - 0.15),
        dim: [1.6, 1.4, 0.3],
        rumo: r2(Math.atan2(-q.tx * k, q.tn * k))
      }
    })
  }

  for (const b of pj.bueiros ?? []) {
    const a = al(b.eixo)
    if (!a || !ok(b.classe) || b.s < a.s0 - 20 || b.s > a.s1 + 20) continue
    const s = Math.max(a.s0, Math.min(a.s1, b.s))
    const E = a.lado(s, 'E')
    const D = a.lado(s, 'D')
    const q = a.eixo.em(s)
    const ang = ((b.esconsidade ?? 0) * Math.PI) / 180
    const dir: [number, number] = [
      q.tn * Math.cos(ang) + q.tx * Math.sin(ang),
      -q.tx * Math.cos(ang) + q.tn * Math.sin(ang)
    ]
    const meio = a.eixo.ponto(s, (D.lo - E.lo) / 2)
    const k = g(b.montante ?? 'D')
    const m = /^B([SDT])([TC])/.exec(b.tipo.trim().toUpperCase())
    const linhas = m ? { S: 1, D: 2, T: 3 }[m[1] as 'S' | 'D' | 'T'] : 1
    const celular = m ? m[2] === 'C' : !num(b.diametro)
    const alt = celular ? (b.altura ?? b.diametro ?? 1.5) : (b.diametro ?? 1)
    const chao = Math.min(E.loz, D.loz) - 0.2
    const boca = (sinal: number, cota: number | undefined): Pt => [
      r2(meio[0] + (dir[0] * sinal * b.comprimento) / 2),
      r2(meio[1] + (dir[1] * sinal * b.comprimento) / 2),
      r2(cota ?? chao)
    ]
    const medida = celular
      ? `${(b.largura ?? alt).toFixed(1)} x ${alt.toFixed(1)}`
      : `Ø ${alt.toFixed(1)}`
    el({
      classe: b.classe,
      eixo: a.id,
      nome: b.nome ?? `${b.tipo} ${medida.replace(/\./g, ',')} · est. ${estaca(b.s)}`,
      s0: s,
      s1: s,
      quantidade: r2(b.comprimento * (celular ? 1 : linhas)),
      geo: {
        t: 'tubo',
        p0: boca(k, b.cota_montante),
        p1: boca(-k, b.cota_jusante),
        linhas,
        ...(celular ? { largura: b.largura ?? alt, altura: alt } : { diametro: alt })
      }
    })
  }

  for (const d of pj.defensas ?? []) {
    const a = al(d.eixo)
    if (!a || !ok(d.classe)) continue
    const t = trecho(a, d.s0, d.s1)
    if (!t) continue
    const k = g(d.lado)
    const o = (s: number): number => k * (a.lado(s, d.lado).w + 0.45)
    // a defensa é cravada na faixa ao lado do pavimento, que no aterro fica abaixo dele: a lâmina sobe o desnível
    const meio = (t[0] + t[1]) / 2
    const desnivel = Math.max(0, a.lado(meio, d.lado).zw - a.cota(meio, o(meio)))
    el({
      classe: d.classe,
      eixo: a.id,
      nome: d.nome ?? `Defensa · est. ${estaca(d.s0)} a ${estaca(d.s1)} L${d.lado}`,
      s0: t[0],
      s1: t[1],
      quantidade: d.quantidade ?? r2(t[1] - t[0]),
      geo: {
        t: 'linha',
        pts: a.linha(t[0], t[1], o, (s, x) => a.cota(s, x)),
        largura: 0.08,
        perfil: subir(LAMINA_DEFENSA, desnivel),
        postes: { passo: 4, altura: r2(0.8 + desnivel), lado: 0.12 }
      }
    })
  }

  const meiaFaixa = (tipo.faixa_dominio ?? 0) / 2
  for (const c of pj.cercas ?? []) {
    const a = al(c.eixo)
    if (!a || !ok(c.classe)) continue
    const t = trecho(a, c.s0, c.s1)
    if (!t) continue
    const k = g(c.lado)
    const afast = (s: number): number => {
      const L = a.lado(s, c.lado)
      return c.afastamento ?? Math.max(meiaFaixa, L.lo + 2)
    }
    el({
      classe: c.classe,
      eixo: a.id,
      nome: c.nome ?? `Cerca · est. ${estaca(c.s0)} a ${estaca(c.s1)} L${c.lado}`,
      s0: t[0],
      s1: t[1],
      quantidade: c.quantidade ?? r2(t[1] - t[0]),
      no_terreno: true,
      geo: {
        t: 'linha',
        pts: a.linha(
          t[0],
          t[1],
          (s) => k * afast(s),
          (s) => a.lado(s, c.lado).loz
        ),
        largura: 0.1,
        fios: c.fauna ? [0.2, 0.5, 0.8, 1.1, 1.4, 1.7] : [0.35, 0.7, 1.05, 1.4],
        postes: { passo: 2.5, altura: c.fauna ? 1.9 : 1.6, lado: 0.1 }
      }
    })
  }

  for (const p of pj.placas ?? []) {
    const a = al(p.eixo)
    if (!a || !ok(p.classe) || p.s < a.s0 || p.s > a.s1) continue
    const k = g(p.lado)
    const L = a.lado(p.s, p.lado)
    const o = k * Math.min(L.w + 0.9, Math.max(L.w + 0.3, L.lb - 0.1))
    const q = a.eixo.em(p.s)
    const pos = a.eixo.ponto(p.s, o)
    const { material, ...chapa } = chapaDaPlaca(p.codigo, p.dimensoes)
    el({
      classe: p.classe,
      eixo: a.id,
      nome: p.nome ?? `${p.codigo} · est. ${estaca(p.s)} L${p.lado}`,
      s0: p.s,
      s1: p.s,
      quantidade: 1,
      material,
      geo: {
        t: 'placa',
        p: [r2(pos[0]), r2(pos[1]), r2(a.cota(p.s, o))],
        rumo: r2(k > 0 ? Math.atan2(-q.tn, -q.tx) : Math.atan2(q.tn, q.tx)),
        ...chapa
      }
    })
  }

  for (const p of pj.postes ?? []) {
    const a = al(p.eixo)
    if (!a || !ok(p.classe) || p.s < a.s0 || p.s > a.s1) continue
    const L = a.lado(p.s, p.lado)
    const pos = a.eixo.ponto(p.s, g(p.lado) * (L.lo + 3))
    el({
      classe: p.classe,
      eixo: a.id,
      nome: p.nome ?? `Poste · est. ${estaca(p.s)}`,
      s0: p.s,
      s1: p.s,
      quantidade: 1,
      no_terreno: true,
      geo: { t: 'caixa', p: [r2(pos[0]), r2(pos[1]), r2(L.loz)], dim: [0.3, 0.3, 9] }
    })
  }

  // ---- conferência
  if (semClasse.size)
    return {
      erros: [`O projeto cita classes que não estão em \`classes\`: ${[...semClasse].join(', ')}.`]
    }
  if (emV)
    avisos.push(
      `${emV} estacas com os dois bordos acima do eixo (seção em V), em ${trechosEmV.length} trechos: ` +
        `${trechosEmV
          .slice(0, 6)
          .map(([a, b]) => `est. ${Math.round(a / 20)} a ${Math.round(b / 20)}`)
          .join(
            '; '
          )}${trechosEmV.length > 6 ? '…' : ''}. Confira a superelevação na nota de serviço.`
    )
  if (estreitas)
    avisos.push(
      `${estreitas} lados de seção com a plataforma mais estreita que o pavimento (pista + acostamento).`
    )
  if (terra && cubCorte + cubAterro > 0)
    avisos.push(
      `Volumes pelas seções: corte ${milhar(volCorte)} m³ (cubação ${milhar(cubCorte)}) e aterro ` +
        `${milhar(volAterro)} m³ (cubação ${milhar(cubAterro)}).`
    )
  if (semGeometria > 1)
    avisos.push(
      `${milhar(semGeometria)} m³ da cubação ficaram sem peça (corte e aterro no mesmo intervalo, do mesmo lado).`
    )
  if (fora) avisos.push(`${fora} itens ficaram fora das estacas da nota de serviço.`)
  if (desconhecidos.size)
    avisos.push(
      `Dispositivos de drenagem fora do catálogo, não desenhados: ${[...desconhecidos].join(', ')}.`
    )
  if (descidasSemAterro)
    avisos.push(`${descidasSemAterro} descidas d'água em estaca sem aterro não foram desenhadas.`)
  return {
    modelo: {
      formato: 'infrawork-4d',
      versao: 1,
      nome: arq.nome,
      origem: arq.origem,
      eixos,
      terreno: arq.terreno,
      classes: arq.classes,
      secoes: [...secoes, ...(arq.secoes ?? [])],
      camadas: [...camadas, ...(arq.camadas ?? [])],
      elementos: [...elementos, ...(arq.elementos ?? [])]
    },
    avisos
  }
}
