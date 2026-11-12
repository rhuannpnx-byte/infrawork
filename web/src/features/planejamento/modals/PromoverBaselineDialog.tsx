import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Lock } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { usePromoverBaseline } from '../hooks/planejamentos'
import type { Planejamento } from '@/types/planejamento'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  planejamento: Planejamento | null
  obraId: string
  /** Já existe linha de base vigente na obra. */
  temVigente?: boolean
  totalLinhasBase?: number
}

export function PromoverBaselineDialog({
  open,
  onOpenChange,
  planejamento,
  obraId,
  temVigente = false,
  totalLinhasBase = 0
}: Props): ReactNode {
  const promover = usePromoverBaseline()
  const [error, setError] = useState<string | null>(null)
  const [vigente, setVigente] = useState(!temVigente)

  useEffect(() => {
    if (open) {
      setVigente(!temVigente)
      setError(null)
    }
  }, [open, temVigente])

  if (!planejamento) return null

  const onConfirm = async (): Promise<void> => {
    setError(null)
    try {
      const r = await promover.mutateAsync({
        planejamento_id: planejamento.id,
        obra_id: obraId,
        marcar_vigente: vigente
      })
      toast.success(
        `"${planejamento.nome}" travado como linha de base${r.vigente ? ' e marcado como vigente' : ''}.`
      )
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao travar')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md" disableDismiss={promover.isPending}>
      <DialogHeader>
        <DialogTitle>Travar como linha de base?</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={error} />

        <div className="flex items-start gap-2 p-3 bg-warn/10 border border-warn/40 rounded">
          <Lock size={14} className="text-warn mt-0.5 shrink-0" />
          <div className="text-xs space-y-1.5 text-text">
            <div className="font-semibold text-warn">O plano deixa de ser editável.</div>
            <div>
              Tarefas, datas, equipes e o perfil semanal ficam congelados, junto com as premissas
              (quantidades, valores e produção de cada serviço, e o calendário). Mudanças futuras no
              orçamento não alteram esta linha de base.
            </div>
            <div>
              Para replanejar depois, crie um plano em edição a partir dela. Linhas de base:{' '}
              {totalLinhasBase}/20.
            </div>
          </div>
        </div>

        <label className="flex items-start gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={vigente}
            onChange={(e) => setVigente(e.target.checked)}
          />
          <span>
            <strong>Tornar vigente</strong> — vira a régua do acompanhamento
            {temVigente ? ' (substitui a vigente atual)' : ''}. Com vigente, orçamento, composições
            e recursos ficam travados.
          </span>
        </label>

        <div className="text-xs font-mono p-2 bg-bg rounded border border-border">
          Travando: <strong className="text-accent">{planejamento.nome}</strong>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={promover.isPending}>
          Cancelar
        </Button>
        <Button variant="default" onClick={onConfirm} disabled={promover.isPending}>
          {promover.isPending ? 'Travando…' : 'Travar como linha de base'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
