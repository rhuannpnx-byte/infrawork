import { useSyncExternalStore } from 'react'

/** `window.matchMedia` reativo (sem setState em efeito). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined') return () => {}
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false),
    () => false
  )
}

/** Largura de celular (≤ 768px). */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 768px)')
}
