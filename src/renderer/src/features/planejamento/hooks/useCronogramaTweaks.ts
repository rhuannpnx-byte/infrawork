// useCronogramaTweaks — preferências visuais do cronograma (Fase 1 do redesign).
//
// Persiste em localStorage. Usado pelo VisualizacaoPanel + componentes Gantt.
//
// Storage key: cronograma:tweaks:v1
//
// Versionamento: se a shape mudar, bump key pra v2 e ignore migração (defaults
// novos aplicam pra todos).

import { useEffect, useSyncExternalStore } from 'react'

export type BarStyle = 'solid' | 'gradient' | 'textured'
export type DepMode = 'ortho' | 'curve'
export type Density = 'compact' | 'regular' | 'comfy'
export type ColorMode = 'tipo' | 'equipe' | 'status'

export interface CronogramaTweaks {
  barStyle: BarStyle
  depMode: DepMode
  density: Density
  colorMode: ColorMode
  showLabels: boolean
  showWeekends: boolean
  autoPropagate: boolean
}

const DEFAULTS: CronogramaTweaks = {
  barStyle: 'gradient',
  depMode: 'ortho',
  density: 'regular',
  colorMode: 'tipo',
  showLabels: true,
  showWeekends: true,
  autoPropagate: true
}

const STORAGE_KEY = 'cronograma:tweaks:v1'

// ─── Singleton store (sem Zustand pra evitar dependência extra; padrão simples
//     com listeners + useSyncExternalStore). Mantém parity com o restante do app.

let state: CronogramaTweaks = loadFromStorage()
const listeners = new Set<() => void>()

function loadFromStorage(): CronogramaTweaks {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<CronogramaTweaks>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return DEFAULTS
  }
}

function persist(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage cheio ou bloqueado — ignora
  }
}

function setTweak<K extends keyof CronogramaTweaks>(key: K, value: CronogramaTweaks[K]): void {
  if (state[key] === value) return
  state = { ...state, [key]: value }
  persist()
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): CronogramaTweaks {
  return state
}

export function useCronogramaTweaks(): {
  tweaks: CronogramaTweaks
  setTweak: typeof setTweak
} {
  const tweaks = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { tweaks, setTweak }
}

/** Reage a mudança no localStorage feita em outra aba/janela do Electron. */
export function useSyncTweaksAcrossWindows(): void {
  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== STORAGE_KEY) return
      state = loadFromStorage()
      listeners.forEach((l) => l())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
}

/** Mapping densidade → altura da linha em px. */
export function rowHeightForDensity(density: Density): number {
  if (density === 'compact') return 22
  if (density === 'comfy') return 34
  return 28
}
