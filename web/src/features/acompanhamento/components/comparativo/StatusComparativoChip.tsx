import { type ReactNode } from 'react'
import { type StatusComparativo, STATUS_COMP_LABEL, STATUS_COMP_COR } from '@/types/acompanhamento'

export function StatusComparativoChip({ status }: { status: StatusComparativo }): ReactNode {
  const cor = STATUS_COMP_COR[status]
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-mono"
      style={{ background: `${cor}22`, color: cor, border: `1px solid ${cor}44` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: cor }} />
      {STATUS_COMP_LABEL[status]}
    </span>
  )
}
