import type { StatusComparativo } from '@/types/acompanhamento'

const TOKEN = {
  success: 'oklch(78% 0.18 145)',
  warn: 'oklch(82% 0.16 80)',
  danger: 'oklch(70% 0.18 25)',
  muted: 'oklch(72% 0.010 255)',
  faint: 'oklch(58% 0.010 255)',
  accent: 'oklch(67% 0.18 255)',
  cyan: 'oklch(85% 0.12 215)',
  lavanda: 'oklch(74% 0.14 295)',
  teal: 'oklch(72% 0.10 195)'
} as const

export type FaixaAderencia = 'no_alvo' | 'atencao' | 'critico' | 'indefinido'

export function faixaAderenciaCpu(ratio: number | null | undefined): FaixaAderencia {
  if (ratio == null || !Number.isFinite(Number(ratio))) return 'indefinido'
  const p = Number(ratio) * 100
  if (p >= 90 && p <= 110) return 'no_alvo'
  if ((p >= 70 && p < 90) || (p > 110 && p <= 130)) return 'atencao'
  return 'critico'
}

export function corAderenciaCpu(ratio: number | null | undefined): string {
  switch (faixaAderenciaCpu(ratio)) {
    case 'no_alvo':
      return TOKEN.success
    case 'atencao':
      return TOKEN.warn
    case 'critico':
      return TOKEN.danger
    default:
      return TOKEN.faint
  }
}

/**
 * Aderencia "real / planejado acumulado": diferente de aderencia CPU. Aqui o
 * critério é assimétrico (executou no minimo X% do que devia): ≥95% verde,
 * ≥70% atenção, abaixo crítico. Pra >100% nao tem "puniçao" (executou alem
 * do esperado é bom).
 */
export function corAderenciaSobreAcumulado(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(Number(ratio))) return TOKEN.faint
  const r = Number(ratio)
  if (r >= 0.95) return TOKEN.success
  if (r >= 0.7) return TOKEN.warn
  return TOKEN.danger
}

export const STATUS_COMP_COR_TOKENS: Record<StatusComparativo, string> = {
  sem_plano: TOKEN.faint,
  nao_iniciado: TOKEN.muted,
  em_andamento: TOKEN.cyan,
  no_prazo: TOKEN.success,
  em_risco: TOKEN.warn,
  atrasado: TOKEN.danger,
  adiantado: TOKEN.lavanda,
  concluido: TOKEN.teal
}

export function corStatusComparativo(status: StatusComparativo): string {
  return STATUS_COMP_COR_TOKENS[status]
}
