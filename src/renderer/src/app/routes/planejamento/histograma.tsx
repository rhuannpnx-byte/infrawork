import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { FileSpreadsheet } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { EmptyState } from '@/components/layout/EmptyState'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import {
  usePlanejamentos,
  usePlanejamentoAtivo,
  useTarefas,
  useComposicoesVigentes,
  useCalendario
} from '@/features/planejamento/hooks'
import { calcularHistogramaRecursos } from '@/features/planejamento/lib/histograma-recursos'
import type { UnidadeTempo } from '@/features/planejamento/lib/histograma-recursos'
import { gerarHistogramaRecursosXlsx } from '@/features/planejamento/lib/histograma-recursos-xlsx'
import { HistogramaRecursosChart } from '@/features/planejamento/components/HistogramaRecursosChart'
import { cn } from '@/lib/utils'

export function PlanejamentoHistogramaPage(): ReactNode {
  return (
    <RequireObra pageTitle="Histograma planejado">
      <HistogramaInner />
    </RequireObra>
  )
}

function HistogramaInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const { data: planejamentos = [] } = usePlanejamentos(obraId)
  const { data: planAtivo } = usePlanejamentoAtivo(obraId)

  const [planId, setPlanId] = useState<string | null>(null)
  const planSel = planId ? planejamentos.find((p) => p.id === planId) ?? planAtivo : planAtivo

  const { data: tarefas = [] } = useTarefas(planSel?.id)

  // O histograma SEMPRE usa a composição da CPU vigente (atual) — acompanha
  // qualquer edição. O snapshot por revisão fica como histórico (não é a fonte).
  const servicoIds = useMemo(
    () =>
      Array.from(
        new Set(
          tarefas
            .filter((t) => t.tipo_no === 'tarefa' && !t.is_indireto && t.servico_id)
            .map((t) => t.servico_id as string)
        )
      ),
    [tarefas]
  )
  const { data: vigentes } = useComposicoesVigentes(obraId, servicoIds)
  const { data: calendario } = useCalendario(obraId)
  const bitmask = calendario?.dias_uteis_bitmask ?? 63

  const [unidadeTempo, setUnidadeTempo] = useState<UnidadeTempo>('recursos')

  const result = useMemo(
    () =>
      calcularHistogramaRecursos(tarefas, new Map(), {
        unidadeTempo,
        bitmask,
        resolver: (t) => (t.servico_id ? vigentes?.get(t.servico_id) ?? null : null)
      }),
    [tarefas, vigentes, unidadeTempo, bitmask]
  )

  const [exporting, setExporting] = useState(false)
  const exportar = async (): Promise<void> => {
    if (result.recursos.length === 0) return
    setExporting(true)
    try {
      const blob = await gerarHistogramaRecursosXlsx({
        obraNome: scope.obra?.nome ?? '',
        planoNome: planSel?.nome ?? '',
        unidadeTempo,
        semanas: result.semanas,
        recursos: result.recursos
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Histograma planejado - ${scope.obra?.nome ?? 'obra'}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
      toast.success('Histograma exportado.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao exportar.')
    } finally {
      setExporting(false)
    }
  }

  if (!planAtivo) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Histograma planejado" subtitle={scope.obra?.nome ?? ''} />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="bar-chart-3"
            title="Sem planejamento ativo"
            description="Crie uma revisão e calcule o cronograma para visualizar o histograma de recursos."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Histograma planejado"
        subtitle={`${scope.obra?.nome ?? ''}: demanda de recursos por semana, conforme o cronograma.`}
        actions={
          <div className="flex items-center gap-2">
            <div
              className="inline-flex rounded border border-border overflow-hidden"
              title="Métrica de MO e Equipamentos"
            >
              {(['recursos', 'dias', 'horas'] as UnidadeTempo[]).map((u) => (
                <button
                  key={u}
                  onClick={() => setUnidadeTempo(u)}
                  className={cn(
                    'px-2.5 py-1 text-2xs font-mono transition-colors',
                    u === unidadeTempo
                      ? 'bg-accent text-white'
                      : 'bg-bg-panel text-text-dim hover:text-text'
                  )}
                >
                  {u === 'recursos' ? 'Recursos' : u === 'dias' ? 'Dias' : 'Horas'}
                </button>
              ))}
            </div>
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
            <button
              onClick={exportar}
              disabled={exporting || result.recursos.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-border text-2xs font-mono text-text-muted hover:text-text hover:bg-bg-hover disabled:opacity-50"
            >
              <FileSpreadsheet size={12} /> {exporting ? 'Exportando…' : 'Exportar Excel'}
            </button>
          </div>
        }
      />
      <div className="flex-1 min-h-0 flex flex-col p-4 gap-4">
        <div className="flex-1 min-h-0">
          <HistogramaRecursosChart result={result} unidadeTempo={unidadeTempo} height={340} />
        </div>
      </div>
    </div>
  )
}
