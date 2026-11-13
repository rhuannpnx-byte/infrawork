import { type ReactNode, useMemo, useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { useNavigate } from '@tanstack/react-router'
import { Camera, Image as ImageIcon, PlusCircle, FileUp } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { BarraFiltros, Filtro, FiltroMulti } from '@/components/ui/filtros'
import { Select } from '@/components/ui/select'
import { RequireObra } from '@/components/layout/RequireObra'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErroConsulta } from '@/components/ui/estado'
import { contar } from '@/lib/rotulos'
import { DataTable } from '@/components/data-table/DataTable'
import type { TableExportConfig } from '@/components/data-table/export-types'
import { DateRangePopover } from '@/components/ui/DateRangePopover'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { useProducao, type ProducaoFiltros } from '@/features/acompanhamento/hooks/producao'
import { ProducaoDetailPanel } from '@/features/acompanhamento/components/producao/ProducaoDetailPanel'
import type { ProducaoEnriquecida, ProducaoOrigem } from '@/types/acompanhamento'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/format'
import { rotuloLocalProducao } from '@/features/acompanhamento/lib/local-producao'

export function AcompanhamentoProducaoPage(): ReactNode {
  return (
    <RequireObra pageTitle="Produção">
      <ProducaoInner />
    </RequireObra>
  )
}

const ORIGEM_LABEL: Record<ProducaoOrigem, string> = {
  app: 'Site',
  campo: 'App de campo',
  viagens: 'Viagens',
  importacao: 'Importação'
}

function ProducaoInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const podeLancar = role === 'god' || role === 'adm' || role === 'engenheiro' || role === 'apoio'
  const [filtros, setFiltros] = useState<ProducaoFiltros>({})
  const consulta = useProducao(obraId, filtros)
  const { data: rows = [], isLoading } = consulta
  const [selecionada, setSelecionada] = useState<ProducaoEnriquecida | null>(null)

  const columns = useMemo<ColumnDef<ProducaoEnriquecida, unknown>[]>(
    () => [
      {
        header: 'Data',
        accessorKey: 'data',
        meta: { label: 'Data' },
        cell: ({ row }) => (
          <span className="tabular text-xs whitespace-nowrap">{formatDate(row.original.data)}</span>
        ),
        sortingFn: (a, b) => (a.original.data ?? '').localeCompare(b.original.data ?? '')
      },
      {
        header: 'Serviço',
        accessorKey: 'servico_display_nome',
        meta: { label: 'Serviço' },
        cell: ({ row }) => {
          const r = row.original
          const nome = r.servico_display_nome ?? r.servico_nome ?? '—'
          return (
            <div className="flex items-center gap-2 min-w-0">
              {r.servico_grupo_codigo ? (
                <span className="tabular text-xs text-text-muted shrink-0">
                  {r.servico_grupo_codigo}
                </span>
              ) : null}
              <span className="truncate text-xs" title={nome}>
                {nome}
              </span>
              {!r.item_orcamentario_id && (
                <Badge
                  variant="warn"
                  className="text-2xs shrink-0"
                  title="O item do orçamento deste lançamento foi removido"
                >
                  Sem item
                </Badge>
              )}
            </div>
          )
        }
      },
      {
        header: 'Equipe',
        accessorKey: 'equipe_display_nome',
        meta: { label: 'Equipe' },
        cell: ({ row }) => {
          const r = row.original
          const cor = r.equipe_display_cor ?? 'var(--text-dim)'
          const nome = (r.equipe_id && r.equipe_display_nome) || 'Sem equipe'
          return (
            <div className="flex items-center gap-2 min-w-0">
              <span
                aria-hidden
                className="size-2 rounded-sm shrink-0"
                style={{ background: cor }}
              />
              <span
                className={cn('truncate text-xs', !r.equipe_id && 'text-text-muted')}
                title={nome}
              >
                {nome}
              </span>
            </div>
          )
        }
      },
      {
        header: 'Encarregado',
        accessorKey: 'encarregado_display_nome',
        meta: { label: 'Encarregado' },
        cell: ({ row }) => (
          <span
            className="text-xs text-text-muted truncate"
            title={row.original.encarregado_display_nome ?? ''}
          >
            {row.original.encarregado_display_nome ?? '—'}
          </span>
        )
      },
      {
        header: 'Qtd',
        accessorKey: 'qtd_convertida',
        meta: { label: 'Quantidade', align: 'right' },
        cell: ({ row }) => {
          const r = row.original
          const converteu = Number(r.fator_conversao ?? 1) !== 1
          const valor = converteu ? Number(r.qtd_convertida ?? 0) : Number(r.qtd ?? 0)
          const unidade = converteu ? r.unidade_plano : (r.unidade ?? r.unidade_plano)
          return (
            <span className="tabular text-xs whitespace-nowrap">
              {formatNumber(valor, 2)}
              {unidade ? <span className="text-text-muted ml-1">{unidade}</span> : null}
              {converteu ? (
                <span
                  className="text-xs text-text-muted ml-1 tabular"
                  title={`Lançado: ${formatNumber(Number(r.qtd ?? 0))} ${r.unidade ?? ''} × ${r.fator_conversao}`}
                >
                  ×{r.fator_conversao}
                </span>
              ) : null}
            </span>
          )
        },
        sortingFn: (a, b) =>
          Number(a.original.qtd_convertida ?? a.original.qtd ?? 0) -
          Number(b.original.qtd_convertida ?? b.original.qtd ?? 0)
      },
      {
        header: 'Frente',
        accessorKey: 'frente',
        meta: { label: 'Frente' },
        cell: ({ row }) => (
          <span className="text-xs text-text-muted truncate" title={row.original.frente ?? ''}>
            {row.original.frente ?? '—'}
          </span>
        )
      },
      {
        header: 'Local e estacas',
        accessorKey: 'estaca_inicial',
        meta: { label: 'Local e estacas' },
        cell: ({ row }) => {
          const txt = rotuloLocalProducao(row.original) || '—'
          return (
            <span className="tabular text-xs text-text-muted whitespace-nowrap" title={txt}>
              {txt}
            </span>
          )
        }
      },
      {
        header: 'Observação',
        accessorKey: 'obs',
        meta: { label: 'Observação' },
        cell: ({ row }) => (
          <span
            className="text-xs text-text-muted truncate block max-w-[220px]"
            title={row.original.obs ?? ''}
          >
            {row.original.obs ?? ''}
          </span>
        )
      },
      {
        header: 'Material',
        accessorKey: 'material_resumo',
        meta: { label: 'Material' },
        cell: ({ row }) => (
          <span
            className="tabular text-xs text-text-muted truncate block max-w-[200px]"
            title={row.original.material_resumo ?? ''}
          >
            {row.original.material_resumo ?? ''}
          </span>
        )
      },
      {
        header: 'Origem',
        accessorKey: 'origem',
        meta: { label: 'Origem' },
        cell: ({ row }) => (
          <span
            className="text-xs text-text-muted whitespace-nowrap"
            title={row.original.criado_por_nome ? `por ${row.original.criado_por_nome}` : undefined}
          >
            {ORIGEM_LABEL[row.original.origem] ?? row.original.origem}
          </span>
        )
      },
      {
        header: () => (
          <span role="img" aria-label="Fotos" title="Fotos" className="inline-flex items-center">
            <Camera size={12} aria-hidden />
          </span>
        ),
        accessorKey: 'fotos_count',
        meta: { label: 'Fotos', align: 'right' },
        cell: ({ row }) => {
          const n = Number(row.original.fotos_count ?? 0)
          if (n === 0) return <span className="text-text-muted text-xs">—</span>
          return (
            <span
              className="inline-flex items-center gap-1 text-xs tabular text-accent"
              title={contar(n, 'foto', 'fotos')}
            >
              <ImageIcon size={12} aria-hidden /> {n}
            </span>
          )
        }
      }
    ],
    []
  )

  const equipesDisponiveis = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) if (r.equipe_id) m.set(r.equipe_id, r.equipe_display_nome)
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  const encarregadosDisponiveis = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows)
      if (r.encarregado_id) m.set(r.encarregado_id, r.encarregado_display_nome ?? '—')
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  const servicosDisponiveis = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) {
      if (r.item_orcamentario_id) {
        m.set(
          r.item_orcamentario_id,
          `${r.servico_grupo_codigo ? r.servico_grupo_codigo + ' · ' : ''}${r.servico_display_nome ?? r.servico_nome}`
        )
      }
    }
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  // Exportação simplificada da tabela de produção (Excel + CSV).
  // Usa as linhas visíveis (filtros + busca/ordenação atuais).
  const getExportConfig = useMemo(
    () =>
      (visibleRows: ProducaoEnriquecida[]): TableExportConfig => ({
        filenameBase: `Produção - ${scope.obra?.nome ?? 'obra'}`,
        titulo: 'Produção',
        obraNome: scope.obra?.nome ?? '',
        colunas: [
          { header: 'Data' },
          { header: 'Código' },
          { header: 'Serviço' },
          { header: 'Equipe' },
          { header: 'Encarregado' },
          { header: 'Qtd', numFmt: '#,##0.00' },
          { header: 'Unid.' },
          { header: 'Fator', numFmt: '#,##0.######' },
          { header: 'Qtd (plano)', numFmt: '#,##0.00' },
          { header: 'Unid. plano' },
          { header: 'Frente' },
          { header: 'Local' },
          { header: 'Estaca inicial' },
          { header: 'Estaca final' },
          { header: 'Observação' },
          { header: 'Material' },
          { header: 'Origem' },
          { header: 'Lançado por' },
          { header: 'Tarefa da linha de base' },
          { header: 'Fotos', numFmt: '0' }
        ],
        linhas: visibleRows.map((r) => [
          formatDate(r.data),
          r.servico_grupo_codigo ?? r.servico_codigo ?? '',
          r.servico_display_nome ?? r.servico_nome ?? '',
          r.equipe_display_nome ?? '',
          r.encarregado_display_nome ?? '',
          r.qtd ?? null,
          r.unidade ?? '',
          Number(r.fator_conversao ?? 1),
          r.qtd_convertida ?? r.qtd ?? null,
          r.unidade_plano ?? r.servico_unidade ?? '',
          r.frente ?? '',
          r.trecho_nome ? (r.trecho_tipo === 'area' ? `Área ${r.trecho_nome}` : r.trecho_nome) : '',
          r.estaca_inicial ?? '',
          r.estaca_final ?? '',
          (r.obs ?? '').replace(/\n/g, ' '),
          r.material_resumo ?? '',
          ORIGEM_LABEL[r.origem] ?? r.origem,
          r.criado_por_nome ?? '',
          r.tarefa_baseline_id ? 'Sim' : 'Não',
          Number(r.fotos_count ?? 0)
        ]) as Array<Array<string | number | null>>
      }),
    [scope.obra?.nome]
  )

  const temFiltro =
    !!filtros.data_de ||
    !!filtros.data_ate ||
    !!filtros.equipe_ids?.length ||
    !!filtros.encarregado_ids?.length ||
    !!filtros.item_ids?.length ||
    !!filtros.origem

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Produção"
        subtitle={
          isLoading
            ? 'Carregando os lançamentos…'
            : consulta.error
              ? undefined
              : contar(rows.length, 'lançamento', 'lançamentos')
        }
        actions={
          podeLancar ? (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void navigate({
                    to: '/acompanhamento/lancar',
                    search: { aba: 'importar' } as never
                  })
                }
              >
                <FileUp size={12} /> Importar
              </Button>
              <Button size="sm" onClick={() => void navigate({ to: '/acompanhamento/lancar' })}>
                <PlusCircle size={12} /> Lançar produção
              </Button>
            </div>
          ) : null
        }
      />

      <BarraFiltros aoLimpar={temFiltro ? () => setFiltros({}) : null}>
        <Filtro rotulo="Período">
          <DateRangePopover
            from={filtros.data_de ?? null}
            to={filtros.data_ate ?? null}
            onChange={(de, ate) => setFiltros((f) => ({ ...f, data_de: de, data_ate: ate }))}
            placeholder="Todo o período"
          />
        </Filtro>
        <FiltroMulti
          rotulo="Serviços"
          opcoes={servicosDisponiveis.map(([id, nome]) => ({ valor: id, rotulo: nome }))}
          selecionados={filtros.item_ids ?? []}
          aoMudar={(v) => setFiltros((f) => ({ ...f, item_ids: v }))}
        />
        <FiltroMulti
          rotulo="Equipes"
          todos="Todas"
          opcoes={equipesDisponiveis.map(([id, nome]) => ({ valor: id, rotulo: nome }))}
          selecionados={filtros.equipe_ids ?? []}
          aoMudar={(v) => setFiltros((f) => ({ ...f, equipe_ids: v }))}
        />
        <FiltroMulti
          rotulo="Encarregados"
          opcoes={encarregadosDisponiveis.map(([id, nome]) => ({ valor: id, rotulo: nome }))}
          selecionados={filtros.encarregado_ids ?? []}
          aoMudar={(v) => setFiltros((f) => ({ ...f, encarregado_ids: v }))}
        />
        <Filtro rotulo="Origem">
          <Select
            value={filtros.origem ?? ''}
            onChange={(e) =>
              setFiltros((f) => ({
                ...f,
                origem: (e.target.value || null) as ProducaoOrigem | null
              }))
            }
            className="h-7 w-[150px]"
          >
            <option value="">Todas</option>
            <option value="app">Site</option>
            <option value="campo">App de campo</option>
            <option value="viagens">Viagens</option>
            <option value="importacao">Importação</option>
          </Select>
        </Filtro>
      </BarraFiltros>

      <div className="flex-1 overflow-hidden">
        {consulta.error ? (
          <ErroConsulta
            erro={consulta.error}
            oQue="a produção"
            aoTentar={() => void consulta.refetch()}
            className="m-5"
          />
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            loading={isLoading}
            globalSearchPlaceholder="Buscar em obs, frente, encarregado…"
            onRowClick={(r) => setSelecionada(r)}
            emptyMessage="Sem produção no período"
            emptyDescription={
              podeLancar
                ? 'Ajuste os filtros ou registre o primeiro lançamento.'
                : 'Ajuste os filtros.'
            }
            getExportConfig={getExportConfig}
          />
        )}
      </div>

      <ProducaoDetailPanel
        producao={selecionada}
        open={!!selecionada}
        onOpenChange={(o) => !o && setSelecionada(null)}
      />
    </div>
  )
}

function formatDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('pt-BR')
}
