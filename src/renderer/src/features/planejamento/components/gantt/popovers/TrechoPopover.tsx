// TrechoPopover — escolha o trecho da tarefa.
//
// Mostra lista de trechos da obra com: nome, unidade base, comprimento (se
// importado via KML). Confirma → commitTrecho. Fecha em click-outside/Escape.

import { type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ObraTrecho } from '@/types/gerencial'
import { AnchoredPopover } from './AnchoredPopover'

interface TrechoPopoverProps {
  anchorRect: DOMRect
  trechos: ObraTrecho[]
  currentTrechoId: string | null
  onSelect: (trechoId: string) => void
  onClose: () => void
}

export function TrechoPopover({
  anchorRect,
  trechos,
  currentTrechoId,
  onSelect,
  onClose
}: TrechoPopoverProps): ReactNode {
  return (
    <AnchoredPopover anchorRect={anchorRect} onClose={onClose} minWidth={260}>
      <div className="py-1 max-h-[300px] overflow-auto">
        {trechos.length === 0 ? (
          <div className="px-3 py-2 text-text-dim italic">
            Nenhum trecho cadastrado. Crie em Planejamento → Trechos.
          </div>
        ) : (
          trechos.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                onSelect(t.id)
                onClose()
              }}
              className={cn(
                'w-full flex items-center justify-between gap-2 px-3 py-1.5',
                'text-left hover:bg-bg-hover'
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: t.cor ?? 'var(--accent)' }}
                />
                <div className="min-w-0">
                  <div className="text-text text-xs truncate">{t.nome}</div>
                  <div className="text-text-dim text-2xs font-mono mt-0.5">
                    {t.unidade_espaco_padrao.toUpperCase()}
                    {t.geometry_comprimento_m
                      ? ` · ${(t.geometry_comprimento_m / 1000).toFixed(2)} km`
                      : ''}
                  </div>
                </div>
              </div>
              {currentTrechoId === t.id ? (
                <Check size={11} className="text-accent shrink-0" />
              ) : null}
            </button>
          ))
        )}
      </div>
    </AnchoredPopover>
  )
}
