import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FilePlus2 } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { RequireRole } from '@/components/layout/RequireRole'
import { RequireObra } from '@/components/layout/RequireObra'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/data-table/DataTable'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { useContratos } from '@/features/documentacao/hooks/contratos'
import { NovoContratoDialog } from '@/features/documentacao/modals/NovoContratoDialog'
import { fmtBRL } from '@/lib/money'
import type { Contrato } from '@/types/documentacao'

export function DocumentacaoContratosPage(): ReactNode {
  return (
    <RequireRole allow={['god']} pageTitle="Contratos">
      <RequireObra pageTitle="Contratos">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

function fmtData(d: string | null): string {
  return d ? new Date(d).toLocaleDateString('pt-BR') : '—'
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role)
  const navigate = useNavigate()
  const { data: contratos = [], isLoading, error } = useContratos(obraId)
  const [openNovo, setOpenNovo] = useState(false)

  const podeEditar = role === 'god' || role === 'adm' || role === 'engenheiro'

  const columns = useMemo<ColumnDef<Contrato, unknown>[]>(
    () => [
      {
        accessorKey: 'numero',
        header: 'Número',
        cell: (info) => (
          <span className="font-mono text-text font-medium">{String(info.getValue())}</span>
        ),
        meta: { label: 'Número' },
        size: 160
      },
      {
        accessorKey: 'contratante',
        header: 'Contratante',
        cell: (info) => (
          <span className="text-text-muted">{(info.getValue() as string) ?? '—'}</span>
        ),
        meta: { label: 'Contratante' }
      },
      {
        accessorKey: 'natureza',
        header: 'Natureza',
        cell: (info) =>
          info.getValue() === 'publico' ? (
            <Badge variant="accent">Público</Badge>
          ) : (
            <Badge variant="outline">Privado</Badge>
          ),
        meta: { label: 'Natureza' },
        size: 100
      },
      {
        accessorKey: 'valor_atual',
        header: 'Valor',
        cell: (info) => {
          const v = info.getValue() as number | null
          return <span className="font-mono text-text">{v != null ? fmtBRL(v) : '—'}</span>
        },
        meta: { label: 'Valor' },
        size: 150
      },
      {
        accessorKey: 'pct_aditado',
        header: '% aditado',
        cell: (info) => (
          <span className="font-mono text-text-muted">
            {Number((info.getValue() as number) ?? 0).toFixed(1)}%
          </span>
        ),
        meta: { label: '% aditado' },
        size: 90
      },
      {
        id: 'vigencia',
        header: 'Vigência',
        accessorFn: (r) => r.vigencia_fim ?? r.vigencia_inicio ?? '',
        cell: ({ row }) => (
          <span className="font-mono text-2xs text-text-dim">
            {fmtData(row.original.vigencia_inicio)} → {fmtData(row.original.vigencia_fim)}
          </span>
        ),
        meta: { label: 'Vigência' },
        size: 180
      }
    ],
    []
  )

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Contratos"
        subtitle="O contrato é o nó central da documentação — os documentos da obra penduram nele."
        actions={
          podeEditar ? (
            <Button variant="default" size="sm" onClick={() => setOpenNovo(true)}>
              <FilePlus2 size={11} /> Novo contrato
            </Button>
          ) : null
        }
      />
      {error ? (
        <div className="mx-3 my-2 text-2xs font-mono text-danger bg-danger/10 border border-danger/30 rounded px-2 py-1.5">
          {error.message}
        </div>
      ) : null}
      {contratos.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="file-text"
            title="Nenhum contrato cadastrado"
            description="Cadastre o contrato da obra para começar a pendurar documentos (edital, OS, ART, aditivos…)."
            action={
              podeEditar ? (
                <Button variant="default" size="sm" onClick={() => setOpenNovo(true)}>
                  <FilePlus2 size={11} /> Novo contrato
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <DataTable
          data={contratos}
          columns={columns}
          loading={isLoading}
          onRowClick={(row) =>
            navigate({ to: '/documentacao/contratos/$id', params: { id: row.id } })
          }
          globalSearchPlaceholder="Buscar contrato…"
          emptyMessage="Nenhum contrato encontrado"
        />
      )}

      {podeEditar ? (
        <NovoContratoDialog
          open={openNovo}
          onOpenChange={setOpenNovo}
          obraId={obraId}
          onCriado={(id) => navigate({ to: '/documentacao/contratos/$id', params: { id } })}
        />
      ) : null}
    </div>
  )
}
