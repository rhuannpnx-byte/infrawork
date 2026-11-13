import { useMemo, useState, type ReactNode } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { Secao } from '@/components/ui/secao'
import { Filtro } from '@/components/ui/filtros'
import { Select } from '@/components/ui/select'
import { RequireObra } from '@/components/layout/RequireObra'
import { EmptyState } from '@/components/layout/EmptyState'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import {
  usePlanejamentos,
  usePlanejamentoAtivo,
  useBaseline,
  useTarefas
} from '@/features/planejamento/hooks'
import { calcularCurvaSemanal } from '@/features/planejamento/hooks/cronograma'
import { CurvaSChart } from '@/features/planejamento/components/CurvaSChart'
import { useOpcoesCurvaS } from '@/features/acompanhamento/hooks/valor-agregado'
import { fmtBRL } from '@/lib/money'
import { fmtDataBR } from '@/features/planejamento/lib/dates'

export function PlanejamentoCurvaSPage(): ReactNode {
  return (
    <RequireObra pageTitle="Curva S">
      <CurvaSInner />
    </RequireObra>
  )
}

function CurvaSInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const { data: planejamentos = [] } = usePlanejamentos(obraId)
  const { data: planAtivo } = usePlanejamentoAtivo(obraId)
  const { data: baseline } = useBaseline(obraId)

  const [planId, setPlanId] = useState<string | null>(null)
  const planSel = planId ? (planejamentos.find((p) => p.id === planId) ?? planAtivo) : planAtivo

  const { data: tarefas = [] } = useTarefas(planSel?.id)
  const { data: tarefasBaseline = [] } = useTarefas(
    baseline?.id !== planSel?.id ? baseline?.id : null
  )

  // receita com o reajuste datado (cada dia ao seu preço) e o calendário do plano
  const opcoesPlan = useOpcoesCurvaS(planSel)
  const opcoesBase = useOpcoesCurvaS(baseline)
  const curvaPlanejada = useMemo(
    () => calcularCurvaSemanal(tarefas, opcoesPlan),
    [tarefas, opcoesPlan]
  )
  const curvaBaseline = useMemo(
    () =>
      tarefasBaseline.length > 0 ? calcularCurvaSemanal(tarefasBaseline, opcoesBase) : undefined,
    [tarefasBaseline, opcoesBase]
  )

  // Totais consolidados: indiretas usam custo_total_calc + custo_taxas_calc,
  // diretas usam custo_total_calc (que via view v10 já é custo_unit × qtd).
  const totalCusto = tarefas.reduce(
    (acc, t) =>
      acc +
      Number(t.custo_total_calc ?? t.custo_total_tarefa ?? 0) +
      Number(t.custo_taxas_calc ?? 0),
    0
  )
  // receita: soma da curva (já com o reajuste datado); sem perfil, o total das tarefas
  const totalReceita =
    curvaPlanejada.length > 0
      ? curvaPlanejada[curvaPlanejada.length - 1].receita_acumulada
      : tarefas.reduce((acc, t) => acc + Number(t.receita_total_calc ?? 0), 0)
  const margem = totalReceita - totalCusto
  // início e término calculados do plano (a curva é por semana: o 1º e o último ponto são segundas-feiras)
  const datas = tarefas.filter((t) => t.data_inicio && t.data_fim)
  const inicioPlano = datas.length ? datas.map((t) => t.data_inicio!).sort()[0] : null
  const fimPlano = datas.length ? datas.map((t) => t.data_fim!).sort()[datas.length - 1] : null

  if (!planAtivo) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Curva S" />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="trending-up"
            title="Nenhum plano nesta obra"
            description="Crie um plano no cronograma e calcule-o para ver a curva S."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Curva S"
        subtitle={`Custo e receita acumulados do plano${baseline ? ', comparados com a linha de base' : ''}`}
        actions={
          <Filtro rotulo="Plano">
            <Select
              value={planSel?.id ?? ''}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-[260px]"
            >
              {planejamentos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                  {p.is_baseline ? ' (linha de base)' : ''}
                </option>
              ))}
            </Select>
          </Filtro>
        }
      />
      <div className="flex-1 overflow-auto p-5 space-y-4">
        <FaixaIndicadores rotulo="Totais do plano">
          <Indicador rotulo="Receita" tamanho="sm" valor={fmtBRL(totalReceita)} />
          <Indicador rotulo="Custo" tamanho="sm" valor={fmtBRL(totalCusto)} />
          <Indicador
            rotulo="Margem"
            tamanho="sm"
            tom={margem >= 0 ? 'success' : 'danger'}
            valor={fmtBRL(margem)}
          />
          <Indicador
            rotulo="Início"
            tamanho="sm"
            valor={fmtDataBR(inicioPlano ?? planSel?.data_referencia_inicio)}
          />
          <Indicador rotulo="Término" tamanho="sm" valor={fmtDataBR(fimPlano)} />
        </FaixaIndicadores>

        <CurvaSChart planejada={curvaPlanejada} baseline={curvaBaseline} height={420} />

        {curvaPlanejada.length > 0 ? (
          <Secao titulo="Distribuição semanal" semRecuo>
            <div
              tabIndex={0}
              role="region"
              aria-label="Distribuição semanal do custo e da receita"
              className="max-h-[320px] overflow-auto border-t border-border"
            >
              <table className="w-full text-sm tabular">
                <thead className="sticky top-0 bg-bg-elevated text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                  <tr className="border-b border-border-strong">
                    <th scope="col" className="text-left font-semibold px-4 py-2">
                      Semana
                    </th>
                    <th scope="col" className="text-right font-semibold px-3 py-2">
                      Custo da semana
                    </th>
                    <th scope="col" className="text-right font-semibold px-3 py-2">
                      Custo acumulado
                    </th>
                    <th scope="col" className="text-right font-semibold px-3 py-2">
                      Receita da semana
                    </th>
                    <th scope="col" className="text-right font-semibold px-3 py-2">
                      Receita acumulada
                    </th>
                    <th scope="col" className="text-right font-semibold px-4 py-2">
                      Margem acumulada
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {curvaPlanejada.map((row) => {
                    const margemAcum = row.receita_acumulada - row.custo_acumulado
                    return (
                      <tr key={row.periodo} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-1.5 text-text">{fmtDataBR(row.periodo)}</td>
                        <td className="px-3 py-1.5 text-right text-text-muted">
                          {fmtBRL(row.custo_periodo)}
                        </td>
                        <td className="px-3 py-1.5 text-right text-text">
                          {fmtBRL(row.custo_acumulado)}
                        </td>
                        <td className="px-3 py-1.5 text-right text-text-muted">
                          {fmtBRL(row.receita_periodo)}
                        </td>
                        <td className="px-3 py-1.5 text-right text-text">
                          {fmtBRL(row.receita_acumulada)}
                        </td>
                        <td
                          className={`px-4 py-1.5 text-right font-semibold ${margemAcum >= 0 ? 'text-success' : 'text-danger'}`}
                        >
                          {fmtBRL(margemAcum)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Secao>
        ) : null}
      </div>
    </div>
  )
}
