// predecessor — parsing/formatting de strings de dependência.
//
// Backend usa relação `planejamento_dependencia` (tabular). Mas a UI do
// redesign quer permitir entrada livre estilo MS Project: "12FS+5d", "T4SS",
// "8-3d" (FS implícito + lag -3d). Aqui ficam parser e formatter pra
// converter entre formato livre e a estrutura tabular.

import type { DependenciaTipo } from '@/types/planejamento'

export interface ParsedPredecessor {
  /** ID ou número da tarefa source (caller resolve qual é). */
  ref: string
  tipo: DependenciaTipo
  lag_dias: number
}

const RE = /^([\w.-]+?)(FS|SS|FF|SF)?([+-]\d+)?d?$/i

/**
 * Aceita formatos: "12", "12FS", "12FS+5d", "12+5d", "12SS-2d", "T4FF".
 * Retorna null se formato inválido. FS é default; lag é 0 se omitido.
 */
export function parsePredecessor(s: string): ParsedPredecessor | null {
  if (!s) return null
  const m = String(s).trim().match(RE)
  if (!m) return null
  return {
    ref: m[1],
    tipo: ((m[2] ?? 'FS').toUpperCase() as DependenciaTipo),
    lag_dias: m[3] ? parseInt(m[3], 10) : 0
  }
}

export function formatPredecessor(p: ParsedPredecessor): string {
  const lag = p.lag_dias > 0 ? `+${p.lag_dias}d` : p.lag_dias < 0 ? `${p.lag_dias}d` : ''
  const t = p.tipo === 'FS' && lag === '' ? '' : p.tipo
  return `${p.ref}${t}${lag}`
}

/** Lista separada por vírgula ou ponto-e-vírgula. */
export function parsePredecessorList(s: string): ParsedPredecessor[] {
  if (!s) return []
  return s
    .split(/[,;]\s*/)
    .map(parsePredecessor)
    .filter((p): p is ParsedPredecessor => p !== null)
}

export function formatPredecessorList(arr: ParsedPredecessor[]): string {
  return arr.map(formatPredecessor).join(', ')
}
