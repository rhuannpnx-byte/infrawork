import { type ReactNode, useMemo, useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { Download, Camera, Image as ImageIcon } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/data-table/DataTable'
import { DateRangePopover } from '@/components/ui/DateRangePopover'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useProducao, exportarProducaoCsv, type ProducaoFiltros } from '@/features/acompanhamento/hooks/producao'
import { useAcompanhamentoLink } from '@/features/acompanhamento/hooks/link'
import { ProducaoDetailPanel } from '@/features/acompanhamento/components/producao/ProducaoDetailPanel'
import type { ProducaoEnriquecida } from '@/types/acompanhamento'
import { cn } from '@/lib/utils'

export function AcompanhamentoProducaoPage(): ReactNode {
  return (
    <RequireObra pageTitle="Produção">
      <ProducaoInner />
    </RequireObra>
  )
}

function ProducaoInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const { data: link } = useAcompanhamentoLink(obraId)
  const [filtros, setFiltros] = useState<ProducaoFiltros>({})
  const { data: rows = [], isLoading } = useProducao(obraId, filtros)
  const [selecionada, setSelecionada] = useState<ProducaoEnriquecida | null>(null)

  const columns = useMemo<ColumnDef<ProducaoEnriquecida, unknown>[]>(() => [
    {
      header: 'Data',
      accessorKey: 'data',
      cell: ({ row }) => (
        <span className="font-mono text-2xs">{formatDate(row.original.data)}</span>
      ),
      sortingFn: (a, b) => (a.original.data ?? '').localeCompare(b.original.data ?? '')
    },
    {
      header: 'Serviço',
      accessorKey: 'siga_servico_nome',
      cell: ({ row }) => {
        const r = row.original
        const nome = r.servico_display_nome ?? r.siga_servico_nome ?? '—'
        return (
          <div className="flex items-center gap-2 min-w-0">
            <span className="size-2 rounded-sm shrink-0 bg-cyan-400/80" />
            <span className="truncate text-xs" title={nome}>{nome}</span>
            {!r.servico_planejamento_id && (
              <Badge variant="default" className="text-2xs shrink-0">não vinc.</Badge>
            )}
          </div>
        )
      }
    },
    {
      header: 'Equipe',
      accessorKey: 'siga_equipe_nome',
      cell: ({ row }) => {
        const r = row.original
        const cor = r.equipe_display_cor ?? '#94a3b8'
        const nome = r.equipe_display_nome ?? r.siga_equipe_nome ?? '—'
        return (
          <div className="flex items-center gap-2 min-w-0">
            <span className="size-2 rounded-sm shrink-0" style={{ background: cor }} />
            <span className="truncate text-xs" title={nome}>{nome}</span>
            {!r.equipe_planejamento_id && (
              <Badge variant="default" className="text-2xs shrink-0">não vinc.</Badge>
            )}
          </div>
        )
      }
    },
    {
      header: 'Encarregado',
      accessorKey: 'siga_encarregado_nome',
      cell: ({ row }) => (
        <span className="text-xs text-text-muted truncate" title={row.original.siga_encarregado_nome ?? ''}>
          {row.original.siga_encarregado_nome ?? '—'}
        </span>
      )
    },
    {
      header: 'Qtd',
      accessorKey: 'qtd',
      cell: ({ row }) => (
        <span className="font-mono tabular-nums text-xs">
          {Number(row.original.qtd ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
          {row.original.servico_unidade ? <span className="text-text-dim ml-1">{row.original.servico_unidade}</span> : null}
        </span>
      ),
      sortingFn: (a, b) => Number(a.original.qtd ?? 0) - Number(b.original.qtd ?? 0)
    },
    {
      header: 'Frente',
      accessorKey: 'frente',
      cell: ({ row }) => (
        <span className="text-xs text-text-muted truncate" title={row.original.frente ?? ''}>
          {row.original.frente ?? '—'}
        </span>
      )
    },
    {
      header: 'Estaca',
      accessorKey: 'estaca_inicial',
      cell: ({ row }) => (
        <span className="font-mono text-2xs text-text-muted truncate" title={row.original.estaca_inicial ?? ''}>
          {row.original.estaca_inicial ?? '—'}
        </span>
      )
    },
    {
      header: 'Obs',
      accessorKey: 'obs',
      cell: ({ row }) => (
        <span className="text-xs text-text-muted truncate block max-w-[220px]" title={row.original.obs ?? ''}>
          {row.original.obs ?? ''}
        </span>
      )
    },
    {
      header: () => <span className="inline-flex items-center gap-1"><Camera size={11} /></span>,
      accessorKey: 'fotos_count',
      cell: ({ row }) => {
        const n = Number(row.original.fotos_count ?? 0)
        if (n === 0) return <span className="text-text-dim text-2xs">—</span>
        return (
          <span className="inline-flex items-center gap-1 text-2xs font-mono text-cyan-300">
            <ImageIcon size={10} /> {n}
          </span>
        )
      }
    }
  ], [])

  const equipesDisponiveis = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) if (r.siga_equipe_nome) s.add(r.siga_equipe_nome)
    return Array.from(s).sort()
  }, [rows])

  const servicosDisponiveis = useMemo(() => {
    const m = new Map<number, string>()
    for (const r of rows) if (r.siga_servico_id != null) m.set(r.siga_servico_id, r.siga_servico_nome ?? String(r.siga_servico_id))
    return Array.from(m.entries()).sort((a, b) => (a[1] ?? '').localeCompare(b[1] ?? ''))
  }, [rows])

  if (!link) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Produção" subtitle={scope.obra?.nome ?? ''} />
        <div className="flex-1 flex items-center justify-center text-text-dim text-xs font-mono">
          Obra não vinculada ao SIGA.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Produção"
        subtitle={`${scope.obra?.nome ?? ''} — ${rows.length} registros`}
        actions={
          <Button size="sm" variant="ghost" onClick={() => exportarProducaoCsv(rows)} disabled={!rows.length}>
            <Download size={11} /> Exportar CSV
          </Button>
        }
      />

      {/* Filtros */}
      <div className="border-b border-border px-5 py-3 flex flex-wrap items-center gap-3 bg-bg-panel">
        <div className="flex items-center gap-1.5">
          <span className="text-2xs font-mono uppercase text-text-dim">Período</span>
          <DateRangePopover
            from={filtros.data_de ?? null}
            to={filtros.data_ate ?? null}
            onChange={(de, ate) => setFiltros((f) => ({ ...f, data_de: de, data_ate: ate }))}
          />
        </div>
        <FiltroMulti
          label="Equipes"
          opcoes={equipesDisponiveis.map((e) => ({ value: e, label: e }))}
          selecionados={filtros.equipe_nomes ?? []}
          onChange={(v) => setFiltros((f) => ({ ...f, equipe_nomes: v as string[] }))}
        />
        <FiltroMulti
          label="Serviços"
          opcoes={servicosDisponiveis.map(([id, nome]) => ({ value: String(id), label: nome }))}
          selecionados={(filtros.servico_ids ?? []).map(String)}
          onChange={(v) => setFiltros((f) => ({ ...f, servico_ids: (v as string[]).map(Number) }))}
        />
        {(filtros.data_de || filtros.data_ate || filtros.equipe_nomes?.length || filtros.servico_ids?.length) ? (
          <button onClick={() => setFiltros({})} className="text-2xs font-mono text-text-dim hover:text-text underline">
            limpar filtros
          </button>
        ) : null}
      </div>

      <div className="flex-1 overflow-hidden">
        <DataTable
          data={rows}
          columns={columns}
          loading={isLoading}
          globalSearchPlaceholder="Buscar em obs, trecho, encarregado…"
          onRowClick={(r) => setSelecionada(r)}
          emptyMessage="Sem produção no período"
          emptyDescription="Ajuste os filtros ou aguarde o próximo sync."
        />
      </div>

      <ProducaoDetailPanel
        producao={selecionada}
        open={!!selecionada}
        onOpenChange={(o) => !o && setSelecionada(null)}
      />
    </div>
  )
}

