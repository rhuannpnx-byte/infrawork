// Persistência da largura do divisor Grid|GanttPane.
// Em arquivo separado pra satisfazer react-refresh (componentes ficam isolados).

const STORAGE_KEY = 'cronograma:split-width:v1'
const DEFAULT_WIDTH = 560
const MIN_WIDTH = 360
const MAX_WIDTH = 1400

export const SPLIT_WIDTH_DEFAULT = DEFAULT_WIDTH
export const SPLIT_WIDTH_MIN = MIN_WIDTH
export const SPLIT_WIDTH_MAX = MAX_WIDTH

export function loadSplitWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_WIDTH
    const n = Number(raw)
    if (!Number.isFinite(n)) return DEFAULT_WIDTH
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n))
  } catch {
    return DEFAULT_WIDTH
  }
}

export function saveSplitWidth(width: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(width))
  } catch {
    // ignora
  }
}
