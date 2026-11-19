/**
 * Quantidade de cada serviço em cada local, numa tabela só: serviços nas linhas, locais nas colunas, e ao fim o
 * total nos locais, o orçado e o que ainda não foi para nenhum local. Clicar num número abre a grade daquele local.
 */
import { useMemo, type ReactNode } from 'react'
import { Secao } from '@/components/ui/secao'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/format'
import { contar } from '@/lib/rotulos'
import type { ObraTrecho } from '@/types/gerencial'
import type { AgrupadorTrecho } from '../../hooks/quantidades'
import { quantidadesPorLocal } from '../../lib/quantidades-por-local'

const TH =
  'border-b border-border bg-bg-elevated px-2 py-2 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'
const num = (v: number): string => formatNumber(v, 3)

export function QuantidadesPorLocal({
  trechos,
  totais,
  agrupadores,
  onAbrirLocal
}: {
  trechos: ObraTrecho[]
  /** id do local → (id do serviço → total no local) */
  totais: ReadonlyMap<string, Readonly<Record<string, number>>>
  agrupadores: AgrupadorTrecho[]
  onAbrirLocal: (t: ObraTrecho) => void
}): ReactNode {
  const linhas = useMemo(() => quantidadesPorLocal(agrupadores, totais), [agrupadores, totais])
  const comQuantidade = linhas.filter((l) => l.nosLocais > 0).length
  const faltam = linhas.filter((l) => l.semLocal > 0).length
  const passam = linhas.filter((l) => l.semLocal < 0).length

  if (linhas.length === 0) return null
  return (
    <Secao
      titulo="Quantidades por local"
      nota={
        comQuantidade === 0
          ? 'Nenhum serviço tem quantidade nos locais ainda. Importe a planilha ou abra um local para digitar.'
          : `${contar(comQuantidade, 'serviço', 'serviços')} com quantidade nos locais${faltam ? ` · ${faltam} com saldo sem local` : ''}${passam ? ` · ${passam} acima do orçado` : ''}. Clique num número para abrir a grade do local.`
      }
      semRecuo
    >
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={cn(TH, 'sticky left-0 z-20 min-w-[260px] text-left')}>Serviço</th>
              <th className={cn(TH, 'w-14 text-left')}>Un.</th>
              {trechos.map((t) => (
                <th key={t.id} className={cn(TH, 'min-w-[120px] text-right')}>
                  <span className="inline-flex items-center justify-end gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: t.cor }}
                    />
                    <span
                      className="max-w-[160px] truncate normal-case tracking-normal"
                      title={t.nome}
                    >
                      {t.nome}
                    </span>
                  </span>
                </th>
              ))}
              <th className={cn(TH, 'min-w-[110px] border-l text-right')}>Nos locais</th>
              <th className={cn(TH, 'min-w-[110px] text-right')}>Orçado</th>
              <th className={cn(TH, 'min-w-[110px] text-right')}>Sem local</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.servico.id} className="hover:bg-bg-hover/60">
                <td className="sticky left-0 border-b border-border bg-bg-panel px-2 py-1.5 text-xs text-text">
                  <span className="tabular text-text-dim">{l.servico.codigo}</span>{' '}
                  {l.servico.descricao}
                </td>
                <td className="border-b border-border px-2 py-1.5 text-xs text-text-muted">
                  {l.servico.unidade}
                </td>
                {trechos.map((t) => {
                  const v = l.porLocal.get(t.id)
                  return (
                    <td key={t.id} className="border-b border-border px-1 py-0.5 text-right">
                      {v ? (
                        <button
                          type="button"
                          onClick={() => onAbrirLocal(t)}
                          title={`Abrir as quantidades de ${t.nome}`}
                          className="tabular w-full rounded px-1 py-1 text-right text-xs text-text hover:bg-bg-hover hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                        >
                          {num(v)}
                        </button>
                      ) : (
                        <span className="px-1 text-xs text-text-dim">—</span>
                      )}
                    </td>
                  )
                })}
                <td className="tabular border-b border-l border-border px-2 py-1.5 text-right text-xs font-semibold text-text">
                  {l.nosLocais ? num(l.nosLocais) : '—'}
                </td>
                <td className="tabular border-b border-border px-2 py-1.5 text-right text-xs text-text-muted">
                  {num(l.servico.quantidade)}
                </td>
                <td
                  className={cn(
                    'tabular border-b border-border px-2 py-1.5 text-right text-xs',
                    l.semLocal < 0
                      ? 'font-semibold text-danger'
                      : l.semLocal > 0
                        ? 'text-warn'
                        : 'text-success'
                  )}
                  title={
                    l.semLocal < 0
                      ? 'Os locais passam do orçado'
                      : l.semLocal > 0
                        ? 'Parte do orçado ainda não está em nenhum local'
                        : 'Todo o orçado está nos locais'
                  }
                >
                  {l.semLocal === 0 ? '0' : num(l.semLocal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Secao>
  )
}
