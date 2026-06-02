// DepContextMenu — menu de contexto ao clicar numa seta de dependência.
//
// Itens (matching protótipo):
//   * Header: "<numPred> → <numSuc>  ·  <tipo>[+lag]d"
//   * Mudar tipo: FS / SS / FF / SF
//   * Lag: +0d / +2d / -2d
//   * Remover vínculo (danger)
//
// Posicionamento: fixed em (x, y) clamped pro viewport. Fecha em click-outside,
// Escape ou após executar uma ação.

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DependenciaTipo } from '@/types/planejamento'

interface DepContextMenuProps {
  x: number
  y: number
  depId: string
  predNumero: number | undefined
  sucNumero: number | undefined
  tipoAtual: DependenciaTipo
  lagAtual: number
  podeEditar: boolean
  onClose: () => void
  onChangeTipo: (depId: string, tipo: DependenciaTipo) => void
  onChangeLag: (depId: string, lag: number) => void
  onRemover: (depId: string) => void
}

export function DepContextMenu({
  x,
  y,
  depId,
  predNumero,
  sucNumero,
  tipoAtual,
  lagAtual,
  podeEditar,
  onClose,
  onChangeTipo,
  onChangeLag,
  onRemover
}: DepContextMenuProps): ReactNode {
  useEffect(() => {
    const onDown = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
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
  const top = Math.min(y, window.innerHeight - 280)

  const tipos: DependenciaTipo[] = ['FS', 'SS', 'FF', 'SF']
  const lagLabel = lagAtual === 0 ? '' : lagAtual > 0 ? `+${lagAtual}d` : `${lagAtual}d`

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
      <div className="px-3 py-1 text-2xs font-mono uppercase text-text-dim tracking-wider">
        {predNumero ?? '?'} → {sucNumero ?? '?'} · {tipoAtual}
        {lagLabel}
      </div>
      <Divider />
      {tipos.map((t) => (
        <MenuItem
          key={t}
          label={`Mudar para ${t}`}
          disabled={!podeEditar || t === tipoAtual}
          active={t === tipoAtual}
          onClick={() => {
            onChangeTipo(depId, t)
            onClose()
          }}
        />
      ))}
      <Divider />
      <MenuItem
        label="Lag +0d"
        disabled={!podeEditar || lagAtual === 0}
        active={lagAtual === 0}
        onClick={() => {
          onChangeLag(depId, 0)
          onClose()
        }}
      />
      <MenuItem
        label="Lag +2d"
        disabled={!podeEditar}
        active={lagAtual === 2}
        onClick={() => {
          onChangeLag(depId, 2)
          onClose()
        }}
      />
      <MenuItem
        label="Lag -2d"
        disabled={!podeEditar}
        active={lagAtual === -2}
        onClick={() => {
          onChangeLag(depId, -2)
          onClose()
        }}
      />
      <Divider />
      <MenuItem
        icon={<Trash2 size={11} />}
        label="Remover vínculo"
        danger
        disabled={!podeEditar}
        onClick={() => {
          onRemover(depId)
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
  danger,
  disabled,
  active,
  onClick
}: {
  icon?: ReactNode
  label: string
  danger?: boolean
  disabled?: boolean
  active?: boolean
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
        danger ? 'text-danger hover:bg-danger/10' : 'text-text-muted hover:text-text',
        active && 'text-accent'
      )}
    >
      {icon && <span className="shrink-0 w-3 flex items-center justify-center">{icon}</span>}
      <span className={cn('flex-1 truncate', !icon && 'pl-5')}>{label}</span>
    </button>
  )
}

function Divider(): ReactNode {
  return <div className="my-1 border-t border-border" />
}
