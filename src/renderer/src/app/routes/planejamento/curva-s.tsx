import { useMemo, useState, type ReactNode } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
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
import { fmtBRL, fmtPct2 } from '@/lib/money'
import { fmtDataBR } from '@/features/planejamento/lib/dates'

export function PlanejamentoCurvaSPage(): ReactNode {
  return (
    <RequireObra pageTitle="Curva-S">
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
  const planSel = planId
    ? planejamentos.find((p) => p.id === planId) ?? planAtivo
    : planAtivo

  const { data: tarefas = [] } = useTarefas(planSel?.id)
  const { data: tarefasBaseline = [] } = useTarefas(
    baseline?.id !== planSel?.id ? baseline?.id : null
  )

  const curvaPlanejada = useMemo(() => calcularCurvaSemanal(tarefas), [tarefas])
  const curvaBaseline = useMemo(
    () => (tarefasBaseline.length > 0 ? calcularCurvaSemanal(tarefasBaseline) : undefined),
    [tarefasBaseline]
  )

  const totalCusto = tarefas.reduce((acc, t) => acc + (t.custo_total_tarefa ?? 0), 0)

  if (!planAtivo) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Curva-S" subtitle={scope.obra?.nome ?? ''} />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="trending-up"
            title="Sem planejamento ativo"
            description="Crie uma revisão e calcule o cronograma para visualizar a curva-S."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Curva-S"
        subtitle={`${scope.obra?.nome ?? ''} — avanço físico acumulado planejado${baseline ? ' vs baseline' : ''}.`}
        actions={
          <select
            value={planSel?.id ?? ''}
            onChange={(e) => setPlanId(e.target.value)}
            className="bg-bg border border-border rounded px-2 py-1 text-xs font-mono"
          >
            {planejamentos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome} {p.is_baseline ? '★' : ''}
              </option>
            ))}
          </select>
        }
      />
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Custo total" value={fmtBRL(totalCusto)} />
          <Stat
            label="Início"
            value={fmtDataBR(curvaPlanejada[0]?.periodo ?? planSel?.data_referencia_inicio)}
          />
          <Stat
            label="Fim"
            value={fmtDataBR(curvaPlanejada[curvaPlanejada.length - 1]?.periodo ?? null)}
          />
        </div>

        <CurvaSChart planejada={curvaPlanejada} baseline={curvaBaseline} height={420} />

        {curvaPlanejada.length > 0 ? (
          <div className="rounded border border-border bg-bg-panel overflow-hidden">
            <div className="px-3 py-2 border-b border-border text-2xs font-mono text-text-dim uppercase">
              Distribuição semanal
            </div>
            <div className="max-h-[280px] overflow-auto">
              <table className="w-full text-xs font-mono">
                <thead className="text-text-dim uppercase text-2xs bg-bg sticky top-0">
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-1.5">Semana</th>
                    <th className="text-right px-3 py-1.5">Custo do período</th>
                    <th className="text-right px-3 py-1.5">Acumulado</th>
                    <th className="text-right px-3 py-1.5">% Planejado</th>
                    {curvaBaseline ? (
                      <th className="text-right px-3 py-1.5">% Baseline</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {curvaPlanejada.map((row) => {
                    const baseRow = curvaBaseline?.find((b) => b.periodo === row.periodo)
                    return (
                      <tr key={row.periodo} className="border-b border-border/40">
                        <td className="px-3 py-1.5">{fmtDataBR(row.periodo)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {fmtBRL(row.custo_periodo)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {fmtBRL(row.custo_acumulado)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-accent">
                          {fmtPct2(row.perc_acumulado)}
                        </td>
                        {curvaBaseline ? (
                          <td className="px-3 py-1.5 text-right tabular-nums text-text-dim">
                            {baseRow ? fmtPct2(baseRow.perc_acumulado) : '—'}
                          </td>
                        ) : null}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="rounded border border-border bg-bg-panel p-3">
      <div className="text-2xs font-mono text-text-dim uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="text-md font-mono text-text">{value}</div>
    </div>
  )
}
