import { useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtBRL, fmtQtd, parseBR } from '@/lib/money'

interface Props {
  value: string
  onCommit: (value: string) => Promise<void> | void
  /** Tipo HTML do input (default 'text'); usa inputMode="decimal" para números. */
  numeric?: boolean
  /** Quando true, formata como BRL no blur e mostra raw no focus. Implica numeric. */
  money?: boolean
  /** Quando true, formata como 1.234,56 (BR) no blur e mostra raw no focus. Implica numeric. */
  qtd?: boolean
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Debounce em ms — default 600. */
  debounceMs?: number
  align?: 'left' | 'right'
}

/**
 * Célula editável com auto-commit após `debounceMs` parado, com indicador
 * visual de save em progresso e rollback em erro.
 */
export function PlanOrcInlineCell({
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
  // `lastUpstream` rastreia o último valor recebido por props. Quando muda
  // (e não estamos no meio de um save local), aceitamos o valor novo —
  // evita useEffect+setState que viola react-hooks/set-state-in-effect.
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

  // Em campos numéricos, aceita "1.234,56" (BR) ou "1234.56" (raw) e
  // emite sempre raw com ponto decimal pro parent (o parent tipicamente
  // chama Number(val.replace(',', '.')) — strip de pontos garante que
  // "1.234,56" não fique "1.234.56").
  const normalizeNumericInput = (s: string): string => {
    const trimmed = s.trim()
    if (trimmed === '') return ''
    // Heurística: se tem vírgula, é BR → parse com parseBR.
    if (trimmed.includes(',')) {
      const d = parseBR(trimmed)
      return d.toString()
    }
    // Sem vírgula: pode ser "1234.56" (raw) ou "1.234" (BR sem decimais).
    // Se tem múltiplos pontos → BR; senão deixa como está.
    const dots = (trimmed.match(/\./g) ?? []).length
    if (dots > 1) {
      return trimmed.replace(/\./g, '')
    }
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
      setLocal(value) // rollback
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

  // Display formatado quando desfocado; raw quando focado (facilita edição).
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
