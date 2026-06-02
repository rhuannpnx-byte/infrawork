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
  /** Mapa id → número da linha (estilo MS Project). Usado pra exibir options
   *  como "#N — Nome" ao invés do código EAP, que pode estar vazio em marcos. */
  numeroById?: Map<string, number>
  /** Callback após adicionar com sucesso — usado pra disparar recálculo. */
  onAdded?: () => void
}

export function AddDependenciaDialog({
  open,
  onOpenChange,
  planejamentoId,
  sucessora,
  tarefas,
  numeroById,
  onAdded
}: Props): ReactNode {
  const add = useAddDependencia()
  const [predecessoraId, setPredecessoraId] = useState('')
  const [tipo, setTipo] = useState<DependenciaTipo>('FS')
  const [lag, setLag] = useState(0)
  const [error, setError] = useState<string | null>(null)

  if (!sucessora) return null

  // Grupos são nós organizacionais e não entram no CPM (a edge function pula
  // `tipo_no='grupo'`), então não podem ser predecessores. Marcos e tarefas
  // sim. Tambem exclui a própria sucessora e tarefas já vinculadas.
  const candidatas = tarefas
    .filter(
      (t) =>
        t.tipo_no !== 'grupo' &&
        t.id !== sucessora.id &&
        !sucessora.predecessoras.some((p) => p.predecessora_id === t.id)
    )
    .sort((a, b) => {
      // Se temos número (ordem visual MS Project), ordena por ele. Senão cai
      // pra código EAP.
      const na = numeroById?.get(a.id) ?? Number.POSITIVE_INFINITY
      const nb = numeroById?.get(b.id) ?? Number.POSITIVE_INFINITY
      if (na !== nb) return na - nb
      const ca = a.codigo_eap ?? a.servico_grupo_codigo ?? ''
      const cb = b.codigo_eap ?? b.servico_grupo_codigo ?? ''
      return ca.localeCompare(cb, 'pt-BR', { numeric: true })
    })

  const marcosCandidatos = candidatas.filter((t) => t.tipo_no === 'marco')
  const tarefasCandidatas = candidatas.filter((t) => t.tipo_no === 'tarefa')

  const labelTarefa = (t: PlanejamentoTarefaCompleta): string => {
    const num = numeroById?.get(t.id)
    const descricao = t.nome_custom ?? t.servico_grupo_descricao ?? '(sem descrição)'
    const prefixo = t.tipo_no === 'marco' ? '[Marco] ' : ''
    const numStr = num != null ? `#${num} — ` : ''
    return `${numStr}${prefixo}${descricao}`
  }

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
      toast.success('Dependência adicionada. Recalculando cronograma…')
      reset()
      onOpenChange(false)
      onAdded?.()
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
            <span className="text-text">{labelTarefa(sucessora)}</span>
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
              <option value="">
                {candidatas.length === 0
                  ? 'Nenhuma tarefa/marco disponível como predecessora'
                  : 'Selecione…'}
              </option>
              {marcosCandidatos.length > 0 ? (
                <optgroup label={`Marcos (${marcosCandidatos.length})`}>
                  {marcosCandidatos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {labelTarefa(t)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {tarefasCandidatas.length > 0 ? (
                <optgroup label={`Tarefas (${tarefasCandidatas.length})`}>
                  {tarefasCandidatas.map((t) => (
                    <option key={t.id} value={t.id}>
                      {labelTarefa(t)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            {candidatas.length === 0 ? (
              <p className="text-2xs text-text-dim font-mono mt-1">
                Todas as outras tarefas/marcos desta revisão já estão vinculadas como
                predecessoras (ou só existem grupos, que não entram no CPM).
              </p>
            ) : (
              <p className="text-2xs text-text-dim font-mono mt-1">
                {marcosCandidatos.length} marco(s) · {tarefasCandidatas.length} tarefa(s)
                disponível(is).
              </p>
            )}
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
                {(['FS', 'SS', 'FF', 'SF'] as DependenciaTipo[]).map((t) => (
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
            ambas terminam juntas. SF = predecessora começa antes da sucessora terminar (raro —
            janelas just-in-time). Lag negativo = lead (sobreposição).
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
