/**
 * Peças da barra de ferramentas das visões do plano (Gantt e tempo-caminho): grupos separados por linha, par de
 * zoom com o nome do eixo e o aviso de somente leitura. As duas visões montam a mesma ordem: modo, zoom, o que
 * mostrar, edição e, à direita, a legenda e as propriedades do plano.
 */
import type { ReactNode } from 'react'
import { Lock, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '@/lib/utils'

export const MOTIVO_LINHA_BASE =
  'Linha de base travada: para alterar, crie um plano em edição a partir dela.'
export const MOTIVO_SEM_PERMISSAO = 'O seu usuário não pode alterar o plano desta obra.'

export function BarraFerramentas({
  rotulo,
  children
}: {
  rotulo: string
  children: ReactNode
}): ReactNode {
  return (
    <div
      role="toolbar"
      aria-label={rotulo}
      className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-1.5 border-b border-border bg-bg-panel px-3 py-1.5"
    >
      {children}
    </div>
  )
}

/** Grupo de controles; do segundo em diante, uma linha fina separa do anterior. */
export function GrupoBarra({
  children,
  fim,
  className
}: {
  children: ReactNode
  /** Empurra o grupo para a direita da barra. */
  fim?: boolean
  className?: string
}): ReactNode {
  return (
    <div
      className={cn(
        'flex items-center gap-1',
        fim ? 'ml-auto' : 'border-l border-border pl-2 ml-1 first:border-l-0 first:pl-0 first:ml-0',
        className
      )}
    >
      {children}
    </div>
  )
}

const BOTAO_ZOOM =
  'inline-flex h-7 w-7 items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text focus-visible:outline-none focus-visible:bg-bg-active'

/** Diminuir e aumentar o zoom de um eixo, com o nome do eixo entre os dois botões. */
export function ZoomPar({
  rotulo,
  aoDiminuir,
  aoAumentar
}: {
  rotulo: string
  aoDiminuir: () => void
  aoAumentar: () => void
}): ReactNode {
  const eixo = rotulo.toLowerCase()
  return (
    <div
      role="group"
      aria-label={`Zoom: ${eixo}`}
      className="inline-flex items-center overflow-hidden rounded border border-border-strong"
    >
      <button
        type="button"
        className={BOTAO_ZOOM}
        onClick={aoDiminuir}
        aria-label={`Diminuir o zoom (${eixo})`}
        title={`Diminuir o zoom (${eixo})`}
      >
        <ZoomOut size={14} />
      </button>
      <span className="px-1.5 text-xs text-text-muted select-none">{rotulo}</span>
      <button
        type="button"
        className={BOTAO_ZOOM}
        onClick={aoAumentar}
        aria-label={`Aumentar o zoom (${eixo})`}
        title={`Aumentar o zoom (${eixo})`}
      >
        <ZoomIn size={14} />
      </button>
    </div>
  )
}

export function SeloSomenteLeitura({ motivo }: { motivo: string }): ReactNode {
  return (
    <span
      title={motivo}
      className="inline-flex h-7 items-center gap-1.5 rounded border border-border-strong px-2 text-xs text-text-muted"
    >
      <Lock size={12} /> Somente leitura
    </span>
  )
}

/** Título de um grupo de opções dentro do painel "Exibir". */
export function TituloOpcoes({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
      {children}
    </div>
  )
}
