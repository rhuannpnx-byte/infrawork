// Transformações puras da página de Performance: das produções enriquecidas
// para séries diárias por equipe/encarregado e métricas por serviço.

import type { ProducaoEnriquecida } from '@/types/acompanhamento'
import { CHART_THEME } from '@/components/charts/theme'
import {
  media,
  mediana,
  regressaoLinear,
  classificarTendencia,
  type Regressao
} from './estatistica'

export type Dimensao = 'equipe' | 'encarregado'

// Paleta padronizada com o Previsto × Realizado (CurvaSComProjecoes):
//   azul = planejado/meta, verde = realizado, laranja = projeção atual/tendência,
//   violeta = projeção necessária/benchmark histórico.
export const COR = {
  meta: CHART_THEME.series[0], // azul
  realizado: CHART_THEME.series[2], // verde
  tendencia: 'var(--warn)', // laranja/âmbar
  historico: 'var(--module-suprimentos)', // violeta
  mediaObra: CHART_THEME.axisLabel
} as const

/**
 * Escala monocromática de verdes da família "Realizado" (mesma cor do
 * Previsto × Realizado), do mais claro ao mais escuro — para distinguir várias
 * linhas/equipes sem sair da paleta. O índice 0 (melhor colocado) é o mais claro.
 */
export function escalaVerde(n: number): string[] {
  if (n <= 1) return [COR.realizado]
  const L0 = 0.9 // claro
  const L1 = 0.52 // escuro
  return Array.from({ length: n }, (_, i) => {
    const l = L0 + (L1 - L0) * (i / (n - 1))
    return `oklch(${Math.round(l * 100)}% 0.15 145)`
  })
}

export interface ServicoOpcao {
  id: string // servico_id (catálogo da obra)
  codigo: string | null
  nome: string
  unidade: string | null
}

export interface EntidadeSerie {
  key: string
  nome: string
  cor: string
  porDia: Map<string, number>
  valores: number[] // produção dos dias trabalhados (qtd>0), em ordem de data
  total: number
  dias: number
  media: number
  mediana: number
  melhorDia: number
  melhorData: string | null
  tendencia: { slope: number; r2: number; rotulo: string; pctPorDia: number }
}

// Mesma paleta de séries do tema (usada no Previsto × Realizado).
const CORES_FALLBACK = CHART_THEME.series

/** Eixo de dias (ISO) do período, inclusivo. */
export function eixoDias(dataDe: string, dataAte: string): string[] {
  const out: string[] = []
  const cur = new Date(dataDe + 'T00:00:00')
  const fim = new Date(dataAte + 'T00:00:00')
  let guard = 0
  while (cur <= fim && guard < 1000) {
    out.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    )
    cur.setDate(cur.getDate() + 1)
    guard++
  }
  return out
}

/** Só consideramos produção cujo item do orçamento ainda existe (comparável + meta). */
function temServico(p: ProducaoEnriquecida): boolean {
  return !!p.servico_id
}

/** Serviços (catálogo global) presentes nas produções, ordenados por código/nome. */
export function servicosDisponiveis(prods: ProducaoEnriquecida[]): ServicoOpcao[] {
  const m = new Map<string, ServicoOpcao>()
  for (const p of prods) {
    if (!temServico(p)) continue
    const id = p.servico_id as string
    if (!m.has(id)) {
      m.set(id, {
        id,
        codigo: p.servico_codigo ?? null,
        nome: p.servico_display_nome ?? p.servico_nome ?? 'Serviço',
        unidade: p.unidade_plano ?? p.servico_unidade ?? null
      })
    }
  }
  return [...m.values()].sort((a, b) =>
    (a.codigo ?? a.nome).localeCompare(b.codigo ?? b.nome, 'pt-BR')
  )
}

/** Quantos apontamentos foram ignorados por não ter serviço casado. */
export function contarSemServico(prods: ProducaoEnriquecida[]): number {
  return prods.filter((p) => !temServico(p)).length
}

