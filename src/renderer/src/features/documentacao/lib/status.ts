import type { DocumentoStatus } from '@/types/documentacao'

type BadgeVariant = 'default' | 'accent' | 'success' | 'warn' | 'danger' | 'outline'

const MAP: Record<DocumentoStatus, { label: string; variant: BadgeVariant }> = {
  minuta: { label: 'Minuta', variant: 'outline' },
  em_analise: { label: 'Em análise', variant: 'warn' },
  assinado: { label: 'Assinado', variant: 'accent' },
  vigente: { label: 'Vigente', variant: 'success' },
  substituido: { label: 'Substituído', variant: 'default' },
  encerrado: { label: 'Encerrado', variant: 'default' }
}

export function statusBadge(status: DocumentoStatus): { label: string; variant: BadgeVariant } {
  return MAP[status] ?? { label: status, variant: 'default' }
}
