import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Toast simples baseado em evento global `monitor:toast`. Sem Context provider
 * porque o consumer único é o root do App. Para disparar:
 *
 *   window.dispatchEvent(new CustomEvent('monitor:toast', { detail: {
 *     kind: 'ok' | 'warn' | 'bad' | 'info',
 *     message: '...',
 *   } }))
 *
 * Auto-dismiss: ok=2s, info=3s, warn/bad=6s.
 */

export type ToastKind = 'ok' | 'warn' | 'bad' | 'info'

interface ToastDetail {
  kind: ToastKind
  message: string
}

interface ActiveToast extends ToastDetail {
  id: number
}

let seq = 0

export function ToastHost() {
  const [toasts, setToasts] = useState<ActiveToast[]>([])

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastDetail>).detail
      if (!detail || !detail.message) return
      const id = ++seq
      setToasts((cur) => [...cur, { ...detail, id }])
      const ttl = detail.kind === 'ok' ? 2000 : detail.kind === 'info' ? 3000 : 6000
      window.setTimeout(() => {
        setToasts((cur) => cur.filter((t) => t.id !== id))
      }, ttl)
    }
    window.addEventListener('monitor:toast', onToast)
    return () => window.removeEventListener('monitor:toast', onToast)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-3 pb-safe-plus-4">
      {toasts.map((t) => (
        <ToastItem
          key={t.id}
          toast={t}
          onDismiss={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
        />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }: { toast: ActiveToast; onDismiss: () => void }) {
  const { kind, message } = toast
  const cls =
    kind === 'ok'
      ? 'bg-ok text-white'
      : kind === 'warn'
        ? 'bg-warn text-bg-base'
        : kind === 'bad'
          ? 'bg-bad text-white'
          : 'bg-info text-white'

  const Icon =
    kind === 'ok'
      ? CheckCircle2
      : kind === 'warn'
        ? AlertTriangle
        : kind === 'bad'
          ? AlertTriangle
          : Info

  return (
    <div
      className={cn(
        'pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-lg px-4 py-3 shadow-xl',
        cls,
      )}
      role="status"
    >
      <Icon className="mt-0.5 h-5 w-5 flex-shrink-0" />
      <p className="flex-1 text-sm font-medium">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="-mr-1 -mt-1 p-1 opacity-80 hover:opacity-100"
        aria-label="Fechar"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
