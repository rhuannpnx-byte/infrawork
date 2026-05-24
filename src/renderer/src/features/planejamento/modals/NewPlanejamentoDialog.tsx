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
  useCreatePlanejamento,
  useCopiarPlanejamento,
  usePlanejamentos
} from '../hooks/planejamentos'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  dataInicioPadrao?: string | null
  onCreated?: (id: string) => void
}

export function NewPlanejamentoDialog({
  open,
  onOpenChange,
  obraId,
  dataInicioPadrao,
  onCreated
}: Props): ReactNode {
  const create = useCreatePlanejamento()
  const copiar = useCopiarPlanejamento()
  const { data: planejamentos = [] } = usePlanejamentos(obraId)

  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [dataRef, setDataRef] = useState(
    dataInicioPadrao ?? new Date().toISOString().slice(0, 10)
  )
  const [copiarDe, setCopiarDe] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setNome('')
    setDescricao('')
    setDataRef(dataInicioPadrao ?? new Date().toISOString().slice(0, 10))
    setCopiarDe('')
    setError(null)
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      let id: string
      if (copiarDe) {
        const r = await copiar.mutateAsync({
          origem_id: copiarDe,
          nome_novo: nome.trim(),
          ajuste_data_inicio: dataRef,
          obra_id: obraId
        })
        id = r.novo_id
        toast.success(`Revisão "${nome}" criada copiando ${r.tarefas_copiadas} tarefa(s).`)
      } else {
        const r = await create.mutateAsync({
          obra_id: obraId,
          nome: nome.trim(),
          descricao: descricao.trim() || undefined,
          data_referencia_inicio: dataRef
        })
        id = r.id
        toast.success(`Revisão "${nome}" criada.`)
      }
      reset()
      onCreated?.(id)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar planejamento')
    }
  }

  const loading = create.isPending || copiar.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="md"
      disableDismiss={loading}
    >
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Nova revisão de planejamento</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          <div>
            <Label htmlFor="p-nome">Nome</Label>
            <Input
              id="p-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              minLength={2}
              autoFocus
              placeholder="Ex.: Inicial, Replan Maio 2026, Após chuva"
            />
          </div>

          <div>
            <Label htmlFor="p-desc">Descrição (opcional)</Label>
            <Input
              id="p-desc"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="O que mudou nesta revisão?"
            />
          </div>

          <div>
            <Label htmlFor="p-data">Data de referência (início da obra)</Label>
            <Input
              id="p-data"
              type="date"
              value={dataRef}
              onChange={(e) => setDataRef(e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="p-copiar">Copiar tarefas de</Label>
            <select
              id="p-copiar"
              value={copiarDe}
              onChange={(e) => setCopiarDe(e.target.value)}
              className="w-full bg-bg border border-border rounded px-2 py-1 text-xs font-mono"
            >
              <option value="">— Começar do zero (sem tarefas) —</option>
              {planejamentos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome} {p.is_baseline ? '(baseline)' : ''}
                </option>
              ))}
            </select>
            <div className="text-2xs text-text-dim font-mono mt-1">
              Se "começar do zero", use o botão "Sincronizar com orçamento" depois para
              importar todos os servico_grupo.
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button type="submit" variant="default" disabled={loading}>
            {loading ? 'Criando…' : 'Criar revisão'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
