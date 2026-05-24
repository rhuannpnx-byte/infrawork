const fmt = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 2
})

export function formatPercent(ratio: number | null | undefined, decimals = 1): string {
  if (ratio == null || Number.isNaN(ratio)) return '—'
  return new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(ratio)
}

export function formatPercentFromBase100(value: number | null | undefined, decimals = 1): string {
  if (value == null || Number.isNaN(value)) return '—'
  return formatPercent(value / 100, decimals)
}

export { fmt as percentFormatter }
