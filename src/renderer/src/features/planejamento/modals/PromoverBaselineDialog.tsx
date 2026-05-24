import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { usePromoverBaseline, useBaseline } from '../hooks/planejamentos'
import type { Planejamento } from '@/types/planejamento'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  planejamento: Planejamento | null
  obraId: string
}

export function PromoverBaselineDialog({
  open,
  onOpenChange,
  planejamento,
  obraId
}: Props): ReactNode {
  const promover = usePromoverBaseline()
  const { data: baselineAtual } = useBaseline(obraId)
  const [error, setError] = useState<string | null>(null)

  if (!planejamento) return null

  const onConfirm = async (): Promise<void> => {
    setError(null)
    try {
      await promover.mutateAsync({ planejamento_id: planejamento.id, obra_id: obraId })
      toast.success(`"${planejamento.nome}" promovido(a) a linha de base.`)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao promover baseline')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md" disableDismiss={promover.isPending}>
      <DialogHeader>
        <DialogTitle>Promover a linha de base?</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={error} />

        <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded">
          <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
          <div className="text-xs space-y-1.5">
            <div className="font-semibold text-amber-300">Ação congela este planejamento.</div>
            <div className="text-text">
              Tarefas, dependências e alocações deste planejamento ficam imutáveis. Para fazer
              ajustes futuros, crie uma <strong>cópia</strong> a partir da baseline e edite a
              cópia.
            </div>
            <div className="text-text">
              Datas calculadas podem ser recalculadas (sem perder a baseline), mas mudanças
              estruturais ficam bloqueadas.
            </div>
          </div>
        </div>

        {baselineAtual && baselineAtual.id !== planejamento.id ? (
          <div className="text-xs text-text-dim font-mono">
            Baseline atual: <strong>{baselineAtual.nome}</strong> será desmarcada (mas a
            revisão fica disponível para histórico).
          </div>
        ) : null}

        <div className="text-xs font-mono p-2 bg-bg rounded border border-border">
          Promovendo: <strong className="text-accent">{planejamento.nome}</strong>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="ghost"
          onClick={() => onOpenChange(false)}
          disabled={promover.isPending}
        >
          Cancelar
        </Button>
        <Button variant="default" onClick={onConfirm} disabled={promover.isPending}>
          {promover.isPending ? 'Promovendo…' : 'Promover a baseline'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
