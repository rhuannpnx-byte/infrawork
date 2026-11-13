import { VoltarPlanilhaButton } from '@/features/orcamento/components/VoltarPlanilhaButton'
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { EmptyState } from '@/components/layout/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Carregando, ErroConsulta } from '@/components/ui/estado'
import { FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { usePlanOrc } from '@/features/orcamento/hooks/plan-orc'
import { usePlanilhaInicial } from '@/features/orcamento/hooks/aditivos'
import { compareCodigo } from '@/lib/xlsx/parse-sheet'
import { fmtBRL, fmtQtd } from '@/lib/money'
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import { cn } from '@/lib/utils'

const TH = 'px-2 py-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'

export function PlanilhaInicialPage(): ReactNode {
  return (
    <RequireObra pageTitle="Planilha inicial">
      <PlanilhaInicialInner />
    </RequireObra>
  )
}

interface Linha {
  id: string
  codigo: string
  descricao: string
  tipo: string
  nivel: number
  unidade: string | null
  quantidade: number | null
  venda_unitaria: number | null
  venda_total: number
}

/** Planilha de venda arquivada no 1º aditivo, comparada com a planilha atual. */
function PlanilhaInicialInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const navigate = useNavigate()
  const { data: inicial, isLoading, error, refetch } = usePlanilhaInicial(obraId)
  const { data: plan } = usePlanOrc(obraId)
  const [soDiferencas, setSoDiferencas] = useState(false)

  const linhas = useMemo<Linha[]>(() => {
    const itens = (inicial?.snapshot.itens ?? []).filter((i) => i.tipo !== 'servico_grupo')
    return itens
      .map((i) => ({
        id: String(i.id),
        codigo: String(i.codigo),
        descricao: String(i.descricao ?? ''),
        tipo: String(i.tipo),
        nivel: Number(i.nivel ?? 1),
        unidade: (i.unidade as string | null) ?? null,
        quantidade: i.quantidade == null ? null : Number(i.quantidade),
        venda_unitaria: i.venda_unitaria == null ? null : Number(i.venda_unitaria),
        venda_total: Number(i.venda_total_calc ?? 0)
      }))
      .sort((a, b) => compareCodigo(a.codigo, b.codigo))
  }, [inicial])

  const atualPorCodigo = useMemo(
    () => new Map((plan?.flat ?? []).map((n) => [n.codigo, n])),
    [plan]
  )
  const novos = useMemo(() => {
    const ini = new Set(linhas.map((l) => l.codigo))
    return (plan?.flat ?? []).filter((n) => !ini.has(n.codigo))
  }, [plan, linhas])

  if (isLoading || error || !inicial) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Planilha inicial" actions={<VoltarPlanilhaButton />} />
        {isLoading ? (
          <Carregando className="px-5" />
        ) : error ? (
          <div className="p-5">
            <ErroConsulta erro={error} oQue="a planilha inicial" aoTentar={() => void refetch()} />
          </div>
        ) : (
          <EmptyState
            icon="archive"
            title="Ainda não há planilha inicial"
            description="A planilha de venda é arquivada como planilha inicial quando o primeiro aditivo é aplicado. Até lá, a planilha orçamentária é a única versão."
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigate({ to: '/orcamento/obra/aditivos' })}
              >
                Abrir aditivos
              </Button>
            }
          />
        )}
      </div>
    )
  }

  const vendaIni = linhas.filter((l) => l.nivel === 1).reduce((a, l) => a + l.venda_total, 0)
  const vendaAtual = plan?.totais.venda ?? 0
  const variacao = vendaAtual - vendaIni
  const visiveis = soDiferencas
    ? linhas.filter((l) => {
        const a = atualPorCodigo.get(l.codigo)
        return !a || Math.abs(Number(a.venda_total_calc ?? 0) - l.venda_total) > 0.005
      })
    : linhas

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Planilha inicial"
        subtitle={`Arquivada em ${fmtDataBR(inicial.criada_em.slice(0, 10))}, antes do 1º aditivo`}
        actions={
          <div className="flex items-center gap-3">
            <VoltarPlanilhaButton />
            <label className="flex items-center gap-1.5 text-sm text-text-muted">
              <input
                type="checkbox"
                checked={soDiferencas}
                onChange={(e) => setSoDiferencas(e.target.checked)}
              />
              Só o que mudou
            </label>
          </div>
        }
      />
      <div className="flex-1 min-h-0 flex flex-col gap-4 p-5">
        <FaixaIndicadores rotulo="Venda inicial e atual" className="shrink-0">
          <Indicador rotulo="Venda inicial" valor={fmtBRL(vendaIni)} tamanho="sm" />
          <Indicador
            rotulo="Venda atual"
            valor={fmtBRL(vendaAtual)}
            tamanho="sm"
            carregando={!plan}
          />
          <Indicador
            rotulo="Variação"
            valor={fmtBRL(variacao)}
            tamanho="sm"
            carregando={!plan}
            tom={variacao < 0 ? 'danger' : variacao > 0 ? 'success' : 'neutro'}
          />
        </FaixaIndicadores>
        <div
          tabIndex={0}
          role="region"
          aria-label="Planilha inicial comparada com a atual"
          className="flex-1 min-h-0 overflow-auto rounded border border-border bg-bg-panel"
        >
          <table className="w-full text-sm tabular">
            <thead className="sticky top-0 z-10 bg-bg-elevated shadow-[0_1px_0_0_var(--border-strong)]">
              <tr>
                <th scope="col" className={`${TH} text-left`}>
                  Código
                </th>
                <th scope="col" className={`${TH} text-left`}>
                  Descrição
                </th>
                <th scope="col" className={`${TH} text-left`}>
                  Un.
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Qtd. inicial
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Preço
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Total inicial
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Qtd. atual
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Total atual
                </th>
              </tr>
            </thead>
            <tbody>
              {visiveis.length === 0 && novos.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-text-muted">
                    {soDiferencas
                      ? 'Nenhum item mudou em relação à planilha inicial.'
                      : 'A planilha inicial foi arquivada sem itens.'}
                  </td>
                </tr>
              ) : null}
              {visiveis.map((l) => {
                const a = atualPorCodigo.get(l.codigo)
                const etapa = l.tipo === 'etapa'
                const totalAtual = a ? Number(a.venda_total_calc ?? 0) : 0
                const mudou = !a || Math.abs(totalAtual - l.venda_total) > 0.005
                return (
                  <tr
                    key={l.id}
                    className={cn('border-b border-border', etapa && 'bg-bg-elevated')}
                  >
                    <td className="px-2 py-1.5 text-text-dim whitespace-nowrap">{l.codigo}</td>
                    <td
                      className={cn('px-2 py-1.5 text-text', etapa && 'font-semibold')}
                      style={{ paddingLeft: 8 + (l.nivel - 1) * 14 }}
                    >
                      {l.descricao}
                    </td>
                    <td className="px-2 py-1.5 text-text-muted">{l.unidade ?? ''}</td>
                    <td className="px-2 py-1.5 text-right text-text whitespace-nowrap">
                      {l.quantidade != null ? fmtQtd(l.quantidade) : ''}
                    </td>
                    <td className="px-2 py-1.5 text-right text-text whitespace-nowrap">
                      {l.venda_unitaria != null ? fmtBRL(l.venda_unitaria) : ''}
                    </td>
                    <td className="px-2 py-1.5 text-right text-text whitespace-nowrap">
                      {fmtBRL(l.venda_total)}
                    </td>
                    <td
                      className={cn(
                        'px-2 py-1.5 text-right whitespace-nowrap',
                        mudou ? 'font-semibold text-warn' : 'text-text-muted'
                      )}
                    >
                      {!a ? (
                        <Badge variant="danger">Excluído</Badge>
                      ) : a.quantidade != null ? (
                        fmtQtd(a.quantidade)
                      ) : (
                        ''
                      )}
                    </td>
                    <td
                      className={cn(
                        'px-2 py-1.5 text-right whitespace-nowrap',
                        mudou ? 'font-semibold text-warn' : 'text-text-muted'
                      )}
                    >
                      {a ? fmtBRL(totalAtual) : '—'}
                    </td>
                  </tr>
                )
              })}
              {novos.map((n) => (
                <tr key={n.id} className="border-b border-border">
                  <td className="px-2 py-1.5 text-text-dim whitespace-nowrap">{n.codigo}</td>
                  <td className="px-2 py-1.5 text-text">
                    {n.descricao} <Badge variant="accent">Item novo de aditivo</Badge>
                  </td>
                  <td className="px-2 py-1.5 text-text-muted">{n.unidade ?? ''}</td>
                  <td className="px-2 py-1.5 text-right text-text-dim">—</td>
                  <td className="px-2 py-1.5 text-right text-text whitespace-nowrap">
                    {n.venda_unitaria != null ? fmtBRL(n.venda_unitaria) : ''}
                  </td>
                  <td className="px-2 py-1.5 text-right text-text-dim">—</td>
                  <td className="px-2 py-1.5 text-right text-success whitespace-nowrap">
                    {n.quantidade != null ? fmtQtd(n.quantidade) : ''}
                  </td>
                  <td className="px-2 py-1.5 text-right text-success whitespace-nowrap">
                    {fmtBRL(Number(n.venda_total_calc ?? 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
