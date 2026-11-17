import type {
  Camada4D,
  Classe4D,
  Elemento4D,
  FaixaCamada,
  Material,
  Modelo4D,
  Pt,
  Secao4D
} from './contrato'
import { EixoCalc } from './eixo'

/**
 * Converte o HTML da "construção digital" (visualizador autônomo com os dados nos blocos `data` e `ext`) no contrato
 * `infrawork-4d`. Ficam de fora o terreno detalhado (arquivos externos ao HTML), o roteiro de visita, o mapa
 * regional, as jazidas, os empréstimos e a desapropriação.
 */

type Json = Record<string, unknown>

/** Seção de cada peça de drenagem (lateral, vertical), como nos projetos-tipo: sarjeta, meio-fio e valetas. */
const PERFIL_DRENAGEM: Record<string, [number, number][]> = {
  STC: [
    [-0.6, -0.1],
    [-0.6, 0.03],
    [-0.5, 0.03],
    [0, -0.13],
    [0.5, 0.03],
    [0.6, 0.03],
    [0.6, -0.1]
  ],
  MFC: [
    [-0.09, -0.3],
    [-0.09, 0.16],
    [-0.06, 0.19],
    [0.09, 0.19],
    [0.09, -0.3]
  ],
  SZC: [
    [-0.7, -0.1],
    [-0.7, 0.04],
    [-0.6, 0.04],
    [-0.35, -0.17],
    [0.35, -0.17],
    [0.6, 0.04],
    [0.7, 0.04],
    [0.7, -0.1]
  ],
  VPCC: [
    [-0.8, -0.12],
    [-0.8, 0.06],
    [-0.65, 0.06],
    [-0.32, -0.3],
    [0.32, -0.3],
    [0.65, 0.06],
    [0.8, 0.06],
    [0.8, -0.12]
  ],
  DPS: [
    [-0.15, -0.15],
    [0.15, -0.15],
    [0.15, 0.15],
    [-0.15, 0.15]
  ]
}
PERFIL_DRENAGEM.VPAC = PERFIL_DRENAGEM.VPCC

const CAIXA_DISPOSITIVO: Record<string, [number, number, number]> = {
  EDA: [1.2, 1.2, 0.4],
  DAR: [3, 1, 0.3],
  DAD: [3, 1, 0.4],
  DED: [2, 1.5, 0.4],
  DES: [2, 1.5, 0.4],
  DEB: [3, 2, 0.5],
  BSD: [1, 1, 0.5],
  CCS: [1.5, 1.5, 1]
}

function bloco(html: string, id: string): Json | null {
  const abre = html.indexOf(`id="${id}"`)
  if (abre < 0) return null
  const ini = html.indexOf('>', abre) + 1
  const fim = html.indexOf('</script>', ini)
  if (ini <= 0 || fim < 0) return null
  try {
    return JSON.parse(html.slice(ini, fim)) as Json
  } catch {
    return null
  }
}

function bytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const titulo = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
const r2 = (v: number): number => Math.round(v * 100) / 100
const P = (p: number[]): Pt => [r2(p[0]), r2(p[1]), r2(p[2])]
const numero = (t: string): number => Number(t.replace(/\./g, '').replace(',', '.'))

/** Diz se o texto parece o HTML da construção digital (para escolher o leitor certo na importação). */
export function ehHtmlDeModelo(texto: string): boolean {
  return texto.includes('<script') && texto.includes('id="data"')
}

/** Fuso UTM do HTML: o visualizador converte latitude e longitude com o meridiano central escrito no código. */
function fusoDoHtml(html: string): string | undefined {
  const m = /l0\s*=\s*(-?\d+(?:\.\d+)?)\s*\*\s*r/.exec(html)
  if (m) {
    const zona = Math.floor((Number(m[1]) + 180) / 6) + 1
    if (zona >= 1 && zona <= 60) return `${zona}S`
  }
  // sem a conversão no código, vale o fuso escrito nos textos ("UTM 22S")
  const t = /UTM\s*(\d{1,2})\s*([NS])\b/.exec(html)
  return t ? `${t[1]}${t[2]}` : undefined
}

