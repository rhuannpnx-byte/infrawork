import { type ReactNode } from 'react'
import { History, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PerfHistorico } from '@/types/acompanhamento'

interface Props {
  historico: PerfHistorico | null | undefined
  loading: boolean
  /** Média diária do serviço NESTA obra (todas as entidades) no período. */
  mediaObra: number
  unidade: string | null
}

export function BenchmarkHistorico({ historico, loading, mediaObra, unidade }: Props): ReactNode {
  const un = unidade ?? ''
  return (
    <div className="rounded border border-border bg-bg-panel p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-text mb-2">
        <History size={12} className="text-accent" />
        Benchmark histórico do serviço
        <span className="text-2xs font-mono text-text-dim font-normal">· outras obras, sem outliers</span>
      </div>

      {loading ? (
        <div className="text-2xs font-mono text-text-dim py-4 text-center">Calculando histórico…</div>
      ) : !historico || historico.p50 == null || historico.n_amostras === 0 ? (
        <div className="text-2xs font-mono text-text-dim py-4 text-center">
          Sem histórico comparável em outras obras para este serviço.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <Stat label="p25" value={`${formatNumber(historico.p25 ?? 0, 1)}`} un={un} />
            <Stat label="mediana (p50)" value={`${formatNumber(historico.p50, 1)}`} un={un} destaque />
            <Stat label="p75" value={`${formatNumber(historico.p75 ?? 0, 1)}`} un={un} />
          </div>
          <DeltaLinha mediaObra={mediaObra} p50={historico.p50} un={un} />
          <div className="text-2xs font-mono text-text-dim mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>n = {formatNumber(historico.n_amostras, 0)} dias-equipe</span>
            <span>outliers removidos: {formatNumber(historico.n_outliers, 0)}</span>
            {historico.media_trim != null ? <span>média aparada: {formatNumber(historico.media_trim, 1)} {un}</span> : null}
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, un, destaque }: { label: string; value: string; un: string; destaque?: boolean }): ReactNode {
  return (
    <div className={cn('rounded border px-2 py-1.5', destaque ? 'border-accent/40 bg-accent/5' : 'border-border bg-bg')}>
      <div className="text-2xs font-mono uppercase text-text-dim">{label}</div>
      <div className="text-sm font-semibold font-mono text-text">{value} <span className="text-2xs text-text-dim">{un}</span></div>
    </div>
  )
}

function DeltaLinha({ mediaObra, p50, un }: { mediaObra: number; p50: number; un: string }): ReactNode {
  const delta = p50 > 0 ? mediaObra / p50 - 1 : 0
  const acima = delta >= 0.02
  const abaixo = delta <= -0.02
  const Icon = acima ? TrendingUp : abaixo ? TrendingDown : Minus
  const cor = acima ? 'text-success' : abaixo ? 'text-danger' : 'text-text-dim'
  return (
    <div className="rounded border border-border bg-bg px-2 py-1.5 flex items-center justify-between">
      <div className="text-2xs font-mono text-text-dim">
        Esta obra (média {formatNumber(mediaObra, 1)} {un}) vs histórico
      </div>
      <div className={cn('flex items-center gap-1 text-sm font-semibold font-mono', cor)}>
        <Icon size={13} />
        {delta >= 0 ? '+' : ''}{formatNumber(delta * 100, 0)}%
      </div>
    </div>
  )
}
