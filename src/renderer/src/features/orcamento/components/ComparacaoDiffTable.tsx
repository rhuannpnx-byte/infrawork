// ComparacaoDiffTable — tabela de diff item-a-item entre duas revisões.
//
// Filtros: tudo / só alterados / só adicionados / só removidos.

import { useMemo, useState, type ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtBRL, fmtPct2, fmtQtd } from '@/lib/money'
import type { DiffLinha } from '../hooks/comparacao'

interface Props {
  diff: DiffLinha[]
}

type Filtro = 'todos' | 'alterados' | 'adicionados' | 'removidos'

const FILTROS: { val: Filtro; label: string }[] = [
  { val: 'todos', label: 'Todos' },
  { val: 'alterados', label: 'Alterados' },
  { val: 'adicionados', label: 'Adicionados' },
  { val: 'removidos', label: 'Removidos' }
]

const STATUS_CLASS: Record<DiffLinha['status'], string> = {
  '=': 'text-text-dim',
  Δ: 'text-warn',
  '+': 'text-success',
  '-': 'text-danger'
}
const STATUS_LABEL: Record<DiffLinha['status'], string> = {
  '=': '=',
  Δ: 'Δ',
  '+': '+',
  '-': '−'
}

export function ComparacaoDiffTable({ diff }: Props): ReactNode {
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busca, setBusca] = useState('')

  const visible = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return diff.filter((d) => {
      if (filtro === 'alterados' && d.status !== 'Δ') return false
      if (filtro === 'adicionados' && d.status !== '+') return false
      if (filtro === 'removidos' && d.status !== '-') return false
      if (q) {
        if (
          !d.codigo.toLowerCase().includes(q) &&
          !d.descricao.toLowerCase().includes(q)
        )
          return false
      }
      return true
    })
  }, [diff, filtro, busca])

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-xs flex-1">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none"
          />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar código ou descrição…"
            className="w-full pl-7 pr-7 h-7 bg-bg border border-border rounded text-xs text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
          />
          {busca ? (
            <button
              type="button"
              onClick={() => setBusca('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-dim hover:text-text"
            >
              <X size={11} />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          {FILTROS.map((f) => (
            <button
              key={f.val}
              type="button"
              onClick={() => setFiltro(f.val)}
              className={
                filtro === f.val
                  ? 'h-7 px-2.5 text-2xs font-mono rounded bg-accent text-[color:var(--primary-foreground)] border border-accent'
                  : 'h-7 px-2.5 text-2xs font-mono rounded border border-border-strong text-text-muted hover:text-text hover:bg-bg-hover'
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="ml-auto text-2xs font-mono text-text-dim">
          {visible.length} de {diff.length}
        </div>
      </div>

      {/* Tabela */}
      <div className="rounded border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="bg-bg-panel text-2xs uppercase tracking-wider text-text-dim">
              <tr>
                <th className="text-center px-2 py-1.5 w-8">Δ</th>
                <th className="text-left px-2 py-1.5 w-24">Código</th>
                <th className="text-left px-2 py-1.5">Descrição</th>
                <th className="text-right px-2 py-1.5 w-20">Qtd A</th>
                <th className="text-right px-2 py-1.5 w-20">Qtd B</th>
                <th className="text-right px-2 py-1.5 w-20">Δ%</th>
                <th className="text-right px-2 py-1.5 w-24">Unit A</th>
                <th className="text-right px-2 py-1.5 w-24">Unit B</th>
                <th className="text-right px-2 py-1.5 w-20">Δ%</th>
                <th className="text-right px-2 py-1.5 w-28">Venda A</th>
                <th className="text-right px-2 py-1.5 w-28">Venda B</th>
                <th className="text-right px-2 py-1.5 w-20">Δ%</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center text-text-dim italic py-6">
                    Nenhum item corresponde ao filtro.
                  </td>
                </tr>
              ) : (
                visible.map((d) => (
                  <tr
                    key={d.codigo}
                    className={cn(
                      'border-t border-border/40',
                      d.status === '+' && 'bg-success/5',
                      d.status === '-' && 'bg-danger/5',
                      d.status === 'Δ' && 'bg-warn/5'
                    )}
                  >
                    <td className={cn('text-center px-2 py-1 font-bold', STATUS_CLASS[d.status])}>
                      {STATUS_LABEL[d.status]}
                    </td>
                    <td className="px-2 py-1 text-text-muted whitespace-nowrap">{d.codigo}</td>
                    <td className="px-2 py-1 text-text truncate max-w-[260px]">{d.descricao}</td>
                    <td className="text-right px-2 py-1 tabular-nums">{numFmt(d.qtdA, fmtQtd)}</td>
                    <td className="text-right px-2 py-1 tabular-nums">{numFmt(d.qtdB, fmtQtd)}</td>
                    <td className={cn('text-right px-2 py-1 tabular-nums', pctColor(d.deltaQtdPct))}>
                      {pctFmt(d.deltaQtdPct)}
                    </td>
                    <td className="text-right px-2 py-1 tabular-nums">{numFmt(d.custoUnitA, fmtBRL)}</td>
                    <td className="text-right px-2 py-1 tabular-nums">{numFmt(d.custoUnitB, fmtBRL)}</td>
                    <td
                      className={cn('text-right px-2 py-1 tabular-nums', pctColor(d.deltaCustoUnitPct))}
                    >
                      {pctFmt(d.deltaCustoUnitPct)}
                    </td>
                    <td className="text-right px-2 py-1 tabular-nums">{numFmt(d.vendaTotalA, fmtBRL)}</td>
                    <td className="text-right px-2 py-1 tabular-nums">{numFmt(d.vendaTotalB, fmtBRL)}</td>
                    <td
                      className={cn(
                        'text-right px-2 py-1 tabular-nums',
                        pctColor(d.deltaVendaTotalPct)
                      )}
                    >
                      {pctFmt(d.deltaVendaTotalPct)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function numFmt(v: number | null, fmt: (n: number) => string): string {
  return v == null ? '—' : fmt(v)
}
function pctFmt(v: number | null): string {
  if (v == null) return '—'
  return `${v > 0 ? '+' : ''}${fmtPct2(v)}`
}
function pctColor(v: number | null): string {
  if (v == null || Math.abs(v) < 0.0001) return 'text-text-dim'
  return v > 0 ? 'text-success' : 'text-danger'
}
