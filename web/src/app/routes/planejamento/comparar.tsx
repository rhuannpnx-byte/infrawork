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
import { useOpcoesCurvaS } from '@/features/acompanhamento/hooks/valor-agregado'
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import { cn } from '@/lib/utils'
import { compararPlanos } from '@/features/planejamento/lib/comparar-planos'

export function PlanejamentoCompararPage(): ReactNode {
  return (
    <RequireObra pageTitle="Comparar planos">
      <CompararInner />
    </RequireObra>
  )
}

function CompararInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const { data: planejamentos = [] } = usePlanejamentos(obraId)
  const { data: ativo } = usePlanejamentoAtivo(obraId)
  const { data: baseline } = useBaseline(obraId)

  const [esquerdaId, setEsquerdaId] = useState<string | null>(null)
  const [direitaId, setDireitaId] = useState<string | null>(null)

  const esquerda = esquerdaId ? planejamentos.find((p) => p.id === esquerdaId) : (baseline ?? null)
  const direita = direitaId
    ? planejamentos.find((p) => p.id === direitaId)
    : ativo && ativo.id !== baseline?.id
      ? ativo
      : null

  const { data: tarefasEsq = [] } = useTarefas(esquerda?.id)
  const { data: tarefasDir = [] } = useTarefas(direita?.id)

  // linha a linha pela posição na árvore (um serviço pode ter várias tarefas; numa cópia os ids mudam)
  const diffs = useMemo(() => compararPlanos(tarefasEsq, tarefasDir), [tarefasEsq, tarefasDir])

  const opcoesEsq = useOpcoesCurvaS(esquerda)
  const opcoesDir = useOpcoesCurvaS(direita)
  const curvaEsq = useMemo(
    () => calcularCurvaSemanal(tarefasEsq, opcoesEsq),
    [tarefasEsq, opcoesEsq]
  )
  const curvaDir = useMemo(
    () => calcularCurvaSemanal(tarefasDir, opcoesDir),
    [tarefasDir, opcoesDir]
  )

  if (!baseline && !ativo) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Comparar" />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="git-compare"
            title="Sem revisões para comparar"
            description="Crie um plano e trave-o como linha de base para comparar."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Comparar planos"
        subtitle="Diferença entre dois planos do cronograma."
        actions={
          <div className="flex items-center gap-2">
            <span className="text-2xs font-mono text-text-dim uppercase">Esq:</span>
            <select
              value={esquerda?.id ?? ''}
              onChange={(e) => setEsquerdaId(e.target.value)}
              className="bg-bg border border-border rounded px-2 py-1 text-xs font-mono"
            >
              <option value="">— escolher —</option>
              {planejamentos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome} {p.is_baseline ? '★' : ''}
                </option>
              ))}
            </select>
            <span className="text-2xs font-mono text-text-dim uppercase">Dir:</span>
            <select
              value={direita?.id ?? ''}
              onChange={(e) => setDireitaId(e.target.value)}
              className="bg-bg border border-border rounded px-2 py-1 text-xs font-mono"
            >
              <option value="">— escolher —</option>
              {planejamentos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome} {p.is_baseline ? '★' : ''}
                </option>
              ))}
            </select>
          </div>
        }
      />
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {esquerda && direita ? (
          <>
            <CurvaSChart
              planejada={curvaDir}
              baseline={curvaEsq}
              rotuloBaseline={esquerda.nome}
              height={300}
            />

            <div className="rounded border border-border bg-bg-panel overflow-hidden">
              <div className="px-3 py-2 border-b border-border text-2xs font-mono text-text-dim uppercase flex items-center justify-between">
                <span>Diferença tarefa-a-tarefa</span>
                <span>
                  <span className="text-text-dim">Esq:</span>{' '}
                  <strong className="text-text">{esquerda.nome}</strong>
                  {' · '}
                  <span className="text-text-dim">Dir:</span>{' '}
                  <strong className="text-text">{direita.nome}</strong>
                </span>
              </div>
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="text-text-dim uppercase text-2xs bg-bg sticky top-0">
                    <tr className="border-b border-border">
                      <th className="text-left px-3 py-1.5">Tarefa</th>
                      <th className="text-left px-3 py-1.5">Esq início → fim</th>
                      <th className="text-left px-3 py-1.5">Dir início → fim</th>
                      <th className="text-right px-3 py-1.5">Δ início</th>
                      <th className="text-right px-3 py-1.5">Δ fim</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.map((r) => (
                      <tr
                        key={r.key}
                        className={cn('border-b border-border', r.grupo && 'bg-bg/40')}
                      >
                        <td className="px-3 py-1.5" style={{ paddingLeft: 12 + r.nivel * 14 }}>
                          <span className="text-text-dim mr-1.5">{r.numero}</span>
                          <span className={r.grupo ? 'font-semibold text-text' : 'text-text-muted'}>
                            {r.nome}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          <Periodo p={r.esq} />
                        </td>
                        <td className="px-3 py-1.5">
                          <Periodo p={r.dir} />
                        </td>
                        <Delta d={r.dInicio} />
                        <Delta d={r.dFim} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="text-xs text-text-dim italic">
            Selecione duas revisões nos dropdowns acima para comparar.
          </div>
        )}
      </div>
    </div>
  )
}

function Periodo({
  p
}: {
  p: { inicio: string | null; fim: string | null } | undefined
}): ReactNode {
  if (!p) return <span className="text-text-dim italic">não existe</span>
  if (!p.inicio && !p.fim) return <span className="text-text-dim">sem datas</span>
  return (
    <>
      {fmtDataBR(p.inicio)} → {fmtDataBR(p.fim)}
    </>
  )
}

/** Diferença em dias corridos: depois = atraso (vermelho), antes = adiantamento (verde). */
function Delta({ d }: { d: number | null }): ReactNode {
  return (
    <td
      className={cn(
        'px-3 py-1.5 text-right tabular-nums',
        d === null || d === 0 ? 'text-text-dim' : d > 0 ? 'text-danger' : 'text-success'
      )}
    >
      {d === null ? '—' : `${d > 0 ? '+' : ''}${d} d`}
    </td>
  )
}
