import { format as dfFormat, formatDistanceToNow as dfDistance } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function formatDate(value: Date | string | number | null | undefined, pattern = 'dd/MM/yyyy'): string {
  if (value == null) return '—'
  const d = typeof value === 'string' || typeof value === 'number' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '—'
  return dfFormat(d, pattern, { locale: ptBR })
}

export function formatDateTime(value: Date | string | number | null | undefined): string {
  return formatDate(value, "dd/MM/yyyy 'às' HH:mm")
}

export function formatTime(value: Date | string | number | null | undefined): string {
  return formatDate(value, 'HH:mm')
}

export function timeAgo(value: Date | string | number | null | undefined): string {
  if (value == null) return '—'
  const d = typeof value === 'string' || typeof value === 'number' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '—'
  return dfDistance(d, { addSuffix: true, locale: ptBR })
}
