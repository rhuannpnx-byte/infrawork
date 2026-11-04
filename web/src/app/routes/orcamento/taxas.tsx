import { useMemo, useState, type ReactNode } from 'react'
import { Plus, Power } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/data-table/DataTable'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { usePlanOrc } from '@/features/orcamento/hooks/plan-orc'
import { useTaxas, useToggleAtivoTaxa, useTaxaVigente } from '@/features/orcamento/hooks/taxas'
import { NewTaxaRegimeDialog } from '@/features/orcamento/modals/NewTaxaRegimeDialog'
import { fmtBRL, fmtPct2 } from '@/lib/money'
import { formatDate } from '@/lib/format'
import type { TaxaRegime } from '@/types/orcamento'

export function TaxasPage(): ReactNode {
  return (
    <RequireObra pageTitle="Taxas">
      <TaxasInner />
    </RequireObra>
  )
}

function TaxasInner(): ReactNode {
  const scope = useCurrentScope()
  const role = useAuthStore((s) => s.profile?.role)
  const obraId = scope.obraId!
  const { data: taxas = [], isLoading, error } = useTaxas(obraId)
  const { data: taxaVigente } = useTaxaVigente(obraId)
  const { data: plan } = usePlanOrc(obraId)
  const toggleAtivo = useToggleAtivoTaxa()
  const [openNew, setOpenNew] = useState(false)

  const podeEditar = role === 'god' || role === 'adm' || role === 'engenheiro'

  // Totais da obra para mostrar o lucro real no footer
  const totalRaizVenda = (plan?.tree ?? []).reduce((acc, n) => acc + n.venda_total_calc, 0)
  const totalRaizCusto = (plan?.tree ?? []).reduce((acc, n) => acc + n.custo_total_calc, 0)
  const taxa = Number(taxaVigente?.total_perc_calc ?? 0)
  const impostos = totalRaizVenda * taxa
  const lucro = totalRaizVenda - totalRaizCusto - impostos
  const margemLiquida = totalRaizVenda > 0 ? lucro / totalRaizVenda : null

  const columns = useMemo<ColumnDef<TaxaRegime, unknown>[]>(
    () => [
      {
        accessorKey: 'nome',
        header: 'Nome',
        cell: (info) => <span className="text-text font-medium">{String(info.getValue())}</span>,
        meta: { label: 'Nome' }
      },
      {
        accessorKey: 'iss_perc',
        header: 'ISS',
        cell: (info) => (
          <span className="font-mono text-text-muted tabular-nums">
            {fmtPct2(info.getValue() as number)}
          </span>
        ),
        meta: { label: 'ISS' },
        size: 80
      },
      {
        accessorKey: 'pis_perc',
        header: 'PIS',
        cell: (info) => (
          <span className="font-mono text-text-muted tabular-nums">
            {fmtPct2(info.getValue() as number)}
          </span>
        ),
        meta: { label: 'PIS' },
        size: 80
      },
      {
        accessorKey: 'cofins_perc',
        header: 'COFINS',
        cell: (info) => (
          <span className="font-mono text-text-muted tabular-nums">
            {fmtPct2(info.getValue() as number)}
          </span>
        ),
        meta: { label: 'COFINS' },
        size: 80
      },
      {
        accessorKey: 'csll_perc',
        header: 'CSLL',
        cell: (info) => (
          <span className="font-mono text-text-muted tabular-nums">
            {fmtPct2(info.getValue() as number)}
          </span>
        ),
        meta: { label: 'CSLL' },
        size: 80
      },
      {
        accessorKey: 'irpj_perc',
        header: 'IRPJ',
        cell: (info) => (
          <span className="font-mono text-text-muted tabular-nums">
            {fmtPct2(info.getValue() as number)}
          </span>
        ),
        meta: { label: 'IRPJ' },
        size: 80
      },
      {
        accessorKey: 'cprb_perc',
        header: 'CPRB',
        cell: (info) => (
          <span className="font-mono text-text-muted tabular-nums">
            {fmtPct2(info.getValue() as number)}
          </span>
        ),
        meta: { label: 'CPRB' },
        size: 80
      },
      {
        accessorKey: 'outros_perc',
        header: 'Outros',
        cell: (info) => (
          <span className="font-mono text-text-muted tabular-nums">
            {fmtPct2(info.getValue() as number)}
          </span>
        ),
        meta: { label: 'Outros' },
        size: 80
      },
      {
        accessorKey: 'total_perc_calc',
        header: 'Total',
        cell: (info) => (
          <span className="font-mono text-accent font-medium tabular-nums">
            {fmtPct2(info.getValue() as number)}
          </span>
        ),
        meta: { label: 'Total' },
        size: 90
      },
      {
        accessorKey: 'vigencia_inicio',
        header: 'Vigência',
        cell: (info) => {
          const v = info.getValue() as string | null
          return v ? (
            <span className="font-mono text-2xs text-text-dim">{formatDate(v)}</span>
          ) : (
            <span className="text-text-faint">—</span>
          )
        },
        meta: { label: 'Vigência' },
        size: 110
      },
      {
        accessorKey: 'ativo',
        header: 'Status',
        cell: (info) =>
          (info.getValue() as boolean) ? (
            <Badge variant="success">ativa</Badge>
          ) : (
            <Badge>inativa</Badge>
          ),
        meta: { label: 'Status' },
        size: 80
      },
      {
        id: 'acoes',
        header: '',
        size: 60,
        cell: ({ row }) =>
          podeEditar ? (
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() =>
                  toggleAtivo.mutate({
                    id: row.original.id,
                    ativo: !row.original.ativo,
                    obra_id: obraId
                  })
                }
                className="w-6 h-6 inline-flex items-center justify-center rounded text-text-dim hover:text-warn hover:bg-bg-hover"
                title={row.original.ativo ? 'Desativar' : 'Reativar'}
              >
                <Power size={12} />
              </button>
            </div>
          ) : null,
        meta: { label: '' }
      }
    ],
    [toggleAtivo, podeEditar, obraId]
  )

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Taxas"
        subtitle="Impostos sobre receita (ISS, PIS, COFINS, CSLL, IRPJ, CPRB e outros) aplicados como deflator no cálculo de lucro."
        actions={
          podeEditar ? (
            <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
              <Plus size={11} /> Nova taxa
            </Button>
          ) : null
        }
      />
      {error ? (
        <div className="mx-3 my-2 text-2xs font-mono text-danger bg-danger/10 border border-danger/30 rounded px-2 py-1.5">
          {error.message}
        </div>
      ) : null}
      {taxas.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="percent"
            title="Nenhuma taxa"
            description="Cadastre a primeira taxa pra calcular lucro com impostos aplicados."
            action={
              podeEditar ? (
                <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
                  <Plus size={11} /> Nova taxa
                </Button>
              ) : null
            }
          />
        </div>
      ) : (
        <DataTable
          data={taxas}
          columns={columns}
          loading={isLoading}
          globalSearchPlaceholder="Buscar taxa…"
          emptyMessage="Nenhuma taxa encontrada"
        />
      )}

      {/* Footer: aplica a taxa vigente sobre a venda total da obra para mostrar o lucro real */}
      {taxas.length > 0 ? (
        <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-bg-panel text-2xs font-mono">
          <div className="text-text-dim">
            Taxa vigente:{' '}
            <span className="text-accent">
              {taxaVigente ? `${taxaVigente.nome} · ${fmtPct2(taxa)}` : '(nenhuma ativa)'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-text-dim">
              Venda: <span className="text-text">{fmtBRL(totalRaizVenda)}</span>
            </span>
            <span className="text-text-dim">
              Custo: <span className="text-text">{fmtBRL(totalRaizCusto)}</span>
            </span>
            <span className="text-text-dim">
              Impostos: <span className="text-warn">{fmtBRL(impostos)}</span>
            </span>
            <span className="text-text-dim">
              Lucro:{' '}
              <span className={lucro >= 0 ? 'text-success' : 'text-danger'}>{fmtBRL(lucro)}</span>
            </span>
            <span className="text-text-dim">
              Margem líquida:{' '}
              <Badge
                variant={
                  margemLiquida === null
                    ? 'default'
                    : margemLiquida < 0
                      ? 'danger'
                      : margemLiquida < 0.1
                        ? 'warn'
                        : 'success'
                }
              >
                {margemLiquida !== null ? fmtPct2(margemLiquida) : '—'}
              </Badge>
            </span>
          </div>
        </div>
      ) : null}

      <NewTaxaRegimeDialog open={openNew} onOpenChange={setOpenNew} obraId={obraId} />
    </div>
  )
}
