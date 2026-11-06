// Quadro de distribuição das viagens (como um QDM de terraplenagem): memória de medição dos serviços lançados por
// viagens. Uma linha por origem → destino → DMT, resumo por faixa de DMT e a relação das viagens.

import type { EapFilhoReceita, EapGrupo } from './valor-agregado-calc'

/** Viagem do período já com os nomes resolvidos (ver carregarViagensExport). */
export interface ViagemExport {
  id: string
  itemId: string
  /** ISO (aaaa-mm-dd) */
  data: string
  fichaId: string
  ordem: number
  veiculo: string
  motorista: string
  equipe: string
  origemId: string | null
  origem: string
  destinoId: string | null
  destino: string
  trechoId: string | null
  trechoNome: string
  trechoArea: boolean
  posIni: number | null
  posFim: number | null
  quantidade: number
  dmtKm: number | null
  nfTicket: string
}

export interface LinhaQuadro {
  origem: string
  destino: string
  estacas: string
  faixa: string
  viagens: number
  volume: number
  dmtKm: number | null
  momento: number | null
  qtd: number
  valor: number
}

export interface FaixaResumo {
  faixa: string
  volume: number
  momento: number
  pct: number
}

export interface RelacaoViagem {
  data: string
  veiculo: string
  motorista: string
  equipe: string
  origem: string
  destino: string
  estaca: string
  volume: number
  dmtKm: number | null
  momento: number | null
  nfTicket: string
}

export interface QuadroViagens {
  unidadeVolume: string
  linhas: LinhaQuadro[]
  total: {
    viagens: number
    volume: number
    dmtMedioKm: number | null
    momento: number
    qtd: number
    valor: number
  }
  porFaixa: FaixaResumo[]
  relacao: RelacaoViagem[]
}

export const SEM_DMT = 'sem DMT'
const LIMITES_M = [50, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 3000]
const fmtM = (m: number): string => m.toLocaleString('pt-BR')
const dataBR = (iso: string): string => iso.split('-').reverse().join('/')

/** Faixa de DMT no padrão SICRO (em metros). */
export function faixaDmt(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km)) return SEM_DMT
  const m = km * 1000
  if (m <= LIMITES_M[0]) return `até ${fmtM(LIMITES_M[0])} m`
  for (let i = 1; i < LIMITES_M.length; i++) {
    if (m <= LIMITES_M[i]) return `${fmtM(LIMITES_M[i - 1])} a ${fmtM(LIMITES_M[i])} m`
  }
  return `acima de ${fmtM(LIMITES_M[LIMITES_M.length - 1])} m`
}

const ordemFaixa = (f: string): number => {
  if (f === SEM_DMT) return Infinity
  const nums = f.replace(/\./g, '').match(/\d+/g) ?? ['0']
  const n = Number(nums[nums.length - 1])
  return f.startsWith('acima') ? n + 1 : n
}

/** Estaca(s) de um conjunto de viagens: faixa mín.–máx. por trecho; área = nome do local. */
function estacasDe(
  vs: ViagemExport[],
  formatarPosicao: (trechoId: string, metros: number) => string
): string {
  const porTrecho = new Map<string, { nome: string; area: boolean; min: number; max: number }>()
  for (const v of vs) {
    if (!v.trechoId) continue
    const t = porTrecho.get(v.trechoId) ?? {
      nome: v.trechoNome,
      area: v.trechoArea,
      min: Infinity,
      max: -Infinity
    }
    if (v.posIni != null) t.min = Math.min(t.min, v.posIni)
    if (v.posFim != null || v.posIni != null) t.max = Math.max(t.max, v.posFim ?? v.posIni!)
    porTrecho.set(v.trechoId, t)
  }
  const partes: string[] = []
  for (const [id, t] of porTrecho) {
    if (t.area || !Number.isFinite(t.min)) {
      partes.push(t.nome)
      continue
    }
    const a = formatarPosicao(id, t.min)
    const b = formatarPosicao(id, t.max)
    const faixa = a === b ? a : `${a} a ${b}`
    partes.push(porTrecho.size > 1 ? `${t.nome} ${faixa}` : faixa)
  }
  return partes.join('; ')
}

/**
 * Quadro de distribuição das viagens para um filho de um agregador lançado por viagens. A quantidade do filho segue
 * a regra proporcional da Medição (volume ÷ quantidade do serviço × quantidade contratual do filho). Quando a
 * produção do período passa da soma das viagens (lançamento anterior à parametrização), entra uma linha com a
 * diferença para o total bater com a Medição.
 */
