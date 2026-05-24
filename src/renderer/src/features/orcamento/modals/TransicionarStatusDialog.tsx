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
import { Button } from '@/components/ui/button'
import { useTransicionarStatus } from '../hooks/revisoes'
import { useAuthStore } from '@/stores/auth-store'
import { RevisaoStatusBadge } from '../components/RevisaoStatusBadge'
import { REVISAO_STATUS_LABEL, type RevisaoStatus, type Revisao } from '@/types/orcamento'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  revisao: Revisao | null
}

interface Opcao {
  status: RevisaoStatus
  label: string
  description: string
  tone: 'accent' | 'success' | 'warn' | 'danger' | 'default'
  /** Roles permitidos (alinhado com Edge Function). */
  papeis: ('god' | 'adm' | 'engenheiro')[]
}

function opcoesPara(de: RevisaoStatus): Opcao[] {
  switch (de) {
    case 'rascunho':
      return [
        {
          status: 'em_revisao',
          label: 'Enviar para revisão',
          description: 'Marca a revisão como "em revisão". Aguardando aprovação.',
          tone: 'warn',
          papeis: ['god', 'adm', 'engenheiro']
        },
        {
          status: 'cancelada',
          label: 'Cancelar revisão',
          description: 'Marca como cancelada (não removida).',
          tone: 'danger',
          papeis: ['god', 'adm']
        }
      ]
    case 'em_revisao':
      return [
        {
          status: 'aprovada',
          label: 'Aprovar',
          description: 'Marca como aprovada. Snapshot e totais ficam imutáveis.',
          tone: 'accent',
          papeis: ['god', 'adm']
        },
        {
          status: 'rascunho',
          label: 'Voltar para rascunho',
          description: 'Rollback para edição.',
          tone: 'default',
          papeis: ['god', 'adm', 'engenheiro']
        },
        {
          status: 'cancelada',
          label: 'Cancelar revisão',
          description: 'Marca como cancelada.',
          tone: 'danger',
          papeis: ['god', 'adm']
        }
      ]
    case 'aprovada':
      return [
        {
          status: 'homologada',
          label: 'Homologar',
          description: 'Marca como homologada (terminal). Não pode mais voltar.',
          tone: 'success',
          papeis: ['god', 'adm']
        },
        {
          status: 'rascunho',
          label: 'Reabrir como rascunho',
          description: 'Rollback. Remove carimbos de aprovação.',
          tone: 'default',
          papeis: ['god', 'adm']
        },
        {
          status: 'cancelada',
          label: 'Cancelar',
          description: 'Marca como cancelada.',
          tone: 'danger',
          papeis: ['god', 'adm']
        }
      ]
    case 'homologada':
    case 'cancelada':
      return []
  }
}

export function TransicionarStatusDialog({ open, onOpenChange, revisao }: Props): ReactNode {
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const transicionar = useTransicionarStatus()
  const [escolha, setEscolha] = useState<RevisaoStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!revisao) return null

  const opcoes = opcoesPara(revisao.status).filter((o) =>
    role ? (o.papeis as readonly string[]).includes(role) : false
  )

  const reset = (): void => {
    setEscolha(null)
    setError(null)
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (!escolha) {
      setError('Selecione uma ação.')
      return
    }
    try {
      await transicionar.mutateAsync({
        revisao_id: revisao.id,
        obra_id: revisao.obra_id,
        novo_status: escolha
      })
      toast.success(`Status atualizado para "${REVISAO_STATUS_LABEL[escolha]}".`)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na transição')
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
      disableDismiss={transicionar.isPending}
    >
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Transição de status — Revisão v{revisao.versao}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <div className="text-xs text-text-muted">
            Status atual: <RevisaoStatusBadge status={revisao.status} />
          </div>

          {opcoes.length === 0 ? (
            <div className="text-xs text-text-muted font-mono italic">
              Nenhuma transição disponível para este status / papel.
            </div>
          ) : (
            <div className="space-y-2">
              {opcoes.map((o) => (
                <label
                  key={o.status}
                  className={
                    escolha === o.status
                      ? 'flex items-start gap-2 p-2 rounded border border-accent-line bg-accent/5 cursor-pointer'
                      : 'flex items-start gap-2 p-2 rounded border border-border hover:bg-bg-hover cursor-pointer'
                  }
                >
                  <input
                    type="radio"
                    name="trans"
                    checked={escolha === o.status}
                    onChange={() => setEscolha(o.status)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="text-xs text-text font-medium">{o.label}</div>
                    <div className="text-2xs text-text-muted font-mono mt-0.5">{o.description}</div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={transicionar.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="default"
            disabled={transicionar.isPending || !escolha || opcoes.length === 0}
          >
            {transicionar.isPending ? 'Aplicando…' : 'Confirmar'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
