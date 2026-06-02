import { useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useRevisoes } from '@/features/orcamento/hooks/revisoes'
import { useComparacaoRevisoes } from '@/features/orcamento/hooks/comparacao'
import { ComparacaoCards } from '@/features/orcamento/components/ComparacaoCards'
import { ComparacaoDiffTable } from '@/features/orcamento/components/ComparacaoDiffTable'

export function RevisoesCompararPage(): ReactNode {
  return (
    <RequireObra pageTitle="Comparar revisões">
      <Inner />
    </RequireObra>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const navigate = useNavigate()
  const obraId = scope.obraId!
  const { data: revisoes = [], isLoading: loadingRevs } = useRevisoes(obraId)

  // Defaults: 2 mais recentes (B = mais recente, A = anterior).
  const sortedByVersao = useMemo(
    () => [...revisoes].sort((a, b) => b.versao - a.versao),
    [revisoes]
  )
  const [idA, setIdA] = useState<string>('')
  const [idB, setIdB] = useState<string>('')
  useMemo(() => {
    if (sortedByVersao.length >= 2 && (!idA || !idB)) {
      if (!idB) setIdB(sortedByVersao[0].id)
      if (!idA) setIdA(sortedByVersao[1].id)
    }
  }, [sortedByVersao, idA, idB])

  const comparacao = useComparacaoRevisoes(idA, idB)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Comparar revisões"
        subtitle={`${scope.obra?.nome ?? ''} — diferenças entre duas revisões`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ to: '/orcamento/obra/revisoes' })}
          >
            <ArrowLeft size={11} /> Voltar
          </Button>
        }
      />

      {/* Selects A vs B */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-bg-panel">
        <div className="flex items-center gap-2">
          <span className="text-2xs font-mono uppercase tracking-wider text-text-dim">
            Comparar
          </span>
          <select
            value={idA}
            onChange={(e) => setIdA(e.target.value)}
            className="h-7 px-2 rounded border border-border-strong bg-bg-elevated text-xs text-text"
            disabled={loadingRevs}
          >
            <option value="">— escolher —</option>
            {sortedByVersao.map((r) => (
              <option key={r.id} value={r.id}>
                v{r.versao} · {r.rotulo ?? '(sem rótulo)'} · {r.status}
              </option>
            ))}
          </select>
          <span className="text-2xs font-mono text-text-dim">com</span>
          <select
            value={idB}
            onChange={(e) => setIdB(e.target.value)}
            className="h-7 px-2 rounded border border-border-strong bg-bg-elevated text-xs text-text"
            disabled={loadingRevs}
          >
            <option value="">— escolher —</option>
            {sortedByVersao.map((r) => (
              <option key={r.id} value={r.id}>
                v{r.versao} · {r.rotulo ?? '(sem rótulo)'} · {r.status}
              </option>
            ))}
          </select>
        </div>
        {idA && idB && idA === idB ? (
          <span className="text-2xs text-warn font-mono">A e B são a mesma revisão.</span>
        ) : null}
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-5">
        {!idA || !idB ? (
          <div className="text-xs text-text-muted italic">
            Selecione duas revisões para começar.
          </div>
        ) : comparacao.isLoading ? (
          <div className="text-xs text-text-muted font-mono">Carregando comparação…</div>
        ) : comparacao.error ? (
          <div className="text-2xs font-mono text-danger bg-danger/10 border border-danger/30 rounded px-2 py-1.5">
            {comparacao.error.message}
          </div>
        ) : comparacao.data ? (
          <>
            <div>
              <h2 className="text-2xs font-mono uppercase tracking-wider text-text-dim mb-2">
                Agregados (A → B)
              </h2>
              <ComparacaoCards
                resumoA={comparacao.data.resumoA}
                resumoB={comparacao.data.resumoB}
              />
            </div>

            <div>
              <h2 className="text-2xs font-mono uppercase tracking-wider text-text-dim mb-2">
                Diferenças item-a-item
              </h2>
              <ComparacaoDiffTable diff={comparacao.data.diff} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
