const fmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

const fmtCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1
})

export function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return fmt.format(value)
}

export function formatCurrencyCompact(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return fmtCompact.format(value)
}

export function parseCurrency(input: string): number | null {
  const cleaned = input.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}
