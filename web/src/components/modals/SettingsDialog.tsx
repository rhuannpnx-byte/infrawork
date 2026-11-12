import { useState, type ReactNode } from 'react'
import { Sheet, SheetHeader, SheetTitle, SheetBody, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { Palette, User, Info, Sun, Moon, Monitor } from 'lucide-react'
import { useThemeStore, type TemaPreferencia } from '@/stores/theme-store'
import { cn } from '@/lib/utils'

type Tab = 'aparencia' | 'conta' | 'sobre'

const TEMAS: { valor: TemaPreferencia; rotulo: string; icone: ReactNode }[] = [
  { valor: 'light', rotulo: 'Claro', icone: <Sun size={14} /> },
  { valor: 'dark', rotulo: 'Escuro', icone: <Moon size={14} /> },
  { valor: 'system', rotulo: 'Seguir o sistema', icone: <Monitor size={14} /> }
]

export function SettingsDialog(): ReactNode {
  const open = useUIStore((s) => s.activeModals.has('settings'))
  const close = (): void => useUIStore.getState().closeModal('settings')
  const [tab, setTab] = useState<Tab>('aparencia')
  const preferencia = useThemeStore((s) => s.preferencia)
  const setPreferencia = useThemeStore((s) => s.setPreferencia)
  const profile = useAuthStore((s) => s.profile)
  const empresa = useAuthStore((s) => s.empresa)

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetHeader>
        <SheetTitle>Configurações</SheetTitle>
      </SheetHeader>
      <SheetBody className="!px-0 !py-0 flex">
        <nav className="w-44 border-r border-border bg-bg-elevated p-2 flex flex-col gap-px">
          <TabBtn
            icon={<Palette size={12} />}
            label="Aparência"
            active={tab === 'aparencia'}
            onClick={() => setTab('aparencia')}
          />
          <TabBtn
            icon={<User size={12} />}
            label="Conta"
            active={tab === 'conta'}
            onClick={() => setTab('conta')}
          />
          <TabBtn
            icon={<Info size={12} />}
            label="Sobre"
            active={tab === 'sobre'}
            onClick={() => setTab('sobre')}
          />
        </nav>
        <div className="flex-1 overflow-auto p-4">
          {tab === 'aparencia' ? (
            <fieldset>
              <legend className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim mb-2">
                Tema
              </legend>
              <div className="flex flex-col gap-1.5">
                {TEMAS.map((t) => (
                  <label
                    key={t.valor}
                    className={cn(
                      'flex items-center gap-2.5 h-10 px-3 rounded border cursor-pointer text-sm',
                      preferencia === t.valor
                        ? 'border-accent bg-accent-glow text-accent font-semibold'
                        : 'border-border-strong text-text hover:bg-bg-hover'
                    )}
                  >
                    <input
                      type="radio"
                      name="tema"
                      className="sr-only"
                      checked={preferencia === t.valor}
                      onChange={() => setPreferencia(t.valor)}
                    />
                    {t.icone} {t.rotulo}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : tab === 'conta' ? (
            <div className="space-y-3">
              <div>
                <Label>Nome</Label>
                <Input readOnly value={profile?.nome ?? ''} />
              </div>
              <div>
                <Label>Email</Label>
                <Input readOnly value={profile?.email ?? ''} className="font-mono" />
              </div>
              <div>
                <Label>Papel</Label>
                <Input readOnly value={profile?.role ?? ''} className="font-mono" />
              </div>
              <div>
                <Label>Empresa</Label>
                <Input readOnly value={empresa?.nome ?? 'Acesso global'} />
              </div>
            </div>
          ) : (
            <div className="space-y-1 text-xs text-text-muted">
              <div className="text-sm text-text font-semibold mb-2">InfraWork</div>
              <div>Versão {__APP_VERSION__}</div>
              <div>Web · React 19 · TypeScript · Supabase</div>
              <div className="mt-3 text-text-dim font-mono text-2xs">
                © 2026 TECPAV — todos os direitos reservados.
              </div>
            </div>
          )}
        </div>
      </SheetBody>
      <SheetFooter>
        <Button variant="ghost" onClick={close}>
          Fechar
        </Button>
      </SheetFooter>
    </Sheet>
  )
}

function TabBtn({
  icon,
  label,
  active,
  onClick
}: {
  icon: ReactNode
  label: string
  active: boolean
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs transition-colors text-left',
        active ? 'bg-accent-glow text-accent' : 'text-text-muted hover:text-text hover:bg-bg-hover'
      )}
    >
      {icon} {label}
    </button>
  )
}
