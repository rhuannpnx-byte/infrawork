import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { DataTable } from '@/components/data-table/DataTable'
import type { TableExportConfig } from '@/components/data-table/export-types'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { usePrevistoXRealizado, useCurvaS } from '@/features/acompanhamento/hooks/comparativo'
import { CurvaSComProjecoes } from '@/features/acompanhamento/components/comparativo/CurvaSComProjecoes'
import { ProgressBarPrevReal } from '@/features/acompanhamento/components/comparativo/ProgressBarPrevReal'
import { StatusComparativoChip } from '@/features/acompanhamento/components/comparativo/StatusComparativoChip'
import { projetarItem, type ProjecaoItem } from '@/features/acompanhamento/lib/projecoes'
import { STATUS_COMP_LABEL, type CurvaSPonto, type PrevistoRealizadoItem } from '@/types/acompanhamento'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/format'
import infraworkIcon from '@/assets/infrawork-icon.png'

export function AcompanhamentoComparativoPage(): ReactNode {
  return (
    <RequireObra pageTitle="Previsto × Realizado">
      <Inner />
    </RequireObra>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  // Cliente: visão pura planejado × realizado — sem projeções de adiantamento/
  // atraso (Δ dias, fim projetado, status, linhas de tendência da curva).
  const isCliente = useAuthStore((s) => s.profile?.role === 'cliente')
  const { data: itens = [], isLoading } = usePrevistoXRealizado(obraId)
  const { data: curva = [] } = useCurvaS(obraId, 180)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const itemSelecionado = useMemo(
    () => (selectedId ? itens.find((i) => i.item_orcamentario_id === selectedId) : null) ?? null,
    [selectedId, itens]
  )

  const curvaFiltrada = useMemo(
    () => (selectedId ? curva.filter((p) => p.item_orcamentario_id === selectedId) : curva),
    [selectedId, curva]
  )

  // Projeção de término no ritmo realizado, por item — alimenta a coluna "Δ dias".
  // Usa os pontos da curva-S (mesma fonte do gráfico) pra ser consistente com a
  // linha "Proj. atual"; o desvio_dias_estimado da view (baseado na CPU) ficava 0.
  const projByItem = useMemo(() => {
    const hojeIso = new Date().toISOString().slice(0, 10)
    const curvaByItem = new Map<string, typeof curva>()
    for (const p of curva) {
      if (!p.item_orcamentario_id) continue
      const arr = curvaByItem.get(p.item_orcamentario_id) ?? []
      arr.push(p)
      curvaByItem.set(p.item_orcamentario_id, arr)
    }
    const out = new Map<string, ProjecaoItem>()
    for (const it of itens) {
      out.set(
        it.item_orcamentario_id,
        projetarItem(
          curvaByItem.get(it.item_orcamentario_id) ?? [],
          it.qtd_plan != null ? Number(it.qtd_plan) : null,
          it.data_fim_plan,
          hojeIso
        )
      )
    }
    return out
  }, [curva, itens])

  // Logo (data URL) p/ embutir no relatório PDF — carregada uma vez.
  const [logoDataUrl, setLogoDataUrl] = useState('')
  useEffect(() => {
    let cancel = false
    fetch(infraworkIcon)
      .then((r) => r.blob())
      .then((b) => {
        const fr = new FileReader()
        fr.onload = () => { if (!cancel) setLogoDataUrl(String(fr.result)) }
        fr.readAsDataURL(b)
      })
      .catch(() => {})
    return () => { cancel = true }
  }, [])

  // Curva-S agrupada por item — alimenta o relatório por serviço.
  const curvaByItem = useMemo(() => {
    const m = new Map<string, CurvaSPonto[]>()
    for (const p of curva) {
      if (!p.item_orcamentario_id) continue
      const arr = m.get(p.item_orcamentario_id) ?? []
      arr.push(p)
      m.set(p.item_orcamentario_id, arr)
    }
    return m
  }, [curva])

  // Config de exportação: tabela plana (CSV/Excel) + relatório por serviço (PDF + abas).
  const getExportConfig = useMemo(
    () =>
      (visibleRows: PrevistoRealizadoItem[]): TableExportConfig => {
        // Cliente: export enxuto — só planejado × realizado, sem projeções
        // (Δ dias, fim projetado), sem status e sem relatório rico por serviço.
        if (isCliente) {
          return {
            filenameBase: `Previsto x Realizado - ${scope.obra?.nome ?? 'obra'}`,
            titulo: 'Previsto × Realizado',
            obraNome: scope.obra?.nome ?? '',
            colunas: [
              { header: 'Código' },
              { header: 'Descrição' },
              { header: 'Unidade' },
              { header: 'Qtd planejada', numFmt: '#,##0.0' },
              { header: 'Qtd planejada período', numFmt: '#,##0.0' },
              { header: 'Qtd realizada', numFmt: '#,##0.0' },
              { header: 'Avanço', numFmt: '0.0"%"' }
            ],
            linhas: visibleRows.map((it) => [
              it.codigo,
              it.descricao,
              it.unidade ?? '',
              it.qtd_plan ?? null,
              it.qtd_plan_periodo ?? null,
              it.qtd_real ?? 0,
              (it.pct_avanco ?? 0) * 100
            ] as Array<string | number | null>)
          }
        }
        const linhas = visibleRows.map((it) => {
          const proj = projByItem.get(it.item_orcamentario_id)
          const fimProj = proj?.fimProjetado
            ? new Date(proj.fimProjetado + 'T00:00:00').toLocaleDateString('pt-BR')
            : '—'
          return [
            it.codigo,
            it.descricao,
            it.unidade ?? '',
            it.qtd_plan ?? null,
            it.qtd_plan_periodo ?? null,
            it.qtd_real ?? 0,
            (it.pct_avanco ?? 0) * 100,
            it.dias_plan ?? null,
            it.dias_real ?? null,
            proj?.desvioDias ?? null,
            fimProj,
            STATUS_COMP_LABEL[it.status]
          ] as Array<string | number | null>
        })
        return {
          filenameBase: `Previsto x Realizado - ${scope.obra?.nome ?? 'obra'}`,
          titulo: 'Previsto × Realizado',
          obraNome: scope.obra?.nome ?? '',
          colunas: [
            { header: 'Código' },
            { header: 'Descrição' },
            { header: 'Unidade' },
            { header: 'Qtd planejada', numFmt: '#,##0.0' },
            { header: 'Qtd planejada período', numFmt: '#,##0.0' },
            { header: 'Qtd realizada', numFmt: '#,##0.0' },
            { header: 'Avanço', numFmt: '0.0"%"' },
            { header: 'Dias plan' },
            { header: 'Dias real' },
            { header: 'Δ dias' },
            { header: 'Fim projetado' },
            { header: 'Status' }
          ],
          linhas,
          // PDF/abas usam TODOS os serviços do baseline (ignora filtro da tabela).
          relatorio: {
            logoDataUrl,
            servicos: itens.map((pr) => ({
              pr,
              cs: curvaByItem.get(pr.item_orcamentario_id) ?? []
            }))
          }
        }
      },
    [isCliente, itens, projByItem, curvaByItem, logoDataUrl, scope.obra?.nome]
  )

  const columns = useMemo<ColumnDef<PrevistoRealizadoItem, unknown>[]>(() => [
    {
      header: 'Código',
      accessorKey: 'codigo',
      cell: ({ row }) => (
        <span className={cn('font-mono text-xs', row.original.item_orcamentario_id === selectedId && 'text-accent font-semibold')}>
          {row.original.codigo}
        </span>
      )
    },
    {
      header: 'Descrição',
      accessorKey: 'descricao',
      cell: ({ row }) => (
        <span className="text-xs truncate block max-w-[280px]" title={row.original.descricao}>
          {row.original.descricao}
        </span>
      )
    },
    {
      header: 'Qtd planejada',
      accessorKey: 'qtd_plan',
      cell: ({ row }) => (
        <span className="font-mono tabular-nums text-xs">
          {row.original.qtd_plan != null
            ? formatNumber(Number(row.original.qtd_plan), 1)
            : '—'}
          {row.original.unidade ? <span className="text-text-dim ml-1">{row.original.unidade}</span> : null}
        </span>
      )
    },
    {
      header: 'Qtd planejada período',
      accessorKey: 'qtd_plan_periodo',
      cell: ({ row }) => (
        <span
          className="font-mono tabular-nums text-xs"
          title="Quantidade prevista acumulada até hoje, segundo o cronograma do baseline"
        >
          {row.original.qtd_plan_periodo != null
            ? formatNumber(Number(row.original.qtd_plan_periodo), 1)
            : '—'}
          {row.original.unidade ? <span className="text-text-dim ml-1">{row.original.unidade}</span> : null}
        </span>
      )
    },
    {
      header: 'Qtd realizada',
      accessorKey: 'qtd_real',
      cell: ({ row }) => (
        <span className="font-mono tabular-nums text-xs">
          {formatNumber(Number(row.original.qtd_real ?? 0), 1)}
        </span>
      )
    },
    {
      header: 'Avanço',
      accessorKey: 'pct_avanco',
      cell: ({ row }) => (
        <ProgressBarPrevReal
          pct={row.original.pct_avanco}
          esperado={row.original.pct_esperado_hoje}
          status={row.original.status}
          neutral={isCliente}
        />
      )
    },
    {
      header: 'Dias plan',
      accessorKey: 'dias_plan',
      cell: ({ row }) => <span className="font-mono tabular-nums text-xs">{row.original.dias_plan ?? '—'}</span>
    },
    {
      header: 'Dias real',
      accessorKey: 'dias_real',
      cell: ({ row }) => <span className="font-mono tabular-nums text-xs">{row.original.dias_real ?? '—'}</span>
    },
    // Δ dias e Status são projeções/julgamento de adiantamento-atraso — ocultos p/ cliente.
    ...(isCliente
      ? []
      : [
          {
            header: 'Δ dias',
            accessorKey: 'desvio_dias_estimado',
            cell: ({ row }) => {
              const proj = projByItem.get(row.original.item_orcamentario_id)
              const d = proj?.desvioDias
              if (d == null) return <span className="text-text-dim text-xs">—</span>
              const fimProj = proj?.fimProjetado
                ? new Date(proj.fimProjetado + 'T00:00:00').toLocaleDateString('pt-BR')
                : null
              return (
                <span
                  className={`font-mono tabular-nums text-xs ${d < 0 ? 'text-red-400' : 'text-emerald-400'}`}
                  title={fimProj ? `Fim projetado (ritmo atual): ${fimProj}` : undefined}
                >
                  {d > 0 ? '+' : ''}{d}
                </span>
              )
            }
          },
          {
            header: 'Status',
            accessorKey: 'status',
            cell: ({ row }) => <StatusComparativoChip status={row.original.status} />
          }
        ] as ColumnDef<PrevistoRealizadoItem, unknown>[])
  ], [selectedId, projByItem, isCliente])

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Previsto × Realizado"
        subtitle={`${scope.obra?.nome ?? ''} · ${itens.length} servico_grupos no baseline${selectedId ? ' · filtrando 1 serviço' : ''}`}
        actions={
          selectedId && (
            <button
              onClick={() => setSelectedId(null)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border text-2xs font-mono text-text-dim hover:text-text"
            >
              <X size={11} /> Limpar filtro
            </button>
          )
        }
      />
      <div className="flex-1 overflow-auto p-5 space-y-4">
        <CurvaSComProjecoes pontos={curvaFiltrada} item={itemSelecionado} altura={360} ocultarProjecoes={isCliente} />

        {!selectedId && (
          <div className="text-2xs font-mono text-text-dim">
            {isCliente
              ? 'Clique em uma linha da tabela para filtrar a curva-S por serviço.'
              : 'Clique em uma linha da tabela para filtrar a curva-S por serviço e ativar projeções de término.'}
          </div>
        )}

        <DataTable
          data={itens}
          columns={columns}
          loading={isLoading}
          emptyMessage="Sem comparativo disponível"
          emptyDescription="Defina baseline no Planejamento e vincule serviços do SIGA."
          onRowClick={(row) => setSelectedId((cur) => cur === row.item_orcamentario_id ? null : row.item_orcamentario_id)}
          getExportConfig={getExportConfig}
        />
      </div>
    </div>
  )
}
