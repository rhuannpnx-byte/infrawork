import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Plus, X } from 'lucide-react'
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogErrorBanner,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Segmentado } from '@/components/ui/segmentado'
import { cn } from '@/lib/utils'
import { fmtBRL, fmtPct2, parseBR } from '@/lib/money'
import type {
  CriterioRateio,
  ItemAlocacao,
  ItemOrcamentario,
  ItemTreeNode
} from '@/types/orcamento'
import { useCriarServico, useSalvarRateio } from '../hooks/alocacao'
import { detalheDoErro } from '@/features/orcamento/lib/erro'

interface Linha {
  grupo_id: string
  valor: string
  compoe: boolean
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  receita: ItemTreeNode | null
  servicos: ItemOrcamentario[]
  alocacoes: ItemAlocacao[]
  /** venda_total_calc por receita (para o critério "venda"). */
  vendaPorReceita: Map<string, number>
}

const CRITERIOS: Array<{ v: CriterioRateio; label: string; ajuda: string }> = [
  {
    v: 'percentual',
    label: 'Percentual',
    ajuda: 'Percentual de cada serviço. Abaixo de 100% fica saldo.'
  },
  {
    v: 'peso',
    label: 'Quantidade física',
    ajuda: 'A parte de cada serviço na unidade da receita (ex.: t × DMT). Sempre fecha 100%.'
  },
  {
    v: 'venda',
    label: 'Proporcional à venda',
    ajuda:
      'Proporcional à venda das receitas que compõem a quantidade de cada serviço. Recalcula sozinho.'
  }
]

const GRADE = 'grid grid-cols-[1fr_120px_72px_70px_110px_28px] gap-2 px-2 items-center'

export function RatearDialog(props: Props): ReactNode {
  // remonta o conteúdo a cada receita aberta (estado inicial limpo)
  if (!props.receita) return null
  return (
    <RatearConteudo
      key={props.receita.id + String(props.open)}
      {...props}
      receita={props.receita}
    />
  )
}

