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
  tendencia: 'oklch(74% 0.16 50)', // laranja
  historico: 'oklch(74% 0.14 295)', // violeta
  mediaObra: CHART_THEME.axisLabel
} as const

export interface ServicoOpcao {
  id: string // servico_planejamento_id (catálogo global)
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
    out.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
    guard++
  }
  return out
}

/** Só consideramos produção com serviço casado ao catálogo (comparável + CPU). */
function temServico(p: ProducaoEnriquecida): boolean {
  return !!p.servico_planejamento_id
}

/** Serviços (catálogo global) presentes nas produções, ordenados por código/nome. */
export function servicosDisponiveis(prods: ProducaoEnriquecida[]): ServicoOpcao[] {
  const m = new Map<string, ServicoOpcao>()
  for (const p of prods) {
    if (!temServico(p)) continue
    const id = p.servico_planejamento_id as string
    if (!m.has(id)) {
      m.set(id, {
        id,
        codigo: p.servico_codigo ?? null,
        nome: p.servico_display_nome ?? p.siga_servico_nome ?? 'Serviço',
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

function chaveEntidade(p: ProducaoEnriquecida, dim: Dimensao): { key: string; nome: string; cor: string } {
  if (dim === 'equipe') {
    return {
      key: p.equipe_planejamento_id ?? p.siga_equipe_nome ?? '∅',
      nome: p.equipe_display_nome ?? p.siga_equipe_nome ?? 'Equipe —',
      cor: p.equipe_display_cor ?? ''
    }
  }
  return {
    key: p.encarregado_match_id ?? p.siga_encarregado_nome ?? '∅',
    nome: p.encarregado_display_nome ?? p.siga_encarregado_nome ?? 'Encarregado —',
    cor: ''
  }
}

const qtdDe = (p: ProducaoEnriquecida): number =>
  Number(p.qtd_convertida ?? p.qtd ?? 0) || 0

/**
 * Séries por entidade (equipe/encarregado) para UM serviço: produção diária
 * (soma de qtd_convertida por dia) + métricas e tendência.
 */
export function construirSeries(
  prods: ProducaoEnriquecida[],
  servicoId: string,
  dim: Dimensao
): EntidadeSerie[] {
  const porEntidade = new Map<
    string,
    { nome: string; cor: string; porDia: Map<string, number> }
  >()
  for (const p of prods) {
    if (p.servico_planejamento_id !== servicoId || !p.data) continue
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
    series.push(metricasSerie(key, e.nome, e.cor || CORES_FALLBACK[ci++ % CORES_FALLBACK.length], e.porDia))
  }
  // ordena por produção média desc (melhores no topo)
  return series.sort((a, b) => b.media - a.media)
}

/** Calcula métricas + tendência de um conjunto produção-por-dia. */
function metricasSerie(key: string, nome: string, cor: string, porDia: Map<string, number>): EntidadeSerie {
  const datas = [...porDia.keys()].sort()
  const valores = datas.map((d) => porDia.get(d)!)
  const reg: Regressao = regressaoLinear(valores.map((y, i) => ({ x: i, y })))
  const med = media(valores)
  const t = classificarTendencia(reg.slope, med)
  let melhorDia = 0
  let melhorData: string | null = null
  for (const d of datas) {
    const v = porDia.get(d)!
    if (v > melhorDia) { melhorDia = v; melhorData = d }
  }
  return {
    key, nome, cor, porDia, valores,
    total: valores.reduce((a, b) => a + b, 0),
    dias: valores.length,
    media: med,
    mediana: mediana(valores),
    melhorDia, melhorData,
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

/** IDs do serviço executado do SIGA presentes na obra para o serviço (catálogo) escolhido. */
export function sigaIdsDoServico(prods: ProducaoEnriquecida[], servicoPlanId: string): number[] {
  const ids = new Set<number>()
  for (const p of prods) {
    if (p.servico_planejamento_id === servicoPlanId && p.siga_servico_id != null) {
      ids.add(Number(p.siga_servico_id))
    }
  }
  return [...ids]
}
