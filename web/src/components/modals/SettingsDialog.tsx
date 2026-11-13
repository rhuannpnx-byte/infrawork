import { useState, type ReactNode } from 'react'
import { Sheet, SheetHeader, SheetTitle, SheetBody, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { Palette, User, Info, Sun, Moon, Monitor } from 'lucide-react'
import { useThemeStore, type TemaPreferencia } from '@/stores/theme-store'
import { cn } from '@/lib/utils'
import { rotuloPapel } from '@/lib/rotulos'
import { Segmentado } from '@/components/ui/segmentado'

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
  const densidade = useUIStore((s) => s.density)
  const setDensidade = useUIStore((s) => s.setDensity)
  const profile = useAuthStore((s) => s.profile)
  const empresa = useAuthStore((s) => s.empresa)

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetHeader>
        <SheetTitle>Configurações</SheetTitle>
      </SheetHeader>
      <SheetBody className="!px-0 !py-0 flex">
        <div
          role="tablist"
          aria-label="Seções das configurações"
          aria-orientation="vertical"
          className="w-44 shrink-0 border-r border-border bg-bg-elevated p-2 flex flex-col gap-px"
        >
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
        </div>
        <div role="tabpanel" className="flex-1 overflow-auto p-4">
          {tab === 'aparencia' ? (
            <>
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
              <div className="mt-5">
                <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim mb-2">
                  Tamanho do texto
                </div>
                <Segmentado
                  rotulo="Tamanho do texto"
                  valor={densidade}
                  aoMudar={setDensidade}
                  opcoes={[
                    { valor: 'normal', rotulo: 'Confortável' },
                    { valor: 'compact', rotulo: 'Compacto' }
                  ]}
                />
                <p className="mt-2 text-sm text-text-muted">
                  O compacto mostra mais linhas por tela. Cronograma, tempo-caminho e planilha
                  orçamentária usam sempre o compacto.
                </p>
              </div>
            </>
          ) : tab === 'conta' ? (
            <>
              <dl className="space-y-3">
                {(
                  [
                    ['Nome', profile?.nome ?? '—'],
                    ['E-mail', profile?.email ?? '—'],
                    ['Papel', rotuloPapel(profile?.role)],
                    ['Empresa', empresa?.nome ?? 'Acesso global']
                  ] as const
                ).map(([rotulo, valor]) => (
                  <div key={rotulo}>
                    <dt className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                      {rotulo}
                    </dt>
                    <dd className="text-sm text-text break-words">{valor}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-sm text-text-muted">
                Para mudar nome, papel ou obras liberadas, fale com o administrador da sua empresa.
              </p>
            </>
          ) : (
            <div className="space-y-1 text-sm text-text-muted">
              <div className="text-sm text-text font-semibold mb-2">InfraWork</div>
              <div>Versão {__APP_VERSION__}</div>
              <div>Orçamento, planejamento e acompanhamento de obras rodoviárias.</div>
              <div className="mt-3 text-text-dim">© 2026 TECPAV. Todos os direitos reservados.</div>
            </div>
          )}
        </div>
      </SheetBody>
      <SheetFooter>
        <Button variant="secondary" onClick={close}>
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
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 h-8 px-2 rounded text-sm transition-colors text-left',
        active
          ? 'bg-accent-glow-strong text-accent font-semibold'
          : 'text-text-muted hover:text-text hover:bg-bg-hover'
      )}
    >
      {icon} {label}
    </button>
  )
}
