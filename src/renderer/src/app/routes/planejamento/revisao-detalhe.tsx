import { useState, type ReactNode } from 'react'
import { useParams } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { EmptyState } from '@/components/layout/EmptyState'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { usePlanejamentos, useTarefas, useEquipes } from '@/features/planejamento/hooks'
import { GanttChart } from '@/features/planejamento/components/GanttChart'
import { TarefaDetailPanel } from '@/features/planejamento/components/TarefaDetailPanel'
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import { STATUS_LABEL } from '@/types/planejamento'

export function PlanejamentoRevisaoDetalhePage(): ReactNode {
  return (
    <RequireObra pageTitle="Revisão">
      <RevisaoInner />
    </RequireObra>
  )
}

function RevisaoInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const { id } = useParams({ from: '/planejamento/revisoes/$id' })

  const { data: planejamentos = [] } = usePlanejamentos(obraId)
  const plan = planejamentos.find((p) => p.id === id)
  const { data: tarefas = [] } = useTarefas(id)
  const { data: equipes = [] } = useEquipes(obraId)
  const [selId, setSelId] = useState<string | null>(null)
  const tarefa = tarefas.find((t) => t.id === selId) ?? null

  if (!plan) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Revisão" subtitle={scope.obra?.nome ?? ''} />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="history"
            title="Revisão não encontrada"
            description="A revisão pode ter sido excluída ou você não tem permissão."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={plan.nome}
        subtitle={`${scope.obra?.nome ?? ''} — ${STATUS_LABEL[plan.status]}${plan.is_baseline ? ' · ★ Linha de Base' : ''} · Início ${fmtDataBR(plan.data_referencia_inicio)} (somente leitura)`}
      />
      <div className="flex-1 overflow-hidden">
        <GanttChart
          tarefas={tarefas}
          selectedId={selId}
          onSelect={setSelId}
          readOnly
          dataReferencia={plan.data_referencia_inicio}
        />
      </div>

      <TarefaDetailPanel
        open={!!tarefa}
        onOpenChange={(o) => !o && setSelId(null)}
        tarefa={tarefa}
        tarefas={tarefas}
        equipes={equipes}
        readOnly
        onAddDependencia={() => {}}
      />
    </div>
  )
}
