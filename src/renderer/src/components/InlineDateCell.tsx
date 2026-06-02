import { useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  /** Data ISO 'YYYY-MM-DD' ou ''/null. */
  value: string | null
  onCommit: (value: string | null) => Promise<void> | void
  disabled?: boolean
  className?: string
  /** Permite limpar (default true). */
  allowEmpty?: boolean
}

/**
 * Input type="date" com commit em onBlur (ou onChange quando o browser
 * dispara após picker). Loader durante save, rollback em erro.
 *
 * Valores: aceita 'YYYY-MM-DD' ou null. Emite null para input vazio (se
 * `allowEmpty`).
 */
export function InlineDateCell({
  value,
  onCommit,
  disabled,
  className,
  allowEmpty = true
}: Props): ReactNode {
  const [local, setLocal] = useState(value ?? '')
  const [lastUpstream, setLastUpstream] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const [errored, setErrored] = useState(false)

  const upstream = value ?? ''
  if (upstream !== lastUpstream && !saving) {
    setLastUpstream(upstream)
    setLocal(upstream)
  }

  const commit = async (next: string): Promise<void> => {
    const nextVal: string | null = next === '' ? null : next
    if (nextVal === value) return
    if (!allowEmpty && nextVal === null) {
      setLocal(upstream)
      return
    }
    setSaving(true)
    setErrored(false)
    try {
      await onCommit(nextVal)
    } catch {
      setErrored(true)
      setLocal(upstream)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative w-full">
      <input
        type="date"
        value={local}
        disabled={disabled || saving}
        onChange={(e) => {
          setLocal(e.target.value)
          // input date browser-chrome geralmente dispara onChange direto
          // ao escolher; mas mantemos onBlur abaixo como fallback (pra
          // edição manual via teclado).
          void commit(e.target.value)
        }}
        onBlur={(e) => {
          void commit(e.target.value)
        }}
        className={cn(
          'h-6 w-full bg-transparent border border-transparent rounded px-1 text-xs font-mono',
          'hover:border-border focus:border-accent focus:bg-bg-elevated focus:outline-none',
          'disabled:opacity-50',
          errored && 'border-danger',
          className
        )}
      />
      {saving ? (
        <Loader2
          size={10}
          className="absolute right-5 top-1/2 -translate-y-1/2 text-accent animate-spin"
        />
      ) : null}
    </div>
  )
}
