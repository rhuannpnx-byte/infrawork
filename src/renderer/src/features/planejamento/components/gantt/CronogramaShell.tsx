// CronogramaShell — orquestrador do redesign Gantt (Fases 1-3).
//
// Estrutura:
//   ┌─ CronogramaHeader ──────────────────────────────────────────┐
//   │   breadcrumb + h1 obra + rev chip + pendências chip + acts │
//   ├─ CronogramaToolbar ─────────────────────────────────────────┤
//   │   counters + Ano/Mês/Semana/Dia + zoom + Hoje + Ajustar +  │
//   │   Visualização                                              │
//   ├─ main ──────────────────────────────────────────────────────┤
//   │   [Grid (15 cols)]  │ Splitter │  [GanttPane timeline]     │
//   ├─ statusbar ─────────────────────────────────────────────────┤
//   │   âncora + término + escala + zoom + custo                  │
//   └─────────────────────────────────────────────────────────────┘
//
// Fase 2 trouxe: Grid de 15 colunas em 5 grupos com edição inline, popovers
// (Trecho, QtdLink, AddEquipe), drag-to-reorder de linhas, qtd_link
// computado em tempo real via template do trecho.
//
// Painel direito ainda é placeholder — Fase 3 traz o GanttPane com timeline
// SVG, barras e dependências; Fase 4 traz drag de barras e Visualização panel
// efetiva.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { createPortal } from 'react-dom'
import { Trash2 } from 'lucide-react'
import {
  useCalcularCronograma,
  useCpuSnapshots,
  useEquipes,
  usePlanejamentoAtivo,
  usePlanejamentos,
  useTarefas
} from '@/features/planejamento/hooks'
import { expandirRecursosPorTarefa } from '@/features/planejamento/lib/histograma-recursos'
import { useCalendario, useExcecoes, useFatoresMes } from '@/features/planejamento/hooks/calendario'
import { useCpmEngine } from '@/features/planejamento/hooks/cpm-reactive'
import {
  useAlocarEquipe,
  useDeleteTarefa,
  useDesalocarEquipe,
  useUpdateTarefa
} from '@/features/planejamento/hooks/tarefas'
import { useDeleteDependencia } from '@/features/planejamento/hooks/dependencias'
import { useObraTrechos } from '@/features/planejamento/hooks/trechos'
import { useReorderTarefas } from '@/features/planejamento/hooks/tarefas'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useAuthStore } from '@/stores/auth-store'
import { fmtBRL } from '@/lib/money'
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import {
  buildTaskTree,
  flattenVisible,
  validateMoveTarget,
  type PlanejamentoTarefaNode
} from '@/features/planejamento/lib/eap'
import { parseMarcador } from '@/lib/format/posicao'
import type { PlanejamentoTarefaCompleta } from '@/types/planejamento'
import { addDaysLocal, diffDaysLocal } from '@/features/planejamento/lib/time-scale'
import { parseISO } from '@/features/planejamento/lib/dates'
import { NewPlanejamentoDialog } from '@/features/planejamento/modals/NewPlanejamentoDialog'
import { PromoverBaselineDialog } from '@/features/planejamento/modals/PromoverBaselineDialog'
import { NewTarefaDialog } from '@/features/planejamento/modals/NewTarefaDialog'
import { ImportMsProjectDialog } from '@/features/planejamento/modals/ImportMsProjectDialog'
import { ExportarMsProjectDialog } from './ExportarMsProjectDialog'
import { exportarCronogramaXml } from '@/features/planejamento/hooks/msproject'
import type { PlanejamentoDependencia } from '@/types/planejamento'
import { AddDependenciaDialog } from '@/features/planejamento/modals/AddDependenciaDialog'
import { NotasModal } from '@/features/planejamento/modals/NotasModal'
import { CronogramaHeader } from './CronogramaHeader'
import {
  CronogramaToolbar,
  PX_PER_DAY_MAX,
  PX_PER_DAY_MIN,
  type EscalaPreset
} from './CronogramaToolbar'
import { CronogramaSplitter } from './CronogramaSplitter'
import { loadSplitWidth, saveSplitWidth } from './split-width'
import { VisualizacaoPanel } from './VisualizacaoPanel'
import { Grid } from './Grid'
import { GanttPane } from './GanttPane'
import { BarContextMenu } from './BarContextMenu'
import { DepContextMenu } from './DepContextMenu'
import { TrechoPopover } from './popovers/TrechoPopover'
import { QtdLinkPopover } from './popovers/QtdLinkPopover'
import { AddEquipePopover } from './popovers/AddEquipePopover'
import { PosicaoPopover } from './popovers/PosicaoPopover'
import { ConstraintPopover } from './popovers/ConstraintPopover'
import { useGanttDrag } from '../../hooks/useGanttDrag'
import { useGanttLasso } from '../../hooks/useGanttLasso'
import { useAddDependencia, useUpdateDependencia } from '../../hooks/dependencias'
import type { DependenciaTipo } from '@/types/planejamento'
import {
  rowHeightForDensity,
  useCronogramaTweaks
} from '../../hooks/useCronogramaTweaks'
import {
  loadGridColumns,
  saveGridColumns,
  type GridColumnConfig
} from '../../lib/grid-columns'
import { useTrechosQuantidadeTemplatesAtuais } from '../../hooks/trechos'
import { computeLinkedQtd } from '../../lib/trecho-metricas'
import type { CellContext, VisibleNode } from './cells/types'

interface CronogramaShellProps {
  obraId: string
  obraNome: string
  /** Quando setado, força a renderização desta revisão específica (readonly).
   *  Usado pela rota /planejamento/revisoes/:id. Sem isso, o Shell usa o
   *  planejamento ativo da obra (comportamento padrão). */
  forcedPlanejamentoId?: string
  /** Força readOnly mesmo se a revisão não for baseline (rotas históricas). */
  forceReadOnly?: boolean
}

