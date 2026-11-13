import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Lock } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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

  const onConfirm = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
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
      setError(
        `Não foi possível travar o plano. ${err instanceof Error ? err.message : 'Tente de novo.'}`
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md" disableDismiss={promover.isPending}>
      <form onSubmit={onConfirm}>
        <DialogHeader>
          <DialogTitle>Travar como linha de base</DialogTitle>
          <DialogDescription>
            Plano: <span className="font-medium text-text">{planejamento.nome}</span>
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          <div className="flex items-start gap-2 rounded border border-warn/40 bg-warn/10 p-3">
            <Lock size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <div className="space-y-1.5 text-sm text-text">
              <p className="font-semibold">O plano deixa de ser editável.</p>
              <p>
                Tarefas, datas, equipes e o perfil semanal ficam congelados, junto com as premissas
                (quantidades, valores e produção de cada serviço, e o calendário). Mudanças futuras
                no orçamento não alteram esta linha de base.
              </p>
              <p>
                Para replanejar depois, crie um plano em edição a partir dela. Esta obra tem{' '}
                <span className="tabular">{totalLinhasBase}</span> de 20 linhas de base.
              </p>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-sm text-text">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
              checked={vigente}
              onChange={(e) => setVigente(e.target.checked)}
            />
            <span>
              <strong>Tornar vigente.</strong>{' '}
              <span className="text-text-muted">
                Passa a ser a referência do previsto no acompanhamento
                {temVigente ? ' e substitui a vigente atual' : ''}. Com linha de base vigente,
                orçamento, composições e recursos ficam travados.
              </span>
            </span>
          </label>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={promover.isPending}
            autoFocus
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={promover.isPending}>
            {promover.isPending ? 'Travando…' : 'Travar como linha de base'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
