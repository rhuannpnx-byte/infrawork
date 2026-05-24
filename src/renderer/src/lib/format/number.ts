const fmt3 = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3
})

const fmt2 = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

const fmtInt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

export function formatNumber(value: number | null | undefined, decimals = 3): string {
  if (value == null || Number.isNaN(value)) return '—'
  if (decimals === 0) return fmtInt.format(value)
  if (decimals === 2) return fmt2.format(value)
  return fmt3.format(value)
}
