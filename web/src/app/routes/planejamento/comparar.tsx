import { useMemo, useState, type ReactNode } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Secao } from '@/components/ui/secao'
import { Vazio } from '@/components/ui/estado'
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
        <PageHeader title="Comparar planos" />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="git-compare"
            title="Nenhum plano para comparar"
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
        subtitle="Diferença de datas entre dois planos do cronograma, tarefa por tarefa"
        actions={
          <>
            <Filtro rotulo="Referência">
              <Select
                value={esquerda?.id ?? ''}
                onChange={(e) => setEsquerdaId(e.target.value)}
                className="w-[230px]"
              >
                <option value="">Escolher…</option>
                {planejamentos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                    {p.is_baseline ? ' (linha de base)' : ''}
                  </option>
                ))}
              </Select>
            </Filtro>
            <Filtro rotulo="Comparado">
              <Select
                value={direita?.id ?? ''}
                onChange={(e) => setDireitaId(e.target.value)}
                className="w-[230px]"
              >
                <option value="">Escolher…</option>
                {planejamentos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                    {p.is_baseline ? ' (linha de base)' : ''}
                  </option>
                ))}
              </Select>
            </Filtro>
          </>
        }
      />
      <div className="flex-1 overflow-auto p-5 space-y-4">
        {esquerda && direita ? (
          <>
            <CurvaSChart
              planejada={curvaDir}
              baseline={curvaEsq}
              rotuloBaseline={esquerda.nome}
              height={300}
            />

            <Secao
              titulo="Diferença por tarefa"
              nota={`de "${esquerda.nome}" para "${direita.nome}"; em dias corridos, positivo é atraso`}
              semRecuo
            >
              <div
                tabIndex={0}
                role="region"
                aria-label="Diferença de datas por tarefa"
                className="max-h-[520px] overflow-auto border-t border-border"
              >
                <table className="w-full text-sm tabular">
                  <thead className="sticky top-0 bg-bg-elevated text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                    <tr className="border-b border-border-strong">
                      <th scope="col" className="text-left font-semibold px-4 py-2">
                        Tarefa
                      </th>
                      <th scope="col" className="text-left font-semibold px-3 py-2">
                        Referência
                      </th>
                      <th scope="col" className="text-left font-semibold px-3 py-2">
                        Comparado
                      </th>
                      <th scope="col" className="text-right font-semibold px-3 py-2">
                        Início
                      </th>
                      <th scope="col" className="text-right font-semibold px-4 py-2">
                        Término
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.map((r) => (
                      <tr
                        key={r.key}
                        className={cn('border-b border-border', r.grupo && 'bg-bg-elevated')}
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
            </Secao>
          </>
        ) : (
          <Vazio>Escolha acima o plano de referência e o plano comparado.</Vazio>
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
  if (!p) return <span className="text-text-dim">não existe</span>
  if (!p.inicio && !p.fim) return <span className="text-text-dim">sem datas</span>
  return (
    <>
      {fmtDataBR(p.inicio)} a {fmtDataBR(p.fim)}
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