function placa(
  codigo: string,
  dim: string
): {
  forma: 'circulo' | 'losango' | 'octogono' | 'triangulo' | 'retangulo'
  largura: number
  altura?: number
  material: Material
} {
  const medidas = [...dim.matchAll(/\d+(?:,\d+)?/g)].map((x) => numero(x[0]))
  if (/^R-1$/.test(codigo)) return { forma: 'octogono', largura: 0.75, material: 'sinal-vermelho' }
  if (/^R-2$/.test(codigo)) return { forma: 'triangulo', largura: 0.9, material: 'sinal-vermelho' }
  if (/^R-/.test(codigo))
    return {
      forma: 'circulo',
      largura: Math.max(0.6, (medidas[0] ?? 0.4) * 1.6),
      material: 'sinal-vermelho'
    }
  if (/^A-/.test(codigo)) return { forma: 'losango', largura: 1.0, material: 'sinal-amarelo' }
  if (/^M[QP]/.test(codigo))
    return { forma: 'retangulo', largura: 0.5, altura: 0.7, material: 'sinal-azul' }
  return {
    forma: 'retangulo',
    largura: Math.min(3.5, medidas[0] ?? 1.2),
    altura: Math.min(1.5, medidas[1] ?? 0.6),
    material: 'sinal-verde'
  }
}