function FiltroMulti({ label, opcoes, selecionados, onChange }: {
  label: string
  opcoes: Array<{ value: string; label: string }>
  selecionados: string[]
  onChange: (v: string[]) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const display = selecionados.length === 0 ? 'todos' : selecionados.length === 1 ? selecionados[0] : `${selecionados.length} selec.`
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border text-2xs font-mono text-text-dim hover:text-text hover:border-border-strong"
      >
        <span className="uppercase">{label}</span>
        <span className={cn('text-text', selecionados.length > 0 && 'text-accent')}>{display}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 left-0 z-40 bg-bg-elevated border border-border rounded shadow-lg min-w-[220px] max-h-[260px] overflow-auto p-1">
            {opcoes.length === 0 && (
              <div className="text-2xs font-mono text-text-dim p-2">sem opções</div>
            )}
            {opcoes.map((o) => {
              const checked = selecionados.includes(o.value)
              return (
                <label key={o.value} className="flex items-center gap-2 px-2 py-1 hover:bg-bg-hover cursor-pointer rounded text-xs">
                  <input
                    type="checkbox" checked={checked}
                    onChange={() => onChange(checked ? selecionados.filter((s) => s !== o.value) : [...selecionados, o.value])}
                  />
                  <span className="truncate">{o.label}</span>
                </label>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function formatDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('pt-BR')
}
