import { Moon, Smartphone, Sun } from 'lucide-react'
import { useTemaStore, type TemaPreferencia } from '@/core/ui/temaStore'
import { cn } from '@/lib/cn'

const OPCOES: { valor: TemaPreferencia; rotulo: string; icone: typeof Sun }[] = [
  { valor: 'light', rotulo: 'Claro', icone: Sun },
  { valor: 'dark', rotulo: 'Escuro', icone: Moon },
  { valor: 'system', rotulo: 'Sistema', icone: Smartphone },
]

/** Escolha do tema (claro é o padrão, para uso sob sol). A preferência fica no aparelho. */
export function SeletorTema({ className }: { className?: string }) {
  const preferencia = useTemaStore((s) => s.preferencia)
  const setPreferencia = useTemaStore((s) => s.setPreferencia)
  return (
    <div className={className}>
      <p className="rotulo">Tema</p>
      <div
        role="radiogroup"
        aria-label="Tema"
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
