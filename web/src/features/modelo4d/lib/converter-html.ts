import type { Camada4D, Classe4D, Elemento4D, Modelo4D, Pt, Secao4D } from './contrato'
import { EixoCalc } from './eixo'

/**
 * Converte o HTML da "construção digital" (visualizador autônomo com os dados nos blocos `data` e `ext`) no contrato
 * `infrawork-4d`. Ficam de fora o terreno detalhado (arquivos externos ao HTML), o roteiro de visita, o mapa
 * regional, os empréstimos e a desapropriação.
 */

type Json = Record<string, unknown>

const NOME_DRENAGEM: Record<string, [largura: number, altura: number]> = {
  STC: [1.0, 0],
  MFC: [0.4, 0.2],
  SZC: [1.0, 0],
  VPCC: [1.2, 0],
  VPAC: [1.2, 0],
  DPS: [0.6, 0]
}

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

/** Diz se o texto parece o HTML da construção digital (para escolher o leitor certo na importação). */
export function ehHtmlDeModelo(texto: string): boolean {
  return texto.includes('<script') && texto.includes('id="data"')
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

  // plataforma: 9 pontos por seção (off-set, borda, acostamento, pista, eixo e o espelho do lado direito)
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
    return { s, perfil: perfil.map(([o, z]) => [r2(o), r2(z + 0.03)]) }
  })

  // terraplenagem: por intervalo de seção, com o volume da cubação
  const corte = classe({
    id: 'TERRA.CORTE',
    nome: 'Escavação (corte)',
    disciplina: 'Terraplenagem',
    unidade: 'm³',
    terreno: true
  })
  const aterro = classe({
    id: 'TERRA.ATERRO',
    nome: 'Aterro compactado',
    disciplina: 'Terraplenagem',
    unidade: 'm³',
    terreno: true
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
    const fc: [number, number][] = []
    const fa: [number, number][] = []
    ;(A[8] > A[6] ? fc : fa).push([-1e6, A[5]])
    ;(A[12] > A[10] ? fc : fa).push([wR, 1e6])
    ;(vc > va ? fc : fa).push([A[5], wR])
    if (fc.length)
      camadas.push({ classe: corte, s0: A[0], s1: B[0], faixas: fc, quantidade: r2(vc) })
    if (fa.length)
      camadas.push({ classe: aterro, s0: A[0], s1: B[0], faixas: fa, quantidade: r2(va) })
  }

  // pavimento: uma camada por nome, da primeira à última estaca, na maior largura informada
  const s0 = sec[0][0]
  const s1 = sec[sec.length - 1][0]
  const pav = new Map<string, { s0: number; s1: number; larg: number }>()
  for (const p of ((M.pav as Json | undefined)?.seg as Json[] | undefined) ?? []) {
    const nome = String(p.cam ?? '').trim()
    if (!nome) continue
    const a = pav.get(nome)
    const larg = Number(p.larg) || 7
    if (!a) pav.set(nome, { s0: Number(p.s0), s1: Number(p.s1), larg })
    else {
      a.s0 = Math.min(a.s0, Number(p.s0))
      a.s1 = Math.max(a.s1, Number(p.s1))
      a.larg = Math.max(a.larg, larg)
    }
  }
  let ordem = 0
  for (const [nome, p] of pav) {
    ordem++
    camadas.push({
      classe: classe({ id: `PAV.${ordem}`, nome: titulo(nome), disciplina: 'Pavimentação' }),
      s0: Math.max(p.s0, s0),
      s1: Math.min(p.s1, s1),
      faixas: [[-p.larg / 2, p.larg / 2]],
      elevacao: 0.05 * ordem
    })
  }
  if (pav.size) {
    camadas.push({
      classe: classe({
        id: 'SIN.HORIZONTAL',
        nome: 'Sinalização horizontal',
        disciplina: 'Sinalização'
      }),
      s0,
      s1,
      faixas: [
        [-3.53, -3.38],
        [-0.14, -0.02],
        [0.02, 0.14],
        [3.38, 3.53]
      ],
      elevacao: 0.05 * (ordem + 1)
    })
  }

  // drenagem linear
  const segs = (M.segs ?? {}) as Record<string, number[][][]>
  for (const [k, [largura, altura]] of Object.entries(NOME_DRENAGEM)) {
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
          unidade: 'm'
        }),
        quantidade: r2(comp),
        geo: { t: 'linha', pts: pts.map(P), largura, altura }
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
      unidade: 'un'
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
      // descida d'água: vale a estaca do dispositivo, então vai como malha de um elemento só
      const pos: number[] = []
      for (let j = 0; j < caminho.length - 1; j++) {
        const a = caminho[j]
        const b = caminho[j + 1]
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
        const ox = (-(b[1] - a[1]) / l) * 0.5
        const on = ((b[0] - a[0]) / l) * 0.5
        const q = [
          [a[0] + ox, a[1] + on, a[2] + 0.15],
          [a[0] - ox, a[1] - on, a[2] + 0.15],
          [b[0] + ox, b[1] + on, b[2] + 0.15],
          [b[0] - ox, b[1] - on, b[2] + 0.15]
        ]
        for (const k of [0, 2, 1, 1, 2, 3]) pos.push(r2(q[k][0]), r2(q[k][1]), r2(q[k][2]))
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
    el({
      classe: classe({
        id: 'OAC.BUEIROS',
        nome: 'Bueiros',
        disciplina: 'Obras de arte correntes',
        unidade: 'm'
      }),
      nome: `${String(b.tipo ?? 'Bueiro')} · est. ${String(b.est ?? '')}`,
      s0: Number(b.s),
      s1: Number(b.s),
      quantidade: Number(b.L) || undefined,
      geo: {
        t: 'tubo',
        p0: P(p0),
        p1: P(p1),
        linhas: Number(b.linhas) || 1,
        ...(B ? { largura: B, altura: D } : { diametro: D })
      }
    })
  }

  // defensas e terminais
  const oc = (M.oc ?? {}) as Record<string, Json[]>
  for (const d of oc.DEFENSA ?? []) {
    const prof = d.prof as number[][] | undefined
    if (!prof || prof.length < 2) continue
    el({
      classe: classe({
        id: 'OC.DEFENSA',
        nome: 'Defensa metálica',
        disciplina: 'Obras complementares',
        unidade: 'm'
      }),
      quantidade: Number(d.len) || undefined,
      geo: { t: 'linha', pts: prof.map(([s, o]) => P(eixo.ponto(s, o))), largura: 0.3, altura: 0.7 }
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
        unidade: 'un'
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

  // cercas
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
              unidade: 'm'
            })
          : classe({
              id: 'OC.CERCA',
              nome: 'Cerca',
              disciplina: 'Obras complementares',
              unidade: 'm'
            })
    el({
      classe: c,
      quantidade: Number(f.len) || undefined,
      geo: { t: 'linha', pts, largura: 0.15, altura: 1.4 }
    })
  }

  // placas
  for (const g of (M.signs as Json[] | undefined) ?? []) {
    const p = g.p as number[] | undefined
    if (!p) continue
    const s = Number(g.s)
    const c = eixo.em(s)
    el({
      classe: classe({
        id: 'SIN.VERTICAL',
        nome: 'Sinalização vertical',
        disciplina: 'Sinalização',
        unidade: 'un'
      }),
      nome: `${String(g.code ?? 'Placa')} · est. ${String(g.est ?? '')}`,
      s0: s,
      s1: s,
      quantidade: 1,
      geo: { t: 'caixa', p: P(p), dim: [0.12, 0.8, 2.4], rumo: r2(Math.atan2(c.tn, c.tx)) }
    })
  }

  // contexto: faixa de domínio, interferências e jazidas
  for (const pts of segs.FXD ?? []) {
    if (pts.length < 2) continue
    el({
      classe: classe({
        id: 'CTX.FAIXA',
        nome: 'Limite da faixa de domínio',
        disciplina: 'Contexto',
        contexto: true
      }),
      geo: { t: 'linha', pts: pts.map(P), largura: 0.6 }
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
      geo: { t: 'caixa', p: P(p), dim: [0.4, 0.4, 8] }
    })
  }
  for (const j of (X.polys as Json[] | undefined) ?? []) {
    const b = bytes(String(j.xyz ?? ''))
    const v = new Float32Array(b.buffer.slice(0, b.length - (b.length % 4)))
    const bi = bytes(String(j.idx ?? ''))
    const idx = Array.from(new Uint16Array(bi.buffer.slice(0, bi.length - (bi.length % 2))))
    if (v.length < 9 || idx.length < 3) continue
    el({
      classe: classe({
        id: 'CTX.JAZIDA',
        nome: 'Jazidas e empréstimos concentrados',
        disciplina: 'Contexto',
        contexto: true
      }),
      nome: String(j.full ?? j.name ?? 'Jazida'),
      geo: { t: 'malha', pos: Array.from(v, r2), idx }
    })
  }

  const origem = M.origin as number[] | undefined
  const nome = /<title>([^<]*)<\/title>/.exec(html)?.[1]?.trim() || 'Modelo 3D'
  return {
    modelo: {
      formato: 'infrawork-4d',
      versao: 1,
      nome,
      origem: origem ? { e: origem[0], n: origem[1] } : undefined,
      eixos: [{ id: 'E1', nome: 'Eixo principal', pontos: axis }],
      terreno: ((M.overview as Json[] | undefined) ?? []).map((o) => ({
        nx: Number(o.nx),
        ny: Number(o.ny),
        res: Number(o.res),
        x0: Number(o.x0),
        ytop: Number(o.ytop),
        zb: Number(o.zb),
        atual: String(o.T),
        projeto: o.D ? String(o.D) : undefined,
        imagem: o.des ? String(o.des) : undefined,
        imagem_larg: o.tw ? Number(o.tw) : undefined,
        imagem_alt: o.th ? Number(o.th) : undefined
      })),
      classes,
      secoes,
      camadas,
      elementos
    }
  }
}
