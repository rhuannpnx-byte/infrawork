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
      setError(err instanceof Error ? err.message : 'Falha ao excluir usuário')
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
          <span className="mt-0.5 shrink-0 text-danger">
            <AlertTriangle size={18} />
          </span>
          <div className="text-sm text-text-muted leading-relaxed">
            Excluir <span className="text-text font-medium">{usuario?.nome}</span>{' '}
            <span className="font-mono text-text-dim">({usuario?.email})</span> de forma{' '}
            <span className="text-danger font-medium">definitiva</span>? Esta ação remove o
            acesso e o cadastro — não pode ser desfeita.
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
          disabled={del.isPending}
        >
          Cancelar
        </Button>
        <Button type="button" variant="danger" onClick={onConfirm} disabled={del.isPending}>
          {del.isPending ? 'Excluindo…' : 'Excluir definitivamente'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
