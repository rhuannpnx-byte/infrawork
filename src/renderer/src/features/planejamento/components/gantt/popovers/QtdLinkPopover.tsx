// QtdLinkPopover — vincula qtd_alocada a uma métrica do template do trecho.
//
// Lê via useTrechoQuantidadeTemplateAtual(trechoId). Mostra colunas do
// template ativo com label + unidade + total geral. Botão "Desvincular"
// limpa o vínculo. Confirma → commitQtdLink.

import { type ReactNode } from 'react'
import { Check, Link as LinkIcon, Unlink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtQtd } from '@/lib/money'
import { useTrechoQuantidadeTemplateAtual } from '../../../hooks/trechos'
import { listMetricas } from '../../../lib/trecho-metricas'
import { AnchoredPopover } from './AnchoredPopover'

interface QtdLinkPopoverProps {
  anchorRect: DOMRect
  trechoId: string | null
  currentQtdLink: string | null
  onSelect: (qtdLink: string | null) => void
  onClose: () => void
}

export function QtdLinkPopover({
  anchorRect,
  trechoId,
  currentQtdLink,
  onSelect,
  onClose
}: QtdLinkPopoverProps): ReactNode {
  const { data: template, isLoading } = useTrechoQuantidadeTemplateAtual(trechoId)
  const metricas = listMetricas(template ?? null)

  return (
    <AnchoredPopover anchorRect={anchorRect} onClose={onClose} minWidth={280}>
      <div className="py-1 max-h-[340px] overflow-auto">
        <div className="px-3 py-1.5 border-b border-border flex items-center gap-1.5 text-2xs font-mono uppercase tracking-wider text-text-dim">
          <LinkIcon size={9} />
          <span>Vincular a métrica do trecho</span>
        </div>

        {!trechoId ? (
          <div className="px-3 py-2 text-text-dim italic text-xs">
            Tarefa sem trecho. Defina um trecho primeiro.
          </div>
        ) : isLoading ? (
          <div className="px-3 py-2 text-text-dim italic text-xs">Carregando template…</div>
        ) : metricas.length === 0 ? (
          <div className="px-3 py-2 text-text-dim italic text-xs">
            Este trecho ainda não tem template de quantidades.{' '}
            <span className="block mt-1 text-text-faint">
              Crie em Planejamento → Trechos → (trecho) → Quantidades.
            </span>
          </div>
        ) : (
          metricas.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => {
                onSelect(m.key)
                onClose()
              }}
              className={cn(
                'w-full flex items-center justify-between gap-2 px-3 py-1.5',
                'text-left hover:bg-bg-hover'
              )}
            >
              <div className="min-w-0">
                <div className="text-text text-xs truncate">{m.label}</div>
                <div className="text-text-dim text-2xs font-mono mt-0.5">
                  Total: {fmtQtd(m.totalGeral)} {m.unidade}
                </div>
              </div>
              {currentQtdLink === m.key ? (
                <Check size={11} className="text-accent shrink-0" />
              ) : null}
            </button>
          ))
        )}

        {currentQtdLink && (
          <div className="border-t border-border mt-1 pt-1">
            <button
              type="button"
              onClick={() => {
                onSelect(null)
                onClose()
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-hover text-warn"
            >
              <Unlink size={11} />
              <span className="text-xs">Desvincular (voltar pra manual)</span>
            </button>
          </div>
        )}
      </div>
    </AnchoredPopover>
  )
}
