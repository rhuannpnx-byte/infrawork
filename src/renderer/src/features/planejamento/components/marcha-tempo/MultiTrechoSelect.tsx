import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, Layers } from 'lucide-react'
import { Popover } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface TrechoOpcao {
  id: string
  nome: string
  ordem: number
}

interface MultiTrechoSelectProps {
  trechos: TrechoOpcao[]
  selecionados: string[]
  onChange: (ids: string[]) => void
  /** Disabled quando não há trechos disponíveis. */
  disabled?: boolean
}

/**
 * Popover com checkboxes pra selecionar 1+ trechos. Mostra contagem no trigger
 * ("3 trechos") ou o nome quando apenas 1. Permite marcar/desmarcar todos.
 */
export function MultiTrechoSelect({
  trechos,
  selecionados,
  onChange,
  disabled = false
}: MultiTrechoSelectProps): ReactNode {
  const [open, setOpen] = useState(false)

  const todasSelecionadas = trechos.length > 0 && selecionados.length === trechos.length

  const toggle = (id: string): void => {
    if (selecionados.includes(id)) {
      onChange(selecionados.filter((x) => x !== id))
    } else {
      onChange([...selecionados, id])
    }
  }

  const toggleTodos = (): void => {
    if (todasSelecionadas) onChange([])
    else onChange(trechos.map((t) => t.id))
  }

  const triggerLabel =
    selecionados.length === 0
      ? 'Nenhum trecho'
      : selecionados.length === 1
        ? trechos.find((t) => t.id === selecionados[0])?.nome ?? '1 trecho'
        : `${selecionados.length} trechos`

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="min-w-[260px] max-h-[360px] overflow-auto"
      trigger={
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'inline-flex items-center gap-2 px-2 py-1 rounded border border-border bg-bg-panel text-xs font-mono',
            'hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed'
          )}
        >
          <Layers size={12} className="text-text-dim" />
          <span className="text-text">{triggerLabel}</span>
          <ChevronDown size={12} className="text-text-dim" />
        </button>
      }
    >
      <div className="p-1">
        {trechos.length > 1 ? (
          <button
            type="button"
            onClick={toggleTodos}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono text-text-dim hover:bg-bg-hover"
          >
            <span
              className={cn(
                'w-3.5 h-3.5 rounded border border-border-strong flex items-center justify-center',
                todasSelecionadas && 'bg-accent border-accent'
              )}
            >
              {todasSelecionadas ? <Check size={10} className="text-bg" /> : null}
            </span>
            <span>{todasSelecionadas ? 'Limpar' : 'Marcar todos'}</span>
          </button>
        ) : null}
        <div className="border-t border-border my-1" />
        {trechos.map((t) => {
          const checked = selecionados.includes(t.id)
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono text-text hover:bg-bg-hover text-left"
            >
              <span
                className={cn(
                  'w-3.5 h-3.5 rounded border border-border-strong flex items-center justify-center shrink-0',
                  checked && 'bg-accent border-accent'
                )}
              >
                {checked ? <Check size={10} className="text-bg" /> : null}
              </span>
              <span className="truncate">{t.nome}</span>
            </button>
          )
        })}
        {trechos.length === 0 ? (
          <div className="px-2 py-1.5 text-xs font-mono text-text-faint">
            Nenhum trecho cadastrado nesta obra.
          </div>
        ) : null}
      </div>
    </Popover>
  )
}
