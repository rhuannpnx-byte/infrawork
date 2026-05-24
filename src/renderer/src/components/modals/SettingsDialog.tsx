import { useState, type ReactNode } from 'react'
import { Sheet, SheetHeader, SheetTitle, SheetBody, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useUIStore } from '@/stores/ui-store'
import { useSettingsStore } from '@/stores/settings-store'
import { Palette, Keyboard, User, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tab = 'aparencia' | 'atalhos' | 'conta' | 'sobre'

export function SettingsDialog(): ReactNode {
  const open = useUIStore((s) => s.activeModals.has('settings'))
  const close = (): void => useUIStore.getState().closeModal('settings')
  const [tab, setTab] = useState<Tab>('aparencia')
  const defaultBdi = useSettingsStore((s) => s.defaultBdi)
  const setDefaultBdi = useSettingsStore((s) => s.setDefaultBdi)

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetHeader>
        <SheetTitle>Configurações</SheetTitle>
      </SheetHeader>
      <SheetBody className="!px-0 !py-0 flex">
        <nav className="w-44 border-r border-border bg-bg-elevated p-2 flex flex-col gap-px">
          <TabBtn icon={<Palette size={12} />} label="Aparência" active={tab === 'aparencia'} onClick={() => setTab('aparencia')} />
          <TabBtn icon={<Keyboard size={12} />} label="Atalhos" active={tab === 'atalhos'} onClick={() => setTab('atalhos')} />
          <TabBtn icon={<User size={12} />} label="Conta" active={tab === 'conta'} onClick={() => setTab('conta')} />
          <TabBtn icon={<Info size={12} />} label="Sobre" active={tab === 'sobre'} onClick={() => setTab('sobre')} />
        </nav>
        <div className="flex-1 overflow-auto p-4">
          {tab === 'aparencia' ? (
            <div className="space-y-3">
              <div>
                <Label>Tema</Label>
                <Select defaultValue="dark">
                  <option value="dark">Escuro (padrão)</option>
                  <option value="darker" disabled>
                    Escuro intenso (em breve)
                  </option>
                </Select>
              </div>
              <div>
                <Label>BDI padrão (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={defaultBdi}
                  onChange={(e) => setDefaultBdi(parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Densidade padrão das tabelas</Label>
                <Select defaultValue="normal">
                  <option value="normal">Normal</option>
                  <option value="compact">Compacta</option>
                </Select>
              </div>
            </div>
          ) : tab === 'atalhos' ? (
            <div>
              <div className="text-2xs font-mono uppercase tracking-wider text-text-dim mb-2">
                Navegação por módulo
              </div>
              <ShortcutRow keys="G O" label="Ir para Orçamento" />
              <ShortcutRow keys="G P" label="Ir para Planejamento" />
              <ShortcutRow keys="G A" label="Ir para Acompanhamento" />
              <ShortcutRow keys="G M" label="Ir para Medições" />
              <ShortcutRow keys="G S" label="Ir para Suprimentos" />
              <ShortcutRow keys="G E" label="Ir para Equipe" />
              <ShortcutRow keys="G D" label="Ir para Documentos" />
              <ShortcutRow keys="G R" label="Ir para Relatórios" />
              <ShortcutRow keys="G H" label="Ir para Visão geral" />
              <div className="text-2xs font-mono uppercase tracking-wider text-text-dim mb-2 mt-4">Aplicação</div>
              <ShortcutRow keys="⌘K" label="Abrir paleta de comandos" />
              <ShortcutRow keys="⌘N" label="Novo (contextual)" />
              <ShortcutRow keys="⌘S" label="Salvar" />
              <ShortcutRow keys="⌘B" label="Mostrar/ocultar sidebar" />
              <ShortcutRow keys="⌘W" label="Fechar aba" />
              <ShortcutRow keys="?" label="Mostrar atalhos" />
            </div>
          ) : tab === 'conta' ? (
            <div className="space-y-3">
              <div>
                <Label>Nome</Label>
                <Input defaultValue="Eduardo G. Pacheco" />
              </div>
              <div>
                <Label>Email</Label>
                <Input defaultValue="egp@tecpav.com.br" />
              </div>
              <div>
                <Label>Cargo</Label>
                <Input defaultValue="Coord. de Planejamento" />
              </div>
            </div>
          ) : (
            <div className="space-y-1 text-xs text-text-muted">
              <div className="text-sm text-text font-semibold mb-2">InfraWork</div>
              <div>Versão 0.1.0 (scaffold)</div>
              <div>Build local · Electron · React 19 · TypeScript</div>
              <div className="mt-3 text-text-dim font-mono text-2xs">© 2026 TECPAV — todos os direitos reservados.</div>
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

function TabBtn({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }): ReactNode {
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

function ShortcutRow({ keys, label }: { keys: string; label: string }): ReactNode {
  return (
    <div className="flex items-center justify-between py-1 border-b border-border last:border-b-0">
      <span className="text-xs text-text">{label}</span>
      <span className="font-mono text-2xs text-text-muted bg-bg-elevated px-1.5 py-0.5 rounded">{keys}</span>
    </div>
  )
}
