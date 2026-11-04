import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Calendar, Users, Rows3, History, TrendingUp, ArrowRight } from 'lucide-react'
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
        subtitle={`${scope.obra?.nome ?? ''} — cronograma, tempo-caminho, calendários e linha de base.`}
      />
      <div className="flex-1 overflow-auto p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Card
            icon={<Rows3 size={16} />}
            label={ativo && !ativo.is_baseline ? 'Plano em edição' : 'Plano'}
            value={ativo?.nome ?? '—'}
            hint={
              ativo
                ? `Início ${fmtDataBR(ativo.data_referencia_inicio)} · ${ativo.is_baseline ? 'linha de base' : 'em edição'}`
                : 'Crie o primeiro plano'
            }
            onClick={() => navigate({ to: '/planejamento/cronograma' })}
            accent
          />
          <Card
            icon={<History size={16} />}
            label={baseline?.provisoria ? 'Referência provisória' : 'Linha de base vigente'}
            value={baseline?.nome ?? '—'}
            hint={
              baseline
                ? baseline.provisoria
                  ? 'Sem vigente — replanejamento em andamento'
                  : `Vigente desde ${fmtDataBR((baseline.vigente_em ?? baseline.updated_at).slice(0, 10))}`
                : 'Sem linha de base vigente'
            }
            onClick={() => navigate({ to: '/planejamento/comparar' })}
          />
        </div>

        <div className="grid grid-cols-4 gap-3">
          <Card
            icon={<Users size={16} />}
            label="Equipes"
            value={equipes.length.toString()}
            hint={
              Object.entries(tiposEquipe)
                .map(([t, n]) => `${n} ${t.toLowerCase()}`)
                .join(' · ') || 'Sem equipes'
            }
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
            label="Linhas de base"
            value={`${planejamentos.filter((p) => p.is_baseline).length}/20`}
            hint={
              planejamentos.some((p) => !p.is_baseline)
                ? '1 plano em edição'
                : 'Sem plano em edição'
            }
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
              Em <strong>Parametrização</strong>, defina como cada serviço é lançado no campo: por
              quantidade ou por <strong>viagens</strong> (origem e destino; o dia é a soma das
              viagens), se controla <strong>material</strong> (qual e em que unidade), se aceita
              observação e se exige local e estacas.
            </li>
            <li>
              Configure os <strong>calendários</strong> da obra: semana de trabalho, feriados (os
              móveis saem da Páscoa), folgas e horários excepcionais, e o fator de produtividade de
              cada mês (dezembro 0,7 por chuva, por exemplo).
            </li>
            <li>
              Em <strong>Serviços</strong>, confira a produção por dia de cada serviço do orçamento
              (vem da composição) e as equipes que o executam.
            </li>
            <li>
              Em <strong>Locais</strong>, cadastre os eixos (nome, estaca inicial e final — o mapa é
              opcional) e as áreas sem estacas (OAE, jazida, canteiro) e informe as{' '}
              <strong>quantidades por serviço em cada local</strong>: na grade, ou importando a
              planilha (uma aba por local, como no DynaRoad). A soma dos locais respeita o
              orçamento.
            </li>
            <li>
              Crie o <strong>plano em edição</strong> com a data de início da obra.
            </li>
            <li>
              No <strong>cronograma</strong>,{' '}
              <strong>crie as tarefas a partir das quantidades por local</strong> (uma por sequência
              contígua de estacas, por local ou por janela) — ou manualmente, com o local e as
              estacas — e ligue as dependências (arrastando no Gantt ou no tempo-caminho). A tarefa
              é os seus locais: posição, quantidade e a “escada” do tempo-caminho saem deles; divida
              por estaca ou por quantidade, combine e mude de trecho pelo menu da tarefa.
            </li>
            <li>
              Quando aprovar, <strong>trave como linha de base</strong> e torne-a{' '}
              <strong>vigente</strong> — ela vira a régua do acompanhamento e trava o orçamento. No
              modo <strong>controle</strong>, o plano mostra o realizado lançado e a previsão do
              saldo.
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
