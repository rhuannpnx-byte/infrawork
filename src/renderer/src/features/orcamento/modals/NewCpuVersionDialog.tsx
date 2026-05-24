import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
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
import { useCreateCpu } from '../hooks/cpus'
import { useServicos } from '../hooks/servicos'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  /** Se passado, fixa o serviço (sem dropdown). */
  servicoIdFixo?: string
}

export function NewCpuVersionDialog({
  open,
  onOpenChange,
  obraId,
  servicoIdFixo
}: Props): ReactNode {
  const create = useCreateCpu()
  const navigate = useNavigate()
  const { data: servicos = [] } = useServicos(obraId)

  const [servicoId, setServicoId] = useState<string>(servicoIdFixo ?? '')
  const [producao, setProducao] = useState('1')
  const [unidade, setUnidade] = useState('DIA')
  const [notas, setNotas] = useState('')
  const [vigente, setVigente] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setServicoId(servicoIdFixo ?? '')
    setProducao('1')
    setUnidade('DIA')
    setNotas('')
    setVigente(true)
    setError(null)
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    const prod = Number(producao.replace(',', '.'))
    if (isNaN(prod) || prod <= 0) {
      setError('Produção diária precisa ser > 0.')
      return
    }
    if (!servicoId) {
      setError('Selecione um serviço.')
      return
    }
    try {
      const { id } = await create.mutateAsync({
        obra_id: obraId,
        servico_id: servicoId,
        producao_diaria_qtde: prod,
        producao_diaria_unidade: unidade,
        encargos_sociais_id: null,
        notas: notas.trim() || undefined,
        marcar_vigente: vigente
      })
      toast.success('CPU criada. Abrindo editor…')
      reset()
      onOpenChange(false)
      void navigate({ to: '/orcamento/cpus/$id', params: { id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar CPU')
    }
  }

  const servicosFolha = servicos.filter((s) => s.unidade !== null)

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
          <DialogTitle>Nova CPU</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          {!servicoIdFixo ? (
            <div>
              <Label htmlFor="c-serv">Serviço</Label>
              <Select
                id="c-serv"
                value={servicoId}
                onChange={(e) => setServicoId(e.target.value)}
                required
              >
                <option value="">Selecione…</option>
                {servicosFolha.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.codigo} — {s.nome} ({s.unidade})
                  </option>
                ))}
              </Select>
              <div className="text-2xs text-text-dim font-mono mt-1">
                Apenas serviços com unidade definida (folhas).
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-prod">Produção diária</Label>
              <Input
                id="c-prod"
                value={producao}
                onChange={(e) => setProducao(e.target.value)}
                required
                inputMode="decimal"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="c-prod-un">Unidade da produção</Label>
              <Input
                id="c-prod-un"
                value={unidade}
                onChange={(e) => setUnidade(e.target.value)}
                placeholder="DIA"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="c-notas">Notas (opcional)</Label>
            <Input id="c-notas" value={notas} onChange={(e) => setNotas(e.target.value)} />
          </div>

          <label className="flex items-center gap-2 text-xs text-text-muted font-mono">
            <input
              type="checkbox"
              checked={vigente}
              onChange={(e) => setVigente(e.target.checked)}
            />
            Marcar como vigente (revoga versões anteriores do mesmo serviço)
          </label>
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
            {create.isPending ? 'Criando…' : 'Criar e editar'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
