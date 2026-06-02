import { useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtBRL, fmtQtd, parseBR } from '@/lib/money'

interface Props {
  value: string
  onCommit: (value: string) => Promise<void> | void
  /** Aceita input numérico (inputMode=decimal). Implícito em money/qtd. */
  numeric?: boolean
  /** Formata como BRL no blur, raw no focus. Implica numeric. */
  money?: boolean
  /** Formata como 1.234,56 (BR) no blur, raw no focus. Implica numeric. */
  qtd?: boolean
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Debounce em ms — default 600. */
  debounceMs?: number
  align?: 'left' | 'right'
}

/**
 * Célula editável genérica com auto-commit após `debounceMs` parado, indicador
 * de save em progresso e rollback em erro. Suporta inputs texto, numéricos,
 * monetários (BRL) e quantidades (BR).
 *
 * Generalização de `PlanOrcInlineCell` (orçamento). Reutilizada pelo Gantt
 * (Fase 6) e por outras áreas do app que precisem de edição inline.
 *
 * Padrão de uso:
 *   <InlineCell
 *     value={String(tarefa.quantidade_alocada ?? '')}
 *     onCommit={async (v) => await update.mutateAsync({ quantidade_alocada: Number(v) || null })}
 *     qtd
 *     align="right"
 *   />
 */
export function InlineCell({
  value,
  onCommit,
  numeric,
  money,
  qtd,
  placeholder,
  className,
  disabled,
  debounceMs = 600,
  align = 'left'
}: Props): ReactNode {
  const isNum = numeric || money || qtd
  const [local, setLocal] = useState(value)
  const [lastUpstream, setLastUpstream] = useState(value)
  const [saving, setSaving] = useState(false)
  const [errored, setErrored] = useState(false)
  const [focused, setFocused] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (value !== lastUpstream && !saving) {
    setLastUpstream(value)
    setLocal(value)
  }

  const normalizeNumericInput = (s: string): string => {
    const trimmed = s.trim()
    if (trimmed === '') return ''
    if (trimmed.includes(',')) {
      const d = parseBR(trimmed)
      return d.toString()
    }
    const dots = (trimmed.match(/\./g) ?? []).length
    if (dots > 1) return trimmed.replace(/\./g, '')
    return trimmed
  }

  const commit = async (next: string): Promise<void> => {
    const outbound = isNum ? normalizeNumericInput(next) : next
    if (outbound === value) return
    setSaving(true)
    setErrored(false)
    try {
      await onCommit(outbound)
    } catch {
      setErrored(true)
      setLocal(value)
    } finally {
      setSaving(false)
    }
  }

  const onChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setLocal(e.target.value)
    if (timer.current) clearTimeout(timer.current)
    const next = e.target.value
    timer.current = setTimeout(() => {
      void commit(next)
    }, debounceMs)
  }

  const onBlur = async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    setFocused(false)
    await commit(local)
  }

  let display = local
  if (!focused && local.trim() !== '') {
    const n = parseBR(local).toNumber()
    if (!isNaN(n)) {
      if (money) display = fmtBRL(n)
      else if (qtd) display = fmtQtd(n)
    }
  }

  return (
    <div className="relative w-full">
      <input
        type="text"
        inputMode={isNum ? 'decimal' : undefined}
        value={display}
        placeholder={placeholder}
        disabled={disabled || saving}
        onFocus={() => setFocused(true)}
        onChange={onChange}
        onBlur={onBlur}
        className={cn(
          'h-6 w-full bg-transparent border border-transparent rounded px-1 text-xs',
          'hover:border-border focus:border-accent focus:bg-bg-elevated focus:outline-none',
          'disabled:opacity-50 tabular-nums',
          align === 'right' && 'text-right',
          errored && 'border-danger',
          className
        )}
      />
      {saving ? (
        <Loader2
          size={10}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-accent animate-spin"
        />
      ) : null}
    </div>
  )
}
