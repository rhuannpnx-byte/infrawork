import { type ReactNode } from 'react'
import { TrendingUp, TrendingDown, DollarSign, Briefcase, Receipt } from 'lucide-react'
import { fmtBRL, fmtPct2 } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { LucratividadeResumo } from '@/types/orcamento'

interface Props {
  data: LucratividadeResumo
}

export function LucratividadeCards({ data }: Props): ReactNode {
  const lucroNegativo = data.lucro_liquido < 0
  return (
    <div className="grid grid-cols-5 gap-3">
      <Card
        icon={<DollarSign size={14} />}
        label="Venda Total"
        value={fmtBRL(data.venda_total)}
        tone="accent"
      />
      <Card
        icon={<Briefcase size={14} />}
        label="Custo Direto"
        value={fmtBRL(data.custo_direto)}
        hint="grupos de serviço (sem indiretos)"
      />
      <Card
        icon={<Briefcase size={14} />}
        label="Custo Indireto"
        value={fmtBRL(data.custo_indireto)}
        hint={
          data.custo_indireto_vinculado > 0
            ? `${fmtBRL(data.custo_indireto_vinculado)} via planilha + ${fmtBRL(data.custo_indireto_standalone)} standalone`
            : 'mobiliz., admin etc'
        }
      />
      <Card
        icon={<Receipt size={14} />}
        label="Impostos"
        value={fmtBRL(data.impostos)}
        hint={`${fmtPct2(data.aliquota_total_perc)} sobre venda`}
      />
      <Card
        icon={lucroNegativo ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
        label="Lucro Líquido"
        value={fmtBRL(data.lucro_liquido)}
        hint={data.margem_perc !== null ? `Margem ${fmtPct2(data.margem_perc)}` : '—'}
        tone={lucroNegativo ? 'danger' : 'success'}
      />
    </div>
  )
}

function Card({
  icon,
  label,
  value,
  hint,
  tone
}: {
  icon: ReactNode
  label: string
  value: string
  hint?: string
  tone?: 'accent' | 'success' | 'warn' | 'danger'
}): ReactNode {
  return (
    <div
      className={cn(
        'rounded border p-3',
        tone === 'accent'
          ? 'border-accent-line bg-accent/5'
          : tone === 'success'
            ? 'border-success/40 bg-success/5'
            : tone === 'danger'
              ? 'border-danger/40 bg-danger/5'
              : tone === 'warn'
                ? 'border-warn/40 bg-warn/5'
                : 'border-border bg-bg-panel'
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 text-2xs font-mono uppercase tracking-wider mb-1',
          tone === 'accent'
            ? 'text-accent'
            : tone === 'success'
              ? 'text-success'
              : tone === 'danger'
                ? 'text-danger'
                : 'text-text-dim'
        )}
      >
        {icon}
        {label}
      </div>
      <div className="text-md font-mono text-text tabular-nums">{value}</div>
      {hint ? <div className="text-2xs text-text-dim font-mono mt-0.5">{hint}</div> : null}
    </div>
  )
}
