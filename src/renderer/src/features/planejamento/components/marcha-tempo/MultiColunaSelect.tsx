import { useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, BarChart3 } from 'lucide-react'
import { Popover } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'

interface MultiColunaSelectProps {
  /** Templates dos trechos atualmente visíveis. */
  templatesPorTrecho: Map<string, TrechoQuantidadeVersaoCompleta | null>
  selecionados: string[]
  onChange: (nomes: string[]) => void
}

/**
 * Popover de seleção de colunas do template — agrega colunas de TODOS os
 * templates selecionados (deduplica por `nome`). Render usa nome da coluna
 * como id estável.
 */
export function MultiColunaSelect({
  templatesPorTrecho,
  selecionados,
  onChange
}: MultiColunaSelectProps): ReactNode {
  const [open, setOpen] = useState(false)

  const colunasUnicas = useMemo(() => {
    const map = new Map<string, { nome: string; unidade: string }>()
    for (const template of templatesPorTrecho.values()) {
      if (!template) continue
      for (const col of template.colunas) {
        if (!map.has(col.nome)) {
          map.set(col.nome, { nome: col.nome, unidade: col.unidade })
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome))
  }, [templatesPorTrecho])

  const todasSelecionadas =
    colunasUnicas.length > 0 && selecionados.length === colunasUnicas.length

  const toggle = (nome: string): void => {
    if (selecionados.includes(nome)) {
      onChange(selecionados.filter((x) => x !== nome))
    } else {
      onChange([...selecionados, nome])
    }
  }

  const toggleTodos = (): void => {
    if (todasSelecionadas) onChange([])
    else onChange(colunasUnicas.map((c) => c.nome))
  }

  const triggerLabel =
    selecionados.length === 0
      ? 'Quantidades'
      : selecionados.length === 1
        ? selecionados[0]
        : `${selecionados.length} colunas`

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="min-w-[280px] max-h-[360px] overflow-auto"
      trigger={
        <button
          type="button"
          disabled={colunasUnicas.length === 0}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-mono',
            selecionados.length > 0
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-border bg-bg text-text-dim',
            'hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed'
          )}
        >
          <BarChart3 size={12} />
          <span>{triggerLabel}</span>
          <ChevronDown size={12} />
        </button>
      }
    >
      <div className="p-1">
        {colunasUnicas.length > 1 ? (
          <>
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
              <span>{todasSelecionadas ? 'Limpar' : 'Marcar todas'}</span>
            </button>
            <div className="border-t border-border my-1" />
          </>
        ) : null}
        {colunasUnicas.map((col) => {
          const checked = selecionados.includes(col.nome)
          return (
            <button
              key={col.nome}
              type="button"
              onClick={() => toggle(col.nome)}
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
              <span className="truncate flex-1">{col.nome}</span>
              <span className="text-text-faint text-2xs">{col.unidade}</span>
            </button>
          )
        })}
        {colunasUnicas.length === 0 ? (
          <div className="px-2 py-1.5 text-xs font-mono text-text-faint">
            Selecione trechos com template de quantidades.
          </div>
        ) : null}
      </div>
    </Popover>
  )
}
