import { type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { REVISAO_STATUS_LABEL, REVISAO_STATUS_VARIANT, type RevisaoStatus } from '@/types/orcamento'

interface Props {
  status: RevisaoStatus
}

export function RevisaoStatusBadge({ status }: Props): ReactNode {
  return <Badge variant={REVISAO_STATUS_VARIANT[status]}>{REVISAO_STATUS_LABEL[status]}</Badge>
}
