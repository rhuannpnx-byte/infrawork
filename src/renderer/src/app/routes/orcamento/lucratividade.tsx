import { type ReactNode } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useLucratividade } from '@/features/orcamento/hooks/lucratividade'
import { usePlanOrc } from '@/features/orcamento/hooks/plan-orc'
import { LucratividadeCards } from '@/features/orcamento/components/LucratividadeCards'
import { fmtBRL, fmtPct2 } from '@/lib/money'

export function LucratividadePage(): ReactNode {
  return (
    <RequireObra pageTitle="Lucratividade">
      <Lucratividade />
    </RequireObra>
  )
}

function Lucratividade(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const { data: lucr, isLoading } = useLucratividade(obraId)
  const { data: plan } = usePlanOrc(obraId)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Lucratividade"
        subtitle={`${scope.obra?.nome ?? ''} — visão financeira consolidada (Planilha Orçamentária + Indireto)`}
      />
      <div className="flex-1 overflow-auto p-5 space-y-4">
        {isLoading || !lucr ? (
          <div className="text-xs text-text-muted font-mono">Carregando…</div>
        ) : (
          <>
            <LucratividadeCards data={lucr} />

            <div className="rounded border border-border bg-bg-panel">
              <div className="px-4 py-2 border-b border-border bg-bg-elevated">
                <h3 className="text-2xs font-mono uppercase tracking-wider text-text-muted">
                  Planilha Orçamentária — agrupado por raiz
                </h3>
              </div>
              <table className="w-full text-xs font-mono">
                <thead className="text-2xs text-text-dim uppercase">
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2">Código</th>
                    <th className="text-left px-3 py-2">Descrição</th>
                    <th className="text-right px-3 py-2">Venda</th>
                    <th className="text-right px-3 py-2">Custo</th>
                    <th className="text-right px-3 py-2">Lucr.%</th>
                  </tr>
                </thead>
                <tbody>
                  {(plan?.tree ?? []).map((raiz) => (
                    <tr key={raiz.id} className="border-b border-border/40">
                      <td className="px-3 py-2 text-text-dim">{raiz.codigo}</td>
                      <td className="px-3 py-2 text-text">{raiz.descricao}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtBRL(raiz.venda_total_calc)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                        {fmtBRL(raiz.custo_total_calc)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {raiz.lucratividade_perc_calc !== null
                          ? fmtPct2(raiz.lucratividade_perc_calc)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                  {(plan?.tree ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-text-muted">
                        Nenhum item no Planilha Orçamentária ainda.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
