const fmt3 = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3
})

const fmt2 = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

const fmtInt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

const fmtAte = new Map<number, Intl.NumberFormat>([[3, fmt3]])

/** 0 = inteiro; 2 = duas casas fixas; outro valor = até N casas. */
export function formatNumber(value: number | null | undefined, decimals = 3): string {
  if (value == null || Number.isNaN(value)) return '—'
  if (decimals === 0) return fmtInt.format(value)
  if (decimals === 2) return fmt2.format(value)
  let f = fmtAte.get(decimals)
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals
    })
    fmtAte.set(decimals, f)
  }
  return f.format(value)
}

/**
 * Lê um número digitado em pt-BR ou en ("1.234,56", "1234,56", "1,234.56", "1234.56"). Vazio ou inválido → null.
 */
export function parseNumero(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, '')
  if (!t) return null
  const ultVirg = t.lastIndexOf(','),
    ultPonto = t.lastIndexOf('.')
  let n: string
  if (ultVirg >= 0 && ultPonto >= 0)
    n = ultVirg > ultPonto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  else if (ultVirg >= 0) n = t.replace(/\./g, '').replace(',', '.')
  else if ((t.match(/\./g) ?? []).length > 1) n = t.replace(/\./g, '')
  else n = t
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(n)) return null
  const v = Number(n)
  return Number.isFinite(v) ? v : null
}
