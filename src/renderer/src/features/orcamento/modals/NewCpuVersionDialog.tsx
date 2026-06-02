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
import { parseBR } from '@/lib/money'
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

  const [nome, setNome] = useState('')
  const [servicoId, setServicoId] = useState<string>(servicoIdFixo ?? '')
  const [producao, setProducao] = useState('1')
  const [unidade, setUnidade] = useState('')
  const [notas, setNotas] = useState('')
  const [vigente, setVigente] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setNome('')
    setServicoId(servicoIdFixo ?? '')
    setProducao('1')
    setUnidade('')
    setNotas('')
    setVigente(true)
    setError(null)
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (!nome.trim()) {
      setError('Nome da CPU é obrigatório.')
      return
    }
    const prod = parseBR(producao).toNumber()
    if (isNaN(prod) || prod <= 0) {
      setError('Produção diária precisa ser > 0.')
      return
    }
    const unidadeTrim = unidade.trim()
    if (!unidadeTrim) {
      setError('Unidade da produção é obrigatória (ex.: m³, m², t, un, m).')
      return
    }
    if (unidadeTrim.toUpperCase() === 'DIA') {
      setError('Unidade não pode ser "DIA". Informe a unidade dimensional produzida por dia (m³, m², t, un, m).')
      return
    }
    try {
      const { id } = await create.mutateAsync({
        obra_id: obraId,
        nome: nome.trim(),
        servico_id: servicoId || null,
        producao_diaria_qtde: prod,
        producao_diaria_unidade: unidadeTrim,
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

          <div>
            <Label htmlFor="c-nome">Nome da CPU *</Label>
            <Input
              id="c-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              minLength={2}
              autoFocus
              placeholder="Ex.: Produção CBUQ, Aplicação base granular…"
            />
            <div className="text-2xs text-text-dim font-mono mt-1">
              Nome técnico da composição. Independente de serviço — você pode vincular essa CPU a um
              servico-agregador depois (pela página Serviços) com fator de conversão e operação (×
              ou ÷).
            </div>
          </div>

          {!servicoIdFixo ? (
            <div>
              <Label htmlFor="c-serv">Serviço-dono (opcional)</Label>
              <Select id="c-serv" value={servicoId} onChange={(e) => setServicoId(e.target.value)}>
                <option value="">— sem servico-dono —</option>
                {servicosFolha.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.codigo} — {s.nome} ({s.unidade})
                  </option>
                ))}
              </Select>
              <div className="text-2xs text-text-dim font-mono mt-1">
                Apenas serviços com unidade definida (folhas). Deixe em branco pra criar uma CPU
                órfã — você pode vinculá-la depois.
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
              />
            </div>
            <div>
              <Label htmlFor="c-prod-un">Unidade da produção *</Label>
              <Input
                id="c-prod-un"
                value={unidade}
                onChange={(e) => setUnidade(e.target.value)}
                required
                minLength={1}
                placeholder="m³, m², t, un, m, vb…"
              />
              <div className="text-2xs text-text-dim font-mono mt-1">
                Unidade dimensional produzida por dia (não use "DIA").
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="c-notas">Notas (opcional)</Label>
            <Input id="c-notas" value={notas} onChange={(e) => setNotas(e.target.value)} />
          </div>

          {servicoId ? (
            <label className="flex items-center gap-2 text-xs text-text-muted font-mono">
              <input
                type="checkbox"
                checked={vigente}
                onChange={(e) => setVigente(e.target.checked)}
              />
              Marcar como vigente (revoga versões anteriores do mesmo serviço)
            </label>
          ) : null}
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
