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
import { parseBR } from '@/lib/money'
import { useCreateRecurso } from '../hooks/recursos'
import { RECURSO_GRUPO_LABEL, type RecursoGrupo } from '@/types/orcamento'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

const GRUPOS: RecursoGrupo[] = ['MO', 'MVE', 'COMBUSTIVEL', 'MATERIAL', 'ADM']

export function NewRecursoDialog({ open, onOpenChange, obraId }: Props): ReactNode {
  const create = useCreateRecurso()
  const [grupo, setGrupo] = useState<RecursoGrupo>('MATERIAL')
  const [nome, setNome] = useState('')
  const [codigo, setCodigo] = useState('')
  const [unidade, setUnidade] = useState('')
  const [precoInicial, setPrecoInicial] = useState('')
  const [observacao, setObservacao] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setGrupo('MATERIAL')
    setNome('')
    setCodigo('')
    setUnidade('')
    setPrecoInicial('')
    setObservacao('')
    setError(null)
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      const preco = precoInicial.trim() ? parseBR(precoInicial).toNumber() : undefined
      if (preco !== undefined && (isNaN(preco) || preco < 0)) {
        setError('Preço inicial inválido.')
        return
      }
      await create.mutateAsync({
        obra_id: obraId,
        grupo,
        nome: nome.trim(),
        codigo: codigo.trim() || undefined,
        unidade: unidade.trim(),
        observacao: observacao.trim() || undefined,
        preco_inicial: preco
      })
      toast.success(`Recurso "${nome}" criado.`)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar recurso')
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
      disableDismiss={create.isPending}
    >
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Novo recurso</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="r-grupo">Grupo</Label>
              <Select
                id="r-grupo"
                value={grupo}
                onChange={(e) => setGrupo(e.target.value as RecursoGrupo)}
              >
                {GRUPOS.map((g) => (
                  <option key={g} value={g}>
                    {RECURSO_GRUPO_LABEL[g]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="r-unidade">Unidade</Label>
              <Input
                id="r-unidade"
                value={unidade}
                onChange={(e) => setUnidade(e.target.value)}
                required
                placeholder="h, L, m³, kg, …"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="r-nome">Nome</Label>
            <Input
              id="r-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              minLength={2}
              autoFocus
              placeholder="Ex.: Diesel S10, Servente, Caminhão basculante 14 m³"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="r-codigo">Código (opcional)</Label>
              <Input
                id="r-codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Ex.: SINAPI 87.412"
              />
            </div>
            <div>
              <Label htmlFor="r-preco">Preço inicial (opcional)</Label>
              <Input
                id="r-preco"
                value={precoInicial}
                onChange={(e) => setPrecoInicial(e.target.value)}
                placeholder="R$/unidade"
                inputMode="decimal"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="r-obs">Observação (opcional)</Label>
            <Input
              id="r-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Fonte, contexto, etc."
            />
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
            {create.isPending ? 'Criando…' : 'Criar recurso'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