export function CronogramaShell({
  obraId,
  obraNome,
  forcedPlanejamentoId,
  forceReadOnly
}: CronogramaShellProps): ReactNode {
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const isApoio = role === 'apoio'

  // ─── Estado UI ──────────────────────────────────────────────────────────
  const [planId, setPlanId] = useState<string | null>(null)
  const [splitWidth, setSplitWidth] = useState<number>(() => loadSplitWidth())
  const [pxPerDay, setPxPerDay] = useState<number>(5)
  /** Set de IDs selecionados (multi-seleção via Shift/Ctrl/Lasso). */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [hoverId, setHoverId] = useState<string | null>(null)
  /** Set de IDs EXPANDIDOS (default: todos os grupos expandidos). */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [pendenciasFilterAtivo, setPendenciasFilterAtivo] = useState(false)
  const [vizPanelAberto, setVizPanelAberto] = useState(false)
  const [novoPlanOpen, setNovoPlanOpen] = useState(false)
  const [promoverOpen, setPromoverOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [importMspOpen, setImportMspOpen] = useState(false)
  const [exportMspOpen, setExportMspOpen] = useState(false)
  const [exportandoMsp, setExportandoMsp] = useState(false)
  const [cols, setCols] = useState<GridColumnConfig[]>(() => loadGridColumns())
  // Resize de coluna: clampa em [minWidth, maxWidth]; a persistência é o effect
  // que observa `cols` (saveGridColumns). Atualiza ao vivo durante o arraste.
  const onColResize = useCallback((key: GridColumnConfig['key'], width: number) => {
    setCols((prev) =>
      prev.map((c) =>
        c.key === key
          ? { ...c, width: Math.max(c.minWidth, Math.min(c.maxWidth, Math.round(width))) }
          : c
      )
    )
  }, [])

  // Popovers — anchorRect + tarefaId
  const [trechoPopover, setTrechoPopover] = useState<{ tarefaId: string; rect: DOMRect } | null>(
    null
  )
  const [qtdLinkPopover, setQtdLinkPopover] = useState<{ tarefaId: string; rect: DOMRect } | null>(
    null
  )
  const [equipePopover, setEquipePopover] = useState<{ tarefaId: string; rect: DOMRect } | null>(
    null
  )
  const [posicaoPopover, setPosicaoPopover] = useState<{
    tarefaId: string
    field: 'posicao_inicio_m' | 'posicao_fim_m'
    rect: DOMRect
  } | null>(null)
  const [constraintPopover, setConstraintPopover] = useState<{
    tarefaId: string
    rect: DOMRect
  } | null>(null)
  const [addDepFor, setAddDepFor] = useState<string | null>(null)
  const [notasFor, setNotasFor] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ tarefaId: string; x: number; y: number } | null>(null)

  // Drag-to-reorder
  const [dragRow, setDragRow] = useState<{
    tarefaId: string
    ghostX: number
    ghostY: number
    /** ID da linha onde o ghost está pairando agora (pra realçar). */
    overId: string | null
    /** Metade da linha onde o cursor está — define se insere antes/depois. */
    overSide: 'top' | 'bottom' | null
  } | null>(null)

  // ─── Data ───────────────────────────────────────────────────────────────
  const { data: planejamentos = [] } = usePlanejamentos(obraId)
  const { data: planAtivo } = usePlanejamentoAtivo(obraId)
  const planejamentoId = forcedPlanejamentoId ?? planId ?? planAtivo?.id ?? null
  const planSelecionado = planejamentos.find((p) => p.id === planejamentoId) ?? null
  const readOnly = isApoio || !!planSelecionado?.is_baseline || !!forceReadOnly

  const { data: tarefas = [] } = useTarefas(planejamentoId)
  // Inclui trecho/equipe-sistema (= 'Indireto') no mapping pra que a tarefa
  // indireta consiga resolver o nome do trecho/equipe na grid. Selects de
  // edição filtram is_sistema separadamente em cada local de uso.
  const { data: equipes = [] } = useEquipes(obraId, { incluirSistema: true })
  const { data: trechos = [] } = useObraTrechos(obraId, { incluirSistema: true })
  const { data: calendario } = useCalendario(obraId)
  const { data: excecoes = [] } = useExcecoes(obraId)
  const { data: fatoresMes = [] } = useFatoresMes(obraId)
  const calcular = useCalcularCronograma()
  const update = useUpdateTarefa()
  const delTarefa = useDeleteTarefa()
  const reorder = useReorderTarefas()
  const alocarEq = useAlocarEquipe()
  const desalocarEq = useDesalocarEquipe()
  const delDep = useDeleteDependencia()
  const addDep = useAddDependencia()
  const updDep = useUpdateDependencia()
  const confirm = useConfirm()

  // Snapshots das composições das tarefas-folha — alimentam a exportação com
  // recursos (mesmo caminho do Histograma planejado).
  const snapshotIds = useMemo(
    () =>
      Array.from(
        new Set(
          tarefas
            .filter((t) => t.tipo_no === 'tarefa' && !t.is_indireto && t.cpu_snapshot_id)
            .map((t) => t.cpu_snapshot_id as string)
        )
      ),
    [tarefas]
  )
  const { data: snapshots } = useCpuSnapshots(snapshotIds)
  const recursosInfo = useMemo(
    () => expandirRecursosPorTarefa(tarefas, snapshots ?? new Map()),
    [tarefas, snapshots]
  )

  // Exporta o cronograma atual para MS Project XML. Dependências derivadas das
  // predecessoras já presentes em cada tarefa (view v10). `incluirRecursos`
  // embute Recursos/Atribuições p/ reproduzir o histograma no Project.
  const handleExportarMsProject = async (incluirRecursos: boolean): Promise<void> => {
    if (!planSelecionado || tarefas.length === 0) {
      toast.error('Nada para exportar neste plano.')
      return
    }
    setExportandoMsp(true)
    try {
      const dependencias: PlanejamentoDependencia[] = tarefas.flatMap((t) =>
        (t.predecessoras ?? []).map((p) => ({
          id: p.id,
          planejamento_id: planSelecionado.id,
          predecessora_id: p.predecessora_id,
          sucessora_id: t.id,
          tipo: p.tipo,
          lag_dias: p.lag_dias,
          created_at: ''
        }))
      )
      const res = await exportarCronogramaXml({
        projectName: `${obraNome} — ${planSelecionado.nome}`,
        filenameBase: `Cronograma ${obraNome} ${planSelecionado.nome}`,
        tarefas,
        dependencias,
        bitmask: calendario?.dias_uteis_bitmask,
        snapshotsById: incluirRecursos ? snapshots : undefined
      })
      if (res.ok) {
        toast.success('Cronograma exportado para MS Project.')
        setExportMspOpen(false)
      } else if (!res.canceled) toast.error(res.error ?? 'Falha ao exportar.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao exportar.')
    } finally {
      setExportandoMsp(false)
    }
  }

  // Context menu específico de barra (right-click no GanttPane)
  const [barCtxMenu, setBarCtxMenu] = useState<{ tarefaId: string; x: number; y: number } | null>(
    null
  )

  // Context menu de seta de dependência (click na linha SVG)
  const [depCtxMenu, setDepCtxMenu] = useState<{
    depId: string
    predId: string
    sucId: string
    tipo: DependenciaTipo
    lag: number
    x: number
    y: number
  } | null>(null)

  // qtd_link: valor ao vivo por tarefa (via template do trecho). Calculado ANTES
  // do CPM pra alimentar a duração com a quantidade REAL — senão o motor usaria
  // o `quantidade_alocada` persistido, que pode estar defasado (ex.: tarefa
  // movida pra range [0,0] mantinha qtd fantasma → duração sem quantidade).
  const trechosComLink = useMemo<string[]>(() => {
    const s = new Set<string>()
    for (const t of tarefas) {
      if (t.qtd_link && t.trecho_id) s.add(t.trecho_id)
    }
    return Array.from(s)
  }, [tarefas])
  const templatesPorTrecho = useTrechosQuantidadeTemplatesAtuais(trechosComLink)
  const qtdLinkValueById = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const t of tarefas) {
      if (!t.qtd_link || !t.trecho_id) continue
      const template = templatesPorTrecho.get(t.trecho_id)
      if (!template) continue // template ainda carregando ou trecho sem template
      const v = computeLinkedQtd(
        {
          qtd_link: t.qtd_link,
          posicao_inicio_m: t.posicao_inicio_m,
          posicao_fim_m: t.posicao_fim_m
        },
        template
      )
      m.set(t.id, v)
    }
    return m
  }, [tarefas, templatesPorTrecho])

  // Tarefas com a qtd_link aplicada em quantidade_alocada (0/null = sem cobertura
  // → tarefa inválida → duração 0). Mantém o persistido só enquanto o template
  // ainda está carregando (valor undefined no mapa).
  const tarefasParaCpm = useMemo<PlanejamentoTarefaCompleta[]>(() => {
    if (qtdLinkValueById.size === 0) return tarefas
    return tarefas.map((t) => {
      if (!t.qtd_link) return t
      const v = qtdLinkValueById.get(t.id)
      if (v === undefined) return t
      return { ...t, quantidade_alocada: v != null && v > 0 ? v : null }
    })
  }, [tarefas, qtdLinkValueById])

  // Motor CPM reativo
  const { cicloIds } = useCpmEngine({
    planejamento: planSelecionado,
    tarefas: tarefasParaCpm,
    calendario,
    excecoes,
    fatoresMes,
    edgeEnabled: !readOnly
  })

  const { tweaks } = useCronogramaTweaks()
  const rowHeight = rowHeightForDensity(tweaks.density)

  // ─── Toast de ciclo ─────────────────────────────────────────────────────
  // Side-effect (toast) precisa rodar em useEffect — chamar toast() direto no
  // corpo atualiza o Toaster durante o render do Shell e gera o warning
  // "Cannot update a component while rendering a different component".
  useEffect(() => {
    if (cicloIds && cicloIds.length > 0) {
      toast.error(
        `Ciclo detectado em ${cicloIds.length} tarefa(s). Remova a dependência cíclica.`,
        { id: `cpm-cycle-${planejamentoId}` }
      )
    }
  }, [cicloIds, planejamentoId])

  // ─── Árvore + flat ──────────────────────────────────────────────────────
  const tree = useMemo(() => buildTaskTree(tarefas), [tarefas])

  // Inicializa expandedIds: na primeira carga, todos os grupos expandidos
  useEffect(() => {
    if (tarefas.length === 0) return
    setExpandedIds((prev) => {
      if (prev.size > 0) return prev
      const next = new Set<string>()
      for (const t of tarefas) {
        if (t.tipo_no === 'grupo') next.add(t.id)
      }
      return next
    })
  }, [tarefas])

  // Pendências filter: mostra só tarefas-folha sem CPU ou sem equipe (e
  // ancestrais delas pra preservar contexto).
  const flatBase = useMemo(() => flattenVisible(tree.tree, expandedIds), [tree.tree, expandedIds])
  const flat: VisibleNode[] = useMemo(() => {
    let base: PlanejamentoTarefaNode[] = flatBase
    if (pendenciasFilterAtivo) {
      const keepIds = new Set<string>()
      for (const n of flatBase) {
        // Indiretas não são "pendência" por não terem CPU/equipe — é o esperado
        // (são tarefas-fantasma que cobrem o cronograma, sem recurso real).
        const isPendencia =
          n.tipo_no === 'tarefa' &&
          !n.is_indireto &&
          (!n.cpu_snapshot_id || (n.equipes ?? []).length === 0)
        if (isPendencia) {
          keepIds.add(n.id)
          // adiciona ancestrais pra contexto
          let cur: PlanejamentoTarefaCompleta | undefined = n
          while (cur && cur.parent_id) {
            keepIds.add(cur.parent_id)
            cur = tarefas.find((x) => x.id === cur!.parent_id)
          }
        }
      }
      base = flatBase.filter((n) => keepIds.has(n.id))
    }
    // Tarefas indiretas SEMPRE ficam no topo do Gantt, antes de qualquer
    // grupo/tarefa direta — refletem cobertura do cronograma inteiro e fazem
    // mais sentido visualmente como "banner" da obra. Partition estável
    // preserva a ordem relativa dentro de cada grupo (indiretas + diretas).
    const indiretas: PlanejamentoTarefaNode[] = []
    const diretas: PlanejamentoTarefaNode[] = []
    for (const n of base) {
      if (n.is_indireto === true) indiretas.push({ ...n, depth: 0 })
      else diretas.push(n)
    }
    const ordenado = [...indiretas, ...diretas]
    return ordenado.map((n) => ({
      ...n,
      depth: n.depth,
      hasChildren: n.children.length > 0
    }))
  }, [flatBase, pendenciasFilterAtivo, tarefas])

  // Mapas auxiliares
  const tarefasById = useMemo(() => {
    const m = new Map<string, PlanejamentoTarefaCompleta>()
    for (const t of tarefas) m.set(t.id, t)
    return m
  }, [tarefas])

  const equipesById = useMemo(() => {
    const m = new Map<string, (typeof equipes)[number]>()
    for (const e of equipes) m.set(e.id, e)
    return m
  }, [equipes])

  const numeroById = useMemo(() => {
    const m = new Map<string, number>()
    flat.forEach((n, i) => m.set(n.id, i + 1))
    return m
  }, [flat])

  // ─── Caminho crítico ────────────────────────────────────────────────────
  const caminhoCriticoIds = useMemo(
    () => tarefas.filter((t) => t.is_critico).map((t) => t.id),
    [tarefas]
  )

  const stats = useMemo(() => {
    let tarefasCount = 0
    let semCpu = 0
    let semEquipe = 0
    let custoTotal = 0
    for (const t of tarefas) {
      if (t.tipo_no === 'tarefa') {
        tarefasCount++
        // Indiretas não são "pendência" — não têm CPU porque sua semântica é
        // de cobertura, não de recurso. Mesmo critério usado no filtro
        // pendências em flat acima.
        if (!t.is_indireto) {
          if (!t.cpu_snapshot_id) semCpu++
          if (!t.equipes || t.equipes.length === 0) semEquipe++
        }
      }
      // Custo total unificado: indireta usa custo_total_calc + custo_taxas_calc
      // (do cache via view v10); direta usa custo_total_tarefa (snap × qtd).
      if (t.is_indireto) {
        custoTotal += Number(t.custo_total_calc ?? 0) + Number(t.custo_taxas_calc ?? 0)
      } else {
        custoTotal += t.custo_total_tarefa ?? 0
      }
    }
    return { tarefasCount, pendencias: semCpu + semEquipe, custoTotal }
  }, [tarefas])

  const dataFimProjeto = useMemo(() => {
    let max: string | null = null
    for (const t of tarefas) {
      if (!t.data_fim) continue
      if (!max || t.data_fim > max) max = t.data_fim
    }
    return max
  }, [tarefas])

  // Preset de escala derivado
  const escalaAtiva: EscalaPreset = useMemo(() => {
    if (pxPerDay >= 22) return 'dia'
    if (pxPerDay >= 5) return 'semana'
    if (pxPerDay >= 1.2) return 'mes'
    return 'ano'
  }, [pxPerDay])

  const scaleLabel = useMemo(() => {
    if (pxPerDay >= 22) return 'Semana / Dia'
    if (pxPerDay >= 5) return 'Mês / Semana'
    return 'Ano / Mês'
  }, [pxPerDay])

  // ─── Commit handlers ────────────────────────────────────────────────────
  const commitField = useCallback(
    async (id: string, patch: Parameters<typeof update.mutateAsync>[0]): Promise<void> => {
      if (!planejamentoId) return
      try {
        await update.mutateAsync({ ...patch, id, planejamento_id: planejamentoId })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Falha ao salvar.')
        throw err
      }
    },
    [planejamentoId, update]
  )

  const ctx: CellContext = useMemo(() => {
    return {
      readOnly,
      numero: 0, // override por linha via GridRow
      trechos,
      tarefasById,
      equipesById,
      numeroById,
      commitNomeCustom: async (id, v) => {
        await commitField(id, { id, planejamento_id: planejamentoId!, nome_custom: v || null })
      },
      commitQuantidade: async (id, v) => {
        await commitField(id, { id, planejamento_id: planejamentoId!, quantidade_alocada: v })
      },
      commitProducao: async (id, v) => {
        // producao_diaria_qtde está no snapshot do CPU — não editável aqui.
        // Mantemos o handler vazio (cell renderiza disabled em readOnly).
        void id
        void v
        toast.info('Produção diária vem da CPU vinculada — edite no orçamento.')
      },
      commitDataInicio: async (id, data) => {
        await commitField(id, {
          id,
          planejamento_id: planejamentoId!,
          data_inicio: data,
          data_inicio_manual: data !== null
        })
      },
      commitDataFim: async (id, data) => {
        // data_fim direto é raro — o motor CPM costuma derivar de data_inicio + dur.
        // Aqui simulamos via update direto pro caso de marcos ou ajustes pontuais.
        await commitField(id, { id, planejamento_id: planejamentoId!, data_inicio: undefined })
        void data
        toast.info('Editar fim diretamente: ajuste a duração ou a data de início.')
      },
      commitPosicao: async (id, field, raw, trechoId) => {
        if (!planejamentoId) return
        const tarefa = tarefas.find((t) => t.id === id)
        const outroField = field === 'posicao_inicio_m' ? 'posicao_fim_m' : 'posicao_inicio_m'
        const outroAtual = tarefa ? Number(tarefa[outroField] ?? NaN) : NaN

        if (raw.trim() === '') {
          await commitField(id, {
            id,
            planejamento_id: planejamentoId,
            posicao_inicio_m: null,
            posicao_fim_m: null
          })
          return
        }

        let metros: number | null = null
        const trecho = trechoId ? trechos.find((t) => t.id === trechoId) : undefined
        if (trecho) {
          const res = parseMarcador(raw, {
            unidade_espaco_padrao: trecho.unidade_espaco_padrao,
            unidade_custom_label: trecho.unidade_custom_label,
            unidade_custom_divisor_m: trecho.unidade_custom_divisor_m,
            marcador_valor_inicial: trecho.marcador_valor_inicial,
            geometry_sentido: trecho.geometry_sentido,
            geometry_comprimento_m: trecho.geometry_comprimento_m
          })
          if (res.metros === null) {
            const motivo =
              res.erro === 'fora-do-trecho'
                ? 'Posição fora dos limites do trecho.'
                : res.erro === 'sentido-invalido'
                  ? trecho.geometry_sentido === 'invertido'
                    ? 'Valor maior que o início do trecho (sentido invertido).'
                    : 'Valor menor que o início do trecho.'
                  : 'Formato inválido.'
            toast.error(motivo)
            throw new Error('invalid')
          }
          metros = res.metros
        } else {
          const num = Number(raw.replace(',', '.'))
          if (!Number.isFinite(num) || num < 0) {
            toast.error('Posição inválida.')
            throw new Error('invalid')
          }
          metros = num
        }

        let posIni: number
        let posFim: number
        if (field === 'posicao_inicio_m') {
          posIni = metros
          posFim = Number.isFinite(outroAtual) && outroAtual >= metros ? outroAtual : metros
        } else {
          posFim = metros
          posIni = Number.isFinite(outroAtual) && outroAtual <= metros ? outroAtual : metros
        }
        await commitField(id, {
          id,
          planejamento_id: planejamentoId,
          posicao_inicio_m: posIni,
          posicao_fim_m: posFim
        })
      },
      commitTrecho: async (id, trechoId) => {
        await commitField(id, { id, planejamento_id: planejamentoId!, trecho_id: trechoId })
      },
      commitQtdLink: async (id, qtdLink) => {
        await commitField(id, { id, planejamento_id: planejamentoId!, qtd_link: qtdLink })
        toast.success(
          qtdLink ? `Vinculado a "${qtdLink}".` : 'Vínculo removido.'
        )
      },
      removerEquipe: (tarefaId, equipeId) => {
        if (!planejamentoId) return
        desalocarEq.mutate({ tarefa_id: tarefaId, equipe_id: equipeId, planejamento_id: planejamentoId })
      },
      removerPredecessora: (depId) => {
        if (!planejamentoId) return
        delDep.mutate({ id: depId, planejamento_id: planejamentoId })
      },
      abrirAddDep: (tarefaId) => setAddDepFor(tarefaId),
      abrirAddEquipe: (tarefaId, rect) => setEquipePopover({ tarefaId, rect }),
      abrirTrecho: (tarefaId, rect) => setTrechoPopover({ tarefaId, rect }),
      abrirPosicao: (tarefaId, field, rect) => setPosicaoPopover({ tarefaId, field, rect }),
      abrirQtdLink: (tarefaId, rect) => setQtdLinkPopover({ tarefaId, rect }),
      abrirNotas: (tarefaId) => setNotasFor(tarefaId)
    }
  }, [
    readOnly,
    trechos,
    tarefasById,
    equipesById,
    numeroById,
    planejamentoId,
    tarefas,
    commitField,
    desalocarEq,
    delDep
  ])

  // CellContext.numero é por-linha — injetado dinamicamente no GridRow via wrapper.
  // Como nossa CellContext é compartilhada, passamos numeroById no ctx e cada
  // NumeroCell lê ctx.numeroById.get(node.id). Atualizar NumeroCell pra ler isso.
  // (Já feito: cells/identificacao-cells.tsx usa ctx.numero — vou injetar via row).
  // Pra economia: lemos numero do mapa via ctx.numeroById no NumeroCell direto.
  // O field ctx.numero do interface vira "número da linha atual" calculado por
  // linha. Mas o GridRow não tem como reescrever ctx por linha facilmente sem
  // novo objeto cada vez. Vou ajustar NumeroCell pra ler numeroById diretamente.

  // ─── Handlers ───────────────────────────────────────────────────────────
  const onSelect = useCallback((id: string, opts?: { add?: boolean }) => {
    setSelectedIds((prev) => {
      if (opts?.add) {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }
      return new Set([id])
    })
  }, [])

  /** Seleção em massa (usado pelo Lasso). */
  const onSelectMany = useCallback((ids: string[], opts?: { add?: boolean }) => {
    setSelectedIds((prev) => {
      const next = opts?.add ? new Set(prev) : new Set<string>()
      for (const id of ids) next.add(id)
      return next
    })
  }, [])

  const onToggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const onContextMenu = useCallback(
    (id: string, x: number, y: number) => {
      setSelectedIds((prev) => (prev.has(id) ? prev : new Set([id])))
      setCtxMenu({ tarefaId: id, x, y })
    },
    []
  )

  // Drag-to-reorder: mousedown no NumeroCell → ghost + detect landing
  const flatRef = useRef(flat)
  flatRef.current = flat
  const gridScrollRef = useRef<HTMLDivElement>(null)
  const ganttScrollRef = useRef<HTMLDivElement>(null)

  // ─── Sync vertical: GanttPane é a ÚNICA barra vertical (master) ──────────
  // O Grid não tem scroll vertical próprio (overflow-y-hidden) e apenas SEGUE o
  // gantt via scrollTop programático. Fluxo one-way = sem feedback loop = sem
  // drift (o sync bidirecional por eventos ocasionalmente dropava um delta e
  // dessincronizava). A roda do mouse sobre o Grid é encaminhada ao gantt
  // (onWheel no wrapper do Grid, abaixo).
  useEffect(() => {
    const grid = gridScrollRef.current
    const gantt = ganttScrollRef.current
    if (!grid || !gantt) return
    const follow = (): void => {
      if (Math.abs(grid.scrollTop - gantt.scrollTop) >= 1) grid.scrollTop = gantt.scrollTop
    }
    gantt.addEventListener('scroll', follow, { passive: true })
    follow() // posição inicial
    return () => gantt.removeEventListener('scroll', follow)
  }, [])

  // Encaminha a rolagem vertical feita sobre o Grid para o gantt (master).
  // deltaX (scroll horizontal) continua no scroll-x próprio do Grid. Sem
  // preventDefault (o wrapper é passivo e o container externo é overflow-hidden,
  // então não há scroll-ancestral pra "vazar").
  const onGridWheel = useCallback((e: React.WheelEvent): void => {
    const gantt = ganttScrollRef.current
    if (!gantt || e.deltaY === 0) return
    gantt.scrollTop += e.deltaY
  }, [])

  // ─── Bounds da timeline ────────────────────────────────────────────────
  const todayDate = useMemo(() => new Date(), [])
  const timelineBounds = useMemo(() => {
    let minS: Date | null = null
    let maxE: Date | null = null
    for (const t of tarefas) {
      if (t.data_inicio) {
        const d = parseISO(t.data_inicio)
        if (!minS || d < minS) minS = d
      }
      if (t.data_fim) {
        const d = parseISO(t.data_fim)
        if (!maxE || d > maxE) maxE = d
      }
    }
    if (planSelecionado?.data_referencia_inicio) {
      const anc = parseISO(planSelecionado.data_referencia_inicio)
      if (!minS || anc < minS) minS = anc
    }
    if (!minS) minS = todayDate
    if (!maxE) maxE = addDaysLocal(minS, 30)
    return {
      origin: addDaysLocal(minS, -7),
      end: addDaysLocal(maxE, 30)
    }
  }, [tarefas, planSelecionado, todayDate])

  // Feriados/exceções não-úteis (BackgroundLayer mostra como shade amarelo)
  const feriados = useMemo(
    () => excecoes.filter((e) => !e.eh_util).map((e) => e.data),
    [excecoes]
  )

  // ─── Drag de barras (move/resize/link) ──────────────────────────────────
  // Map mínimo passado ao hook — só id+datas pra evitar deps pesadas
  const tarefasDateMap = useMemo(() => {
    const m = new Map<
      string,
      { id: string; data_inicio: string | null; data_fim: string | null }
    >()
    for (const t of tarefas) {
      m.set(t.id, { id: t.id, data_inicio: t.data_inicio, data_fim: t.data_fim })
    }
    return m
  }, [tarefas])

  const commitMove = useCallback(
    async (
      updates: Array<{ id: string; data_inicio: string; data_fim: string }>
    ): Promise<void> => {
      if (!planejamentoId) return
      try {
        await Promise.all(
          updates.map((u) =>
            update.mutateAsync({
              id: u.id,
              planejamento_id: planejamentoId,
              data_inicio: u.data_inicio,
              data_inicio_manual: true
            })
          )
        )
        toast.success(
          updates.length === 1 ? 'Datas atualizadas.' : `${updates.length} barras movidas.`
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Falha ao mover.')
      }
    },
    [planejamentoId, update]
  )

  const commitResizeLeft = useCallback(
    async (id: string, novoInicio: string): Promise<void> => {
      if (!planejamentoId) return
      try {
        await update.mutateAsync({
          id,
          planejamento_id: planejamentoId,
          data_inicio: novoInicio,
          data_inicio_manual: true
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Falha ao ajustar início.')
      }
    },
    [planejamentoId, update]
  )

  const commitResizeRight = useCallback(
    async (_id: string, _novoFim: string): Promise<void> => {
      // Edge function calcula data_fim a partir de qtd/prod. Editar data_fim
      // direto não tem efeito persistente (recalc sobrescreve). Avisamos.
      void _id
      void _novoFim
      toast.info(
        'Para alongar uma tarefa, ajuste a quantidade ou produção. data_fim é derivada.'
      )
    },
    []
  )

  const commitLink = useCallback(
    async (predId: string, sucId: string, tipo: DependenciaTipo): Promise<void> => {
      if (!planejamentoId) return
      // Indiretas não aceitam dependência em nenhuma direção — sua duração
      // é derivada do cronograma todo, não de FS/SS/FF.
      const pred = tarefasById.get(predId)
      const suc = tarefasById.get(sucId)
      if (pred?.is_indireto || suc?.is_indireto) {
        toast.error('Tarefas indiretas não aceitam dependências — cobrem o cronograma automaticamente.')
        return
      }
      try {
        await addDep.mutateAsync({
          planejamento_id: planejamentoId,
          predecessora_id: predId,
          sucessora_id: sucId,
          tipo,
          lag_dias: 0
        })
        toast.success(`Dependência ${tipo} criada.`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Falha ao criar dependência.')
      }
    },
    [planejamentoId, addDep, tarefasById]
  )

  const dragApi = useGanttDrag({
    pxPerDay,
    readOnly,
    selectedIds,
    tarefasById: tarefasDateMap,
    onCommitMove: commitMove,
    onCommitResizeLeft: commitResizeLeft,
    onCommitResizeRight: commitResizeRight,
    onCommitLink: commitLink
  })

  // ─── Lasso (rect select no canvas) ──────────────────────────────────────
  const barRectsRef = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(
    new Map()
  )
  const lassoApi = useGanttLasso({
    readOnly,
    barRectsRef,
    onSelectMany,
    onClearSelection: () => setSelectedIds(new Set())
  })

  const onDragRowStart = useCallback(
    (tarefaId: string, e: React.MouseEvent) => {
      if (!planejamentoId || readOnly) return
      e.preventDefault()

      const sourceTarefa = tarefasById.get(tarefaId)
      if (!sourceTarefa) return
      const sourceParentId = sourceTarefa.parent_id

      // Threshold de 5px antes de "ativar" o drag — evita ghost flicker em
      // cliques simples (que devem cair na seleção da linha).
      const THRESHOLD_PX = 5
      const originX = e.clientX
      const originY = e.clientY
      let active = false

      // Walk pra cima a partir de qualquer linha-alvo até achar um irmão do source.
      // Cobre o caso "arrasto o grupo BR-452 e solto numa tarefa-filha de BR-060":
      // o irmão resolvido é BR-060 (raiz, mesmo nível do source), e o source vai
      // pra DEPOIS do subtree inteiro de BR-060 — que é exatamente o que o usuário
      // quer dizer com "deixa o 452 abaixo do 060".
      // Última linha-filha visível: usada como ÂNCORA VISUAL do indicador (cola
      // perto do cursor) mesmo quando o reorder lógico mexe num pai mais alto.
      function lastVisibleDescendantId(siblingId: string): string {
        const flat = flatRef.current
        const startIdx = flat.findIndex((n) => n.id === siblingId)
        if (startIdx < 0) return siblingId
        const siblingDepth = flat[startIdx].depth
        let last = siblingId
        for (let i = startIdx + 1; i < flat.length; i++) {
          if (flat[i].depth <= siblingDepth) break
          last = flat[i].id
        }
        return last
      }

      interface Landing {
        /** Irmão do source onde a inserção realmente acontece (lógica). */
        siblingId: string
        siblingSide: 'top' | 'bottom'
        /** Onde o indicador visual aparece (geralmente colado no cursor). */
        visibleId: string
        visibleSide: 'top' | 'bottom'
      }
      function findLanding(ev: MouseEvent): Landing | null {
        const target = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
        const row = target?.closest('[data-row-id]') as HTMLElement | null
        const id = row?.dataset.rowId
        if (!id || id === tarefaId) return null
        const rect = row!.getBoundingClientRect()
        const rawSide: 'top' | 'bottom' =
          ev.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom'

        // Sobe a árvore até achar um irmão do source. Se chegar na raiz sem
        // achar, é cross-parent inválido (source em grupo A, target em grupo B).
        let curr = tarefasById.get(id)
        let walkedUp = false
        while (curr && curr.parent_id !== sourceParentId) {
          if (!curr.parent_id) return null
          curr = tarefasById.get(curr.parent_id)
          walkedUp = true
        }
        if (!curr) return null

        // Drop direto num irmão: respeita top/bottom como o usuário pediu.
        // Drop num descendente de um irmão: força 'bottom' (= depois do subtree).
        const effectiveSide: 'top' | 'bottom' = walkedUp ? 'bottom' : rawSide

        // Visual: pra side='bottom', cola na ÚLTIMA descendente visível do irmão
        // — assim o indicador fica perto do cursor em vez de "subir" pro irmão
        // quando o usuário está hovering uma linha-filha lá embaixo.
        const visibleId =
          effectiveSide === 'bottom' ? lastVisibleDescendantId(curr.id) : curr.id

        return {
          siblingId: curr.id,
          siblingSide: effectiveSide,
          visibleId,
          visibleSide: effectiveSide
        }
      }

      const onMove = (ev: MouseEvent): void => {
        if (!active) {
          const dx = ev.clientX - originX
          const dy = ev.clientY - originY
          if (Math.hypot(dx, dy) < THRESHOLD_PX) return
          active = true
        }
        const landing = findLanding(ev)
        setDragRow({
          tarefaId,
          ghostX: ev.clientX + 12,
          ghostY: ev.clientY + 12,
          overId: landing?.visibleId ?? null,
          overSide: landing?.visibleSide ?? null
        })
      }
      const onUp = (ev: MouseEvent): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)

        // Click sem drag (não passou do threshold) — limpa state e não commita
        if (!active) {
          setDragRow(null)
          return
        }

        const landing = findLanding(ev)
        setDragRow(null)

        if (!landing) {
          // Drop fora de qualquer drop-zone válido (ex: cross-parent profundo)
          toast.info('Mova só entre irmãos no mesmo nível.')
          return
        }

        // Verifica ciclo defensivo (mesmo parent, deve ser ok)
        const validation = validateMoveTarget(
          sourceTarefa.id,
          sourceTarefa.parent_id,
          tree.byId
        )
        if (validation) {
          toast.error(validation)
          return
        }

        // Reorder entre irmãos. Insere ANTES se siblingSide='top', DEPOIS se 'bottom'.
        const siblings = flatRef.current
          .filter((n) => n.parent_id === sourceTarefa.parent_id && n.id !== sourceTarefa.id)
        const landingIdx = siblings.findIndex((n) => n.id === landing.siblingId)
        if (landingIdx < 0) return

        const insertAt = landing.siblingSide === 'top' ? landingIdx : landingIdx + 1
        const novaOrdem = [
          ...siblings.slice(0, insertAt),
          { id: sourceTarefa.id, parent_id: sourceTarefa.parent_id } as PlanejamentoTarefaNode,
          ...siblings.slice(insertAt)
        ]
        const items = novaOrdem.map((n, i) => ({ id: n.id, ordem: (i + 1) * 10 }))
        reorder.mutate({ planejamento_id: planejamentoId, items })
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [planejamentoId, readOnly, tarefasById, tree.byId, reorder]
  )

  const onPresetZoom = (preset: EscalaPreset): void => {
    const map: Record<EscalaPreset, number> = { dia: 26, semana: 10, mes: 3, ano: 0.8 }
    setPxPerDay(map[preset])
  }

  const onAjustar = useCallback((): void => {
    const el = ganttScrollRef.current
    if (!el) return
    const days = diffDaysLocal(timelineBounds.origin, timelineBounds.end) + 1
    if (days <= 0) return
    const px = Math.max(PX_PER_DAY_MIN, Math.min(PX_PER_DAY_MAX, (el.clientWidth / days) * 0.95))
    setPxPerDay(px)
    el.scrollLeft = 0
  }, [timelineBounds])

  const onHoje = useCallback((): void => {
    const el = ganttScrollRef.current
    if (!el) return
    const x = diffDaysLocal(timelineBounds.origin, todayDate) * pxPerDay
    el.scrollLeft = Math.max(0, x - el.clientWidth / 3)
  }, [timelineBounds, pxPerDay, todayDate])

  const onRecalcular = async (): Promise<void> => {
    if (!planejamentoId) return
    try {
      const r = await calcular.mutateAsync({ planejamento_id: planejamentoId })
      toast.success(
        `Recalculado em ${r.duracao_ms}ms — ${r.tarefas_recalculadas} tarefa(s). Fim: ${fmtDataBR(r.data_fim)}`
      )
      if (r.warning_drift) {
        toast.warning('Algumas datas foram ajustadas pra respeitar a âncora.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao recalcular')
    }
  }

  const onDeleteSelecionadas = useCallback(async () => {
    if (selectedIds.size === 0 || !planejamentoId || readOnly) return
    const ids = Array.from(selectedIds)
    const tarefasSel = ids.map((id) => tarefasById.get(id)).filter((t) => t != null)
    if (tarefasSel.length === 0) return

    const desc =
      tarefasSel.length === 1
        ? (() => {
            const t = tarefasSel[0]!
            const nome = t.nome_custom ?? t.servico_grupo_descricao ?? '(sem nome)'
            const tipo =
              t.tipo_no === 'grupo' ? 'grupo' : t.tipo_no === 'marco' ? 'marco' : 'tarefa'
            return { title: `Excluir ${tipo} "${nome}"?` }
          })()
        : { title: `Excluir ${tarefasSel.length} itens?` }

    const ok = await confirm({
      title: desc.title,
      description: 'Dependências, alocações e perfis vinculados serão removidos.',
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    if (!ok) return

    let okCount = 0
    let errCount = 0
    await Promise.all(
      ids.map(
        (id) =>
          new Promise<void>((resolve) => {
            delTarefa.mutate(
              { id, planejamento_id: planejamentoId },
              {
                onSuccess: () => {
                  okCount++
                  resolve()
                },
                onError: () => {
                  errCount++
                  resolve()
                }
              }
            )
          })
      )
    )
    if (okCount > 0) {
      toast.success(`${okCount} item(ns) excluído(s).`)
      setSelectedIds(new Set())
    }
    if (errCount > 0) {
      toast.error(`${errCount} falha(s) ao excluir.`)
    }
  }, [selectedIds, planejamentoId, readOnly, tarefasById, confirm, delTarefa])

  // ─── Atalhos de teclado ─────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (!target) return
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable)
        return

      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        setPxPerDay((p) => Math.max(PX_PER_DAY_MIN, Math.min(PX_PER_DAY_MAX, p * 1.4)))
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        setPxPerDay((p) => Math.max(PX_PER_DAY_MIN, Math.min(PX_PER_DAY_MAX, p / 1.4)))
      } else if (e.key === '0') {
        e.preventDefault()
        onAjustar()
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        onHoje()
      } else if (e.key === 'Delete') {
        if (selectedIds.size > 0) {
          e.preventDefault()
          void onDeleteSelecionadas()
        }
      } else if (e.key === 'Escape') {
        setCtxMenu(null)
        setBarCtxMenu(null)
        setDepCtxMenu(null)
        setTrechoPopover(null)
        setQtdLinkPopover(null)
        setEquipePopover(null)
        setPosicaoPopover(null)
        setSelectedIds(new Set())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, onDeleteSelecionadas])

  // Persiste splitWidth + columns
  useEffect(() => {
    saveSplitWidth(splitWidth)
  }, [splitWidth])
  useEffect(() => {
    saveGridColumns(cols)
  }, [cols])

  // ─── Render ─────────────────────────────────────────────────────────────
  if (!planAtivo) {
    return (
      <div className="flex flex-col h-full">
        <CronogramaHeader
          obraNome={obraNome}
          planejamentos={[]}
          planejamentoId={null}
          onChangePlanejamento={() => {}}
          pendencias={0}
          pendenciasFilterAtivo={false}
          onTogglePendenciasFilter={() => {}}
          onNovaRevisao={() => setNovoPlanOpen(true)}
          onNovaTarefa={() => {}}
          onRecalcular={() => {}}
          recalculando={false}
          onBaseline={() => {}}
          podeEditar={false}
          isBaseline={false}
        />
        <div className="flex-1 flex items-center justify-center text-text-dim text-sm">
          Nenhuma revisão de planejamento. Crie a primeira para começar.
        </div>
        <NewPlanejamentoDialog
          open={novoPlanOpen}
          onOpenChange={setNovoPlanOpen}
          obraId={obraId}
          onCreated={(id) => setPlanId(id)}
        />
      </div>
    )
  }

  // Tarefa atual pros popovers/dialogs que precisam dela
  const tarefaCtx = findTarefa(trechoPopover?.tarefaId, tarefasById)
  const tarefaQtdLink = findTarefa(qtdLinkPopover?.tarefaId, tarefasById)
  const tarefaEquipe = findTarefa(equipePopover?.tarefaId, tarefasById)
  const tarefaPosicao = findTarefa(posicaoPopover?.tarefaId, tarefasById)
  const tarefaConstraint = findTarefa(constraintPopover?.tarefaId, tarefasById)
  const trechoPosicao = tarefaPosicao
    ? trechos.find((t) => t.id === tarefaPosicao.trecho_id) ?? null
    : null

  return (
    <div className="flex flex-col h-full">
      <CronogramaHeader
        obraNome={obraNome}
        planejamentos={planejamentos}
        planejamentoId={planejamentoId}
        onChangePlanejamento={setPlanId}
        pendencias={stats.pendencias}
        pendenciasFilterAtivo={pendenciasFilterAtivo}
        onTogglePendenciasFilter={() => setPendenciasFilterAtivo((s) => !s)}
        onNovaRevisao={() => setNovoPlanOpen(true)}
        onNovaTarefa={() => setAddOpen(true)}
        onRecalcular={() => {
          void onRecalcular()
        }}
        recalculando={calcular.isPending}
        onBaseline={() => setPromoverOpen(true)}
        podeEditar={!readOnly}
        isBaseline={planSelecionado?.is_baseline ?? false}
        onExportarMsProject={() => setExportMspOpen(true)}
        exportandoMsProject={exportandoMsp}
        onImportarMsProject={() => setImportMspOpen(true)}
      />
      <CronogramaToolbar
        nTarefas={stats.tarefasCount}
        nCriticas={caminhoCriticoIds.length}
        nSelecionadas={selectedIds.size}
        pxPerDay={pxPerDay}
        setPxPerDay={setPxPerDay}
        scaleLabel={scaleLabel}
        escalaAtiva={escalaAtiva}
        onPresetZoom={onPresetZoom}
        onAjustar={onAjustar}
        onHoje={onHoje}
        vizPanelAberto={vizPanelAberto}
        onToggleVizPanel={() => setVizPanelAberto((s) => !s)}
      />

      <div className="flex-1 overflow-hidden relative flex min-h-0">
        {/* Painel esquerdo: Grid de 15 colunas. Sem barra vertical própria —
            a roda do mouse é encaminhada ao gantt (única barra vertical). */}
        <div
          className="shrink-0 flex flex-col bg-bg-panel"
          style={{ width: splitWidth }}
          onWheel={onGridWheel}
        >
          <Grid
            flat={flat}
            cols={cols}
            ctx={ctx}
            rowHeight={rowHeight}
            selectedIds={selectedIds}
            hoverId={hoverId}
            expandedIds={expandedIds}
            qtdLinkValueById={qtdLinkValueById}
            dragOverId={dragRow?.overId ?? null}
            dragOverSide={dragRow?.overSide ?? null}
            onSelect={onSelect}
            onHover={setHoverId}
            onToggleExpand={onToggleExpand}
            onDragRowStart={onDragRowStart}
            onContextMenu={onContextMenu}
            onColResize={onColResize}
            scrollRef={gridScrollRef}
          />
        </div>

        <CronogramaSplitter width={splitWidth} onChange={setSplitWidth} />

        {/* Painel direito: GanttPane (Fase 3) */}
        <div className="flex-1 overflow-hidden min-w-0">
          <GanttPane
            flat={flat}
            origin={timelineBounds.origin}
            end={timelineBounds.end}
            pxPerDay={pxPerDay}
            rowHeight={rowHeight}
            todayDate={todayDate}
            feriados={feriados}
            selectedIds={selectedIds}
            hoverId={hoverId}
            showWeekends={tweaks.showWeekends}
            showLabels={tweaks.showLabels}
            barStyle={tweaks.barStyle}
            depMode={tweaks.depMode}
            colorMode={tweaks.colorMode}
            equipesById={equipesById}
            onHover={setHoverId}
            onSelect={onSelect}
            onContextMenu={(id, x, y) => setBarCtxMenu({ tarefaId: id, x, y })}
            onDepClick={(info) => setDepCtxMenu(info)}
            scrollRef={ganttScrollRef}
            dragApi={dragApi}
            lassoApi={lassoApi}
            barRectsRef={barRectsRef}
          />
        </div>

        {vizPanelAberto && <VisualizacaoPanel onClose={() => setVizPanelAberto(false)} />}
      </div>

      {/* Statusbar */}
      <footer className="flex items-center justify-between gap-4 px-4 h-8 border-t border-border bg-bg-panel text-2xs font-mono">
        <div className="flex items-center gap-3 text-text-dim">
          {planSelecionado?.data_referencia_inicio && (
            <span>
              Âncora:{' '}
              <strong className="text-text">
                {fmtDataBR(planSelecionado.data_referencia_inicio)}
              </strong>
            </span>
          )}
          {dataFimProjeto && (
            <>
              <span>·</span>
              <span>
                Término:{' '}
                <strong className="text-text">{fmtDataBR(dataFimProjeto)}</strong>
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 text-text-dim">
          <span>
            Escala: <strong className="text-text">{scaleLabel}</strong>
          </span>
          <span>·</span>
          <span>
            Zoom: <strong className="text-text">{pxPerDay.toFixed(1)} px/dia</strong>
          </span>
          <span>·</span>
          <span>
            Custo: <strong className="text-accent">{fmtBRL(stats.custoTotal)}</strong>
          </span>
        </div>
      </footer>

      {/* ─── Popovers ─────────────────────────────────────────────────────── */}
      {trechoPopover && tarefaCtx && (
        <TrechoPopover
          anchorRect={trechoPopover.rect}
          trechos={trechos}
          currentTrechoId={tarefaCtx.trecho_id}
          onSelect={(trechoId) => {
            void ctx.commitTrecho(trechoPopover.tarefaId, trechoId)
          }}
          onClose={() => setTrechoPopover(null)}
        />
      )}
      {qtdLinkPopover && tarefaQtdLink && (
        <QtdLinkPopover
          anchorRect={qtdLinkPopover.rect}
          trechoId={tarefaQtdLink.trecho_id}
          currentQtdLink={tarefaQtdLink.qtd_link}
          onSelect={(qtdLink) => {
            void ctx.commitQtdLink(qtdLinkPopover.tarefaId, qtdLink)
          }}
          onClose={() => setQtdLinkPopover(null)}
        />
      )}
      {equipePopover && tarefaEquipe && (
        <AddEquipePopover
          anchorRect={equipePopover.rect}
          equipesDisponiveis={equipes}
          jaAlocadasIds={new Set((tarefaEquipe.equipes ?? []).map((e) => e.id))}
          onSelect={(equipeId) => {
            if (!planejamentoId) return
            alocarEq.mutate({
              tarefa_id: equipePopover.tarefaId,
              equipe_id: equipeId,
              qtd_equipes: 1,
              planejamento_id: planejamentoId
            })
          }}
          onClose={() => setEquipePopover(null)}
        />
      )}
      {posicaoPopover && tarefaPosicao && (
        <PosicaoPopover
          anchorRect={posicaoPopover.rect}
          trecho={trechoPosicao}
          field={posicaoPopover.field}
          currentMetros={
            tarefaPosicao[posicaoPopover.field] != null
              ? Number(tarefaPosicao[posicaoPopover.field])
              : null
          }
          onSelect={(raw) => {
            void ctx.commitPosicao(
              posicaoPopover.tarefaId,
              posicaoPopover.field,
              raw,
              tarefaPosicao.trecho_id
            )
          }}
          onClose={() => setPosicaoPopover(null)}
        />
      )}
      {constraintPopover && tarefaConstraint && planejamentoId && (
        <ConstraintPopover
          anchorRect={constraintPopover.rect}
          currentScheduleMode={tarefaConstraint.schedule_mode ?? 'asap'}
          currentConstraintType={tarefaConstraint.constraint_type}
          currentConstraintDate={tarefaConstraint.constraint_date}
          isMarco={tarefaConstraint.tipo_no === 'marco'}
          onSave={(patch) => {
            update.mutate(
              {
                id: constraintPopover.tarefaId,
                planejamento_id: planejamentoId,
                schedule_mode: patch.schedule_mode,
                constraint_type: patch.constraint_type,
                constraint_date: patch.constraint_date
              },
              {
                onSuccess: () => toast.success('Restrição atualizada.'),
                onError: (err) =>
                  toast.error(err instanceof Error ? err.message : 'Falha ao atualizar restrição.')
              }
            )
          }}
          onClose={() => setConstraintPopover(null)}
        />
      )}

      {/* Context menu de linha */}
      {ctxMenu &&
        createPortal(
          <RowContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            onExcluir={() => {
              setCtxMenu(null)
              void onDeleteSelecionadas()
            }}
            podeEditar={!readOnly}
          />,
          document.body
        )}

      {/* Context menu de barra (GanttPane) */}
      {barCtxMenu && (
        <BarContextMenu
          x={barCtxMenu.x}
          y={barCtxMenu.y}
          tarefaId={barCtxMenu.tarefaId}
          isSelected={selectedIds.has(barCtxMenu.tarefaId)}
          multiSelectionAtiva={selectedIds.size > 1}
          podeEditar={!readOnly}
          onClose={() => setBarCtxMenu(null)}
          onSelectOnly={(id) => setSelectedIds(new Set([id]))}
          onAddToSelection={(id) => {
            setSelectedIds((prev) => new Set(prev).add(id))
          }}
          onRemoveFromSelection={(id) => {
            setSelectedIds((prev) => {
              const n = new Set(prev)
              n.delete(id)
              return n
            })
          }}
          onAddPred={(id) => setAddDepFor(id)}
          onEditConstraint={(id, rect) => setConstraintPopover({ tarefaId: id, rect })}
          onExcluir={() => {
            void onDeleteSelecionadas()
          }}
        />
      )}

      {/* Context menu de seta de dependência */}
      {depCtxMenu && planejamentoId && (
        <DepContextMenu
          x={depCtxMenu.x}
          y={depCtxMenu.y}
          depId={depCtxMenu.depId}
          predNumero={numeroById.get(depCtxMenu.predId)}
          sucNumero={numeroById.get(depCtxMenu.sucId)}
          tipoAtual={depCtxMenu.tipo}
          lagAtual={depCtxMenu.lag}
          podeEditar={!readOnly}
          onClose={() => setDepCtxMenu(null)}
          onChangeTipo={(depId, tipo) => {
            updDep.mutate(
              { id: depId, planejamento_id: planejamentoId, tipo },
              {
                onSuccess: () => toast.success(`Dependência alterada para ${tipo}.`),
                onError: (err) =>
                  toast.error(err instanceof Error ? err.message : 'Falha ao alterar tipo.')
              }
            )
          }}
          onChangeLag={(depId, lag) => {
            updDep.mutate(
              { id: depId, planejamento_id: planejamentoId, lag_dias: lag },
              {
                onSuccess: () =>
                  toast.success(`Lag alterado para ${lag === 0 ? '0d' : `${lag > 0 ? '+' : ''}${lag}d`}.`),
                onError: (err) =>
                  toast.error(err instanceof Error ? err.message : 'Falha ao alterar lag.')
              }
            )
          }}
          onRemover={(depId) => {
            delDep.mutate(
              { id: depId, planejamento_id: planejamentoId },
              {
                onSuccess: () => toast.success('Vínculo removido.'),
                onError: (err) =>
                  toast.error(err instanceof Error ? err.message : 'Falha ao remover vínculo.')
              }
            )
          }}
        />
      )}

      {/* Drag ghost */}
      {dragRow &&
        createPortal(
          <div
            className="fixed z-50 px-2 py-1 rounded bg-bg-elevated border border-accent text-2xs font-mono text-accent pointer-events-none shadow-lg"
            style={{ left: dragRow.ghostX, top: dragRow.ghostY }}
          >
            ↕ {tarefasById.get(dragRow.tarefaId)?.nome_custom ?? '?'}
          </div>,
          document.body
        )}

      {/* Dialogs existentes do app */}
      <ExportarMsProjectDialog
        open={exportMspOpen}
        onOpenChange={setExportMspOpen}
        onConfirm={(incluirRecursos) => void handleExportarMsProject(incluirRecursos)}
        exportando={exportandoMsp}
        recursosCount={recursosInfo.recursos.length}
        tarefasSemComposicao={recursosInfo.tarefasIgnoradas}
      />
      <ImportMsProjectDialog
        open={importMspOpen}
        onOpenChange={setImportMspOpen}
        obraId={obraId}
        onImported={(id) => setPlanId(id)}
      />
      <NewPlanejamentoDialog
        open={novoPlanOpen}
        onOpenChange={setNovoPlanOpen}
        obraId={obraId}
        dataInicioPadrao={planAtivo?.data_referencia_inicio}
        onCreated={(id) => setPlanId(id)}
      />
      <PromoverBaselineDialog
        open={promoverOpen}
        onOpenChange={setPromoverOpen}
        planejamento={planSelecionado}
        obraId={obraId}
      />
      {planejamentoId && (
        <NewTarefaDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          planejamentoId={planejamentoId}
          obraId={obraId}
          tabInicial="tarefa"
          dataPadraoMarco={planSelecionado?.data_referencia_inicio ?? undefined}
        />
      )}
      {addDepFor && planejamentoId && (
        <AddDependenciaDialog
          open={true}
          onOpenChange={(o) => {
            if (!o) setAddDepFor(null)
          }}
          planejamentoId={planejamentoId}
          sucessora={tarefasById.get(addDepFor) ?? null!}
          tarefas={tarefas}
          numeroById={numeroById}
        />
      )}
      <NotasModal
        open={notasFor !== null}
        onOpenChange={(o) => {
          if (!o) setNotasFor(null)
        }}
        tarefa={notasFor ? tarefasById.get(notasFor) ?? null : null}
        readOnly={readOnly}
      />
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function findTarefa(
  id: string | undefined,
  tarefasById: Map<string, PlanejamentoTarefaCompleta>
): PlanejamentoTarefaCompleta | null {
  if (!id) return null
  return tarefasById.get(id) ?? null
}

interface RowContextMenuProps {
  x: number
  y: number
  onClose: () => void
  onExcluir: () => void
  podeEditar: boolean
}
function RowContextMenu({
  x,
  y,
  onClose,
  onExcluir,
  podeEditar
}: RowContextMenuProps): ReactNode {
  useEffect(() => {
    const onDown = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Clamp coords pra não vazar
  const left = Math.min(x, window.innerWidth - 200)
  const top = Math.min(y, window.innerHeight - 80)

  return (
    <div
      className="fixed z-50 min-w-[180px] rounded-md bg-bg-elevated border border-border-strong shadow-lg py-1 text-xs"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onExcluir}
        disabled={!podeEditar}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-danger hover:bg-danger/10 disabled:opacity-40 disabled:cursor-not-allowed text-left"
      >
        <Trash2 size={11} />
        <span>Excluir</span>
        <span className="ml-auto text-text-faint font-mono text-2xs">Del</span>
      </button>
    </div>
  )
}

