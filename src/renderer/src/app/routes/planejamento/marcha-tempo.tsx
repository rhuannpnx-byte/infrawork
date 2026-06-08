import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { EmptyState } from '@/components/layout/EmptyState'
import { PulseBlock } from '@/components/ui/PulseBlock'
import { useCurrentScope } from '@/hooks/useCurrentScope'

// ─── Persistência local: opções globais + trechos por obra ──────────────────

const STORAGE_OPCOES = 'planejamento-marcha-tempo-opcoes-v1'
const STORAGE_TRECHOS = (obraId: string): string =>
  `planejamento-marcha-tempo-trechos-${obraId}`

function carregarOpcoes(fallback: MarchaTempoOpcoes): MarchaTempoOpcoes {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(STORAGE_OPCOES)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<MarchaTempoOpcoes>
    return { ...fallback, ...parsed }
  } catch {
    return fallback
  }
}

function salvarOpcoes(o: MarchaTempoOpcoes): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_OPCOES, JSON.stringify(o))
  } catch {
    /* localStorage cheio ou indisponível — silencioso */
  }
}

function carregarTrechos(obraId: string): string[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_TRECHOS(obraId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : null
  } catch {
    return null
  }
}

function salvarTrechos(obraId: string, ids: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_TRECHOS(obraId), JSON.stringify(ids))
  } catch {
    /* silencioso */
  }
}
import {
  usePlanejamentos,
  usePlanejamentoAtivo,
  useTarefas,
  useDependencias,
  useObraTrechos
} from '@/features/planejamento/hooks'
import {
  useTracosMarchaTempo,
  useTemplatesAtuaisPorTrecho
} from '@/features/planejamento/hooks/marcha-tempo'
import { MarchaTempoMultiTrecho } from '@/features/planejamento/components/marcha-tempo/MarchaTempoMultiTrecho'
import { MarchaTempoOpcoesPopover } from '@/features/planejamento/components/marcha-tempo/MarchaTempoOpcoesPopover'
import { MultiTrechoSelect } from '@/features/planejamento/components/marcha-tempo/MultiTrechoSelect'
import type { MarchaTempoOpcoes } from '@/types/planejamento'

export function PlanejamentoMarchaTempoPage(): ReactNode {
  return (
    <RequireObra pageTitle="Marcha-Tempo">
      <MarchaTempoInner />
    </RequireObra>
  )
}

function MarchaTempoInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const { data: planejamentos = [] } = usePlanejamentos(obraId)
  const { data: planAtivo, isLoading: loadingAtivo } = usePlanejamentoAtivo(obraId)
  const [planId, setPlanId] = useState<string | null>(null)
  const planSel = planId
    ? (planejamentos.find((p) => p.id === planId) ?? planAtivo)
    : planAtivo

  const { data: tarefas = [], isLoading: loadingTarefas } = useTarefas(planSel?.id)
  const { data: dependencias = [] } = useDependencias(planSel?.id)
  const { data: trechos = [] } = useObraTrechos(obraId)

  // Hidrata os trechos selecionados do localStorage SINCRONAMENTE no 1º render
  // — evita o flash "sem trechos / config default" → "filtros do usuário". A
  // validação contra a lista real de trechos roda no efeito abaixo.
  const [trechosSelecionados, setTrechosSelecionados] = useState<string[]>(
    () => carregarTrechos(obraId) ?? []
  )
  const [opcoes, setOpcoes] = useState<MarchaTempoOpcoes>(() =>
    carregarOpcoes({
      eixoXTempo: false,
      geom: 'perfilada',
      granularidadeTempo: 'auto',
      passoPosicaoM: null,
      mostrarMarcos: true,
      mostrarDependencias: false,
      mostrarTodayLine: true,
      mostrarConflitos: true,
      mostrarNaoTrabalhado: true,
      eixosEspelhados: true,
      colunasQuantidade: [],
      estilosSerie: {},
      joinThresholdM: 800
    })
  )
  const [exportRequest, setExportRequest] = useState(0)

  // Persistência: opções globais (salva a cada mudança)
  useEffect(() => {
    salvarOpcoes(opcoes)
  }, [opcoes])

  // Persistência: trechos selecionados por obra
  useEffect(() => {
    if (trechosSelecionados.length === 0) return
    salvarTrechos(obraId, trechosSelecionados)
  }, [obraId, trechosSelecionados])

  // Carrega trechos persistidos quando a obra muda OU quando lista de trechos
  // fica disponível. Filtra IDs que não existem mais na obra (defensivo).
  useEffect(() => {
    if (trechos.length === 0) return
    const armazenados = carregarTrechos(obraId)
    if (armazenados && armazenados.length > 0) {
      const validos = armazenados.filter((id) => trechos.some((t) => t.id === id))
      if (validos.length > 0) {
        setTrechosSelecionados(validos)
        return
      }
    }
    // Fallback: auto-seleciona o primeiro trecho quando nada persistido
    if (trechosSelecionados.length === 0) {
      setTrechosSelecionados([trechos[0].id])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trechos.length, obraId])

  // Templates dos trechos selecionados
  const templatesQuery = useTemplatesAtuaisPorTrecho(trechosSelecionados)
  const templatesPorTrecho = templatesQuery.data ?? new Map()

  const tracos = useTracosMarchaTempo(tarefas, templatesPorTrecho, {
    geom: opcoes.geom,
    trechoIds: trechosSelecionados,
    granularidadeTempo: opcoes.granularidadeTempo,
    joinThresholdM: opcoes.joinThresholdM
  })

  const trechosOpcoes = useMemo(
    () =>
      trechos
        .map((t) => ({ id: t.id, nome: t.nome, ordem: t.ordem }))
        .sort((a, b) => a.ordem - b.ordem),
    [trechos]
  )

  if (!planAtivo) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Marcha-Tempo" subtitle={scope.obra?.nome ?? ''} />
        <div className="flex-1 flex items-center justify-center p-4">
          {loadingAtivo ? (
            <PulseBlock h={460} className="w-full max-w-6xl" />
          ) : (
            <EmptyState
              icon="route"
              title="Sem planejamento ativo"
              description="Crie uma revisão e calcule o cronograma para visualizar a marcha-tempo."
            />
          )}
        </div>
      </div>
    )
  }

  // Enquanto tarefas/templates dos trechos não carregam, a perfilada cairia no
  // fallback "uniforme" e a tela saltaria depois pra versão final. Mostra um
  // skeleton até estar tudo pronto, evitando esse flash de "app bugado".
  const carregando =
    loadingTarefas || (trechosSelecionados.length > 0 && templatesQuery.isLoading)
  const semDados = trechosSelecionados.length === 0 || tracos.length === 0

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Marcha-Tempo"
        subtitle={`${scope.obra?.nome ?? ''}: avanço espacial das frentes ao longo do tempo (TILOS).`}
        actions={
          <div className="flex items-center gap-2">
            <MultiTrechoSelect
              trechos={trechosOpcoes}
              selecionados={trechosSelecionados}
              onChange={setTrechosSelecionados}
            />
            <MarchaTempoOpcoesPopover
              opcoes={opcoes}
              onChangeOpcoes={setOpcoes}
              templatesPorTrecho={templatesPorTrecho}
              trechoRef={
                trechos.find((t) => t.id === trechosSelecionados[0]) ?? null
              }
              onExportPdf={() => setExportRequest((n) => n + 1)}
            />
            <select
              value={planSel?.id ?? ''}
              onChange={(e) => setPlanId(e.target.value)}
              className="bg-bg border border-border rounded px-2 py-1 text-xs font-mono"
            >
              {planejamentos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome} {p.is_baseline ? '★' : ''}
                </option>
              ))}
            </select>
          </div>
        }
      />
      <div className="flex-1 overflow-auto">
        <div className="p-4 space-y-3">
          {carregando ? (
            <PulseBlock h={460} />
          ) : semDados ? (
            <div className="flex items-center justify-center py-12">
              <EmptyState
                icon="route"
                title="Sem trajetórias para exibir"
                description={
                  trechosSelecionados.length === 0
                    ? 'Selecione 1 ou mais trechos no menu Filtros acima.'
                    : 'Nenhuma tarefa com data + posição definida no(s) trecho(s) selecionado(s).'
                }
              />
            </div>
          ) : (
            <MarchaTempoMultiTrecho
              tarefas={tarefas}
              tracos={tracos}
              trechos={trechos}
              trechosSelecionados={trechosSelecionados}
              templatesPorTrecho={templatesPorTrecho}
              dependencias={dependencias}
              dataDate={planSel?.data_date ?? null}
              opcoes={opcoes}
              onChangeOpcoes={setOpcoes}
              exportRequest={exportRequest}
              onExportConsumed={() => {
                /* nada — reaberto pelo next request */
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