function RatearConteudo({
  open,
  onOpenChange,
  obraId,
  receita,
  servicos,
  alocacoes,
  vendaPorReceita
}: Props & { receita: ItemTreeNode }): ReactNode {
  const salvar = useSalvarRateio()
  const criar = useCriarServico()
  const existentes = alocacoes.filter((a) => a.receita_id === receita.id)
  const [criterio, setCriterio] = useState<CriterioRateio>(existentes[0]?.criterio ?? 'percentual')
  const [linhas, setLinhas] = useState<Linha[]>(
    existentes.length > 0
      ? existentes.map((a) => ({
          grupo_id: a.grupo_id,
          valor: a.valor === null ? '' : String(a.valor).replace('.', ','),
          compoe: a.compoe_qtd
        }))
      : [
          { grupo_id: '', valor: '', compoe: false },
          { grupo_id: '', valor: '', compoe: false }
        ]
  )
  const [novoNome, setNovoNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)
  const venda = Number(receita.venda_total_calc ?? 0)

  const num = (s: string): number => {
    if (!s.trim()) return 0
    const n = parseBR(s).toNumber()
    return isNaN(n) ? 0 : n
  }

  // fração de cada linha (prévia)
  const fracoes = useMemo(() => {
    if (criterio === 'percentual') return linhas.map((l) => num(l.valor) / 100)
    if (criterio === 'peso') {
      const tot = linhas.reduce((a, l) => a + num(l.valor), 0)
      return linhas.map((l) => (tot > 0 ? num(l.valor) / tot : 0))
    }
    const base = linhas.map((l) =>
      alocacoes
        .filter(
          (a) =>
            a.grupo_id === l.grupo_id &&
            a.compoe_qtd &&
            a.criterio !== 'venda' &&
            a.receita_id !== receita.id
        )
        .reduce((acc, a) => acc + (vendaPorReceita.get(a.receita_id) ?? 0) * a.fracao, 0)
    )
    const tot = base.reduce((a, b) => a + b, 0)
    return base.map((b) => (tot > 0 ? b / tot : linhas.length > 0 ? 1 / linhas.length : 0))
  }, [criterio, linhas, alocacoes, vendaPorReceita, receita.id])
  const total = fracoes.reduce((a, b) => a + b, 0)

  const set = (i: number, patch: Partial<Linha>): void =>
    setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  const restante = (): void => {
    const outros = linhas.slice(0, -1).reduce((a, l) => a + num(l.valor), 0)
    set(linhas.length - 1, { valor: String(Math.max(0, 100 - outros)).replace('.', ',') })
  }

  const criarServico = async (): Promise<void> => {
    const nome = novoNome.trim()
    if (!nome) return
    try {
      const s = await criar.mutateAsync({ obra_id: obraId, descricao: nome })
      setNovoNome('')
      setLinhas((ls) => {
        const vazia = ls.findIndex((l) => !l.grupo_id)
        if (vazia >= 0) return ls.map((l, j) => (j === vazia ? { ...l, grupo_id: s.id } : l))
        return [...ls, { grupo_id: s.id, valor: '', compoe: false }]
      })
    } catch (err) {
      toast.error('Não foi possível criar o serviço.', {
        description: detalheDoErro(err) ?? undefined
      })
    }
  }

  // validação: calculada das linhas, mostrada depois da primeira tentativa de salvar
  const validas = linhas.filter((l) => l.grupo_id)
  const repetidos = new Set(
    validas.map((l) => l.grupo_id).filter((id, i, ids) => ids.indexOf(id) !== i)
  )
  const semValor = (l: Linha): boolean => criterio !== 'venda' && !!l.grupo_id && num(l.valor) <= 0
  const passaDe100 =
    criterio === 'percentual' && validas.reduce((a, l) => a + num(l.valor), 0) > 100.0001
  const erroLinhas =
    repetidos.size > 0
      ? 'O mesmo serviço aparece mais de uma vez. Deixe cada serviço em uma linha só.'
      : validas.some(semValor)
        ? criterio === 'percentual'
          ? 'Informe o percentual de cada serviço.'
          : 'Informe a quantidade de cada serviço.'
        : passaDe100
          ? 'A soma passa de 100%. Reduza o percentual de algum serviço.'
          : undefined

  const onSalvar = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setErro(null)
    if (erroLinhas) {
      setTentou(true)
      const form = e.currentTarget
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    try {
      await salvar.mutateAsync({
        obra_id: obraId,
        receita_id: receita.id,
        criterio,
        destinos: validas.map((l) => ({
          grupo_id: l.grupo_id,
          valor: criterio === 'venda' ? null : num(l.valor),
          compoe_qtd: l.compoe
        }))
      })
      toast.success(validas.length === 0 ? 'Alocações removidas.' : 'Rateio salvo.')
      onOpenChange(false)
    } catch (err) {
      setErro(`Não foi possível salvar o rateio. ${detalheDoErro(err) ?? 'Tente de novo.'}`)
    }
  }

  const corBarra = total > 1.0001 ? 'bg-danger' : total < 0.9999 ? 'bg-warn' : 'bg-accent'
  const rotuloValor =
    criterio === 'percentual'
      ? 'Percentual'
      : criterio === 'peso'
        ? `Quantidade${receita.unidade ? ` em ${receita.unidade}` : ''}`
        : 'Valor'

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" disableDismiss={salvar.isPending}>
      <form onSubmit={onSalvar} noValidate>
        <DialogHeader>
          <DialogTitle>Ratear receita</DialogTitle>
          <DialogDescription>
            {receita.codigo} {receita.descricao} · venda de{' '}
            <span className="tabular text-text">{fmtBRL(venda)}</span>
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={erro} />

          <div>
            <Segmentado
              rotulo="Critério do rateio"
              valor={criterio}
              aoMudar={setCriterio}
              opcoes={CRITERIOS.map((c) => ({ valor: c.v, rotulo: c.label }))}
            />
            <p className="mt-1 text-xs text-text-muted">
              {CRITERIOS.find((c) => c.v === criterio)!.ajuda}
            </p>
          </div>

          <div className="overflow-x-auto rounded border border-border">
            <div className="min-w-[560px]">
              <div
                className={cn(
                  GRADE,
                  'border-b border-border bg-bg-elevated py-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'
                )}
              >
                <span>Serviço</span>
                <span className="text-right">
                  {criterio === 'percentual'
                    ? '%'
                    : criterio === 'peso'
                      ? (receita.unidade ?? 'Qtd.')
                      : 'Valor'}
                </span>
                <span className="text-center" title="A receita compõe a quantidade do serviço">
                  Compõe
                </span>
                <span className="text-right">Parte</span>
                <span className="text-right">Venda</span>
                <span />
              </div>
              {linhas.map((l, i) => (
                <div key={i} className={cn(GRADE, 'border-b border-border py-1')}>
                  <Select
                    value={l.grupo_id}
                    onChange={(e) => set(i, { grupo_id: e.target.value })}
                    aria-label={`Serviço da linha ${i + 1}`}
                    aria-invalid={tentou && repetidos.has(l.grupo_id) ? true : undefined}
                    data-foco-inicial={i === 0 && !l.grupo_id ? '' : undefined}
                  >
                    <option value="">Selecione…</option>
                    {servicos.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.codigo} · {s.descricao}
                      </option>
                    ))}
                  </Select>
                  {criterio === 'venda' ? (
                    <span className="text-right text-xs text-text-muted">Automático</span>
                  ) : (
                    <Input
                      value={l.valor}
                      onChange={(e) => set(i, { valor: e.target.value })}
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label={`${rotuloValor} da linha ${i + 1}`}
                      aria-invalid={
                        tentou && repetidos.size === 0 && (semValor(l) || passaDe100)
                          ? true
                          : undefined
                      }
                      className="tabular text-right"
                    />
                  )}
                  <span className="flex justify-center">
                    <input
                      type="checkbox"
                      checked={l.compoe}
                      onChange={(e) => set(i, { compoe: e.target.checked })}
                      aria-label={`A receita compõe a quantidade do serviço da linha ${i + 1}`}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                  </span>
                  <span className="tabular text-right text-sm text-text">
                    {l.grupo_id ? fmtPct2(fracoes[i] ?? 0) : '—'}
                  </span>
                  <span className="tabular text-right text-sm text-text-muted">
                    {l.grupo_id ? fmtBRL(venda * (fracoes[i] ?? 0)) : '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))}
                    className="grid h-7 w-7 place-items-center rounded text-text-dim hover:bg-danger/10 hover:text-danger"
                    title={`Remover a linha ${i + 1}`}
                    aria-label={`Remover a linha ${i + 1}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setLinhas((ls) => [...ls, { grupo_id: '', valor: '', compoe: false }])
                  }
                >
                  <Plus size={12} /> Adicionar linha
                </Button>
                {criterio === 'percentual' && linhas.length > 0 ? (
                  <Button type="button" variant="ghost" size="sm" onClick={restante}>
                    Pôr o restante na última linha
                  </Button>
                ) : null}
                <div className="ml-auto flex items-center gap-1">
                  <Input
                    value={novoNome}
                    onChange={(e) => setNovoNome(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      void criarServico()
                    }}
                    placeholder="Nome do novo serviço"
                    aria-label="Nome do novo serviço"
                    autoComplete="off"
                    className="h-7 w-48"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={criar.isPending}
                    title={novoNome.trim() ? undefined : 'Digite o nome do serviço para criar'}
                    onClick={() => void criarServico()}
                  >
                    {criar.isPending ? 'Criando…' : 'Criar serviço'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
          {tentou && erroLinhas ? (
            <p role="alert" className="text-xs font-medium text-danger">
              {erroLinhas}
            </p>
          ) : null}

          <div>
            <div className="h-1.5 overflow-hidden rounded bg-bg-elevated" aria-hidden>
              <div
                className={cn('h-full', corBarra)}
                style={{ width: `${Math.min(100, total * 100)}%` }}
              />
            </div>
            <div className="tabular mt-1 flex justify-between text-xs text-text-muted">
              <span>Alocado: {fmtPct2(total)}</span>
              <span className={total > 1.0001 ? 'font-medium text-danger' : undefined}>
                {total > 1.0001
                  ? 'Acima de 100%'
                  : `Saldo: ${fmtBRL(Math.max(0, venda * (1 - total)))}`}
              </span>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={salvar.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Salvar rateio'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
