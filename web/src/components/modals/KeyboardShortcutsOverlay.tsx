import { type ReactNode } from 'react'
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/stores/ui-store'
import { MODULES } from '@/config/modules'

const SECTIONS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Ir para',
    items: [
      ['G H', 'Início'],
      ...MODULES.map((m): [string, string] => [m.shortcut.toUpperCase(), m.title])
    ]
  },
  {
    title: 'Aplicação',
    items: [
      ['Ctrl K', 'Buscar páginas, obras e ações'],
      ['Ctrl B', 'Mostrar ou ocultar o menu'],
      ['?', 'Mostrar estes atalhos'],
      ['Esc', 'Fechar a janela aberta']
    ]
  }
]

export function KeyboardShortcutsOverlay(): ReactNode {
  const open = useUIStore((s) => s.activeModals.has('shortcuts'))
  const close = (): void => useUIStore.getState().closeModal('shortcuts')

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} size="lg">
      <DialogHeader>
        <DialogTitle>Atalhos de teclado</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {SECTIONS.map((sec) => (
            <div key={sec.title}>
              <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim mb-2">
                {sec.title}
              </div>
              <div className="space-y-1">
                {sec.items.map(([k, label]) => (
                  <div key={k} className="flex items-center justify-between">
                    <span className="text-xs text-text">{label}</span>
                    <span className="font-mono text-2xs text-text-muted bg-bg-elevated px-1.5 py-0.5 rounded">
                      {k}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={close}>
          Fechar
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
