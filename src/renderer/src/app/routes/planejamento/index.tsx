import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Calendar, Users, GanttChart, History, TrendingUp, ArrowRight } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { cn } from '@/lib/utils'
import {
  useEquipes,
  usePlanejamentos,
  usePlanejamentoAtivo,
  useBaseline
} from '@/features/planejamento/hooks'
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import { STATUS_LABEL } from '@/types/planejamento'

export function PlanejamentoIndex(): ReactNode {
  return (
    <RequireObra pageTitle="Planejamento">
      <PlanejamentoIndexInner />
    </RequireObra>
  )
}

function PlanejamentoIndexInner(): ReactNode {
  const navigate = useNavigate()
  const scope = useCurrentScope()
  const obraId = scope.obraId!

  const { data: equipes = [] } = useEquipes(obraId)
  const { data: planejamentos = [] } = usePlanejamentos(obraId)
  const { data: ativo } = usePlanejamentoAtivo(obraId)
  const { data: baseline } = useBaseline(obraId)

  const tiposEquipe = equipes.reduce<Record<string, number>>((acc, e) => {
    acc[e.tipo] = (acc[e.tipo] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Planejamento"
        subtitle={`${scope.obra?.nome ?? ''} — cronograma físico, equipes, calendário e linha de base.`}
      />
      <div className="flex-1 overflow-auto p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Card
            icon={<GanttChart size={16} />}
            label="Revisão ativa"
            value={ativo?.nome ?? '—'}
            hint={
              ativo
                ? `Início ${fmtDataBR(ativo.data_referencia_inicio)} · ${STATUS_LABEL[ativo.status]}`
                : 'Crie a primeira revisão'
            }
            onClick={() => navigate({ to: '/planejamento/cronograma' })}
            accent
          />
          <Card
            icon={<History size={16} />}
            label="Linha de base"
            value={baseline?.nome ?? '—'}
            hint={baseline ? `Promovida em ${fmtDataBR(baseline.updated_at.slice(0, 10))}` : 'Sem baseline'}
            onClick={() => navigate({ to: '/planejamento/comparar' })}
          />
        </div>

        <div className="grid grid-cols-4 gap-3">
          <Card
            icon={<Users size={16} />}
            label="Equipes"
            value={equipes.length.toString()}
            hint={Object.entries(tiposEquipe)
              .map(([t, n]) => `${n} ${t.toLowerCase()}`)
              .join(' · ') || 'Sem equipes'}
            onClick={() => navigate({ to: '/planejamento/equipes' })}
          />
          <Card
            icon={<Calendar size={16} />}
            label="Calendário"
            value="Config"
            hint="Dias úteis, feriados, fator mensal"
            onClick={() => navigate({ to: '/planejamento/calendario' })}
          />
          <Card
            icon={<History size={16} />}
            label="Revisões"
            value={planejamentos.length.toString()}
            hint={`${planejamentos.filter((p) => p.status === 'arquivado').length} arquivadas`}
            onClick={() => navigate({ to: '/planejamento/revisoes' })}
          />
          <Card
            icon={<TrendingUp size={16} />}
            label="Curva-S"
            value="Físico"
            hint="Avanço acumulado planejado"
            onClick={() => navigate({ to: '/planejamento/curva-s' })}
          />
        </div>

        <div className="rounded border border-border bg-bg-panel p-4">
          <h3 className="text-sm font-semibold text-text mb-2">Como começar</h3>
          <ol className="text-xs text-text-muted leading-relaxed list-decimal pl-5 space-y-1">
            <li>
              Cadastre as <strong>equipes</strong> de campo (Pavimentação, Terraplanagem, etc).
            </li>
            <li>
              Configure o <strong>calendário</strong>: dias úteis, feriados nacionais (botão importa em
              lote) e fator de produtividade mensal (dezembro 0.7 por chuva, por exemplo).
            </li>
            <li>
              Crie a primeira <strong>revisão</strong> com data de início da obra. Use "Sincronizar com
              orçamento" pra puxar todos os agrupadores azuis (servico_grupo) como tarefas.
            </li>
            <li>
              No <strong>cronograma</strong>: aloque equipes em cada tarefa, adicione dependências
              entre tarefas e clique em <em>Recalcular</em>.
            </li>
            <li>
              Quando aprovar, <strong>promova a baseline</strong>. Replanejamentos posteriores devem ser
              feitos copiando a baseline em nova revisão.
            </li>
          </ol>
        </div>
      </div>
    </div>
  )
}

function Card({
  icon,
  label,
  value,
  hint,
  onClick,
  accent
}: {
  icon: ReactNode
  label: string
  value: string
  hint?: string
  onClick: () => void
  accent?: boolean
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group text-left rounded border bg-bg-panel p-4 transition-colors',
        accent ? 'border-accent/40' : 'border-border',
        'hover:border-border-accent hover:bg-bg-hover'
      )}
    >
      <div className="flex items-center justify-between text-text-dim mb-2">
        <div className="flex items-center gap-2 text-2xs font-mono uppercase tracking-wider">
          {icon}
          {label}
        </div>
        <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className={cn('text-2xl font-semibold font-mono', accent ? 'text-accent' : 'text-text')}>
        {value}
      </div>
      {hint ? <div className="text-2xs text-text-muted font-mono mt-1">{hint}</div> : null}
    </button>
  )
}
