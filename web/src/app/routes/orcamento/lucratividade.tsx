import { type ReactNode } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useLucratividade } from '@/features/orcamento/hooks/lucratividade'
import { usePlanOrc } from '@/features/orcamento/hooks/plan-orc'
import { LucratividadeCards } from '@/features/orcamento/components/LucratividadeCards'
import { fmtBRL, fmtPct2 } from '@/lib/money'
import { EstadoConsulta } from '@/components/ui/estado'
import { Secao } from '@/components/ui/secao'
import { cn } from '@/lib/utils'

const TH = 'px-3 py-2 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'

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
  const planConsulta = usePlanOrc(obraId)
  const raizes = planConsulta.data?.tree ?? []

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Lucratividade" subtitle="Venda, custos, impostos e lucro do orçamento" />
      <div
        tabIndex={0}
        role="region"
        aria-label="Lucratividade do orçamento"
        className="flex-1 overflow-auto p-5 space-y-4"
      >
        {!lucr ? (
          <EstadoConsulta
            consulta={consulta}
            oQue="a lucratividade"
            vazio
            textoVazio="Ainda não há valores para calcular a lucratividade. Monte a planilha orçamentária e vincule as composições aos serviços."
          >
            {null}
          </EstadoConsulta>
        ) : (
          <>
            <LucratividadeCards data={lucr} />

            <Secao
              titulo="Resultado por etapa"
              nota="Itens de primeiro nível da planilha orçamentária"
              semRecuo
            >
              <EstadoConsulta
                consulta={planConsulta}
                oQue="a planilha orçamentária"
                vazio={raizes.length === 0}
                textoVazio="A planilha orçamentária ainda não tem itens. Importe ou monte a planilha para ver o resultado por etapa."
                className="px-4"
              >
                <div
                  tabIndex={0}
                  role="region"
                  aria-label="Tabela do resultado por etapa"
                  className="overflow-x-auto border-t border-border"
                >
                  <table className="w-full text-sm tabular">
                    <thead className="bg-bg-elevated border-b border-border-strong">
                      <tr>
                        <th scope="col" className={`${TH} text-left`}>
                          Código
                        </th>
                        <th scope="col" className={`${TH} text-left`}>
                          Descrição
                        </th>
                        <th scope="col" className={`${TH} text-right`}>
                          Venda
                        </th>
                        <th scope="col" className={`${TH} text-right`}>
                          Custo
                        </th>
                        <th
                          scope="col"
                          className={`${TH} text-right`}
                          title={`Taxa aplicada: ${fmtPct2(lucr.aliquota_total_perc)} sobre a venda`}
                        >
                          Taxas ({fmtPct2(lucr.aliquota_total_perc)})
                        </th>
                        <th scope="col" className={`${TH} text-right`}>
                          Lucro (R$)
                        </th>
                        <th scope="col" className={`${TH} text-right`}>
                          Lucro (%)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {raizes.map((raiz) => {
                        const venda = raiz.venda_total_calc
                        const custo = raiz.custo_total_calc
                        const taxa = venda * lucr.aliquota_total_perc
                        const lucroRs = venda - custo - taxa
                        const lucroPerc = venda > 0 ? lucroRs / venda : null
                        const negativo = lucroRs < 0
                        return (
                          <tr key={raiz.id} className="border-b border-border last:border-b-0">
                            <td className="px-3 py-2 text-text-dim whitespace-nowrap">
                              {raiz.codigo}
                            </td>
                            <td className="px-3 py-2 text-text">{raiz.descricao}</td>
                            <td className="px-3 py-2 text-right text-text whitespace-nowrap">
                              {fmtBRL(venda)}
                            </td>
                            <td className="px-3 py-2 text-right text-text-muted whitespace-nowrap">
                              {fmtBRL(custo)}
                            </td>
                            <td className="px-3 py-2 text-right text-text-muted whitespace-nowrap">
                              {fmtBRL(taxa)}
                            </td>
                            <td
                              className={cn(
                                'px-3 py-2 text-right font-semibold whitespace-nowrap',
                                negativo ? 'text-danger' : 'text-text'
                              )}
                            >
                              {fmtBRL(lucroRs)}
                            </td>
                            <td
                              className={cn(
                                'px-3 py-2 text-right whitespace-nowrap',
                                negativo ? 'text-danger' : 'text-text'
                              )}
                            >
                              {lucroPerc !== null ? fmtPct2(lucroPerc) : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </EstadoConsulta>
            </Secao>
          </>
        )}
      </div>
    </div>
  )
}
