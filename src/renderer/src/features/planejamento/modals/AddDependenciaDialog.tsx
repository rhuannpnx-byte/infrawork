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
import {
  DEPENDENCIA_LABEL,
  type DependenciaTipo,
  type PlanejamentoTarefaCompleta
} from '@/types/planejamento'
import { useAddDependencia } from '../hooks/dependencias'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  planejamentoId: string
  sucessora: PlanejamentoTarefaCompleta | null
  tarefas: PlanejamentoTarefaCompleta[]
}

export function AddDependenciaDialog({
  open,
  onOpenChange,
  planejamentoId,
  sucessora,
  tarefas
}: Props): ReactNode {
  const add = useAddDependencia()
  const [predecessoraId, setPredecessoraId] = useState('')
  const [tipo, setTipo] = useState<DependenciaTipo>('FS')
  const [lag, setLag] = useState(0)
  const [error, setError] = useState<string | null>(null)

  if (!sucessora) return null

  const candidatas = tarefas.filter(
    (t) =>
      t.id !== sucessora.id &&
      !sucessora.predecessoras.some((p) => p.predecessora_id === t.id)
  )

  const reset = (): void => {
    setPredecessoraId('')
    setTipo('FS')
    setLag(0)
    setError(null)
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (!predecessoraId) {
      setError('Selecione a predecessora.')
      return
    }
    try {
      await add.mutateAsync({
        planejamento_id: planejamentoId,
        predecessora_id: predecessoraId,
        sucessora_id: sucessora.id,
        tipo,
        lag_dias: lag
      })
      toast.success('Dependência adicionada.')
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao adicionar dependência')
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
      disableDismiss={add.isPending}
    >
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Adicionar dependência</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          <div className="text-xs font-mono p-2 bg-bg rounded border border-border">
            <span className="text-text-dim">Sucessora:</span>{' '}
            <span className="text-text">
              {sucessora.servico_grupo_codigo} {sucessora.servico_grupo_descricao}
            </span>
          </div>

          <div>
            <Label htmlFor="dep-pred">Predecessora</Label>
            <select
              id="dep-pred"
              value={predecessoraId}
              onChange={(e) => setPredecessoraId(e.target.value)}
              required
              className="w-full bg-bg border border-border rounded px-2 py-1 text-xs font-mono"
            >
              <option value="">Selecione…</option>
              {candidatas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.servico_grupo_codigo} — {t.servico_grupo_descricao}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="dep-tipo">Tipo</Label>
              <select
                id="dep-tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as DependenciaTipo)}
                className="w-full bg-bg border border-border rounded px-2 py-1 text-xs font-mono"
              >
                {(['FS', 'SS', 'FF'] as DependenciaTipo[]).map((t) => (
                  <option key={t} value={t}>
                    {t} — {DEPENDENCIA_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="dep-lag">Lag (dias úteis)</Label>
              <Input
                id="dep-lag"
                type="number"
                value={lag}
                onChange={(e) => setLag(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="text-2xs text-text-dim font-mono">
            FS = predecessora termina antes da sucessora começar. SS = ambas começam juntas. FF =
            ambas terminam juntas. Lag negativo = lead (sobreposição).
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={add.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" variant="default" disabled={add.isPending}>
            {add.isPending ? 'Adicionando…' : 'Adicionar'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
