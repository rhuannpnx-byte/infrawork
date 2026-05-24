import { type ReactNode } from 'react'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/stores/ui-store'

interface ConfirmDeletePayload {
  entityName: string
  type?: 'composicao' | 'tarefa' | 'insumo' | 'rdo' | 'bm' | 'fornecedor' | 'colaborador'
  linkedCount?: number
  linkedDescription?: string
  onConfirm?: () => void
}

export function ConfirmDeleteDialog(): ReactNode {
  const open = useUIStore((s) => s.activeModals.has('confirmDelete'))
  const close = (): void => useUIStore.getState().closeModal('confirmDelete')
  const payload = (useUIStore((s) => s.modalPayload['confirmDelete']) ?? {}) as ConfirmDeletePayload
  const { entityName, linkedCount, linkedDescription, onConfirm } = payload

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} size="sm">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-danger" />
          Confirmar exclusão
        </DialogTitle>
      </DialogHeader>
      <DialogBody>
        <p className="text-sm text-text">
          Tem certeza que deseja excluir <span className="font-mono text-accent">{entityName}</span>?
        </p>
        {linkedCount && linkedCount > 0 ? (
          <div className="mt-3 rounded border border-warn/30 bg-warn/10 p-2 text-2xs text-warn flex gap-2">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            <div>
              {linkedDescription ??
                `Este item está vinculado a ${linkedCount} ${linkedCount === 1 ? 'registro' : 'registros'} em outros módulos. A exclusão pode afetar cálculos de orçamento e cronograma.`}
            </div>
          </div>
        ) : null}
        <p className="mt-3 text-xs text-text-muted">Esta ação não pode ser desfeita.</p>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={close}>
          Cancelar
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            onConfirm?.()
            toast.success(`${entityName ?? 'Item'} excluído.`)
            close()
          }}
        >
          Excluir
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
