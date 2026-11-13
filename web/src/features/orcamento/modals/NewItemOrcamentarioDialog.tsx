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
import { Button } from '@/components/ui/button'
import { Segmentado } from '@/components/ui/segmentado'
import { parseBR } from '@/lib/money'
import { useUpsertItem } from '../hooks/plan-orc'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  parentId: string | null
  /** Pré-seleciona o tipo (etapa/receita). Não cria servico_grupo aqui — use o modal "Agrupar como serviço". */
  tipoInicial?: 'etapa' | 'receita'
}

/** Só algarismos, ponto e vírgula: o que o `parseBR` entende como número. */
const NUMERO = /^\d[\d.,]*$/

type CampoComErro = 'descricao' | 'unidade' | 'quantidade' | 'venda'

export function NewItemOrcamentarioDialog({
  open,
  onOpenChange,
  obraId,
  parentId,
  tipoInicial
}: Props): ReactNode {
  const upsert = useUpsertItem()

  const [tipo, setTipo] = useState<'etapa' | 'receita'>(tipoInicial ?? 'receita')
  const [descricao, setDescricao] = useState('')
  const [unidade, setUnidade] = useState('')
  const [quantidade, setQuantidade] = useState('')
  const [vendaUnit, setVendaUnit] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)

  const reset = (): void => {
    setTipo(tipoInicial ?? 'receita')
    setDescricao('')
    setUnidade('')
    setQuantidade('')
    setVendaUnit('')
    setError(null)
    setTentou(false)
  }

  const aoMudar = (o: boolean): void => {
    if (!o) reset()
    onOpenChange(o)
  }

  // parseBR: remove separador de milhar (.) ANTES de trocar a vírgula.
  const qtd = parseBR(quantidade).toNumber()
  const venda = parseBR(vendaUnit).toNumber()

  const erros: Partial<Record<CampoComErro, string>> = {}
  if (!descricao.trim()) erros.descricao = 'Informe a descrição do item.'
  if (tipo === 'receita') {
    if (!unidade.trim()) erros.unidade = 'Informe a unidade, como m³, t ou km.'
    if (!quantidade.trim()) erros.quantidade = 'Informe a quantidade.'
    else if (!NUMERO.test(quantidade.trim()) || !Number.isFinite(qtd) || qtd <= 0)
      erros.quantidade = 'Digite uma quantidade maior que zero, como 1.250,5.'
    if (!vendaUnit.trim()) erros.venda = 'Informe a venda unitária.'
    else if (!NUMERO.test(vendaUnit.trim()) || !Number.isFinite(venda) || venda < 0)
      erros.venda = 'Digite a venda unitária como um número, por exemplo 38,50.'
  }
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
      if (tipo === 'receita') {
        await upsert.mutateAsync({
          obra_id: obraId,
          parent_id: parentId,
          tipo: 'receita',
          descricao: descricao.trim() || 'Sem descrição',
          unidade: unidade.trim(),
          quantidade: qtd,
          venda_unitaria: venda
        })
      } else {
        await upsert.mutateAsync({
          obra_id: obraId,
          parent_id: parentId,
          tipo: 'etapa',
          descricao: descricao.trim() || 'Sem descrição'
        })
      }

      toast.success(tipo === 'receita' ? 'Receita criada.' : 'Índice criado.')
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(
        `Não foi possível criar o item. ${err instanceof Error ? err.message : 'Tente de novo.'}`
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={aoMudar} size="md" disableDismiss={upsert.isPending}>
      <form onSubmit={onSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>Novo item da planilha</DialogTitle>
          <DialogDescription>
            {parentId
              ? 'O item entra dentro do item selecionado.'
              : 'O item entra na raiz da planilha orçamentária.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text">Tipo</span>
            <Segmentado
              rotulo="Tipo do item"
              valor={tipo}
              aoMudar={setTipo}
              className="self-start"
              opcoes={[
                { valor: 'receita', rotulo: 'Receita' },
                { valor: 'etapa', rotulo: 'Índice' }
              ]}
            />
            <p className="text-xs text-text-muted">
              {tipo === 'receita'
                ? 'Linha cobrada do cliente: tem unidade, quantidade e venda unitária.'
                : 'Linha que só organiza a planilha: agrupa os itens abaixo dela, sem valor próprio.'}{' '}
              Para ter composição e custo, selecione as receitas na planilha e use &ldquo;Agrupar
              como serviço&rdquo;.
            </p>
          </div>

          <Campo rotulo="Descrição" obrigatorio erro={erro('descricao')}>
            <Input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              autoComplete="off"
              autoFocus
              placeholder={tipo === 'etapa' ? 'Ex.: PAVIMENTAÇÃO' : 'Ex.: Aplicação de CBUQ'}
            />
          </Campo>

          {tipo === 'receita' ? (
            <div className="grid grid-cols-3 gap-3">
              <Campo rotulo="Unidade" obrigatorio erro={erro('unidade')}>
                <Input
                  value={unidade}
                  onChange={(e) => setUnidade(e.target.value)}
                  autoComplete="off"
                  placeholder="Ex.: m³"
                />
              </Campo>
              <Campo rotulo="Quantidade" obrigatorio erro={erro('quantidade')}>
                <Input
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  className="tabular text-right"
                />
              </Campo>
              <Campo rotulo="Venda unitária (R$)" obrigatorio erro={erro('venda')}>
                <Input
                  value={vendaUnit}
                  onChange={(e) => setVendaUnit(e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  className="tabular text-right"
                />
              </Campo>
            </div>
          ) : null}
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
            {upsert.isPending ? 'Criando…' : tipo === 'receita' ? 'Criar receita' : 'Criar índice'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
