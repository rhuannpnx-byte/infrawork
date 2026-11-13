import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Campo } from '@/components/ui/campo'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { rotuloPapel } from '@/lib/rotulos'
import { useClientes, useEngenheiros, useGrantPermissao } from '../hooks'
import { falhaDoServidor } from '../lib/falha-servidor'

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
  const [tentou, setTentou] = useState(false)

  // Engenheiros, clientes e apontadores recebem permissão direta (o apoio herda do engenheiro).
  const disponiveis = [...engenheiros, ...clientes].filter((e) => !existingUserIds.includes(e.id))
  const semDisponiveis = disponiveis.length === 0

  useEffect(() => {
    if (!open) {
      setUserId('')
      setError(null)
      setTentou(false)
    }
  }, [open])

  const erroUsuario = userId ? undefined : 'Selecione o usuário que vai receber o acesso.'

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (erroUsuario) {
      setTentou(true)
      const form = e.currentTarget
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    try {
      await grant.mutateAsync({ obra_id: obraId, user_id: userId })
      toast.success(`Acesso concedido na obra ${obraCodigo}.`)
      onOpenChange(false)
    } catch (err) {
      setError(`Não foi possível conceder o acesso. ${falhaDoServidor(err)}`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm" disableDismiss={grant.isPending}>
      <form onSubmit={onSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>Conceder acesso</DialogTitle>
          <DialogDescription>Obra {obraCodigo}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          {semDisponiveis ? (
            <p className="text-sm text-text-muted">
              Todos os engenheiros, clientes e apontadores desta empresa já têm acesso a esta obra.
              Para liberar outra pessoa, cadastre o usuário em Usuários.
            </p>
          ) : (
            <Campo
              rotulo="Usuário"
              obrigatorio
              dica="Engenheiro, cliente ou apontador da empresa. O apoio herda o acesso do seu engenheiro."
              erro={tentou ? erroUsuario : undefined}
            >
              <Select value={userId} onChange={(e) => setUserId(e.target.value)} data-foco-inicial>
                <option value="">Selecione…</option>
                {disponiveis.map((e) => (
                  <option key={e.id} value={e.id}>
                    {rotuloPapel(e.role)}: {e.nome} · {e.email}
                  </option>
                ))}
              </Select>
            </Campo>
          )}
        </DialogBody>
        <DialogFooter>
          {semDisponiveis ? (
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={grant.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={grant.isPending}>
                {grant.isPending ? 'Concedendo…' : 'Conceder acesso'}
              </Button>
            </>
          )}
        </DialogFooter>
      </form>
    </Dialog>
  )
}
