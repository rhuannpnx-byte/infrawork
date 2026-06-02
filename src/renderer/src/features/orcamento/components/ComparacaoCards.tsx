// ComparacaoCards — agregados lado a lado de duas revisões.

import { type ReactNode } from 'react'
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtBRL, fmtPct2 } from '@/lib/money'
import type { ResumoRevisao } from '../hooks/comparacao'

interface Props {
  resumoA: ResumoRevisao
  resumoB: ResumoRevisao
}

interface MetricaProps {
  label: string
  vA: number | null
  vB: number | null
  /** Como formatar (BRL ou %). */
  fmt: (v: number) => string
  /** Se true, "subir" é positivo (verde). Para custo, é o contrário. */
  subirEhBom: boolean
}

function Metrica({ label, vA, vB, fmt, subirEhBom }: MetricaProps): ReactNode {
  const a = vA ?? 0
  const b = vB ?? 0
  const delta = b - a
  const deltaPct = a !== 0 ? delta / a : null
  const isNeutral = Math.abs(delta) < 0.005
  const subiu = delta > 0
  const verde = !isNeutral && (subirEhBom ? subiu : !subiu)
  const vermelho = !isNeutral && (subirEhBom ? !subiu : subiu)

  return (
    <div className="rounded border border-border bg-bg-panel p-3 flex-1 min-w-[180px]">
      <div className="text-2xs font-mono uppercase tracking-wider text-text-dim mb-1.5">
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-xs text-text-muted font-mono">{vA != null ? fmt(a) : '—'}</div>
        <ArrowRight size={11} className="text-text-faint" />
        <div className="text-sm font-mono text-text font-semibold">
          {vB != null ? fmt(b) : '—'}
        </div>
      </div>
      <div
        className={cn(
          'text-2xs font-mono mt-1 flex items-center gap-1',
          isNeutral && 'text-text-dim',
          verde && 'text-success',
          vermelho && 'text-danger'
        )}
      >
        {isNeutral ? (
          '—'
        ) : (
          <>
            {subiu ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
            <span>
              {delta > 0 ? '+' : ''}
              {fmt(delta)}
            </span>
            {deltaPct !== null ? (
              <span className="text-text-faint ml-1">
                ({deltaPct > 0 ? '+' : ''}
                {fmtPct2(deltaPct)})
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

export function ComparacaoCards({ resumoA, resumoB }: Props): ReactNode {
  return (
    <div className="flex flex-wrap gap-3">
      <Metrica
        label="Venda total"
        vA={resumoA.venda_total}
        vB={resumoB.venda_total}
        fmt={fmtBRL}
        subirEhBom
      />
      <Metrica
        label="Custo direto"
        vA={resumoA.custo_direto_calc}
        vB={resumoB.custo_direto_calc}
        fmt={fmtBRL}
        subirEhBom={false}
      />
      <Metrica
        label="Indireto (standalone)"
        vA={resumoA.custo_indireto_standalone}
        vB={resumoB.custo_indireto_standalone}
        fmt={fmtBRL}
        subirEhBom={false}
      />
      <Metrica
        label="Custo total"
        vA={resumoA.custo_total}
        vB={resumoB.custo_total}
        fmt={fmtBRL}
        subirEhBom={false}
      />
      <Metrica
        label="Impostos"
        vA={resumoA.impostos}
        vB={resumoB.impostos}
        fmt={fmtBRL}
        subirEhBom={false}
      />
      <Metrica
        label="Lucro líquido"
        vA={resumoA.lucro_liquido}
        vB={resumoB.lucro_liquido}
        fmt={fmtBRL}
        subirEhBom
      />
      <Metrica
        label="Lucratividade %"
        vA={resumoA.lucratividade_perc}
        vB={resumoB.lucratividade_perc}
        fmt={fmtPct2}
        subirEhBom
      />
    </div>
  )
}
