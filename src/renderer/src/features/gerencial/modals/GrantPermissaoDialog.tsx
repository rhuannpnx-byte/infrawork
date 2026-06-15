import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useClientes, useEngenheiros, useGrantPermissao } from '../hooks'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  obraEmpresaId: string
  obraCodigo: string
  /** IDs de usuários que já têm permissão — pra esconder duplicatas. */
  existingUserIds: string[]
}

export function GrantPermissaoDialog({
  open,
  onOpenChange,
  obraId,
  obraEmpresaId,
  obraCodigo,
  existingUserIds
}: Props): ReactNode {
  const { data: engenheiros = [] } = useEngenheiros(obraEmpresaId)
  const { data: clientes = [] } = useClientes(obraEmpresaId)
  const grant = useGrantPermissao()
  const [userId, setUserId] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Engenheiros e Clientes recebem permissão direta (Apoio herda do engenheiro).
  const disponiveis = [...engenheiros, ...clientes].filter((e) => !existingUserIds.includes(e.id))

  useEffect(() => {
    if (!open) {
      setUserId('')
      setError(null)
    }
  }, [open])

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (!userId) {
      setError('Selecione um usuário.')
      return
    }
    try {
      await grant.mutateAsync({ obra_id: obraId, user_id: userId })
      toast.success(`Acesso concedido na obra ${obraCodigo}.`)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao conceder')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm" disableDismiss={grant.isPending}>
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Conceder acesso à obra {obraCodigo}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <div>
            <Label htmlFor="grant-user">Engenheiro ou Cliente</Label>
            <Select
              id="grant-user"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              disabled={disponiveis.length === 0}
              autoFocus
            >
              <option value="">
                {disponiveis.length === 0
                  ? 'Todos os engenheiros e clientes desta empresa já têm acesso'
                  : 'Selecione…'}
              </option>
              {disponiveis.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.role === 'cliente' ? '[Cliente] ' : '[Eng] '}{e.nome} · {e.email}
                </option>
              ))}
            </Select>
          </div>

          <div className="text-2xs font-mono text-text-dim bg-bg-elevated rounded border border-border px-2 py-1.5">
            Engenheiros e Clientes recebem acesso direto. Apoios vinculados a um
            engenheiro herdam o acesso automaticamente.
          </div>

        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={grant.isPending}>
            Cancelar
          </Button>
          <Button type="submit" variant="default" disabled={grant.isPending || !userId}>
            {grant.isPending ? 'Concedendo…' : 'Conceder acesso'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
