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

/**
 * Converte string numérica aceitando AMBOS os formatos BR e US.
 *
 * Heurística baseada na presença de vírgula:
 *   - Tem vírgula (formato BR "1.234,56"): pontos são separadores de
 *     milhar, vírgula é decimal → remove pontos + troca vírgula por ponto.
 *   - Sem vírgula:
 *     - 2+ pontos ("1.234.567"): pontos são milhar → remove todos.
 *     - 1 ponto ("18416.67"): assume formato US (decimal) → mantém.
 *     - 0 pontos ("18416"): inteiro puro.
 *
 * Crítico: a versão antiga removia TODOS os pontos sempre, o que inflava
 * por 10^N strings vindas do banco em formato US (Postgres `numeric` →
 * PostgREST → "18416.6700"). Quando o display do InlineCell chamava
 * `parseBR(value)` pra formatar com `fmtQtd`, "18416.67" virava 1.841.667.
 */
export function parseBR(s: string): Decimal {
  if (!s) return new Decimal(0)
  const trimmed = s.trim()
  if (trimmed === '') return new Decimal(0)
  let normalized: string
  if (trimmed.includes(',')) {
    // Formato BR — pontos são milhar, vírgula é decimal.
    normalized = trimmed.replace(/\./g, '').replace(',', '.')
  } else {
    const dots = (trimmed.match(/\./g) ?? []).length
    if (dots > 1) {
      // Múltiplos pontos sem vírgula = milhar (ex: "1.234.567").
      normalized = trimmed.replace(/\./g, '')
    } else {
      // 0 ou 1 ponto sem vírgula = formato US (decimal) ou inteiro puro.
      normalized = trimmed
    }
  }
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
