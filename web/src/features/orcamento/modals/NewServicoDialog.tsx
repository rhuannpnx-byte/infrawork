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
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Segmentado } from '@/components/ui/segmentado'
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

type CampoComErro = 'cpu' | 'fator' | 'codigo' | 'unidade' | 'nome'

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
  const [tentou, setTentou] = useState(false)

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
    setTentou(false)
  }

  const aoMudar = (o: boolean): void => {
    if (!o) reset()
    onOpenChange(o)
  }

  const codigoTrim = codigo.trim()
  const fatorN = Number(parseBR(fator).toString())
  const gravando = create.isPending || createFromCpu.isPending

  const erros: Partial<Record<CampoComErro, string>> = {}
  if (modo === 'novo') {
    if (!codigoTrim) erros.codigo = 'Informe o código do serviço.'
    else if (!CODIGO_REGEX.test(codigoTrim))
      erros.codigo = 'Use só algarismos e pontos, de 1 a 3 algarismos por nível, como 01.02.03.'
  } else {
    if (!cpuId) erros.cpu = 'Escolha a composição que vira serviço.'
    if (!isFinite(fatorN) || fatorN === 0)
      erros.fator = 'O fator deve ser um número diferente de zero.'
    if (!unidade.trim())
      erros.unidade = 'Informe a unidade. Serviço criado de uma composição sempre tem unidade.'
  }
  if (nome.trim().length < 2) erros.nome = 'Informe o nome do serviço.'
  const erro = (c: CampoComErro): string | undefined => (tentou ? erros[c] : undefined)

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (Object.keys(erros).length > 0) {
      setTentou(true)
      const form = e.currentTarget
      requestAnimationFrame(() =>
        form.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')?.focus()
      )
      return
    }
    if (modo === 'novo') {
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
        setError(
          `Não foi possível criar o serviço. ${err instanceof Error ? err.message : 'Tente de novo.'}`
        )
      }
    } else {
      const codigoFinal = codigo.trim() || nextImpCodigo
      const nomeFinal = nome.trim()
      const unidadeFinal = unidade.trim()
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
        toast.success(`Serviço "${codigoFinal}: ${nomeFinal}" criado a partir da composição.`)
        reset()
        onOpenChange(false)
      } catch (err) {
        setError(
          `Não foi possível criar o serviço. ${err instanceof Error ? err.message : 'Tente de novo.'}`
        )
      }
    }
  }

  const indices = servicos.filter((s) => s.unidade === null)
  const semComposicao = cpusOrfas.length === 0

  return (
    <Dialog open={open} onOpenChange={aoMudar} size="md" disableDismiss={gravando}>
      <form onSubmit={onSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>Novo serviço</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          <Segmentado
            rotulo="Como criar o serviço"
            valor={modo}
            aoMudar={(m) => {
              setModo(m)
              setTentou(false)
            }}
            opcoes={[
              { valor: 'novo', rotulo: 'Criar do zero' },
              {
                valor: 'importar_cpu',
                rotulo:
                  cpusOrfas.length > 0
                    ? `A partir de uma composição (${cpusOrfas.length})`
                    : 'A partir de uma composição'
              }
            ]}
          />

          {modo === 'importar_cpu' ? (
            <div className="space-y-3">
              <Campo
                rotulo="Composição"
                obrigatorio
                erro={erro('cpu')}
                dica={
                  semComposicao
                    ? 'Todas as composições da obra já pertencem a um serviço.'
                    : 'Só aparecem as composições que ainda não pertencem a um serviço. Depois de criar, dá para ligar outras composições e ajustar o fator na página Serviços.'
                }
              >
                <Select
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
                  autoFocus
                >
                  <option value="">
                    {semComposicao ? 'Nenhuma composição disponível' : 'Selecione…'}
                  </option>
                  {cpusOrfas.map((cpu) => (
                    <option key={cpu.id} value={cpu.id}>
                      {nomeDaCpu(cpu)} · {cpu.producao_diaria_unidade}
                    </option>
                  ))}
                </Select>
              </Campo>

              <Campo
                rotulo="Fator inicial (divisor)"
                obrigatorio
                erro={erro('fator')}
                dica="O custo do serviço é o custo unitário da composição dividido pelo fator. Use 1 quando as unidades são iguais, ou outro valor para converter (ex.: 2,4 para passar de m³ para t)."
              >
                <Input
                  inputMode="decimal"
                  autoComplete="off"
                  value={fator}
                  onChange={(e) => setFator(e.target.value)}
                  className="tabular text-right"
                />
              </Campo>
            </div>
          ) : null}

          <Campo rotulo="Dentro de" dica="Só aparecem os índices, que são os serviços sem unidade.">
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">Raiz</option>
              {indices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.codigo} · {s.nome}
                </option>
              ))}
            </Select>
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo
              rotulo="Código"
              obrigatorio={modo === 'novo'}
              erro={erro('codigo')}
              dica={
                modo === 'novo'
                  ? 'De 1 a 3 algarismos por nível, separados por ponto.'
                  : `Em branco, usa ${nextImpCodigo}.`
              }
            >
              <Input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Ex.: 02.03.50"
                autoComplete="off"
                autoFocus={modo === 'novo'}
              />
            </Campo>
            <Campo
              rotulo="Unidade"
              obrigatorio={modo === 'importar_cpu'}
              erro={erro('unidade')}
              dica={modo === 'novo' ? 'Em branco, o serviço vira um índice.' : undefined}
            >
              <Input
                value={unidade}
                onChange={(e) => setUnidade(e.target.value)}
                autoComplete="off"
                placeholder="Ex.: m³, t, m²"
              />
            </Campo>
          </div>

          <Campo rotulo="Nome" obrigatorio erro={erro('nome')}>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              autoComplete="off"
              placeholder="Ex.: Capa de CBUQ"
            />
          </Campo>

          {modo === 'novo' ? (
            <>
              <Campo rotulo="Referência" dica="Opcional. Código na tabela de referência.">
                <Input
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  autoComplete="off"
                  placeholder="Ex.: SINAPI 95879"
                />
              </Campo>
              <Campo rotulo="Descrição" dica="Opcional.">
                <Input
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  autoComplete="off"
                />
              </Campo>
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => aoMudar(false)}
            disabled={gravando}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={gravando}>
            {gravando ? 'Criando…' : 'Criar serviço'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
