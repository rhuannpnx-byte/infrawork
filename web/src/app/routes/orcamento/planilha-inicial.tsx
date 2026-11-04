import { VoltarPlanilhaButton } from '@/features/orcamento/components/VoltarPlanilhaButton'
import { useMemo, useState, type ReactNode } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { EmptyState } from '@/components/layout/EmptyState'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { usePlanOrc } from '@/features/orcamento/hooks/plan-orc'
import { usePlanilhaInicial } from '@/features/orcamento/hooks/aditivos'
import { compareCodigo } from '@/lib/xlsx/parse-sheet'
import { fmtBRL, fmtQtd } from '@/lib/money'
import { fmtDataBR } from '@/features/planejamento/lib/dates'

export function PlanilhaInicialPage(): ReactNode {
  return (
    <RequireObra pageTitle="Planilha Inicial">
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
  const { data: inicial, isLoading } = usePlanilhaInicial(obraId)
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

  if (isLoading) return <div className="p-5 text-xs text-text-muted font-mono">Carregando…</div>
  if (!inicial) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader
          title="Planilha Inicial"
          breadcrumb={['Orçamento', 'Planilha Orçamentária', 'Planilha Inicial']}
          subtitle={scope.obra?.nome ?? ''}
          actions={<VoltarPlanilhaButton />}
        />
        <EmptyState
          icon="archive"
          title="Ainda sem aditivo"
          description="A Planilha Inicial é arquivada automaticamente quando o primeiro aditivo é aplicado."
        />
      </div>
    )
  }

  const vendaIni = linhas.filter((l) => l.nivel === 1).reduce((a, l) => a + l.venda_total, 0)
  const vendaAtual = plan?.totais.venda ?? 0
  const visiveis = soDiferencas
    ? linhas.filter((l) => {
        const a = atualPorCodigo.get(l.codigo)
        return !a || Math.abs(Number(a.venda_total_calc ?? 0) - l.venda_total) > 0.005
      })
    : linhas

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Planilha Inicial"
        breadcrumb={['Orçamento', 'Planilha Orçamentária', 'Planilha Inicial']}
        subtitle={`${scope.obra?.nome ?? ''} — arquivada em ${fmtDataBR(inicial.criada_em.slice(0, 10))} (antes do 1º aditivo)`}
        actions={
          <div className="flex items-center gap-3">
            <VoltarPlanilhaButton />
            <label className="flex items-center gap-1.5 text-xs text-text-muted">
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
      <div className="px-5 py-2 flex gap-6 text-xs font-mono border-b border-border">
        <span>
          Inicial <strong className="text-text">{fmtBRL(vendaIni)}</strong>
        </span>
        <span>
          Atual <strong className="text-text">{fmtBRL(vendaAtual)}</strong>
        </span>
        <span>
          Δ{' '}
          <strong className={vendaAtual - vendaIni < 0 ? 'text-danger' : 'text-success'}>
            {fmtBRL(vendaAtual - vendaIni)}
          </strong>
        </span>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <table className="w-full text-xs">
          <thead className="text-text-dim font-mono uppercase text-2xs bg-bg sticky top-0">
            <tr className="border-b border-border">
              <th className="text-left px-2 py-1.5">Código</th>
              <th className="text-left px-2 py-1.5">Descrição</th>
              <th className="text-left px-2 py-1.5">Un</th>
              <th className="text-right px-2 py-1.5">Qtd inicial</th>
              <th className="text-right px-2 py-1.5">Preço</th>
              <th className="text-right px-2 py-1.5">Total inicial</th>
              <th className="text-right px-2 py-1.5">Qtd atual</th>
              <th className="text-right px-2 py-1.5">Total atual</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => {
              const a = atualPorCodigo.get(l.codigo)
              const etapa = l.tipo === 'etapa'
              const totalAtual = a ? Number(a.venda_total_calc ?? 0) : 0
              const mudou = !a || Math.abs(totalAtual - l.venda_total) > 0.005
              return (
                <tr
                  key={l.id}
                  className={'border-b border-border/40 ' + (etapa ? 'bg-bg-elevated/40' : '')}
                >
                  <td className="px-2 py-1 font-mono text-text-dim">{l.codigo}</td>
                  <td
                    className={'px-2 py-1 ' + (etapa ? 'font-semibold text-text' : 'text-text')}
                    style={{ paddingLeft: 8 + (l.nivel - 1) * 14 }}
                  >
                    {l.descricao}
                  </td>
                  <td className="px-2 py-1 font-mono text-text-muted">{l.unidade ?? ''}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {l.quantidade != null ? fmtQtd(l.quantidade) : ''}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {l.venda_unitaria != null ? fmtBRL(l.venda_unitaria) : ''}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtBRL(l.venda_total)}</td>
                  <td
                    className={
                      'px-2 py-1 text-right tabular-nums ' +
                      (mudou ? 'text-warn' : 'text-text-muted')
                    }
                  >
                    {!a ? (
                      <span className="text-danger">excluído</span>
                    ) : a.quantidade != null ? (
                      fmtQtd(a.quantidade)
                    ) : (
                      ''
                    )}
                  </td>
                  <td
                    className={
                      'px-2 py-1 text-right tabular-nums ' +
                      (mudou ? 'text-warn' : 'text-text-muted')
                    }
                  >
                    {a ? fmtBRL(totalAtual) : '—'}
                  </td>
                </tr>
              )
            })}
            {novos.map((n) => (
              <tr key={n.id} className="border-b border-border/40">
                <td className="px-2 py-1 font-mono text-text-dim">{n.codigo}</td>
                <td className="px-2 py-1 text-text">
                  {n.descricao}{' '}
                  <span className="text-2xs text-accent font-mono">(item novo de aditivo)</span>
                </td>
                <td className="px-2 py-1 font-mono text-text-muted">{n.unidade ?? ''}</td>
                <td className="px-2 py-1 text-right text-text-dim">—</td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {n.venda_unitaria != null ? fmtBRL(n.venda_unitaria) : ''}
                </td>
                <td className="px-2 py-1 text-right text-text-dim">—</td>
                <td className="px-2 py-1 text-right tabular-nums text-success">
                  {n.quantidade != null ? fmtQtd(n.quantidade) : ''}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-success">
                  {fmtBRL(Number(n.venda_total_calc ?? 0))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