function chaveEntidade(
  p: ProducaoEnriquecida,
  dim: Dimensao
): { key: string; nome: string; cor: string } {
  if (dim === 'equipe') {
    return {
      key: p.equipe_id ?? '∅',
      nome: p.equipe_display_nome ?? 'Equipe —',
      cor: p.equipe_display_cor ?? ''
    }
  }
  return {
    key: p.encarregado_id ?? '∅',
    nome: p.encarregado_display_nome ?? 'Encarregado —',
    cor: ''
  }
}

const qtdDe = (p: ProducaoEnriquecida): number => Number(p.qtd_convertida ?? p.qtd ?? 0) || 0

/**
 * Séries por entidade (equipe/encarregado) para UM serviço: produção diária
 * (soma de qtd_convertida por dia) + métricas e tendência.
 */
export function construirSeries(
  prods: ProducaoEnriquecida[],
  servicoId: string,
  dim: Dimensao
): EntidadeSerie[] {
  const porEntidade = new Map<string, { nome: string; cor: string; porDia: Map<string, number> }>()
  for (const p of prods) {
    if (p.servico_id !== servicoId || !p.data) continue
    const q = qtdDe(p)
    if (q <= 0) continue
    const { key, nome, cor } = chaveEntidade(p, dim)
    let e = porEntidade.get(key)
    if (!e) {
      e = { nome, cor, porDia: new Map() }
      porEntidade.set(key, e)
    }
    e.porDia.set(p.data, (e.porDia.get(p.data) ?? 0) + q)
  }

  let ci = 0
  const series: EntidadeSerie[] = []
  for (const [key, e] of porEntidade) {
    series.push(
      metricasSerie(key, e.nome, e.cor || CORES_FALLBACK[ci++ % CORES_FALLBACK.length], e.porDia)
    )
  }
  // ordena por produção média desc (melhores no topo)
  return series.sort((a, b) => b.media - a.media)
}

/** Calcula métricas + tendência de um conjunto produção-por-dia. */
function metricasSerie(
  key: string,
  nome: string,
  cor: string,
  porDia: Map<string, number>
): EntidadeSerie {
  const datas = [...porDia.keys()].sort()
  const valores = datas.map((d) => porDia.get(d)!)
  const reg: Regressao = regressaoLinear(valores.map((y, i) => ({ x: i, y })))
  const med = media(valores)
  const t = classificarTendencia(reg.slope, med, reg.r2, valores.length)
  let melhorDia = 0
  let melhorData: string | null = null
  for (const d of datas) {
    const v = porDia.get(d)!
    if (v > melhorDia) {
      melhorDia = v
      melhorData = d
    }
  }
  return {
    key,
    nome,
    cor,
    porDia,
    valores,
    total: valores.reduce((a, b) => a + b, 0),
    dias: valores.length,
    media: med,
    mediana: mediana(valores),
    melhorDia,
    melhorData,
    tendencia: { slope: reg.slope, r2: reg.r2, rotulo: t.rotulo, pctPorDia: t.pctPorDia }
  }
}

/** Série "Geral" do serviço: soma a produção de TODAS as entidades por dia. */
export function construirSerieGeral(series: EntidadeSerie[]): EntidadeSerie | null {
  if (series.length === 0) return null
  const porDia = new Map<string, number>()
  for (const s of series) {
    for (const [d, v] of s.porDia) porDia.set(d, (porDia.get(d) ?? 0) + v)
  }
  return metricasSerie('__geral__', 'Geral (todas)', COR.realizado, porDia)
}

/** Todos os valores diários (todas as entidades) do serviço — base p/ média da obra. */
export function valoresDiariosObra(series: EntidadeSerie[]): number[] {
  return series.flatMap((s) => s.valores)
}

/** Códigos de serviço (catálogo) das produções do serviço escolhido — chave do benchmark entre obras. */
export function codigosDoServico(prods: ProducaoEnriquecida[], servicoId: string): string[] {
  const cods = new Set<string>()
  for (const p of prods) {
    if (p.servico_id === servicoId && p.servico_codigo) cods.add(p.servico_codigo)
  }
  return [...cods]
}
