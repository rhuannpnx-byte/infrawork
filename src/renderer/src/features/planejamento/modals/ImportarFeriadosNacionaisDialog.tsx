import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { feriadosNacionaisBR } from '@/lib/feriados-br'
import { useUpsertExcecao } from '../hooks/calendario'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

export function ImportarFeriadosNacionaisDialog({
  open,
  onOpenChange,
  obraId
}: Props): ReactNode {
  const upsert = useUpsertExcecao()
  const anoAtual = new Date().getFullYear()
  const [ano, setAno] = useState(anoAtual)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const feriados = feriadosNacionaisBR(ano)

  const onConfirm = async (): Promise<void> => {
    setError(null)
    setLoading(true)
    try {
      for (const f of feriados) {
        await upsert.mutateAsync({
          obra_id: obraId,
          data: f.data,
          motivo: f.motivo,
          eh_util: false
        })
      }
      toast.success(`${feriados.length} feriados nacionais de ${ano} importados.`)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao importar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" disableDismiss={loading}>
      <DialogHeader>
        <DialogTitle>Importar feriados nacionais</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={error} />

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Label htmlFor="fer-ano">Ano</Label>
            <Input
              id="fer-ano"
              type="number"
              min={2024}
              max={2030}
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
            />
          </div>
          <div className="text-2xs text-text-dim font-mono pb-1">
            {feriados.length} feriados (datas móveis + fixas)
          </div>
        </div>

        <div className="max-h-[280px] overflow-auto border border-border rounded">
          <table className="w-full text-xs font-mono">
            <thead className="text-text-dim uppercase text-2xs">
              <tr className="border-b border-border bg-bg-panel">
                <th className="text-left px-2 py-1.5">Data</th>
                <th className="text-left px-2 py-1.5">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {feriados.map((f) => (
                <tr key={f.data} className="border-b border-border/40">
                  <td className="px-2 py-1.5">{f.data}</td>
                  <td className="px-2 py-1.5">{f.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-2xs text-text-dim font-mono">
          Duplicatas com mesma data são sobrescritas (upsert). Feriados estaduais/municipais
          devem ser adicionados manualmente.
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
          Cancelar
        </Button>
        <Button variant="default" onClick={onConfirm} disabled={loading}>
          {loading ? 'Importando…' : `Importar ${feriados.length} feriados`}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
