import { type ReactNode } from 'react'
import { Download } from 'lucide-react'
import type { MedicaoRow } from '../../lib/valor-agregado-calc'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { fmtBRL } from '@/lib/money'
import { formatNumber } from '@/lib/format'

interface Props {
  rows: MedicaoRow[]
  onExportar: () => void
  exportando?: boolean
}

/** Tabela de medição unitária do período + botão de export .xlsx. */
export function MedicaoTable({ rows, onExportar, exportando }: Props): ReactNode {
  const total = rows.reduce((acc, r) => acc + r.medicao_valor, 0)

  return (
    <div className="rounded border border-border bg-bg-panel overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
        <span className="text-2xs font-mono text-text-dim uppercase">
          Medição unitária do período
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={onExportar}
          disabled={exportando || rows.length === 0}
        >
          <Download size={11} /> {exportando ? 'Exportando…' : 'Exportar .xlsx'}
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="p-6 text-center text-xs font-mono text-text-dim">
          Sem produção no período para medir.
        </div>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-xs font-mono">
            <thead className="text-text-dim uppercase text-2xs bg-bg sticky top-0">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-1.5">Agregador</th>
                <th className="text-left px-3 py-1.5">Serviço</th>
                <th className="text-left px-3 py-1.5">Unid.</th>
                <th className="text-right px-3 py-1.5">Qtd contratual</th>
                <th className="text-right px-3 py-1.5">% avanço</th>
                <th className="text-right px-3 py-1.5">Qtd medida</th>
                <th className="text-right px-3 py-1.5">Venda unit.</th>
                <th className="text-right px-3 py-1.5">Valor medido</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) =>
                r.tipo === 'indireto' && !r.item_codigo ? (
                  // Fallback: indireto sem itens de receita cadastrados.
                  <tr key={`ind-${i}`} className="border-b border-border/40 bg-accent/5">
                    <td className="px-3 py-1.5 text-text-dim">{r.grupo_codigo}</td>
                    <td className="px-3 py-1.5" colSpan={3}>
                      {r.item_descricao}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-text-dim">
                      {(r.pct_avanco * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-1.5" colSpan={2} />
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-400">
                      {fmtBRL(r.medicao_valor)}
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={`${r.tipo}-${r.item_codigo}-${i}`}
                    className={cn('border-b border-border/40', r.tipo === 'indireto' && 'bg-accent/5')}
                  >
                    <td className="px-3 py-1.5 text-text-dim">{r.grupo_codigo}</td>
                    <td className="px-3 py-1.5">
                      <span className="text-text-dim">{r.item_codigo}</span> {r.item_descricao}
                    </td>
                    <td className="px-3 py-1.5">{r.unidade}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatNumber(r.qtd_contratual, 2)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {(r.pct_avanco * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-accent">
                      {formatNumber(r.medicao_qtd, 2)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {fmtBRL(r.venda_unitaria)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-400">
                      {fmtBRL(r.medicao_valor)}
                    </td>
                  </tr>
                )
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-bg sticky bottom-0">
                <td className="px-3 py-1.5 font-semibold uppercase text-2xs" colSpan={7}>
                  Total medido no período
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-emerald-400">
                  {fmtBRL(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
