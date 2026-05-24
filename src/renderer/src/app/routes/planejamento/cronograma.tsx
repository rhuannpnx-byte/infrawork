import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Plus, RefreshCw, Star, Shuffle, AlertCircle } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { RequireObra } from '@/components/layout/RequireObra'
import { Button } from '@/components/ui/button'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { fmtBRL } from '@/lib/money'
import {
  usePlanejamentos,
  usePlanejamentoAtivo,
  useTarefas,
  useEquipes,
  useCalcularCronograma,
  useSincronizarComOrcamento
} from '@/features/planejamento/hooks'
import { GanttChart } from '@/features/planejamento/components/GanttChart'
import { TarefaDetailPanel } from '@/features/planejamento/components/TarefaDetailPanel'
import { NewPlanejamentoDialog } from '@/features/planejamento/modals/NewPlanejamentoDialog'
import { PromoverBaselineDialog } from '@/features/planejamento/modals/PromoverBaselineDialog'
import { AddDependenciaDialog } from '@/features/planejamento/modals/AddDependenciaDialog'
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import type { PlanejamentoTarefaCompleta } from '@/types/planejamento'

export function PlanejamentoCronogramaPage(): ReactNode {
  return (
    <RequireObra pageTitle="Cronograma">
      <CronogramaInner />
    </RequireObra>
  )
}

function CronogramaInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const isApoio = role === 'apoio'

  const { data: planejamentos = [] } = usePlanejamentos(obraId)
  const { data: planAtivo } = usePlanejamentoAtivo(obraId)
  const [planId, setPlanId] = useState<string | null>(null)
  const planejamentoId = planId ?? planAtivo?.id ?? null
  const planSelecionado = planejamentos.find((p) => p.id === planejamentoId) ?? null
  const readOnly = isApoio || !!planSelecionado?.is_baseline

  const { data: tarefas = [] } = useTarefas(planejamentoId)
  const { data: equipes = [] } = useEquipes(obraId)
  const calcular = useCalcularCronograma()
  const sincronizar = useSincronizarComOrcamento()

  const [selectedTarefaId, setSelectedTarefaId] = useState<string | null>(null)
  const [novoPlanOpen, setNovoPlanOpen] = useState(false)
  const [promoverOpen, setPromoverOpen] = useState(false)
  const [addDepOpen, setAddDepOpen] = useState(false)
  const [caminhoCritico, setCaminhoCritico] = useState<string[]>([])

  const tarefaSelecionada = useMemo<PlanejamentoTarefaCompleta | null>(() => {
    return tarefas.find((t) => t.id === selectedTarefaId) ?? null
  }, [tarefas, selectedTarefaId])

  const totalCusto = tarefas.reduce((acc, t) => acc + (t.custo_total_tarefa ?? 0), 0)
  const semCpu = tarefas.filter((t) => !t.cpu_snapshot_id).length
  const semEquipe = tarefas.filter((t) => t.equipes.length === 0).length

  if (!planAtivo) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Cronograma" subtitle={scope.obra?.nome ?? ''} />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="gantt-chart"
            title="Nenhuma revisão de planejamento"
            description="Crie a primeira revisão para começar a planejar esta obra."
            action={
              !isApoio ? (
                <Button variant="default" size="sm" onClick={() => setNovoPlanOpen(true)}>
                  <Plus size={11} /> Nova revisão
                </Button>
              ) : undefined
            }
          />
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

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Cronograma"
        subtitle={`${scope.obra?.nome ?? ''} — ${planSelecionado?.nome ?? planAtivo.nome}${readOnly && planSelecionado?.is_baseline ? ' (baseline imutável)' : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={planejamentoId ?? ''}
              onChange={(e) => setPlanId(e.target.value)}
              className="bg-bg border border-border rounded px-2 py-1 text-xs font-mono"
            >
              {planejamentos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome} {p.is_baseline ? '★' : ''}
                </option>
              ))}
            </select>
            {!isApoio ? (
              <Button size="sm" variant="ghost" onClick={() => setNovoPlanOpen(true)}>
                <Plus size={11} /> Nova revisão
              </Button>
            ) : null}
            {!readOnly && planejamentoId ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      const r = await sincronizar.mutateAsync({
                        planejamento_id: planejamentoId,
                        obra_id: obraId
                      })
                      toast.success(
                        `${r.criadas} tarefa(s) criada(s); ${r.ja_existentes} já existiam.`
                      )
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Falha ao sincronizar')
                    }
                  }}
                  disabled={sincronizar.isPending}
                >
                  <Shuffle size={11} /> Sincronizar com orçamento
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={async () => {
                    try {
                      const r = await calcular.mutateAsync({ planejamento_id: planejamentoId })
                      setCaminhoCritico(r.caminho_critico_ids)
                      toast.success(
                        `Recalculado em ${r.duracao_ms}ms — ${r.tarefas_recalculadas} tarefa(s). Fim: ${fmtDataBR(r.data_fim)}`
                      )
                      if (r.warning_drift) {
                        toast.warning('Algumas datas foram ajustadas pra respeitar a âncora.')
                      }
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Falha ao recalcular')
                    }
                  }}
                  disabled={calcular.isPending}
                >
                  <RefreshCw size={11} /> {calcular.isPending ? 'Calculando…' : 'Recalcular'}
                </Button>
                {!planSelecionado?.is_baseline ? (
                  <Button size="sm" variant="ghost" onClick={() => setPromoverOpen(true)}>
                    <Star size={11} /> Baseline
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        }
      />

      {(semCpu > 0 || semEquipe > 0) && !readOnly ? (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-xs font-mono flex items-center gap-3">
          <AlertCircle size={12} className="text-amber-400" />
          {semCpu > 0 ? (
            <span className="text-amber-300">{semCpu} tarefa(s) sem CPU vinculada.</span>
          ) : null}
          {semEquipe > 0 ? (
            <span className="text-amber-300">{semEquipe} tarefa(s) sem equipe alocada.</span>
          ) : null}
          <span className="text-text-dim">— precisam ser resolvidas antes do cálculo.</span>
        </div>
      ) : null}

      <div className="flex-1 overflow-hidden">
        {tarefas.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              icon="gantt-chart"
              title="Sem tarefas neste planejamento"
              description="Clique em 'Sincronizar com orçamento' para criar uma tarefa por servico_grupo (item azul) do Plan_Orc."
              action={
                !readOnly ? (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={async () => {
                      const r = await sincronizar.mutateAsync({
                        planejamento_id: planejamentoId!,
                        obra_id: obraId
                      })
                      toast.success(`${r.criadas} tarefa(s) criada(s).`)
                    }}
                  >
                    <Shuffle size={11} /> Sincronizar agora
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <GanttChart
            tarefas={tarefas}
            caminhoCriticoIds={caminhoCritico}
            selectedId={selectedTarefaId}
            onSelect={setSelectedTarefaId}
            readOnly={readOnly}
            dataReferencia={planSelecionado?.data_referencia_inicio ?? null}
          />
        )}
      </div>

      <div className="px-4 py-2 border-t border-border bg-bg-panel flex items-center justify-between text-2xs font-mono">
        <div className="flex items-center gap-4 text-text-dim">
          <span>
            <strong className="text-text">{tarefas.length}</strong> tarefas
          </span>
          {caminhoCritico.length > 0 ? (
            <span className="text-red-400">{caminhoCritico.length} crítica(s)</span>
          ) : null}
          {planSelecionado?.data_referencia_inicio ? (
            <span>
              Âncora: <strong className="text-text">{fmtDataBR(planSelecionado.data_referencia_inicio)}</strong>
            </span>
          ) : null}
        </div>
        <div className="text-text-dim">
          Custo total (orçamento):{' '}
          <strong className="text-accent">{fmtBRL(totalCusto)}</strong>
        </div>
      </div>

      <TarefaDetailPanel
        open={!!tarefaSelecionada}
        onOpenChange={(o) => !o && setSelectedTarefaId(null)}
        tarefa={tarefaSelecionada}
        tarefas={tarefas}
        equipes={equipes}
        readOnly={readOnly}
        onAddDependencia={() => setAddDepOpen(true)}
      />

      {planejamentoId && tarefaSelecionada ? (
        <AddDependenciaDialog
          open={addDepOpen}
          onOpenChange={setAddDepOpen}
          planejamentoId={planejamentoId}
          sucessora={tarefaSelecionada}
          tarefas={tarefas}
        />
      ) : null}

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
    </div>
  )
}
