import { type ReactNode } from 'react'
import { WindowControls } from './WindowControls'
import infraworkIcon from '@/assets/infrawork-icon.png'

const isMac = window.infrawork?.platform === 'darwin'

/**
 * Barra de título mínima para telas anteriores ao AppShell (carregando / login),
 * onde a TitleBar completa não existe. Garante arraste da janela + controles
 * (minimizar/maximizar/fechar) em ambiente frameless (Win/Linux).
 *
 * No macOS retorna `null`: a moldura nativa (frame + hiddenInset) já provê os
 * traffic lights e o arraste em qualquer tela.
 */
export function SystemTitleBar(): ReactNode {
  if (isMac) return null

  return (
    <div className="drag-region fixed top-0 inset-x-0 h-9 z-50 flex items-center bg-bg-tabs border-b border-border">
      <div className="flex items-center shrink-0 pl-2" title="InfraWork">
        <img
          src={infraworkIcon}
          alt="InfraWork"
          className="h-7 w-7 select-none"
          draggable={false}
        />
      </div>
      <div className="flex-1 min-w-0" />
      <WindowControls />
    </div>
  )
}
