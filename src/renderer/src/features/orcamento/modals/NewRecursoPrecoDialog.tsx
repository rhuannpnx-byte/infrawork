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
import { parseBR } from '@/lib/money'
import { useAddRecursoPreco } from '../hooks/recursos'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  recursoId: string
  recursoNome: string
}

export function NewRecursoPrecoDialog({
  open,
  onOpenChange,
  recursoId,
  recursoNome
}: Props): ReactNode {
  const add = useAddRecursoPreco()
  const today = new Date().toISOString().slice(0, 10)
  const [custo, setCusto] = useState('')
  const [vigenciaInicio, setVigenciaInicio] = useState(today)
  const [origem, setOrigem] = useState('')
  const [observacao, setObservacao] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setCusto('')
    setVigenciaInicio(today)
    setOrigem('')
    setObservacao('')
    setError(null)
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    // parseBR: remove separador de milhar (.) ANTES de trocar a vírgula.
    const valor = parseBR(custo).toNumber()
    if (isNaN(valor) || valor < 0) {
      setError('Custo inválido.')
      return
    }
    try {
      await add.mutateAsync({
        recurso_id: recursoId,
        custo_unitario: valor,
        vigencia_inicio: vigenciaInicio,
        origem: origem.trim() || undefined,
        observacao: observacao.trim() || undefined
      })
      toast.success('Preço registrado.')
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao registrar preço')
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
          <DialogTitle>Novo preço — {recursoNome}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <div className="text-2xs text-text-dim font-mono">
            O preço anterior em aberto será fechado em (vigência − 1d) automaticamente.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-custo">Custo unitário</Label>
              <Input
                id="p-custo"
                value={custo}
                onChange={(e) => setCusto(e.target.value)}
                required
                inputMode="decimal"
                autoFocus
                placeholder="R$/unidade"
              />
            </div>
            <div>
              <Label htmlFor="p-vig">Vigência a partir de</Label>
              <Input
                id="p-vig"
                type="date"
                value={vigenciaInicio}
                onChange={(e) => setVigenciaInicio(e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <Label htmlFor="p-origem">Origem (opcional)</Label>
            <Input
              id="p-origem"
              value={origem}
              onChange={(e) => setOrigem(e.target.value)}
              placeholder="Ex.: Cotação Fornecedor X, contrato N123, SINAPI 2026-04"
            />
          </div>
          <div>
            <Label htmlFor="p-obs">Observação (opcional)</Label>
            <Input id="p-obs" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
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
            {add.isPending ? 'Registrando…' : 'Registrar preço'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
