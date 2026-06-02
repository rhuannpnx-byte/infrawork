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
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import { cn } from '@/lib/utils'

export function PlanejamentoCompararPage(): ReactNode {
  return (
    <RequireObra pageTitle="Comparar baseline">
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

  const esquerda = esquerdaId
    ? planejamentos.find((p) => p.id === esquerdaId)
    : baseline ?? null
  const direita = direitaId
    ? planejamentos.find((p) => p.id === direitaId)
    : ativo && ativo.id !== baseline?.id
      ? ativo
      : null

  const { data: tarefasEsq = [] } = useTarefas(esquerda?.id)
  const { data: tarefasDir = [] } = useTarefas(direita?.id)

  // Chave de pareamento: prefere `item_orcamentario_id` (modelo agregador novo),
  // cai pra `codigo_eap` (modelo legado), e finalmente pro próprio id (sem par).
  // Modelos diferentes não cruzam — cada lado vira linha solta.
  type Row = {
    key: string
    codigo: string
    descricao: string
    esq?: (typeof tarefasEsq)[number]
    dir?: (typeof tarefasDir)[number]
  }
  const diffs = useMemo(() => {
    const codigoDe = (t: (typeof tarefasEsq)[number]): string =>
      t.codigo_eap ?? t.servico_grupo_codigo ?? ''
    const descricaoDe = (t: (typeof tarefasEsq)[number]): string =>
      t.nome_custom ?? t.servico_grupo_descricao ?? '(sem nome)'
    const keyDe = (t: (typeof tarefasEsq)[number]): string =>
      t.item_orcamentario_id ?? (t.codigo_eap ? `eap:${t.codigo_eap}` : `id:${t.id}`)
    const porChave = new Map<string, Row>()
    for (const t of tarefasEsq) {
      const k = keyDe(t)
      porChave.set(k, { key: k, codigo: codigoDe(t), descricao: descricaoDe(t), esq: t })
    }
    for (const t of tarefasDir) {
      const k = keyDe(t)
      const cur = porChave.get(k)
      if (cur) {
        cur.dir = t
      } else {
        porChave.set(k, { key: k, codigo: codigoDe(t), descricao: descricaoDe(t), dir: t })
      }
    }
    return Array.from(porChave.values()).sort((a, b) => a.codigo.localeCompare(b.codigo))
  }, [tarefasEsq, tarefasDir])

  // Heurística: se nenhuma linha tem AMBOS lados, os modelos são incompatíveis
  // (uma revisão usa item_orcamentario_id, a outra usa codigo_eap legado).
  const modelosDivergem = useMemo(() => {
    if (tarefasEsq.length === 0 || tarefasDir.length === 0) return false
    const pareadas = diffs.filter((r) => r.esq && r.dir).length
    return pareadas === 0 && diffs.length > 0
  }, [diffs, tarefasEsq.length, tarefasDir.length])

  const curvaEsq = useMemo(() => calcularCurvaSemanal(tarefasEsq), [tarefasEsq])
  const curvaDir = useMemo(() => calcularCurvaSemanal(tarefasDir), [tarefasDir])

  if (!baseline && !ativo) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Comparar" subtitle={scope.obra?.nome ?? ''} />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="git-compare"
            title="Sem revisões para comparar"
            description="Crie revisões e promova uma a baseline para comparar."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Comparar baseline"
        subtitle={`${scope.obra?.nome ?? ''} — diferença entre duas revisões do cronograma.`}
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
            {modelosDivergem ? (
              <div className="rounded border border-amber-700/60 bg-amber-950/30 text-amber-200 px-3 py-2 text-xs font-mono">
                <strong>Modelos de tarefa incompatíveis.</strong> Nenhuma tarefa pareou entre as
                duas revisões — uma usa <code>item_orcamentario_id</code> (modelo atual), a outra
                usa <code>codigo_eap</code> (modelo legado). Cada tarefa aparece em um lado só.
                Comparação de cronograma só faz sentido entre revisões do mesmo modelo.
              </div>
            ) : null}

            <CurvaSChart planejada={curvaDir} baseline={curvaEsq} height={300} />

            <div className="rounded border border-border bg-bg-panel overflow-hidden">
              <div className="px-3 py-2 border-b border-border text-2xs font-mono text-text-dim uppercase flex items-center justify-between">
                <span>
                  Diferença tarefa-a-tarefa
                </span>
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
                    {diffs.map((r) => {
                      const dInicio =
                        r.esq?.data_inicio && r.dir?.data_inicio
                          ? Math.round(
                              (new Date(r.dir.data_inicio + 'T00:00:00Z').getTime() -
                                new Date(r.esq.data_inicio + 'T00:00:00Z').getTime()) /
                                (1000 * 60 * 60 * 24)
                            )
                          : null
                      const dFim =
                        r.esq?.data_fim && r.dir?.data_fim
                          ? Math.round(
                              (new Date(r.dir.data_fim + 'T00:00:00Z').getTime() -
                                new Date(r.esq.data_fim + 'T00:00:00Z').getTime()) /
                                (1000 * 60 * 60 * 24)
                            )
                          : null
                      return (
                        <tr key={r.key} className="border-b border-border/40">
                          <td className="px-3 py-1.5">
                            <span className="text-text-dim mr-1">{r.codigo}</span>
                            {r.descricao}
                          </td>
                          <td className="px-3 py-1.5">
                            {r.esq ? (
                              <>
                                {fmtDataBR(r.esq.data_inicio)} → {fmtDataBR(r.esq.data_fim)}
                              </>
                            ) : (
                              <span className="text-text-dim italic">não existe</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            {r.dir ? (
                              <>
                                {fmtDataBR(r.dir.data_inicio)} → {fmtDataBR(r.dir.data_fim)}
                              </>
                            ) : (
                              <span className="text-text-dim italic">não existe</span>
                            )}
                          </td>
                          <td
                            className={cn(
                              'px-3 py-1.5 text-right tabular-nums',
                              dInicio === null
                                ? 'text-text-dim'
                                : dInicio > 0
                                  ? 'text-red-400'
                                  : dInicio < 0
                                    ? 'text-emerald-400'
                                    : 'text-text-dim'
                            )}
                          >
                            {dInicio === null ? '—' : `${dInicio > 0 ? '+' : ''}${dInicio}d`}
                          </td>
                          <td
                            className={cn(
                              'px-3 py-1.5 text-right tabular-nums',
                              dFim === null
                                ? 'text-text-dim'
                                : dFim > 0
                                  ? 'text-red-400'
                                  : dFim < 0
                                    ? 'text-emerald-400'
                                    : 'text-text-dim'
                            )}
                          >
                            {dFim === null ? '—' : `${dFim > 0 ? '+' : ''}${dFim}d`}
                          </td>
                        </tr>
                      )
                    })}
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
