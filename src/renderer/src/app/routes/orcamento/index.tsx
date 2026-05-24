import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Package, ListTree, Calculator, Percent, ArrowRight, Briefcase } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useUIStore } from '@/stores/ui-store'
import { useRecursos } from '@/features/orcamento/hooks/recursos'
import { useServicos } from '@/features/orcamento/hooks/servicos'
import { useCpus } from '@/features/orcamento/hooks/cpus'
import { useTaxas } from '@/features/orcamento/hooks/taxas'
import { cn } from '@/lib/utils'

export function OrcamentoIndex(): ReactNode {
  const navigate = useNavigate()
  const scope = useCurrentScope()
  const openModal = useUIStore((s) => s.openModal)

  const obraId = scope.obraId
  const { data: recursos = [] } = useRecursos(obraId)
  const { data: servicos = [] } = useServicos(obraId)
  const { data: cpus = [] } = useCpus(obraId)
  const { data: taxas = [] } = useTaxas(obraId)

  if (!obraId) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Orçamento" />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="briefcase"
            title="Selecione uma obra"
            description="Tudo no módulo de orçamento é por obra. Recursos, serviços, CPUs, planilha orçamentária e revisões são isolados por obra."
            action={
              <Button variant="default" size="sm" onClick={() => openModal('projectSwitcher')}>
                <Briefcase size={11} /> Selecionar obra
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  const servicosFolha = servicos.filter((s) => s.unidade !== null).length
  const servicosAgr = servicos.length - servicosFolha

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Orçamento"
        subtitle={`${scope.obra?.nome ?? ''} — catálogos da obra (vedados entre obras).`}
      />
      <div className="flex-1 overflow-auto p-5 space-y-4">
        <div className="grid grid-cols-4 gap-3">
          <Card
            icon={<Package size={16} />}
            label="Recursos"
            value={recursos.length.toString()}
            hint="insumos cadastrados"
            onClick={() => navigate({ to: '/orcamento/recursos' })}
          />
          <Card
            icon={<ListTree size={16} />}
            label="Serviços"
            value={servicos.length.toString()}
            hint={`${servicosFolha} folhas · ${servicosAgr} agrup.`}
            onClick={() => navigate({ to: '/orcamento/servicos' })}
          />
          <Card
            icon={<Calculator size={16} />}
            label="CPUs vigentes"
            value={cpus.length.toString()}
            hint="composições ativas"
            onClick={() => navigate({ to: '/orcamento/cpus' })}
          />
          <Card
            icon={<Percent size={16} />}
            label="Taxas"
            value={taxas.length.toString()}
            hint="impostos sobre receita"
            onClick={() => navigate({ to: '/orcamento/taxas' })}
          />
        </div>

        <div className="rounded border border-border bg-bg-panel p-4">
          <h3 className="text-sm font-semibold text-text mb-2">Próximos passos</h3>
          <p className="text-xs text-text-muted leading-relaxed">
            Cadastre Recursos → monte Serviços → crie CPUs. Depois vá em{' '}
            <strong>Planilha Orçamentária</strong> e selecione receitas para agrupar como serviço
            (vincula CPU).
          </p>
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
  onClick
}: {
  icon: ReactNode
  label: string
  value: string
  hint?: string
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group text-left rounded border border-border bg-bg-panel p-4 transition-colors',
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
      <div className="text-2xl font-semibold text-text font-mono">{value}</div>
      {hint ? <div className="text-2xs text-text-muted font-mono mt-1">{hint}</div> : null}
    </button>
  )
}
