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
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useCreateServico, useServicos } from '../hooks/servicos'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  /** Pré-seleciona um pai (ao clicar em "+ filho" num nó da árvore). */
  parentIdInicial?: string | null
}

export function NewServicoDialog({
  open,
  onOpenChange,
  obraId,
  parentIdInicial
}: Props): ReactNode {
  const create = useCreateServico()
  const { data: servicos = [] } = useServicos(obraId)

  const [codigo, setCodigo] = useState('')
  const [nome, setNome] = useState('')
  const [parentId, setParentId] = useState<string>(parentIdInicial ?? '')
  const [unidade, setUnidade] = useState('')
  const [referencia, setReferencia] = useState('')
  const [descricao, setDescricao] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setCodigo('')
    setNome('')
    setParentId(parentIdInicial ?? '')
    setUnidade('')
    setReferencia('')
    setDescricao('')
    setError(null)
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      await create.mutateAsync({
        obra_id: obraId,
        codigo: codigo.trim(),
        nome: nome.trim(),
        parent_id: parentId || null,
        unidade: unidade.trim() || null,
        referencia_externa: referencia.trim() || undefined,
        descricao: descricao.trim() || undefined
      })
      toast.success(`Serviço "${codigo}: ${nome}" criado.`)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar serviço')
    }
  }

  const indices = servicos.filter((s) => s.unidade === null)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="md"
      disableDismiss={create.isPending}
    >
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Novo serviço</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          <div>
            <Label htmlFor="s-parent">Pai (índice)</Label>
            <Select id="s-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— raiz —</option>
              {indices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.codigo} — {s.nome}
                </option>
              ))}
            </Select>
            <div className="text-2xs text-text-dim font-mono mt-1">
              Apenas serviços sem unidade aparecem (índices).
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="s-codigo">Código</Label>
              <Input
                id="s-codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                required
                placeholder="02.03.50"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="s-unid">Unidade</Label>
              <Input
                id="s-unid"
                value={unidade}
                onChange={(e) => setUnidade(e.target.value)}
                placeholder="m³, t, m², VB… (em branco = índice)"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="s-nome">Nome</Label>
            <Input
              id="s-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              minLength={2}
              placeholder="Ex.: Capa - CBUQ"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="s-ref">Referência (opcional)</Label>
              <Input
                id="s-ref"
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
                placeholder="SINAPI 95879 / SICRO 2-S-04-…"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="s-desc">Descrição (opcional)</Label>
            <Input id="s-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" variant="default" disabled={create.isPending}>
            {create.isPending ? 'Criando…' : 'Criar serviço'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
