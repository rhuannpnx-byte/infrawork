import { useState, type FormEvent, type ReactNode } from 'react'
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
import { useCriarRevisao } from '../hooks/revisoes'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

export function CriarRevisaoDialog({ open, onOpenChange, obraId }: Props): ReactNode {
  const criar = useCriarRevisao()
  const [rotulo, setRotulo] = useState('')
  const [observacao, setObservacao] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setRotulo('')
    setObservacao('')
    setError(null)
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      const r = await criar.mutateAsync({
        obra_id: obraId,
        rotulo: rotulo.trim() || undefined,
        observacao: observacao.trim() || undefined
      })
      toast.success(`Revisão v${r.versao} criada como rascunho.`)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar revisão')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="md"
      disableDismiss={criar.isPending}
    >
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Nova revisão</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <div className="text-2xs text-text-dim font-mono">
            Antes de criar a revisão, a obra será recalculada para garantir totais consistentes. O
            snapshot inclui Planilha Orçamentária, Indireto, parâmetros da obra e CPUs aplicadas.
          </div>
          <div>
            <Label htmlFor="r-rotulo">Rótulo (opcional)</Label>
            <Input
              id="r-rotulo"
              value={rotulo}
              onChange={(e) => setRotulo(e.target.value)}
              placeholder="Ex.: v3 - revisão para licitação"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="r-obs">Observação (opcional)</Label>
            <textarea
              id="r-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={3}
              className="w-full rounded border border-border-strong bg-bg-elevated px-2 py-1.5 text-xs text-text placeholder:text-text-dim focus-visible:outline-none focus-visible:border-accent resize-none"
              placeholder="Notas sobre esta revisão"
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={criar.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" variant="default" disabled={criar.isPending}>
            {criar.isPending ? 'Snapshot…' : 'Criar revisão'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
