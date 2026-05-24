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
import { useUpsertIndireto } from '../hooks/indireto'
import { INDIRETO_TIPO_LABEL, type IndiretoTipo } from '@/types/orcamento'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

const TIPOS: IndiretoTipo[] = ['mobilizacao', 'desmob', 'admin_local', 'outros']

export function NewIndiretoDialog({ open, onOpenChange, obraId }: Props): ReactNode {
  const upsert = useUpsertIndireto()
  const [codigo, setCodigo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [tipo, setTipo] = useState<IndiretoTipo>('admin_local')
  const [valor, setValor] = useState('')
  const [distribuicao, setDistribuicao] = useState('100')
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setCodigo('')
    setDescricao('')
    setTipo('admin_local')
    setValor('')
    setDistribuicao('100')
    setError(null)
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    const v = Number(valor.replace(',', '.'))
    const d = Number(distribuicao.replace(',', '.'))
    if (isNaN(v) || v < 0) {
      setError('Valor inválido.')
      return
    }
    if (isNaN(d) || d < 0 || d > 100) {
      setError('Distribuição deve estar entre 0 e 100%.')
      return
    }
    try {
      await upsert.mutateAsync({
        obra_id: obraId,
        codigo: codigo.trim(),
        descricao: descricao.trim(),
        tipo,
        valor_total: v,
        distribuicao_perc: d / 100
      })
      toast.success('Custo indireto criado.')
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar')
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
      disableDismiss={upsert.isPending}
    >
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Novo custo indireto</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="in-cod">Código</Label>
              <Input
                id="in-cod"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                required
                placeholder="IND.01"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="in-tipo">Tipo</Label>
              <Select
                id="in-tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as IndiretoTipo)}
              >
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {INDIRETO_TIPO_LABEL[t]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="in-desc">Descrição</Label>
            <Input
              id="in-desc"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              required
              minLength={2}
              placeholder="Ex.: Mobilização inicial da equipe"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="in-valor">Valor total (R$)</Label>
              <Input
                id="in-valor"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                required
                inputMode="decimal"
              />
            </div>
            <div>
              <Label htmlFor="in-dist">Distribuição (%)</Label>
              <Input
                id="in-dist"
                value={distribuicao}
                onChange={(e) => setDistribuicao(e.target.value)}
                inputMode="decimal"
              />
              <div className="text-2xs text-text-dim font-mono mt-1">
                Quanto do valor entra na lucratividade (100 = total).
              </div>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={upsert.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" variant="default" disabled={upsert.isPending}>
            {upsert.isPending ? 'Criando…' : 'Criar'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