export function converterHtml(html: string): { modelo: Modelo4D } | { erros: string[] } {
  const M = bloco(html, 'data')
  if (!M) return { erros: ['Não achei os dados do modelo no HTML (bloco "data").'] }
  const X = bloco(html, 'ext') ?? {}
  const faltam = ['axis', 'sec'].filter((k) => !Array.isArray(M[k]) || !(M[k] as unknown[]).length)
  if (faltam.length)
    return {
      erros: [`O HTML não traz ${faltam.join(' nem ')}: sem eixo e seções não dá para montar o 4D.`]
    }

  const axis = M.axis as [number, number, number, number][]
  const sec = M.sec as number[][]
  const eixo = new EixoCalc({ id: 'E1', nome: 'Eixo principal', pontos: axis })
  const info = (M.info ?? {}) as Record<string, string>
  const classes: Classe4D[] = []
  const camadas: Camada4D[] = []
  const elementos: Elemento4D[] = []
  const tem = new Set<string>()
  const classe = (c: Classe4D): string => {
    if (!tem.has(c.id)) {
      tem.add(c.id)
      classes.push(c)
    }
    return c.id
  }
  let seq = 0
  const el = (e: Omit<Elemento4D, 'id'>): void => {
    elementos.push({ id: `${e.classe}#${++seq}`, ...e })
  }

  // plataforma acabada: 9 pontos por seção (off-set, borda, acostamento, pista, eixo e o espelho do lado direito)
  const secoes: Secao4D[] = sec.map((r) => {
    const [s, , , cp, , Lba, Lbz, Loa, Loz, Rba, Rbz, Roa, Roz] = r
    const wL = -Lba
    const sl = (Lbz - cp) / wL
    const sr = (Rbz - cp) / Math.max(Rba, 0.1)
    const wR = wL + (Rba - 3.5)
    const perfil: [number, number][] = [
      [Loa, Loz],
      [Lba, Lbz],
      [-6, cp + sl * 6],
      [-3.5, cp + sl * 3.5],
      [0, cp],
      [Rba, Rbz],
      [Rba + 2.5, cp + sr * (Rba + 2.5)],
      [wR, cp + sr * wR],
      [Roa, Roz]
    ]
    return { s, perfil: perfil.map(([o, z]) => [r2(o), r2(z)]) }
  })

  // pavimento: uma camada por nome, na maior largura e espessura informadas, empilhadas de baixo para cima
  const s0 = sec[0][0]
  const s1 = sec[sec.length - 1][0]
  const pav = new Map<string, { s0: number; s1: number; larg: number; esp: number }>()
  for (const p of ((M.pav as Json | undefined)?.seg as Json[] | undefined) ?? []) {
    const nome = String(p.cam ?? '').trim()
    if (!nome) continue
    const larg = Number(p.larg) || 7
    // o quadro traz a espessura (m) no começo da linha das camadas que têm corpo: "0,20 149.031,00 …"
    const m = /^\s*(0,\d+)\s/.exec(String(p.raw ?? ''))
    const esp = m ? numero(m[1]) : 0
    const a = pav.get(nome)
    if (!a) pav.set(nome, { s0: Number(p.s0), s1: Number(p.s1), larg, esp })
    else {
      a.s0 = Math.min(a.s0, Number(p.s0))
      a.s1 = Math.max(a.s1, Number(p.s1))
      a.larg = Math.max(a.larg, larg)
      a.esp = Math.max(a.esp, esp)
    }
  }
  const pilha = [...pav]
  const espessuraTotal = pilha.reduce((t, [, p]) => t + p.esp, 0)
  const larguraPavimento = Math.max(0, ...pilha.map(([, p]) => p.larg))

  // terraplenagem: por intervalo de seção, com o volume da cubação; sob o pavimento ela para no subleito
  const corte = classe({
    id: 'TERRA.CORTE',
    nome: 'Escavação (corte)',
    disciplina: 'Terraplenagem',
    unidade: 'm³',
    terreno: true,
    material: 'corte'
  })
  const aterro = classe({
    id: 'TERRA.ATERRO',
    nome: 'Aterro compactado',
    disciplina: 'Terraplenagem',
    unidade: 'm³',
    terreno: true,
    material: 'aterro'
  })
  const cub = ((M.cub as number[][] | undefined) ?? []).slice().sort((a, b) => a[0] - b[0])
  let ic = 0
  for (let i = 0; i < sec.length - 1; i++) {
    const A = sec[i]
    const B = sec[i + 1]
    let vc = 0
    let va = 0
    while (ic < cub.length && cub[ic][0] <= A[0]) ic++
    while (ic < cub.length && cub[ic][0] <= B[0]) {
      vc += cub[ic][1]
      va += cub[ic][2]
      ic++
    }
    if (B[0] - A[0] > 80) continue
    const wR = -A[5] + (A[9] - 3.5)
    const meia = Math.min(larguraPavimento / 2, -A[5], wR)
    const miolo: FaixaCamada[] =
      meia > 0 && espessuraTotal > 0
        ? [
            [A[5], -meia],
            [-meia, meia, -espessuraTotal],
            [meia, wR]
          ]
        : [[A[5], wR]]
    const fc: FaixaCamada[] = []
    const fa: FaixaCamada[] = []
    ;(A[8] > A[6] ? fc : fa).push([-1e6, A[5]])
    ;(A[12] > A[10] ? fc : fa).push([wR, 1e6])
    ;(vc > va ? fc : fa).push(...miolo)
    if (fc.length)
      camadas.push({ classe: corte, s0: A[0], s1: B[0], faixas: fc, quantidade: r2(vc) })
    if (fa.length)
      camadas.push({ classe: aterro, s0: A[0], s1: B[0], faixas: fa, quantidade: r2(va) })
  }

  // camadas do pavimento, do topo para baixo: a última do quadro é a de cima e fica no perfil acabado
  let acima = 0
  const nomes = new Map<string, string>()
  pilha.forEach(([nome], i) => nomes.set(nome, `PAV.${i + 1}`))
  for (const [nome, p] of [...pilha].reverse()) {
    const id = nomes.get(nome)!
    camadas.push({
      classe: id,
      s0: Math.max(p.s0, s0),
      s1: Math.min(p.s1, s1),
      faixas: [[-p.larg / 2, p.larg / 2]],
      // a película (imprimação, regularização) fica um fio acima da camada de baixo, para não se confundir com ela
      elevacao: r2(-acima + (p.esp > 0 ? 0 : 0.004)),
      espessura: p.esp > 0 ? p.esp : undefined
    })
    acima += p.esp
  }
  pilha.forEach(([nome], i) =>
    classe({ id: `PAV.${i + 1}`, nome: titulo(nome), disciplina: 'Pavimentação' })
  )
  if (pilha.length) {
    const sh = classe({
      id: 'SIN.HORIZONTAL',
      nome: 'Sinalização horizontal',
      disciplina: 'Sinalização',
      material: 'sinal-branco'
    })
    camadas.push({
      classe: sh,
      s0,
      s1,
      faixas: [
        [-3.53, -3.38],
        [3.38, 3.53]
      ],
      elevacao: 0.012
    })
    camadas.push({
      classe: sh,
      s0,
      s1,
      faixas: [
        [-0.16, -0.04],
        [0.04, 0.16]
      ],
      elevacao: 0.012,
      material: 'sinal-amarelo'
    })
  }

  // drenagem linear, com a seção de cada peça
  const segs = (M.segs ?? {}) as Record<string, number[][][]>
  for (const k of ['STC', 'MFC', 'SZC', 'VPCC', 'VPAC', 'DPS']) {
    const id = `DREN.${k}`
    for (const pts of segs[k] ?? []) {
      if (pts.length < 2) continue
      const comp = pts.reduce(
        (t, p, i) => t + (i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0),
        0
      )
      el({
        classe: classe({
          id,
          nome: `${k} · ${info[k] ?? 'Drenagem'}`,
          disciplina: 'Drenagem',
          unidade: 'm',
          material: 'concreto'
        }),
        quantidade: r2(comp),
        geo: { t: 'linha', pts: pts.map(P), largura: 1, perfil: PERFIL_DRENAGEM[k] }
      })
    }
  }

  // dispositivos de drenagem
  const caminhos = (X.darPaths ?? {}) as Record<string, number[][]>
  ;((M.devs as Json[] | undefined) ?? []).forEach((d, i) => {
    const t = String(d.t)
    const p = d.p as number[] | undefined
    if (!p) return
    const id = classe({
      id: `DREN.${t}`,
      nome: `${t} · ${info[t] ?? 'Dispositivo de drenagem'}`,
      disciplina: 'Drenagem',
      unidade: 'un',
      material: 'concreto'
    })
    const base = {
      classe: id,
      nome: `${String(d.code ?? t)} · est. ${String(d.est ?? '')}`,
      s0: Number(d.s),
      s1: Number(d.s),
      quantidade: 1
    }
    const caminho = caminhos[String(i)]
    if (caminho && caminho.length >= 2) {
      // descida d'água: canal em U pelo talude; vale a estaca do dispositivo, então vai como malha de um elemento só
      const pos: number[] = []
      const canal: [number, number][] = [
        [-0.55, 0.3],
        [-0.45, 0.3],
        [-0.45, 0.08],
        [0.45, 0.08],
        [0.45, 0.3],
        [0.55, 0.3]
      ]
      for (let j = 0; j < caminho.length - 1; j++) {
        const a = caminho[j]
        const b = caminho[j + 1]
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
        const ux = (b[1] - a[1]) / l
        const un = -(b[0] - a[0]) / l
        const em = (q: number[], c: [number, number]): number[] => [
          q[0] + ux * c[0],
          q[1] + un * c[0],
          q[2] + c[1]
        ]
        for (let c = 0; c < canal.length - 1; c++) {
          const q = [em(a, canal[c]), em(a, canal[c + 1]), em(b, canal[c]), em(b, canal[c + 1])]
          for (const v of [0, 2, 1, 1, 2, 3]) pos.push(r2(q[v][0]), r2(q[v][1]), r2(q[v][2]))
        }
      }
      el({ ...base, geo: { t: 'malha', pos } })
      return
    }
    const q = eixo.projetar(p[0], p[1])
    const c = eixo.em(q.s)
    el({
      ...base,
      geo: {
        t: 'caixa',
        p: P(p),
        dim: CAIXA_DISPOSITIVO[t] ?? [1.5, 1.5, 0.5],
        rumo: r2(Math.atan2(p[1] - c.n, p[0] - c.x))
      }
    })
  })

  // bueiros
  for (const b of (M.bue as Json[] | undefined) ?? []) {
    const p0 = b.p0 as number[] | undefined
    const p1 = b.p1 as number[] | undefined
    if (!p0 || !p1) continue
    const D = Number(b.D) || 1
    const B = Number(b.B) || 0
    const celular = /CC/.test(String(b.tipo ?? '').split(' ')[0])
    el({
      classe: classe({
        id: 'OAC.BUEIROS',
        nome: 'Bueiros',
        disciplina: 'Obras de arte correntes',
        unidade: 'm',
        material: 'concreto'
      }),
      nome: `${String(b.tipo ?? 'Bueiro')} · est. ${String(b.est ?? '')}`,
      s0: Number(b.s),
      s1: Number(b.s),
      quantidade: Number(b.L) || undefined,
      geo: {
        t: 'tubo',
        // as bocas vêm na geratriz superior; a peça é desenhada a partir da base
        p0: [r2(p0[0]), r2(p0[1]), r2(p0[2] - D)],
        p1: [r2(p1[0]), r2(p1[1]), r2(p1[2] - D)],
        linhas: Number(b.linhas) || 1,
        ...(celular ? { largura: B || D, altura: D } : { diametro: D })
      }
    })
  }

  // defensas (lâmina e postes) e terminais
  const oc = (M.oc ?? {}) as Record<string, Json[]>
  for (const d of oc.DEFENSA ?? []) {
    const prof = d.prof as number[][] | undefined
    if (!prof || prof.length < 2) continue
    el({
      classe: classe({
        id: 'OC.DEFENSA',
        nome: 'Defensa metálica',
        disciplina: 'Obras complementares',
        unidade: 'm',
        material: 'metal'
      }),
      quantidade: Number(d.len) || undefined,
      geo: {
        t: 'linha',
        pts: prof.map(([s, o]) => P(eixo.ponto(s, o))),
        largura: 0.08,
        perfil: [
          [-0.04, 0.45],
          [0.04, 0.45],
          [0.04, 0.78],
          [-0.04, 0.78]
        ],
        postes: { passo: 4, altura: 0.8, lado: 0.12 }
      }
    })
  }
  for (const t of oc.TERMINAL ?? []) {
    const s = Number(t.s)
    const c = eixo.em(s)
    el({
      classe: classe({
        id: 'OC.TERMINAL',
        nome: 'Terminal de defensa',
        disciplina: 'Obras complementares',
        unidade: 'un',
        material: 'metal'
      }),
      s0: s,
      s1: s,
      quantidade: 1,
      geo: {
        t: 'caixa',
        p: P(eixo.ponto(s, Number(t.o))),
        dim: [2, 0.5, 0.8],
        rumo: r2(Math.atan2(c.tn, c.tx))
      }
    })
  }

  // cercas: mourões e fios, assentados no terreno
  for (const f of (X.fences as Json[] | undefined) ?? []) {
    const b = bytes(String(f.xyz ?? ''))
    const v = new Float32Array(b.buffer.slice(0, b.length - (b.length % 12)))
    const pts: Pt[] = []
    for (let i = 0; i + 2 < v.length; i += 3) pts.push(P([v[i], v[i + 1], v[i + 2]]))
    if (pts.length < 2) continue
    const k = String(f.k)
    const c =
      k === 'exist'
        ? classe({
            id: 'CTX.CERCA',
            nome: 'Cerca existente',
            disciplina: 'Contexto',
            contexto: true
          })
        : k === 'fauna'
          ? classe({
              id: 'OC.CERCA_FAUNA',
              nome: 'Cerca de condução de fauna',
              disciplina: 'Obras complementares',
              unidade: 'm',
              material: 'madeira'
            })
          : classe({
              id: 'OC.CERCA',
              nome: 'Cerca',
              disciplina: 'Obras complementares',
              unidade: 'm',
              material: 'madeira'
            })
    el({
      classe: c,
      quantidade: Number(f.len) || undefined,
      no_terreno: true,
      geo: {
        t: 'linha',
        pts,
        largura: 0.1,
        fios:
          k === 'exist'
            ? [0.6, 1.3]
            : k === 'fauna'
              ? [0.2, 0.5, 0.8, 1.1, 1.4, 1.7]
              : [0.35, 0.7, 1.05, 1.4],
        postes: {
          passo: k === 'exist' ? 5 : 2.5,
          altura: k === 'fauna' ? 1.9 : 1.6,
          lado: 0.1
        }
      }
    })
  }

  // placas: poste e chapa na forma do código, de frente para quem vem pela pista
  for (const g of (M.signs as Json[] | undefined) ?? []) {
    const p = g.p as number[] | undefined
    if (!p) continue
    const s = Number(g.s)
    const c = eixo.em(s)
    const direita = String(g.side ?? 'LD') !== 'LE'
    const { material, ...chapa } = placa(String(g.code ?? ''), String(g.dim ?? ''))
    el({
      classe: classe({
        id: 'SIN.VERTICAL',
        nome: 'Sinalização vertical',
        disciplina: 'Sinalização',
        unidade: 'un',
        material: 'sinal-branco'
      }),
      nome: `${String(g.code ?? 'Placa')} · est. ${String(g.est ?? '')}`,
      s0: s,
      s1: s,
      quantidade: 1,
      material,
      no_terreno: true,
      geo: {
        t: 'placa',
        p: P(p),
        rumo: r2(direita ? Math.atan2(-c.tn, -c.tx) : Math.atan2(c.tn, c.tx)),
        ...chapa
      }
    })
  }

  // contexto: faixa de domínio e interferências
  for (const pts of segs.FXD ?? []) {
    if (pts.length < 2) continue
    el({
      classe: classe({
        id: 'CTX.FAIXA',
        nome: 'Limite da faixa de domínio',
        disciplina: 'Contexto',
        contexto: true
      }),
      no_terreno: true,
      geo: { t: 'linha', pts: pts.map(P), largura: 0.4, fios: [0.15] }
    })
  }
  for (const it of (M.interf as Json[] | undefined) ?? []) {
    const p = it.p as number[] | undefined
    if (!p) continue
    el({
      classe: classe({
        id: 'CTX.INTERFERENCIA',
        nome: 'Interferências (postes e redes)',
        disciplina: 'Contexto',
        contexto: true
      }),
      nome: `${String(it.tipo ?? 'Interferência')} · est. ${String(it.est ?? '')}`,
      no_terreno: true,
      geo: { t: 'caixa', p: P(p), dim: [0.3, 0.3, 9] }
    })
  }
  const origem = M.origin as number[] | undefined
  const fuso = fusoDoHtml(html)
  if (!origem || !fuso)
    return {
      erros: [
        'O HTML não traz a origem das coordenadas ou o fuso UTM: sem eles não dá para pôr a obra no terreno.'
      ]
    }
  const nome = /<title>([^<]*)<\/title>/.exec(html)?.[1]?.trim() || 'Modelo 3D'
  return {
    modelo: {
      formato: 'infrawork-4d',
      versao: 1,
      nome,
      origem: { e: origem[0], n: origem[1], fuso },
      eixos: [{ id: 'E1', nome: 'Eixo principal', pontos: axis }],
      terreno: ((M.overview as Json[] | undefined) ?? []).map((o) => ({
        nx: Number(o.nx),
        ny: Number(o.ny),
        res: Number(o.res),
        x0: Number(o.x0),
        ytop: Number(o.ytop),
        zb: Number(o.zb),
        atual: String(o.T),
        projeto: o.D ? String(o.D) : undefined
      })),
      classes,
      secoes,
      camadas,
      elementos
    }
  }
}
