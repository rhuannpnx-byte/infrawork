// AddEquipePopover — adiciona uma equipe a uma tarefa.
//
// Lista equipes da obra ainda não alocadas, com filtro por nome. Confirma
// chama useAlocarEquipe (passada via onSelect com qtd_equipes=1 default).

import { useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Equipe } from '@/types/planejamento'
import { AnchoredPopover } from './AnchoredPopover'

interface AddEquipePopoverProps {
  anchorRect: DOMRect
  equipesDisponiveis: Equipe[]
  /** IDs já alocadas — não aparecem na lista. */
  jaAlocadasIds: Set<string>
  onSelect: (equipeId: string) => void
  onClose: () => void
}

export function AddEquipePopover({
  anchorRect,
  equipesDisponiveis,
  jaAlocadasIds,
  onSelect,
  onClose
}: AddEquipePopoverProps): ReactNode {
  const [filtro, setFiltro] = useState('')

  const lista = useMemo(() => {
    const term = filtro.trim().toLowerCase()
    return equipesDisponiveis.filter((e) => {
      if (jaAlocadasIds.has(e.id)) return false
      if (!term) return true
      return e.nome.toLowerCase().includes(term) || (e.tipo ?? '').toLowerCase().includes(term)
    })
  }, [equipesDisponiveis, jaAlocadasIds, filtro])

  return (
    <AnchoredPopover anchorRect={anchorRect} onClose={onClose} minWidth={260}>
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
        <Search size={11} className="text-text-dim" />
        <input
          autoFocus
          type="text"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar equipe…"
          className="flex-1 bg-transparent text-xs outline-none placeholder:text-text-faint"
        />
      </div>
      <div className="py-1 max-h-[280px] overflow-auto">
        {lista.length === 0 ? (
          <div className="px-3 py-2 text-text-dim italic text-xs">
            {equipesDisponiveis.length === 0
              ? 'Nenhuma equipe cadastrada na obra.'
              : 'Todas as equipes elegíveis já estão alocadas.'}
          </div>
        ) : (
          lista.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                onSelect(e.id)
                onClose()
              }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5',
                'text-left hover:bg-bg-hover'
              )}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: e.cor }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-text text-xs truncate">{e.nome}</div>
                {e.tipo && (
                  <div className="text-text-dim text-2xs font-mono mt-0.5">{e.tipo}</div>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </AnchoredPopover>
  )
}
