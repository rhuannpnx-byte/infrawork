import { type ReactNode } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useLucratividade } from '@/features/orcamento/hooks/lucratividade'
import { usePlanOrc } from '@/features/orcamento/hooks/plan-orc'
import { LucratividadeCards } from '@/features/orcamento/components/LucratividadeCards'
import { fmtBRL, fmtPct2 } from '@/lib/money'
import { EstadoConsulta } from '@/components/ui/estado'

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
  const consulta = useLucratividade(obraId)
  const lucr = consulta.data
  const { data: plan } = usePlanOrc(obraId)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Lucratividade"
        subtitle="Venda, custo, taxas e lucro da planilha orçamentária e do indireto"
      />
      <div className="flex-1 overflow-auto p-5 space-y-4">
        {!lucr ? (
          <EstadoConsulta consulta={consulta} oQue="a lucratividade" vazio>
            {null}
          </EstadoConsulta>
        ) : (
          <>
            <LucratividadeCards data={lucr} />

            <div className="rounded border border-border bg-bg-panel">
              <div className="px-4 py-2 border-b border-border bg-bg-elevated">
                <h3 className="text-2xs font-mono uppercase tracking-wider text-text-muted">
                  Planilha Orçamentária · agrupado por raiz
                </h3>
              </div>
              <table className="w-full text-xs font-mono">
                <thead className="text-2xs text-text-dim uppercase">
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2">Código</th>
                    <th className="text-left px-3 py-2">Descrição</th>
                    <th className="text-right px-3 py-2">Venda</th>
                    <th className="text-right px-3 py-2">Custo</th>
                    <th
                      className="text-right px-3 py-2"
                      title={`Taxa aplicada: ${fmtPct2(lucr.aliquota_total_perc)} sobre a venda`}
                    >
                      Taxas ({fmtPct2(lucr.aliquota_total_perc)})
                    </th>
                    <th className="text-right px-3 py-2">Lucro R$</th>
                    <th className="text-right px-3 py-2">Lucr.%</th>
                  </tr>
                </thead>
                <tbody>
                  {(plan?.tree ?? []).map((raiz) => {
                    const venda = raiz.venda_total_calc
                    const custo = raiz.custo_total_calc
                    const taxa = venda * lucr.aliquota_total_perc
                    const lucroRs = venda - custo - taxa
                    const lucroPerc = venda > 0 ? lucroRs / venda : null
                    return (
                      <tr key={raiz.id} className="border-b border-border">
                        <td className="px-3 py-2 text-text-dim">{raiz.codigo}</td>
                        <td className="px-3 py-2 text-text">{raiz.descricao}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtBRL(venda)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                          {fmtBRL(custo)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-warn">
                          {fmtBRL(taxa)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            lucroRs < 0 ? 'text-danger' : 'text-success'
                          }`}
                        >
                          {fmtBRL(lucroRs)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            lucroPerc !== null && lucroPerc < 0 ? 'text-danger' : ''
                          }`}
                        >
                          {lucroPerc !== null ? fmtPct2(lucroPerc) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                  {(plan?.tree ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-text-muted">
                        A planilha orçamentária ainda não tem itens.
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
