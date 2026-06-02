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
import { Button } from '@/components/ui/button'
import { useUpdateTarefa, traduzirErroPlanejamento } from '../hooks/tarefas'
import type { PlanejamentoTarefaCompleta } from '@/types/planejamento'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tarefa: PlanejamentoTarefaCompleta | null
  readOnly?: boolean
}

/**
 * Modal dedicado pra editar a observação (notas) de uma tarefa. Substitui a
 * antiga aba "Notas" do TarefaDetailPanel. Aberto a partir da célula `notas`
 * do Gantt.
 */
export function NotasModal({ open, onOpenChange, tarefa, readOnly = false }: Props): ReactNode {
  const update = useUpdateTarefa()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Sincroniza com a tarefa selecionada ao abrir
  useEffect(() => {
    if (open && tarefa) {
      setDraft(tarefa.notas ?? '')
      setError(null)
    }
  }, [open, tarefa?.id, tarefa?.notas])

  if (!tarefa) return null

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    const next = draft.trim() === '' ? null : draft
    if (next === (tarefa.notas ?? null)) {
      onOpenChange(false)
      return
    }
    try {
      await update.mutateAsync({
        id: tarefa.id,
        planejamento_id: tarefa.planejamento_id,
        notas: next
      })
      toast.success('Observação salva.')
      onOpenChange(false)
    } catch (err) {
      setError(traduzirErroPlanejamento(err))
    }
  }

  const sujo = draft !== (tarefa.notas ?? '')

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md" disableDismiss={update.isPending}>
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <div className="text-2xs font-mono text-text-dim mb-1">
            {tarefa.codigo_eap ?? tarefa.servico_grupo_codigo ?? '—'}
          </div>
          <DialogTitle>
            Observação · {tarefa.nome_custom ?? tarefa.servico_grupo_descricao ?? '(sem nome)'}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-2">
          <DialogErrorBanner message={error} />
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Contexto, restrições, fontes de prazo, dependências externas, etc."
            disabled={readOnly}
            rows={8}
            className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs font-mono focus:border-accent focus:outline-none resize-y min-h-[120px]"
            autoFocus
          />
          <div className="text-2xs text-text-dim font-mono">
            {draft.length === 0 ? 'Vazio (campo opcional).' : `${draft.length} caracteres.`}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            Cancelar
          </Button>
          {!readOnly ? (
            <Button type="submit" variant="default" disabled={update.isPending || !sujo}>
              {update.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          ) : null}
        </DialogFooter>
      </form>
    </Dialog>
  )
}
