import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Plus, X } from 'lucide-react'
import {
  Dialog,
  DialogBody,
  DialogErrorBanner,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { fmtBRL, fmtPct2, parseBR } from '@/lib/money'
import type {
  CriterioRateio,
  ItemAlocacao,
  ItemOrcamentario,
  ItemTreeNode
} from '@/types/orcamento'
import { useCriarServico, useSalvarRateio } from '../hooks/alocacao'

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
  { v: 'percentual', label: '%', ajuda: 'Percentual de cada serviço. Abaixo de 100% fica saldo.' },
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
      toast.error(err instanceof Error ? err.message : 'Falha ao criar serviço')
    }
  }

  const onSalvar = async (): Promise<void> => {
    setErro(null)
    const validas = linhas.filter((l) => l.grupo_id)
    if (new Set(validas.map((l) => l.grupo_id)).size !== validas.length) {
      setErro('O mesmo serviço aparece mais de uma vez.')
      return
    }
    if (criterio !== 'venda' && validas.some((l) => num(l.valor) <= 0)) {
      setErro(
        criterio === 'percentual'
          ? 'Informe o % de cada serviço.'
          : 'Informe a quantidade de cada serviço.'
      )
      return
    }
    if (criterio === 'percentual' && validas.reduce((a, l) => a + num(l.valor), 0) > 100.0001) {
      setErro('A soma passa de 100%.')
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
      setErro(err instanceof Error ? err.message : 'Falha ao salvar o rateio')
    }
  }

  const corBarra = total > 1.0001 ? 'bg-danger' : total < 0.9999 ? 'bg-warn' : 'bg-accent'

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" disableDismiss={salvar.isPending}>
      <DialogHeader>
        <DialogTitle>Ratear receita</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={erro} />
        <div className="flex items-baseline gap-2 text-xs">
          <span className="font-mono text-text-dim">{receita.codigo}</span>
          <span className="text-text truncate flex-1">{receita.descricao}</span>
          <span className="font-mono tabular-nums text-text">{fmtBRL(venda)}</span>
        </div>

        <div>
          <div className="inline-flex rounded border border-border-strong overflow-hidden">
            {CRITERIOS.map((c) => (
              <button
                key={c.v}
                type="button"
                onClick={() => setCriterio(c.v)}
                className={cn(
                  'px-3 py-1 text-2xs',
                  criterio === c.v
                    ? 'bg-accent text-[color:var(--primary-foreground)]'
                    : 'text-text-muted hover:bg-bg-hover'
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-2xs text-text-dim">
            {CRITERIOS.find((c) => c.v === criterio)!.ajuda}
          </p>
        </div>

        <div className="rounded border border-border">
          <div className="grid grid-cols-[1fr_120px_64px_70px_110px_24px] gap-2 px-2 py-1 text-2xs font-mono uppercase text-text-dim bg-bg-elevated border-b border-border">
            <span>Serviço</span>
            <span className="text-right">
              {criterio === 'percentual'
                ? '%'
                : criterio === 'peso'
                  ? (receita.unidade ?? 'qtd')
                  : '—'}
            </span>
            <span className="text-center" title="Compõe a quantidade do serviço">
              Compõe
            </span>
            <span className="text-right">Parte</span>
            <span className="text-right">Venda</span>
            <span />
          </div>
          {linhas.map((l, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_120px_64px_70px_110px_24px] gap-2 px-2 py-1 items-center border-b border-border"
            >
              <Select value={l.grupo_id} onChange={(e) => set(i, { grupo_id: e.target.value })}>
                <option value="">— serviço —</option>
                {servicos.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.codigo} · {s.descricao}
                  </option>
                ))}
              </Select>
              {criterio === 'venda' ? (
                <span className="text-right text-2xs text-text-dim">auto</span>
              ) : (
                <input
                  value={l.valor}
                  onChange={(e) => set(i, { valor: e.target.value })}
                  inputMode="decimal"
                  className="h-7 px-2 rounded bg-bg-elevated border border-border-strong text-xs text-right font-mono outline-none focus:border-accent"
                />
              )}
              <span className="flex justify-center">
                <input
                  type="checkbox"
                  checked={l.compoe}
                  onChange={(e) => set(i, { compoe: e.target.checked })}
                  className="accent-[var(--accent)]"
                />
              </span>
              <span className="text-right text-xs font-mono tabular-nums">
                {l.grupo_id ? fmtPct2(fracoes[i] ?? 0) : '—'}
              </span>
              <span className="text-right text-xs font-mono tabular-nums text-text-muted">
                {l.grupo_id ? fmtBRL(venda * (fracoes[i] ?? 0)) : '—'}
              </span>
              <button
                type="button"
                onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))}
                className="w-6 h-6 grid place-items-center rounded text-text-dim hover:text-danger hover:bg-bg-hover"
                title="Remover"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 px-2 py-1.5">
            <button
              type="button"
              onClick={() => setLinhas((ls) => [...ls, { grupo_id: '', valor: '', compoe: false }])}
              className="text-2xs text-accent hover:underline inline-flex items-center gap-1"
            >
              <Plus size={12} /> serviço
            </button>
            {criterio === 'percentual' && linhas.length > 0 ? (
              <button
                type="button"
                onClick={restante}
                className="text-2xs text-accent hover:underline"
              >
                restante para a última linha
              </button>
            ) : null}
            <form
              className="ml-auto flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault()
                void criarServico()
              }}
            >
              <input
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder="Novo serviço…"
                className="h-6 w-44 px-2 rounded bg-bg-elevated border border-dashed border-border-strong text-2xs outline-none focus:border-accent"
              />
            </form>
          </div>
        </div>

        <div>
          <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
            <div
              className={cn('h-full', corBarra)}
              style={{ width: `${Math.min(100, total * 100)}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-2xs font-mono text-text-dim">
            <span>Alocado {fmtPct2(total)}</span>
            <span className={total < 0.9999 ? 'text-warn' : total > 1.0001 ? 'text-danger' : ''}>
              {total > 1.0001
                ? 'acima de 100%'
                : `Saldo ${fmtBRL(Math.max(0, venda * (1 - total)))}`}
            </span>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvar.isPending}>
          Cancelar
        </Button>
        <Button onClick={() => void onSalvar()} disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar rateio'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
