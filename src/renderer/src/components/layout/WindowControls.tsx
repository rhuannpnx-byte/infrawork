import { type ReactNode, useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'

const isMac = window.infrawork?.platform === 'darwin'

/**
 * Botões de janela (minimizar / maximizar-restaurar / fechar) para a barra de
 * título customizada. No macOS retorna `null` — usamos os traffic lights nativos
 * (titleBarStyle: hiddenInset).
 */
export function WindowControls(): ReactNode {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (isMac) return
    void window.infrawork.window.isMaximized().then(setMaximized)
    return window.infrawork.window.onMaximizedChange(setMaximized)
  }, [])

  if (isMac) return null

  const btn =
    'no-drag w-[46px] h-full flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-hover transition-colors'

  return (
    <div className="flex items-stretch h-full shrink-0">
      <button
        type="button"
        aria-label="Minimizar"
        className={btn}
        onClick={() => window.infrawork.window.minimize()}
      >
        <Minus size={15} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restaurar' : 'Maximizar'}
        className={btn}
        onClick={() => window.infrawork.window.maximize()}
      >
        {maximized ? <Copy size={12} strokeWidth={1.5} /> : <Square size={12} strokeWidth={1.5} />}
      </button>
      <button
        type="button"
        aria-label="Fechar"
        className="no-drag w-[46px] h-full flex items-center justify-center text-text-muted hover:text-white hover:bg-danger transition-colors"
        onClick={() => window.infrawork.window.close()}
      >
        <X size={16} strokeWidth={1.5} />
      </button>
    </div>
  )
}
