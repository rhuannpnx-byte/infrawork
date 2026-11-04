import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ListTree, Briefcase, TrendingUp, ArrowRight } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useLucratividade } from '@/features/orcamento/hooks/lucratividade'
import { usePlanOrc } from '@/features/orcamento/hooks/plan-orc'
import { useIndireto, totalIndireto } from '@/features/orcamento/hooks/indireto'
import { fmtBRL, fmtPct2 } from '@/lib/money'
import { cn } from '@/lib/utils'

export function ObraIndexPage(): ReactNode {
  return (
    <RequireObra pageTitle="Orçamento da obra">
      <ObraDashboard />
    </RequireObra>
  )
}

function ObraDashboard(): ReactNode {
  const scope = useCurrentScope()
  const navigate = useNavigate()
  const obraId = scope.obraId!
  const { data: plan } = usePlanOrc(obraId)
  const { data: indiretos = [] } = useIndireto(obraId)
  const { data: lucr } = useLucratividade(obraId)

  const totalItens = plan?.flat.length ?? 0
  const totalReceitas = (plan?.flat ?? []).filter((i) => i.tipo === 'receita').length
  const indiretoTotal = totalIndireto(indiretos)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={scope.obra?.nome ?? 'Obra'}
        subtitle={`Código ${scope.obra?.codigo ?? '—'} · status: ${scope.obra?.status ?? '—'}`}
      />
      <div className="flex-1 overflow-auto p-5 space-y-4">
        <div className="grid grid-cols-4 gap-3">
          <Card
            icon={<ListTree size={16} />}
            label="Itens da planilha"
            value={totalItens.toString()}
            hint={`${totalReceitas} receita(s)`}
            onClick={() => navigate({ to: '/orcamento/obra/plan-orc' })}
          />
          <Card
            icon={<Briefcase size={16} />}
            label="Indireto total"
            value={fmtBRL(indiretoTotal)}
            hint={`${indiretos.length} lançamento(s)`}
            onClick={() => navigate({ to: '/orcamento/obra/indireto' })}
          />
          <Card
            icon={<TrendingUp size={16} />}
            label="Venda total"
            value={fmtBRL(lucr?.venda_total ?? 0)}
            hint="Soma das receitas"
            onClick={() => navigate({ to: '/orcamento/obra/lucratividade' })}
          />
          <Card
            icon={<TrendingUp size={16} />}
            label="Lucratividade"
            value={
              lucr?.margem_perc !== null && lucr?.margem_perc !== undefined
                ? fmtPct2(lucr.margem_perc)
                : '—'
            }
            hint={lucr ? fmtBRL(lucr.lucro_liquido) : '—'}
            onClick={() => navigate({ to: '/orcamento/obra/lucratividade' })}
            tone={
              lucr && lucr.lucro_liquido < 0
                ? 'danger'
                : lucr && (lucr.margem_perc ?? 0) < 0.1
                  ? 'warn'
                  : 'success'
            }
          />
        </div>

        <div className="rounded border border-border bg-bg-panel p-4">
          <h3 className="text-sm font-semibold text-text mb-2">Próximas ações</h3>
          <ul className="text-xs text-text-muted leading-relaxed space-y-1 list-disc list-inside">
            <li>
              Construa a <strong>Planilha Orçamentária</strong> com índices + receitas; depois
              selecione receitas e agrupe como serviço (vincula CPU).
            </li>
            <li>
              Lance os <strong>custos indiretos</strong> (mobilização, admin local, etc).
            </li>
            <li>
              Consulte a <strong>lucratividade global</strong> consolidada.
            </li>
          </ul>
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
  tone
}: {
  icon: ReactNode
  label: string
  value: string
  hint?: string
  onClick: () => void
  tone?: 'success' | 'warn' | 'danger'
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group text-left rounded border bg-bg-panel p-4 transition-colors',
        tone === 'danger'
          ? 'border-danger/40 hover:border-danger'
          : tone === 'warn'
            ? 'border-warn/40 hover:border-warn'
            : tone === 'success'
              ? 'border-success/40 hover:border-success'
              : 'border-border hover:border-border-accent hover:bg-bg-hover'
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
      {tone === 'danger' ? (
        <Badge variant="danger" className="mt-2">
          prejuízo
        </Badge>
      ) : null}
      {tone === 'warn' ? (
        <Badge variant="warn" className="mt-2">
          margem baixa
        </Badge>
      ) : null}
    </button>
  )
}
