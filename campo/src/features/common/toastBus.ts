import type { ToastKind } from './Toast'

/** Dispara um toast pelo barramento de eventos (o ToastHost escuta `monitor:toast`). */
export function showToast(kind: ToastKind, message: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('monitor:toast', { detail: { kind, message } }))
}
