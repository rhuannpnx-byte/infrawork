import { type ReactNode } from 'react'
import { type StatusComparativo, STATUS_COMP_LABEL, STATUS_COMP_COR } from '@/types/acompanhamento'

/** Situação do serviço: a cor vai no marcador e no fundo; o texto fica na tinta, para manter o contraste. */
export function StatusComparativoChip({ status }: { status: StatusComparativo }): ReactNode {
  const cor = STATUS_COMP_COR[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm border text-2xs font-semibold uppercase tracking-[0.04em] text-text whitespace-nowrap"
      style={{
        background: `color-mix(in oklab, ${cor} 12%, transparent)`,
        borderColor: `color-mix(in oklab, ${cor} 45%, transparent)`
      }}
    >
      <span aria-hidden className="size-2 rounded-full shrink-0" style={{ background: cor }} />
      {STATUS_COMP_LABEL[status]}
    </span>
  )
}
