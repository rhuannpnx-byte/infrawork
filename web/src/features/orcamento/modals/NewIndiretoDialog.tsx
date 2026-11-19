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
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { parseBR } from '@/lib/money'
import { useUpsertIndireto } from '../hooks/indireto'
import { INDIRETO_TIPO_LABEL, type Indireto, type IndiretoTipo } from '@/types/orcamento'
import { detalheDoErro } from '@/features/orcamento/lib/erro'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  /** Item a editar; sem ele o diálogo cria um novo. */
  item?: Indireto | null
}

const TIPOS: IndiretoTipo[] = ['mobilizacao', 'desmob', 'admin_local', 'outros']

/** Só algarismos, ponto e vírgula: o que o `parseBR` entende como número. */
const NUMERO = /^\d[\d.,]*$/

type CampoComErro = 'codigo' | 'descricao' | 'valor' | 'distribuicao'

/** Número no formato do campo (vírgula decimal, sem milhar). */
const paraCampo = (n: number, casas: number): string =>
  String(Math.round(Number(n) * 10 ** casas) / 10 ** casas).replace('.', ',')

export function NewIndiretoDialog({ open, onOpenChange, obraId, item }: Props): ReactNode {
  const upsert = useUpsertIndireto()
  const editando = !!item
  const inicial = {
    codigo: item?.codigo ?? '',
    descricao: item?.descricao ?? '',
    tipo: item?.tipo ?? ('admin_local' as IndiretoTipo),
    valor: item ? paraCampo(item.valor_total, 2) : '',
    distribuicao: item ? paraCampo(Number(item.distribuicao_perc) * 100, 4) : '100'
  }
  const [codigo, setCodigo] = useState(inicial.codigo)
  const [descricao, setDescricao] = useState(inicial.descricao)
  const [tipo, setTipo] = useState<IndiretoTipo>(inicial.tipo)
  const [valor, setValor] = useState(inicial.valor)
  const [distribuicao, setDistribuicao] = useState(inicial.distribuicao)
  const [error, setError] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)

  const reset = (): void => {
    setCodigo(inicial.codigo)
    setDescricao(inicial.descricao)
    setTipo(inicial.tipo)
    setValor(inicial.valor)
    setDistribuicao(inicial.distribuicao)
    setError(null)
    setTentou(false)
  }

  const aoMudar = (o: boolean): void => {
    if (!o) reset()
    onOpenChange(o)
  }

  // parseBR: remove separador de milhar (.) ANTES de trocar a vírgula.
  const v = parseBR(valor).toNumber()
  const d = parseBR(distribuicao).toNumber()

  const erros: Partial<Record<CampoComErro, string>> = {}
  if (!codigo.trim()) erros.codigo = 'Informe o código.'
  if (descricao.trim().length < 2) erros.descricao = 'Informe a descrição do custo.'
  if (!valor.trim()) erros.valor = 'Informe o valor total.'
  else if (!NUMERO.test(valor.trim()) || isNaN(v) || v < 0)
    erros.valor = 'Digite o valor como um número, por exemplo 125.000,00.'
  if ((distribuicao.trim() && !NUMERO.test(distribuicao.trim())) || isNaN(d) || d < 0 || d > 100)
    erros.distribuicao = 'A distribuição deve ficar entre 0 e 100%.'
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
      await upsert.mutateAsync({
        id: item?.id,
        parent_id: item?.parent_id ?? null,
        ordem: item?.ordem ?? 0,
        obra_id: obraId,
        codigo: codigo.trim(),
        descricao: descricao.trim(),
        tipo,
        valor_total: v,
        distribuicao_perc: d / 100
      })
      toast.success(editando ? 'Custo indireto atualizado.' : 'Custo indireto criado.')
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(
        `Não foi possível ${editando ? 'salvar' : 'criar'} o custo indireto. ${detalheDoErro(err) ?? 'Tente de novo.'}`
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={aoMudar} size="md" disableDismiss={upsert.isPending}>
      <form onSubmit={onSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>{editando ? 'Editar custo indireto' : 'Novo custo indireto'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Código" obrigatorio erro={erro('codigo')}>
              <Input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Ex.: IND.01"
                autoComplete="off"
                data-foco-inicial=""
              />
            </Campo>
            <Campo rotulo="Tipo" obrigatorio>
              <Select value={tipo} onChange={(e) => setTipo(e.target.value as IndiretoTipo)}>
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {INDIRETO_TIPO_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Campo>
          </div>
          <Campo rotulo="Descrição" obrigatorio erro={erro('descricao')}>
            <Input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              autoComplete="off"
              placeholder="Ex.: Mobilização inicial da equipe"
            />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Valor total (R$)" obrigatorio erro={erro('valor')}>
              <Input
                mascara="decimal"
                casas={2}
                casasMin={2}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                autoComplete="off"
                placeholder="Ex.: 125.000,00"
                className="tabular text-right"
              />
            </Campo>
            <Campo
              rotulo="Distribuição (%)"
              dica="Quanto do valor entra no cálculo do lucro. 100 é o valor todo."
              erro={erro('distribuicao')}
            >
              <Input
                mascara="decimal"
                casas={2}
                value={distribuicao}
                onChange={(e) => setDistribuicao(e.target.value)}
                autoComplete="off"
                className="tabular text-right"
              />
            </Campo>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => aoMudar(false)}
            disabled={upsert.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={upsert.isPending}>
            {upsert.isPending
              ? 'Salvando…'
              : editando
                ? 'Salvar alterações'
                : 'Criar custo indireto'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
