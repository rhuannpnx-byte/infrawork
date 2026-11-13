/**
 * Casco das páginas do cronograma (Gantt, tempo-caminho, recursos): o plano escolhido da obra, o estado do cálculo
 * do motor e o rodapé com início, término, prazo e avisos. Sem plano, o convite para criar um.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { PulseBlock } from '@/components/ui/PulseBlock'
import { Button } from '@/components/ui/button'
import { ErroConsulta } from '@/components/ui/estado'
import { FaixaLinhaBase, SeletorPlano } from './planos/PlanosControle'
import { useAuthStore } from '@/stores/auth-store'
import { contar } from '@/lib/rotulos'
import { cn } from '@/lib/utils'
import { usePlanejamentoAtivo, usePlanejamentos } from '@/features/planejamento/hooks/planejamentos'
import { NewPlanejamentoDialog } from '@/features/planejamento/modals/NewPlanejamentoDialog'
import {
  CHAVE_CRONOGRAMA,
  useCalculoCronograma,
  type CalculoCronograma
} from '../hooks/calculo'
import { useCronogramaUi } from '../store'
import { fmtDataLonga } from '../visoes/formato'
import { isoParaSeg } from '../motor/tempo'

export interface ContextoPlano {
  obraId: string
  calc: CalculoCronograma
  somenteLeitura: boolean
  baseline: boolean
}

interface Props {
  obraId: string
  titulo: string
  corpo: (c: ContextoPlano) => ReactNode
}

export function PaginaPlano({ obraId, titulo, corpo }: Props): ReactNode {
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const planoPorObra = useCronogramaUi((s) => s.planoPorObra)
  const escolherPlano = useCronogramaUi((s) => s.escolherPlano)
  const qc = useQueryClient()
  const planosQ = usePlanejamentos(obraId)
  const { data: planos = [], isLoading: carregandoPlanos } = planosQ
  const { data: ativo } = usePlanejamentoAtivo(obraId)
  const escolhido = planoPorObra[obraId]
  const planoId =
    (escolhido && planos.some((p) => p.id === escolhido) ? escolhido : null) ??
    ativo?.id ??
    planos[0]?.id ??
    null
  const plano = planos.find((p) => p.id === planoId) ?? null
  const calc = useCalculoCronograma(planoId)
  const podeGerir = role !== null && role !== 'apoio' && role !== 'cliente'
  const somenteLeitura = !plano || plano.is_baseline || !podeGerir
  const [novoPlano, setNovoPlano] = useState(false)

  if (carregandoPlanos) return <PulseBlock h={480} className="m-4" />
  if (planosQ.error && !planosQ.data)
    return (
      <div className="flex h-full flex-col">
        <PageHeader title={titulo} />
        <ErroConsulta
          className="m-5"
          erro={planosQ.error}
          oQue="os planos da obra"
          aoTentar={() => void planosQ.refetch()}
        />
      </div>
    )
  if (!plano) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title={titulo} />
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon="calendar"
            title="Nenhum plano nesta obra"
            description="Crie um plano para programar as tarefas a partir dos serviços do orçamento."
            action={
              role === 'apoio' || role === 'cliente' ? undefined : (
                <Button onClick={() => setNovoPlano(true)}>Criar plano</Button>
              )
            }
          />
        </div>
        <NewPlanejamentoDialog
          open={novoPlano}
          onOpenChange={setNovoPlano}
          obraId={obraId}
          onCreated={(id) => escolherPlano(obraId, id)}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={titulo}
        actions={
          <div className="flex items-center gap-2">
            <EstadoCalculo calc={calc} />
            <SeletorPlano
              obraId={obraId}
              planos={planos}
              plano={plano}
              podeGerir={podeGerir}
              onEscolher={(id) => escolherPlano(obraId, id)}
            />
          </div>
        }
      />
      {plano.is_baseline ? (
        <FaixaLinhaBase
          obraId={obraId}
          plano={plano}
          planos={planos}
          podeGerir={podeGerir}
          onEscolher={(id) => escolherPlano(obraId, id)}
        />
      ) : null}
      {calc.entrada ? (
        <>
          <div key={plano.id} className="flex min-h-0 flex-1 flex-col">
            {corpo({ obraId, calc, somenteLeitura, baseline: plano.is_baseline })}
          </div>
          <RodapePlano calc={calc} />
        </>
      ) : calc.erro ? (
        <ErroConsulta
          className="m-5"
          erro={calc.erro}
          oQue="o cronograma"
          aoTentar={() => void qc.invalidateQueries({ queryKey: [CHAVE_CRONOGRAMA] })}
        />
      ) : (
        <PulseBlock h={480} className="m-4" />
      )}
    </div>
  )
}

export function EstadoCalculo({ calc }: { calc: CalculoCronograma }): ReactNode {
  if (calc.erro)
    return (
      <span
        className="flex items-center gap-1.5 rounded border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger"
        title={calc.erro.message}
      >
        <AlertTriangle size={12} /> Erro no cálculo
      </span>
    )
  if (calc.carregando || calc.calculando || calc.gravando || calc.previa)
    return (
      <span role="status" className="flex items-center gap-1.5 px-2 py-1 text-xs text-text-muted">
        <Loader2 size={12} className="animate-spin" />
        {calc.gravando ? 'Gravando…' : calc.carregando ? 'Carregando…' : 'Calculando…'}
      </span>
    )
  return (
    <span
      role="status"
      className="flex items-center gap-1.5 px-2 py-1 text-xs text-text-muted"
      title={calc.duracaoMs !== null ? `Cálculo em ${Math.round(calc.duracaoMs)} ms` : undefined}
    >
      <CheckCircle2 size={12} className={calc.gravado ? 'text-success' : 'text-warn'} />
      {calc.gravado ? 'Cronograma em dia' : 'Aguardando gravação'}
    </span>
  )
}

function RodapePlano({ calc }: { calc: CalculoCronograma }): ReactNode {
  const e = calc.entrada!
  const r = calc.resultado
  const nViol = useMemo(
    () => [...(r?.tarefas.values() ?? [])].reduce((s, t) => s + (t.violacoes.length ? 1 : 0), 0),
    [r]
  )
  const fora = useMemo(
    () =>
      e.tarefas.filter((t) => t.tipo_no === 'tarefa' && !t.is_indireto && !r?.tarefas.has(t.id))
        .length,
    [e, r]
  )
  const semProducao = useMemo(
    () => [...(r?.tarefas.values() ?? [])].filter((t) => t.sem_producao).length,
    [r]
  )
  const prazo = e.plano.prazo ? isoParaSeg(e.plano.prazo) : null
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-0.5 border-t border-border bg-bg-panel px-3 py-1 text-xs text-text-dim">
      <span>
        Início <span className="text-text-muted">{fmtDataLonga(isoParaSeg(e.plano.inicio))}</span>
      </span>
      <span>
        Término{' '}
        <span className="text-text-muted">{r?.fimProjeto ? fmtDataLonga(r.fimProjeto) : '—'}</span>
      </span>
      <span>
        Prazo{' '}
        <span
          className={cn(
            'text-text-muted',
            prazo !== null && r?.fimProjeto && r.fimProjeto > prazo + 86400 && 'text-danger'
          )}
        >
          {prazo !== null ? fmtDataLonga(prazo) : 'sem prazo'}
        </span>
      </span>
      <span>{contar(r?.tarefas.size ?? 0, 'tarefa', 'tarefas')} no cálculo</span>
      {nViol ? (
        <span
          className="text-danger"
          title="Tarefas que passam do prazo, de um marco, de uma restrição ou de um atraso máximo"
        >
          ⚑ {nViol} com violação
        </span>
      ) : null}
      {semProducao ? (
        <span className="text-warn" title="Tarefas de serviço sem produção por dia na composição">
          {semProducao} sem produção
        </span>
      ) : null}
      {fora ? (
        <span
          className="text-warn"
          title="Tarefas sem serviço com composição ficam fora do cálculo"
        >
          {fora} fora do cálculo
        </span>
      ) : null}
      <span className="ml-auto">
        {e.plano.modo === 'controle' ? 'Modo controle' : 'Modo programação'}
      </span>
    </div>
  )
}
