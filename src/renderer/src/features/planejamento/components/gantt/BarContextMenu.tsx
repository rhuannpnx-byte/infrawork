// BarContextMenu — menu de contexto ao right-click numa barra/marco (Fase 4).
//
// Itens:
//   * Selecionar somente esta (limpa multi-seleção)
//   * Adicionar à seleção
//   * Adicionar predecessora (abre AddDependenciaDialog)
//   * Editar constraint (abre Constraint inline dialog — Fase 4 deferred)
//   * Excluir tarefa (com confirm)
//
// Posicionamento: fixed em (x, y), clamped pro viewport. Fecha em click-outside,
// Escape, ou ação executada.

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, Plus, Check, CheckSquare, X, Anchor } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BarContextMenuProps {
  x: number
  y: number
  tarefaId: string
  isSelected: boolean
  multiSelectionAtiva: boolean
  podeEditar: boolean
  onClose: () => void
  onSelectOnly: (id: string) => void
  onAddToSelection: (id: string) => void
  onRemoveFromSelection: (id: string) => void
  onAddPred: (id: string) => void
  onEditConstraint: (id: string, anchorRect: DOMRect) => void
  onExcluir: (id: string) => void
}

export function BarContextMenu({
  x,
  y,
  tarefaId,
  isSelected,
  multiSelectionAtiva,
  podeEditar,
  onClose,
  onSelectOnly,
  onAddToSelection,
  onRemoveFromSelection,
  onAddPred,
  onEditConstraint,
  onExcluir
}: BarContextMenuProps): ReactNode {
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      // Click fora do menu fecha. Stop propagation no próprio menu evita.
      onClose()
      void e
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // Delay pra não capturar o próprio mouseup que abriu o menu
    const id = setTimeout(() => {
      window.addEventListener('mousedown', onDown)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(id)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const W = 220
  const left = Math.min(x, window.innerWidth - W - 8)
  const top = Math.min(y, window.innerHeight - 200)

  return createPortal(
    <div
      role="menu"
      className={cn(
        'fixed z-50 rounded-md bg-bg-elevated border border-border-strong shadow-lg',
        'py-1 text-xs animate-fade-in'
      )}
      style={{ left, top, minWidth: W }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <MenuItem
        icon={<Check size={11} />}
        label="Selecionar somente esta"
        onClick={() => {
          onSelectOnly(tarefaId)
          onClose()
        }}
      />
      {isSelected && multiSelectionAtiva ? (
        <MenuItem
          icon={<X size={11} />}
          label="Remover da seleção"
          onClick={() => {
            onRemoveFromSelection(tarefaId)
            onClose()
          }}
        />
      ) : (
        <MenuItem
          icon={<CheckSquare size={11} />}
          label="Adicionar à seleção"
          onClick={() => {
            onAddToSelection(tarefaId)
            onClose()
          }}
        />
      )}
      <Divider />
      <MenuItem
        icon={<Plus size={11} />}
        label="Adicionar predecessora"
        disabled={!podeEditar}
        onClick={() => {
          onAddPred(tarefaId)
          onClose()
        }}
      />
      <MenuItem
        icon={<Anchor size={11} />}
        label="Restrição..."
        disabled={!podeEditar}
        onClick={() => {
          // Usa o ponto de clique como anchor (DOMRect 1×1).
          const rect = new DOMRect(x, y, 1, 1)
          onEditConstraint(tarefaId, rect)
          onClose()
        }}
      />
      <Divider />
      <MenuItem
        icon={<Trash2 size={11} />}
        label="Excluir"
        shortcut="Del"
        danger
        disabled={!podeEditar}
        onClick={() => {
          onExcluir(tarefaId)
          onClose()
        }}
      />
    </div>,
    document.body
  )
}

function MenuItem({
  icon,
  label,
  shortcut,
  danger,
  disabled,
  onClick
}: {
  icon: ReactNode
  label: string
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-left',
        'hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed',
        danger ? 'text-danger hover:bg-danger/10' : 'text-text-muted hover:text-text'
      )}
    >
      <span className="shrink-0 w-3 flex items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {shortcut && <span className="text-text-faint font-mono text-2xs">{shortcut}</span>}
    </button>
  )
}

function Divider(): ReactNode {
  return <div className="my-1 border-t border-border" />
}
