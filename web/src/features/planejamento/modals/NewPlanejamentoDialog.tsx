import { useState, type FormEvent, type ReactNode } from 'react'
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
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import {
  useCreatePlanejamento,
  useCopiarPlanejamento,
  usePlanejamentos
} from '../hooks/planejamentos'
import { useObra } from '@/features/gerencial/hooks'
import { hojeLocalISO } from '@/lib/format/local-date'
import { contar } from '@/lib/rotulos'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  onCreated?: (id: string) => void
}

type CampoComErro = 'nome' | 'data'

export function NewPlanejamentoDialog({ open, onOpenChange, obraId, onCreated }: Props): ReactNode {
  const create = useCreatePlanejamento()
  const copiar = useCopiarPlanejamento()
  const { data: planejamentos = [] } = usePlanejamentos(obraId)
  const { data: obra } = useObra(obraId)

  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  // sem edição, a data é o início planejado da obra (Gerencial › Obras) ou hoje
  const [dataEditada, setDataRef] = useState<string | null>(null)
  const dataRef = dataEditada ?? obra?.data_inicio_planejada ?? hojeLocalISO()
  const [copiarDe, setCopiarDe] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)

  const reset = (): void => {
    setNome('')
    setDescricao('')
    setDataRef(null)
    setCopiarDe('')
    setError(null)
    setTentou(false)
  }

  const aoMudar = (o: boolean): void => {
    if (!o) reset()
    onOpenChange(o)
  }

  const erros: Partial<Record<CampoComErro, string>> = {}
  if (nome.trim().length < 2) erros.nome = 'Informe o nome do plano.'
  if (!dataRef) erros.data = 'Informe a data de início da obra.'
  const erro = (c: CampoComErro): string | undefined => (tentou ? erros[c] : undefined)

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (Object.keys(erros).length > 0) {
      setTentou(true)
      const form = e.currentTarget
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
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
        toast.success(
          `Plano "${nome}" criado com ${contar(r.tarefas_copiadas, 'tarefa copiada', 'tarefas copiadas')}.`
        )
      } else {
        const r = await create.mutateAsync({
          obra_id: obraId,
          nome: nome.trim(),
          descricao: descricao.trim() || undefined,
          data_referencia_inicio: dataRef
        })
        id = r.id
        toast.success(`Plano "${nome}" criado.`)
      }
      reset()
      onCreated?.(id)
      onOpenChange(false)
    } catch (err) {
      setError(
        `Não foi possível criar o plano. ${err instanceof Error ? err.message : 'Tente de novo.'}`
      )
    }
  }

  const loading = create.isPending || copiar.isPending

  return (
    <Dialog open={open} onOpenChange={aoMudar} size="md" disableDismiss={loading}>
      <form onSubmit={onSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>Novo plano</DialogTitle>
          <DialogDescription>
            Um plano é uma versão do cronograma. Comece do zero ou copie as tarefas de outro plano.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          <Campo rotulo="Nome" obrigatorio erro={erro('nome')}>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              autoComplete="off"
              data-foco-inicial
              placeholder="Ex.: Inicial, Replanejamento de maio, Após as chuvas"
            />
          </Campo>

          <Campo rotulo="Descrição" dica="Opcional. O que muda neste plano.">
            <Input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              autoComplete="off"
            />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo
              rotulo="Início da obra"
              obrigatorio
              erro={erro('data')}
              dica="Data de referência do cronograma."
            >
              <Input type="date" value={dataRef} onChange={(e) => setDataRef(e.target.value)} />
            </Campo>
            <Campo
              rotulo="Copiar tarefas de"
              dica={
                copiarDe
                  ? 'As tarefas vêm do plano escolhido, ajustadas para a data de início.'
                  : 'Do zero, as tarefas são criadas no cronograma, a partir das quantidades por local ou dos serviços do orçamento.'
              }
            >
              <Select value={copiarDe} onChange={(e) => setCopiarDe(e.target.value)}>
                <option value="">Começar do zero, sem tarefas</option>
                {planejamentos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                    {p.is_baseline ? ' (linha de base)' : ''}
                  </option>
                ))}
              </Select>
            </Campo>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => aoMudar(false)}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Criando…' : 'Criar plano'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