export function montarQuadroViagens(input: {
  grupo: EapGrupo
  filho: EapFilhoReceita
  viagens: ViagemExport[]
  /** Produção do agregador no período (mesma fonte da Medição). */
  producaoPeriodo: number
  formatarPosicao: (trechoId: string, metros: number) => string
}): QuadroViagens {
  const { grupo, filho, formatarPosicao } = input
  const viagens = input.viagens
    .filter((v) => v.itemId === grupo.id)
    .sort(
      (a, b) =>
        a.data.localeCompare(b.data) || a.fichaId.localeCompare(b.fichaId) || a.ordem - b.ordem
    )
  const qref = grupo.quantidade_referencia
  const qtdFilho = (volume: number): number => (qref > 0 ? (volume / qref) * filho.quantidade : 0)

  const grupos = new Map<string, ViagemExport[]>()
  for (const v of viagens) {
    const k = `${v.origemId ?? ''}|${v.destinoId ?? ''}|${v.dmtKm ?? ''}`
    const g = grupos.get(k)
    if (g) g.push(v)
    else grupos.set(k, [v])
  }

  const linhas: LinhaQuadro[] = [...grupos.values()].map((vs) => {
    const volume = vs.reduce((a, v) => a + v.quantidade, 0)
    const dmt = vs[0].dmtKm
    const qtd = qtdFilho(volume)
    return {
      origem: vs[0].origem,
      destino: vs[0].destino,
      estacas: estacasDe(vs, formatarPosicao),
      faixa: faixaDmt(dmt),
      viagens: vs.length,
      volume,
      dmtKm: dmt,
      momento: dmt == null ? null : volume * dmt,
      qtd,
      valor: qtd * filho.venda_unitaria
    }
  })
  linhas.sort(
    (a, b) =>
      a.origem.localeCompare(b.origem, 'pt-BR') ||
      a.destino.localeCompare(b.destino, 'pt-BR') ||
      (a.dmtKm ?? Infinity) - (b.dmtKm ?? Infinity)
  )

  const somaViagens = linhas.reduce((a, l) => a + l.volume, 0)
  const sobra = input.producaoPeriodo - somaViagens
  if (sobra > 1e-6) {
    const qtd = qtdFilho(sobra)
    linhas.push({
      origem: 'Produção sem viagem no período',
      destino: '',
      estacas: '',
      faixa: SEM_DMT,
      viagens: 0,
      volume: sobra,
      dmtKm: null,
      momento: null,
      qtd,
      valor: qtd * filho.venda_unitaria
    })
  }

  const volume = linhas.reduce((a, l) => a + l.volume, 0)
  const momento = linhas.reduce((a, l) => a + (l.momento ?? 0), 0)
  const volumeComDmt = linhas.reduce((a, l) => a + (l.dmtKm == null ? 0 : l.volume), 0)

  const faixas = new Map<string, { volume: number; momento: number }>()
  for (const l of linhas) {
    const f = faixas.get(l.faixa) ?? { volume: 0, momento: 0 }
    f.volume += l.volume
    f.momento += l.momento ?? 0
    faixas.set(l.faixa, f)
  }
  const porFaixa = [...faixas.entries()]
    .map(([faixa, f]) => ({ faixa, ...f, pct: volume > 0 ? f.volume / volume : 0 }))
    .sort((a, b) => ordemFaixa(a.faixa) - ordemFaixa(b.faixa))

  const relacao: RelacaoViagem[] = viagens.map((v) => ({
    data: dataBR(v.data),
    veiculo: v.veiculo,
    motorista: v.motorista,
    equipe: v.equipe,
    origem: v.origem,
    destino: v.destino,
    estaca: estacasDe([v], formatarPosicao),
    volume: v.quantidade,
    dmtKm: v.dmtKm,
    momento: v.dmtKm == null ? null : v.quantidade * v.dmtKm,
    nfTicket: v.nfTicket
  }))

  return {
    unidadeVolume: grupo.unidade_referencia,
    linhas,
    total: {
      viagens: viagens.length,
      volume,
      dmtMedioKm: volumeComDmt > 0 ? momento / volumeComDmt : null,
      momento,
      qtd: linhas.reduce((a, l) => a + l.qtd, 0),
      valor: linhas.reduce((a, l) => a + l.valor, 0)
    },
    porFaixa,
    relacao
  }
}
