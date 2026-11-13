import { type ReactNode } from 'react'
import { Download } from 'lucide-react'
import type { MedicaoRow } from '../../lib/valor-agregado-calc'
import { Button } from '@/components/ui/button'
import { Vazio } from '@/components/ui/estado'
import { cn } from '@/lib/utils'
import { fmtBRL } from '@/lib/money'
import { formatNumber } from '@/lib/format'

interface Props {
  rows: MedicaoRow[]
  onExportar: () => void
  exportando?: boolean
}

const TH = 'px-3 py-2 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'
const pct = (v: number): string => `${formatNumber(v * 100, 1)}%`

/** Tabela de medição unitária do período, com o botão de exportar para Excel. */
export function MedicaoTable({ rows, onExportar, exportando }: Props): ReactNode {
  const total = rows.reduce((acc, r) => acc + r.medicao_valor, 0)

  return (
    <section
      aria-label="Medição unitária do período"
      className="rounded border border-border bg-bg-panel overflow-hidden"
    >
      <div className="px-4 py-2.5 border-b border-border flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-text">Medição unitária do período</h2>
        <Button
          size="sm"
          variant="secondary"
          onClick={onExportar}
          disabled={exportando || rows.length === 0}
          title={rows.length === 0 ? 'Não há medição no período para exportar.' : undefined}
        >
          <Download size={14} /> {exportando ? 'Exportando…' : 'Exportar para Excel'}
        </Button>
      </div>

      {rows.length === 0 ? (
        <Vazio className="px-4">
          Sem produção no período para medir. Escolha outro período ou lance a produção.
        </Vazio>
      ) : (
        <div
          tabIndex={0}
          role="region"
          aria-label="Tabela da medição unitária do período"
          className="max-h-[420px] overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          <table className="w-full text-sm">
            <thead className="bg-bg-elevated sticky top-0 z-10">
              <tr className="border-b border-border">
                <th scope="col" className={cn(TH, 'text-left')}>
                  Agregador
                </th>
                <th scope="col" className={cn(TH, 'text-left')}>
                  Serviço
                </th>
                <th scope="col" className={cn(TH, 'text-left')}>
                  Un.
                </th>
                <th scope="col" className={cn(TH, 'text-right')}>
                  Quantidade contratual
                </th>
                <th scope="col" className={cn(TH, 'text-right')}>
                  Avanço
                </th>
                <th scope="col" className={cn(TH, 'text-right')}>
                  Quantidade medida
                </th>
                <th scope="col" className={cn(TH, 'text-right')}>
                  Venda unitária
                </th>
                <th scope="col" className={cn(TH, 'text-right')}>
                  Valor medido
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) =>
                r.tipo === 'indireto' && !r.item_codigo ? (
                  // Indireto sem itens de receita cadastrados: uma linha só, com o valor.
                  <tr key={`ind-${i}`} className="border-b border-border bg-accent/5">
                    <td className="px-3 py-1.5 text-text-muted tabular">{r.grupo_codigo}</td>
                    <td className="px-3 py-1.5 text-text" colSpan={3}>
                      {r.item_descricao}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular text-text-muted">
                      {pct(r.pct_avanco)}
                    </td>
                    <td className="px-3 py-1.5" colSpan={2} />
                    <td className="px-3 py-1.5 text-right tabular text-success">
                      {fmtBRL(r.medicao_valor)}
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={`${r.tipo}-${r.item_codigo}-${i}`}
                    className={cn('border-b border-border', r.tipo === 'indireto' && 'bg-accent/5')}
                  >
                    <td className="px-3 py-1.5 text-text-muted tabular">{r.grupo_codigo}</td>
                    <td className="px-3 py-1.5 text-text">
                      <span className="text-text-muted tabular">{r.item_codigo}</span>{' '}
                      {r.item_descricao}
                    </td>
                    <td className="px-3 py-1.5 text-text-muted">{r.unidade}</td>
                    <td className="px-3 py-1.5 text-right tabular text-text">
                      {formatNumber(r.qtd_contratual, 2)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular text-text">
                      {pct(r.pct_avanco)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular text-accent">
                      {formatNumber(r.medicao_qtd, 2)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular text-text">
                      {fmtBRL(r.venda_unitaria)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular text-success">
                      {fmtBRL(r.medicao_valor)}
                    </td>
                  </tr>
                )
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-border-strong bg-bg-elevated sticky bottom-0">
                <td className="px-3 py-2 font-semibold text-text" colSpan={7}>
                  Total medido no período
                </td>
                <td className="px-3 py-2 text-right tabular font-semibold text-success">
                  {fmtBRL(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}
