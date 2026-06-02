import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
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
import { cn } from '@/lib/utils'
import { useCreateServico, useServicos } from '../hooks/servicos'
import { useCpusOrfas, useCreateServicoFromCpu } from '../hooks/servico-links'
import { parseBR } from '@/lib/money'
import { nomeDaCpu } from '../lib/nomeDaCpu'

// Regex de código hierárquico: "01", "01.02", "01.02.03" — 1 a 3 dígitos por nível.
const CODIGO_REGEX = /^\d{1,3}(\.\d{1,3})*$/

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  /** Pré-seleciona um pai (ao clicar em "+ filho" num nó da árvore). */
  parentIdInicial?: string | null
}

type Modo = 'novo' | 'importar_cpu'

export function NewServicoDialog({
  open,
  onOpenChange,
  obraId,
  parentIdInicial
}: Props): ReactNode {
  const create = useCreateServico()
  const createFromCpu = useCreateServicoFromCpu()
  const { data: servicos = [] } = useServicos(obraId)
  const { data: cpusOrfas = [] } = useCpusOrfas(open ? obraId : null)

  const [modo, setModo] = useState<Modo>('novo')
  const [codigo, setCodigo] = useState('')
  const [nome, setNome] = useState('')
  const [parentId, setParentId] = useState<string>(parentIdInicial ?? '')
  const [unidade, setUnidade] = useState('')
  const [referencia, setReferencia] = useState('')
  const [descricao, setDescricao] = useState('')
  const [cpuId, setCpuId] = useState('')
  const [fator, setFator] = useState('1')
  const [error, setError] = useState<string | null>(null)

  const nextImpCodigo = useMemo(() => {
    const nums = servicos
      .map((s) => s.codigo)
      .filter((c) => /^IMP-\d+$/.test(c))
      .map((c) => parseInt(c.replace('IMP-', ''), 10))
    const n = nums.length > 0 ? Math.max(...nums) + 1 : 1
    return `IMP-${String(n).padStart(3, '0')}`
  }, [servicos])

  const reset = (): void => {
    setModo('novo')
    setCodigo('')
    setNome('')
    setParentId(parentIdInicial ?? '')
    setUnidade('')
    setReferencia('')
    setDescricao('')
    setCpuId('')
    setFator('1')
    setError(null)
  }

  const codigoTrim = codigo.trim()
  const codigoValido = codigoTrim === '' || CODIGO_REGEX.test(codigoTrim)

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (modo === 'novo') {
      if (!codigoValido) {
        setError(
          'Código inválido. Use o formato "01.02.03" (1 a 3 dígitos por nível, separados por ponto).'
        )
        return
      }
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
    } else {
      // modo === 'importar_cpu'
      if (!cpuId) {
        setError('Escolha uma CPU para importar.')
        return
      }
      const fatorN = Number(parseBR(fator).toString())
      if (!isFinite(fatorN) || fatorN === 0) {
        setError('Fator deve ser número diferente de zero.')
        return
      }
      const codigoFinal = codigo.trim() || nextImpCodigo
      const nomeFinal = nome.trim()
      const unidadeFinal = unidade.trim()
      if (!nomeFinal) {
        setError('Nome do serviço é obrigatório.')
        return
      }
      if (!unidadeFinal) {
        setError('Unidade é obrigatória (servico-folha sempre tem unidade).')
        return
      }
      try {
        await createFromCpu.mutateAsync({
          obra_id: obraId,
          codigo: codigoFinal,
          nome: nomeFinal,
          unidade: unidadeFinal,
          parent_id: parentId || null,
          cpu_id: cpuId,
          fator: fatorN
        })
        toast.success(`Serviço "${codigoFinal}: ${nomeFinal}" criado a partir da CPU.`)
        reset()
        onOpenChange(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao criar serviço')
      }
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
          <div className="flex gap-1 mt-2">
            <button
              type="button"
              onClick={() => setModo('novo')}
              className={cn(
                'px-2 py-1 text-2xs font-mono uppercase tracking-wider rounded border',
                modo === 'novo'
                  ? 'bg-accent-glow text-accent border-accent-line'
                  : 'text-text-muted hover:text-text border-transparent'
              )}
            >
              Criar do zero
            </button>
            <button
              type="button"
              onClick={() => setModo('importar_cpu')}
              className={cn(
                'px-2 py-1 text-2xs font-mono uppercase tracking-wider rounded border',
                modo === 'importar_cpu'
                  ? 'bg-accent-glow text-accent border-accent-line'
                  : 'text-text-muted hover:text-text border-transparent'
              )}
            >
              Importar CPU como serviço {cpusOrfas.length > 0 ? `(${cpusOrfas.length})` : ''}
            </button>
          </div>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          {modo === 'importar_cpu' ? (
            <div className="space-y-3">
              <div>
                <Label htmlFor="s-cpu">CPU a importar</Label>
                <Select
                  id="s-cpu"
                  value={cpuId}
                  onChange={(e) => {
                    setCpuId(e.target.value)
                    const cpu = cpusOrfas.find((c) => c.id === e.target.value)
                    if (cpu) {
                      if (!nome.trim()) setNome(nomeDaCpu(cpu))
                      if (!unidade.trim()) setUnidade(cpu.producao_diaria_unidade)
                      if (!codigo.trim()) setCodigo(nextImpCodigo)
                    }
                  }}
                  required
                  autoFocus
                >
                  <option value="">— escolha uma CPU órfã —</option>
                  {cpusOrfas.map((cpu) => (
                    <option key={cpu.id} value={cpu.id}>
                      {nomeDaCpu(cpu)} · {cpu.producao_diaria_unidade}
                    </option>
                  ))}
                </Select>
                <div className="text-2xs text-text-dim font-mono mt-1">
                  Só aparecem CPUs sem servico-dono. Após criar, será possível vincular outras CPUs
                  e ajustar fator pela página Serviços.
                </div>
              </div>

              <div>
                <Label htmlFor="s-fator-imp">Fator (divisor) inicial</Label>
                <Input
                  id="s-fator-imp"
                  inputMode="decimal"
                  value={fator}
                  onChange={(e) => setFator(e.target.value)}
                />
                <div className="text-2xs text-text-dim font-mono mt-1">
                  custo_servico = cpu.custo_unit ÷ fator. Use 1 quando unidades batem; outro valor
                  para converter (ex.: m³→ton com 2,4).
                </div>
              </div>
            </div>
          ) : null}

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
                autoFocus={modo === 'novo'}
                className={cn(!codigoValido && '!border-danger focus:!border-danger')}
                aria-invalid={!codigoValido}
              />
              <div
                className={cn(
                  'text-2xs font-mono mt-1',
                  codigoValido ? 'text-text-dim' : 'text-danger'
                )}
              >
                {codigoValido
                  ? 'Formato: 01.02.03 — 1 a 3 dígitos por nível, separados por ponto.'
                  : 'Use apenas dígitos e pontos (ex.: 01.02.03).'}
              </div>
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
            disabled={create.isPending || createFromCpu.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="default"
            disabled={
              create.isPending ||
              createFromCpu.isPending ||
              (modo === 'novo' && (!codigoValido || codigoTrim === '')) ||
              (modo === 'importar_cpu' && !cpuId)
            }
          >
            {create.isPending || createFromCpu.isPending
              ? 'Criando…'
              : modo === 'importar_cpu'
                ? 'Criar serviço a partir da CPU'
                : 'Criar serviço'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
