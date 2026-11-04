/**
 * Estado de interface do cronograma (por navegador): plano escolhido por obra, opções de exibição das visões (as
 * `GanttViewSettings` / `RoadTimeViewSettings` do ApeX), zoom, largura da grade e linhas recolhidas.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { storageKey } from '@/lib/storage-keys'
import type { FiltroVisao } from './visoes/filtro'
import type { OpcoesGantt } from './visoes/gantt-dados'

export interface OpcoesVisaoGantt extends OpcoesGantt {
  /** `SHOW_WEEK_ENDS` (padrão do ApeX: não) */
  fimDeSemana: boolean
  /** `SHOW_HOLIDAYS` (padrão: sim, sombreados) */
  feriados: boolean
  /** dependências derivadas dos tipos (tracejadas) */
  automaticas: boolean
  /** destaque das tarefas sem folga */
  critico: boolean
  /** nome à direita da barra */
  rotulos: boolean
  /** número da hierarquia à esquerda da barra (como no ApeX) */
  numeros: boolean
}

export const OPCOES_VISAO_GANTT: OpcoesVisaoGantt = {
  agrupar: true,
  resumos: true,
  marcos: true,
  fimDeSemana: false,
  feriados: true,
  automaticas: true,
  critico: false,
  rotulos: true,
  numeros: false
}

/** `RoadTimeViewSettings` do ApeX + opções do InfraWork. */
export interface OpcoesTempoCaminho {
  /** trechos mostrados, na ordem (null = todos os trechos com tarefas) */
  trechos: string[] | null
  fimDeSemana: boolean
  feriados: boolean
  marcos: boolean
  dependencias: boolean
  automaticas: boolean
  rotulos: boolean
  /** caixa envolvente de cada tarefa (`BIT_ROAD_TIME_SHOW_TASK_BOX`) */
  caixas: boolean
  /** modo controle: a série da previsão (atributo de look `FORECAST` do ApeX) */
  previsao: boolean
  /** áreas (locais sem estacas) como colunas estreitas à direita dos eixos */
  areas: boolean
  /** fecho das tarefas de cada tarefa-resumo (`SHOW_SUM_TASK_AREAS`) */
  areasResumo: boolean
}

export const OPCOES_TEMPO_CAMINHO: OpcoesTempoCaminho = {
  trechos: null,
  fimDeSemana: false,
  feriados: true,
  marcos: true,
  dependencias: true,
  automaticas: false,
  rotulos: true,
  caixas: false,
  previsao: true,
  areas: true,
  areasResumo: false
}

export const COLUNAS_GANTT = [
  'numero',
  'nome',
  'servico',
  'trecho',
  'quantidade',
  'inicio',
  'fim',
  'duracao',
  'producao',
  'equipes',
  'folga',
  'estacas',
  'prioridade',
  'executado',
  'previsto'
] as const
export type ColunaGantt = (typeof COLUNAS_GANTT)[number]
/** Como no ApeX, local e estacas ficam à vista: a tarefa é os seus locais. */
export const COLUNAS_PADRAO: ColunaGantt[] = [
  'numero',
  'nome',
  'trecho',
  'estacas',
  'quantidade',
  'inicio',
  'fim',
  'duracao',
  'folga'
]

interface CronogramaUi {
  planoPorObra: Record<string, string>
  gantt: OpcoesVisaoGantt
  /** pixels por hora de trabalho; null = ajustar ao período do plano */
  pxPorHora: number | null
  /** largura da grade; null = a soma das colunas */
  larguraGrade: number | null
  colunas: ColunaGantt[]
  recolhidas: Record<string, string[]>
  tc: OpcoesTempoCaminho
  /** zoom do tempo-caminho; null = ajustar à área */
  tcZoom: { pxPorHora: number | null; pxPorMetro: number | null }
  /** filtro da visão por plano (Gantt e tempo-caminho usam o mesmo) */
  filtros: Record<string, FiltroVisao>
  setFiltro: (planoId: string, f: FiltroVisao) => void
  setTc: (o: Partial<OpcoesTempoCaminho>) => void
  setTcZoom: (z: Partial<{ pxPorHora: number | null; pxPorMetro: number | null }>) => void
  escolherPlano: (obraId: string, planoId: string) => void
  setGantt: (o: Partial<OpcoesVisaoGantt>) => void
  setZoom: (px: number | null) => void
  setLarguraGrade: (w: number | null) => void
  setColunas: (c: ColunaGantt[]) => void
  alternarRecolhida: (planoId: string, chave: string) => void
  setRecolhidas: (planoId: string, chaves: string[]) => void
}

export const useCronogramaUi = create<CronogramaUi>()(
  persist(
    (set) => ({
      planoPorObra: {},
      gantt: OPCOES_VISAO_GANTT,
      pxPorHora: null,
      larguraGrade: null,
      colunas: COLUNAS_PADRAO,
      recolhidas: {},
      tc: OPCOES_TEMPO_CAMINHO,
      tcZoom: { pxPorHora: null, pxPorMetro: null },
      filtros: {},
      setFiltro: (planoId, f) => set((s) => ({ filtros: { ...s.filtros, [planoId]: f } })),
      setTc: (o) => set((s) => ({ tc: { ...s.tc, ...o } })),
      setTcZoom: (z) => set((s) => ({ tcZoom: { ...s.tcZoom, ...z } })),
      escolherPlano: (obraId, planoId) =>
        set((s) => ({ planoPorObra: { ...s.planoPorObra, [obraId]: planoId } })),
      setGantt: (o) => set((s) => ({ gantt: { ...s.gantt, ...o } })),
      setZoom: (pxPorHora) => set({ pxPorHora }),
      setLarguraGrade: (w) =>
        set({ larguraGrade: w === null ? null : Math.max(200, Math.min(1400, Math.round(w))) }),
      setColunas: (colunas) =>
        set({ colunas: colunas.includes('nome') ? colunas : ['nome', ...colunas] }),
      alternarRecolhida: (planoId, chave) =>
        set((s) => {
          const atual = new Set(s.recolhidas[planoId] ?? [])
          if (atual.has(chave)) atual.delete(chave)
          else atual.add(chave)
          return { recolhidas: { ...s.recolhidas, [planoId]: [...atual] } }
        }),
      setRecolhidas: (planoId, chaves) =>
        set((s) => ({ recolhidas: { ...s.recolhidas, [planoId]: chaves } }))
    }),
    {
      name: storageKey('cronograma.ui.v2'),
      // v3: colunas Trecho e Estacas entram no padrão (zoom, plano e opções ficam)
      version: 4,
      migrate: (p, v) => {
        const x = (p ?? {}) as CronogramaUi
        // v4: a faixa de quantidades do tempo-caminho saiu
        if (x.tc) delete (x.tc as unknown as Record<string, unknown>).quantidades
        return v < 3 ? { ...x, colunas: COLUNAS_PADRAO } : x
      },
      partialize: (s) => ({
        planoPorObra: s.planoPorObra,
        gantt: s.gantt,
        pxPorHora: s.pxPorHora,
        larguraGrade: s.larguraGrade,
        colunas: s.colunas,
        recolhidas: s.recolhidas,
        tc: s.tc,
        tcZoom: s.tcZoom,
        filtros: s.filtros
      }),
      merge: (p, cur) => {
        const x = (p ?? {}) as Partial<CronogramaUi>
        return {
          ...cur,
          ...x,
          gantt: { ...OPCOES_VISAO_GANTT, ...(x.gantt ?? {}) },
          tc: { ...OPCOES_TEMPO_CAMINHO, ...(x.tc ?? {}) }
        }
      }
    }
  )
)
