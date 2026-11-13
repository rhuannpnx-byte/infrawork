import { useRef, type KeyboardEvent } from 'react'
import { Moon, Smartphone, Sun } from 'lucide-react'
import { useTemaStore, type TemaPreferencia } from '@/core/ui/temaStore'
import { cn } from '@/lib/cn'

const OPCOES: { valor: TemaPreferencia; rotulo: string; icone: typeof Sun }[] = [
  { valor: 'light', rotulo: 'Claro', icone: Sun },
  { valor: 'dark', rotulo: 'Escuro', icone: Moon },
  { valor: 'system', rotulo: 'Sistema', icone: Smartphone },
]

/**
 * Escolha do tema (claro é o padrão, para uso sob sol). A preferência fica no aparelho.
 * No teclado é um grupo de opções: o Tab entra na opção marcada e as setas trocam.
 */
export function SeletorTema({ className }: { className?: string }) {
  const preferencia = useTemaStore((s) => s.preferencia)
  const setPreferencia = useTemaStore((s) => s.setPreferencia)
  const grupo = useRef<HTMLDivElement>(null)

  function comSetas(e: KeyboardEvent) {
    const passo =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (!passo) return
    e.preventDefault()
    const i = OPCOES.findIndex((o) => o.valor === preferencia)
    const proxima = OPCOES[(i + passo + OPCOES.length) % OPCOES.length]!
    setPreferencia(proxima.valor)
    grupo.current?.querySelector<HTMLElement>(`[data-valor="${proxima.valor}"]`)?.focus()
  }

  return (
    <div className={className}>
      <p className="rotulo">Tema</p>
      <div
        ref={grupo}
        role="radiogroup"
        aria-label="Tema"
        onKeyDown={comSetas}
        className="mt-1.5 grid grid-cols-3 rounded-md border border-border-strong bg-bg-panel p-0.5"
      >
        {OPCOES.map((o) => {
          const ativo = preferencia === o.valor
          return (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={ativo}
              tabIndex={ativo ? 0 : -1}
              data-valor={o.valor}
              onClick={() => setPreferencia(o.valor)}
              className={cn(
                'flex min-h-touch items-center justify-center gap-1.5 rounded-sm px-2 text-sm font-medium',
                'transition-colors duration-150',
                ativo ? 'bg-accent text-accent-fg' : 'text-on-surface-dim hover:text-on-surface',
              )}
            >
              <o.icone className="h-4 w-4" aria-hidden />
              {o.rotulo}
            </button>
          )
        })}
      </div>
    </div>
  )
}
