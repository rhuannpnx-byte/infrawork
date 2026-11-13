import { useEffect, useState, type ReactNode } from 'react'
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
import { useDeleteUsuario } from '../hooks'
import { falhaDoServidor } from '../lib/falha-servidor'
import type { UsuarioComEmpresa } from '@/types/gerencial'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  usuario: UsuarioComEmpresa | null
}

export function DeleteUsuarioDialog({ open, onOpenChange, usuario }: Props): ReactNode {
  const del = useDeleteUsuario()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) setError(null)
  }, [open])

  const onConfirm = async (): Promise<void> => {
    if (!usuario) return
    setError(null)
    try {
      await del.mutateAsync({ id: usuario.id })
      toast.success(`Usuário ${usuario.nome} excluído.`)
      onOpenChange(false)
    } catch (err) {
      setError(`Não foi possível excluir o usuário. ${falhaDoServidor(err)}`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm" disableDismiss={del.isPending}>
      <DialogHeader>
        <DialogTitle>Excluir usuário</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={error} />
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden />
          <p className="text-sm leading-relaxed text-text-muted">
            Excluir <span className="font-medium text-text">{usuario?.nome}</span> ({usuario?.email}
            ) de forma <span className="font-medium text-danger">definitiva</span>? O acesso e o
            cadastro são removidos e não dá para desfazer. Para só impedir a entrada, edite o
            usuário e marque como inativo.
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onOpenChange(false)}
          disabled={del.isPending}
          data-foco-inicial
        >
          Cancelar
        </Button>
        <Button type="button" variant="danger" onClick={onConfirm} disabled={del.isPending}>
          {del.isPending ? 'Excluindo…' : 'Excluir usuário'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
