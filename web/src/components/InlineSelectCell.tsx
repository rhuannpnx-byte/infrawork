import { useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface InlineSelectOption {
  value: string
  label: string
}

interface Props {
  value: string
  options: InlineSelectOption[]
  onCommit: (value: string) => Promise<void> | void
  /** Texto vazio (default "—"). */
  emptyLabel?: string
  /** Permite selecionar valor vazio (option ""). */
  allowEmpty?: boolean
  disabled?: boolean
  className?: string
}

/**
 * Select com commit imediato (sem debounce — escolha discreta).
 * Loader visual durante o save. Rollback em erro (restaura value).
 *
 * Usado no Gantt colunar para campos como trecho, perfil, unidade_espaco.
 */
export function InlineSelectCell({
  value,
  options,
  onCommit,
  emptyLabel = '—',
  allowEmpty = false,
  disabled,
  className
}: Props): ReactNode {
  const [saving, setSaving] = useState(false)
  const [errored, setErrored] = useState(false)
  // Local mirror para feedback visual imediato em mutate; rollback em erro.
  const [local, setLocal] = useState(value)
  const [lastUpstream, setLastUpstream] = useState(value)

  if (value !== lastUpstream && !saving) {
    setLastUpstream(value)
    setLocal(value)
  }

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>): Promise<void> => {
    const next = e.target.value
    if (next === value) return
    setLocal(next)
    setSaving(true)
    setErrored(false)
    try {
      await onCommit(next)
    } catch {
      setErrored(true)
      setLocal(value)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative w-full">
      <select
        value={local}
        onChange={handleChange}
        disabled={disabled || saving}
        className={cn(
          'h-6 w-full bg-transparent border border-transparent rounded px-1 text-xs font-mono',
          'hover:border-border focus:border-accent focus:bg-bg-elevated focus:outline-none',
          'disabled:opacity-50 appearance-none cursor-pointer',
          'pr-5', // espaço pro caret
          errored && 'border-danger',
          className
        )}
      >
        {allowEmpty ? <option value="">{emptyLabel}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {saving ? (
        <Loader2
          size={10}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-accent animate-spin"
        />
      ) : null}
    </div>
  )
}
