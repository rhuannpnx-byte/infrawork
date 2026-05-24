import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { FileText, FileSpreadsheet, FileJson } from 'lucide-react'
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'

type Format = 'pdf' | 'excel' | 'csv'

const TABS: Array<{ key: Format; label: string; icon: typeof FileText }> = [
  { key: 'pdf', label: 'PDF', icon: FileText },
  { key: 'excel', label: 'Excel', icon: FileSpreadsheet },
  { key: 'csv', label: 'CSV', icon: FileJson }
]

export function ExportDialog(): ReactNode {
  const open = useUIStore((s) => s.activeModals.has('export'))
  const close = (): void => useUIStore.getState().closeModal('export')
  const [format, setFormat] = useState<Format>('pdf')
  const [exporting, setExporting] = useState(false)

  const handleExport = async (): Promise<void> => {
    setExporting(true)
    await new Promise((r) => setTimeout(r, 900))
    setExporting(false)
    toast.success(`Exportação ${format.toUpperCase()} concluída.`)
    close()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} size="md">
      <DialogHeader>
        <DialogTitle>Exportar dados</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <div className="flex gap-1 border border-border rounded p-0.5 bg-bg-elevated">
          {TABS.map((t) => {
            const isActive = t.key === format
            const Icon = t.icon
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setFormat(t.key)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 h-7 rounded text-xs font-medium transition-colors',
                  isActive ? 'bg-bg-panel text-text shadow-[0_0_0_1px_var(--border-accent)]' : 'text-text-muted hover:text-text'
                )}
              >
                <Icon size={12} /> {t.label}
              </button>
            )
          })}
        </div>

        {format === 'pdf' ? (
          <div className="space-y-3">
            <div>
              <Label>Orientação</Label>
              <Select defaultValue="retrato">
                <option value="retrato">Retrato (A4)</option>
                <option value="paisagem">Paisagem (A4)</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <CheckboxLine label="Incluir capa institucional" defaultChecked />
              <CheckboxLine label="Sumário automático" defaultChecked />
              <CheckboxLine label="Marca d'água CONFIDENCIAL" />
              <CheckboxLine label="Numerar páginas" defaultChecked />
            </div>
          </div>
        ) : format === 'excel' ? (
          <div className="space-y-2">
            <Label>Planilhas a incluir</Label>
            <CheckboxLine label="Composições" defaultChecked />
            <CheckboxLine label="Insumos" defaultChecked />
            <CheckboxLine label="Curva ABC" defaultChecked />
            <CheckboxLine label="Resumo executivo" />
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label>Separador</Label>
              <Select defaultValue=";">
                <option value=";">; (ponto e vírgula)</option>
                <option value=",">, (vírgula)</option>
                <option value="\t">Tabulação</option>
              </Select>
            </div>
            <CheckboxLine label="Incluir cabeçalho" defaultChecked />
            <CheckboxLine label="Aspas em strings" defaultChecked />
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={close} disabled={exporting}>
          Cancelar
        </Button>
        <Button variant="default" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exportando…' : 'Exportar'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function CheckboxLine({ label, defaultChecked }: { label: string; defaultChecked?: boolean }): ReactNode {
  return (
    <label className="flex items-center gap-2 text-xs text-text cursor-pointer">
      <input type="checkbox" defaultChecked={defaultChecked} className="accent-[var(--accent)]" />
      {label}
    </label>
  )
}
