/**
 * Utilitários de dinheiro/percentuais usando Decimal (arbitrary-precision).
 *
 * Regra: nunca usar `+`, `-`, `*`, `/` direto em valores monetários. Sempre
 * passar por estas funções. Centavos sobre dezenas de milhões viram problema
 * em auditoria fiscal — não há economia em usar `number`.
 */

import Decimal from 'decimal.js'

// Configuração global do Decimal: 20 dígitos de precisão, half-even rounding.
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_EVEN })

export type Numeric = number | string | Decimal | null | undefined

export function dec(v: Numeric): Decimal {
  if (v === null || v === undefined || v === '') return new Decimal(0)
  if (v instanceof Decimal) return v
  return new Decimal(v)
}

export function add(a: Numeric, b: Numeric): Decimal {
  return dec(a).plus(dec(b))
}

export function sub(a: Numeric, b: Numeric): Decimal {
  return dec(a).minus(dec(b))
}

export function mul(a: Numeric, b: Numeric): Decimal {
  return dec(a).times(dec(b))
}

export function div(a: Numeric, b: Numeric): Decimal {
  const denom = dec(b)
  if (denom.isZero()) return new Decimal(0)
  return dec(a).dividedBy(denom)
}

export function sum(values: Numeric[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0))
}

const BRL_FMT = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

const BRL_FMT_4 = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4
})

const NUM_FMT_2 = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

const NUM_FMT_4 = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4
})

const PCT_FMT = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

/** Formata como R$ 1.234,56 (2 casas). */
export function fmtBRL(v: Numeric): string {
  return BRL_FMT.format(dec(v).toNumber())
}

/** Formata como R$ 1.234,5678 (4 casas) — usado em custos unitários precisos. */
export function fmtBRL4(v: Numeric): string {
  return BRL_FMT_4.format(dec(v).toNumber())
}

/** Formata como 1.234,56. */
export function fmtNum(v: Numeric): string {
  return NUM_FMT_2.format(dec(v).toNumber())
}

/** Formata até 4 casas, removendo zeros à direita. */
export function fmtQtd(v: Numeric): string {
  return NUM_FMT_4.format(dec(v).toNumber())
}

/** Recebe um decimal já em forma fracionária (0.27 → 27%). */
export function fmtPct(v: Numeric): string {
  return PCT_FMT.format(dec(v).toNumber())
}

/** Recebe um decimal já em forma fracionária (0.27 → "27,00%"). */
export function fmtPct2(v: Numeric): string {
  return `${NUM_FMT_2.format(dec(v).times(100).toNumber())}%`
}

/** Converte string com vírgula brasileira (1.234,56) para Decimal. */
export function parseBR(s: string): Decimal {
  if (!s) return new Decimal(0)
  const normalized = s.replace(/\./g, '').replace(',', '.')
  try {
    return new Decimal(normalized)
  } catch {
    return new Decimal(0)
  }
}

/** Para uso em forms: serializa Decimal como string com ponto (formato Postgres). */
export function toDbNumeric(v: Numeric): string {
  return dec(v).toFixed(4)
}
