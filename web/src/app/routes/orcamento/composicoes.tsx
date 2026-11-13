import { useMemo, useState, type ReactNode } from 'react'
import { CadeiaTravaBanner } from '@/features/orcamento/components/CadeiaTravaBanner'
import { useCadeiaTrava } from '@/features/planejamento/hooks/planejamentos'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, Plus, Trash2 } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { useNavigate } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/data-table/DataTable'
import { RequireObra } from '@/components/layout/RequireObra'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { useCpus } from '@/features/orcamento/hooks/cpus'
import { previewCascadeCpus } from '@/features/orcamento/hooks/cascade'
import { supabase } from '@/lib/supabase/client'
import { formatNumber } from '@/lib/format'
import { fmtBRL4 } from '@/lib/money'
import { formatDate } from '@/lib/format'
import { contar } from '@/lib/rotulos'
import type { CpuComServico } from '@/types/orcamento'
import { nomeDaCpu } from '@/features/orcamento/lib/nomeDaCpu'
import { ImportComposicoesDialog } from '@/features/orcamento/modals/ImportComposicoesDialog'

export function ComposicoesPage(): ReactNode {
  return (
    <RequireObra pageTitle="Composições">
      <ComposicoesInner />
    </RequireObra>
  )
}

function ComposicoesInner(): ReactNode {
  const navigate = useNavigate()
  const scope = useCurrentScope()
  const role = useAuthStore((s) => s.profile?.role)
  const obraId = scope.obraId!

  const { data: cpus = [], isLoading, error } = useCpus(obraId, null)
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [openImport, setOpenImport] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const { data: cadeiaTrava } = useCadeiaTrava(obraId)
  const podeEditar = (role === 'god' || role === 'adm' || role === 'engenheiro') && !cadeiaTrava

  const handleBulkDelete = async (rows: CpuComServico[], clear: () => void): Promise<void> => {
    if (rows.length === 0) return
    let preview
    try {
      preview = await previewCascadeCpus(rows.map((r) => r.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao avaliar dependências')
      return
    }
    const ok = await confirm({
      title: `Excluir ${contar(rows.length, 'composição', 'composições')}?`,
      description: (
        <div className="space-y-2">
          <p>
            O serviço do catálogo continua existindo; só a composição de custo (e seus insumos) é
            removida.
          </p>
          {preview.itensOrcamentoComCpuOrigem > 0 ? (
            <p>
              <span className="text-text-dim">
                {contar(preview.itensOrcamentoComCpuOrigem, 'serviço', 'serviços')} do orçamento
              </span>{' '}
              {preview.itensOrcamentoComCpuOrigem === 1
                ? 'usa essas composições e fica'
                : 'usam essas composições e ficam'}{' '}
              sem custo (o orçamento é recalculado na hora).
            </p>
          ) : null}
        </div>
      ),
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    if (!ok) return
    clear()
    setBulkDeleting(true)
    try {
      const { error: errCpu } = await supabase
        .from('cpu')
        .delete()
        .in(
          'id',
          rows.map((r) => r.id)
        )
      if (errCpu) {
        toast.error(`Falha ao excluir: ${errCpu.message}`)
        return
      }
      toast.success(`${contar(rows.length, 'composição excluída', 'composições excluídas')}.`)
    } finally {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpus'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpu'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'plan-orc'] })
      setBulkDeleting(false)
    }
  }

  const columns = useMemo<ColumnDef<CpuComServico, unknown>[]>(
    () => [
      {
        id: 'codigo',
        header: 'Código',
        accessorFn: (row) => row.servico?.codigo ?? '',
        cell: (info) => (
          <span className="font-mono text-2xs text-text-muted">
            {String(info.getValue() || '—')}
          </span>
        ),
        meta: { label: 'Código' },
        size: 90
      },
      {
        id: 'nome',
        header: 'Serviço / composição',
        accessorFn: (row) => nomeDaCpu(row),
        cell: (info) => (
          <span className="text-text font-medium">{String(info.getValue() ?? '—')}</span>
        ),
        meta: { label: 'Nome' }
      },
      {
        id: 'unidade',
        header: 'Un.',
        accessorFn: (row) => row.servico?.unidade ?? row.producao_diaria_unidade ?? '',
        cell: (info) => (
          <span className="text-text-muted font-mono">{String(info.getValue() ?? '—')}</span>
        ),
        meta: { label: 'Unidade' },
        size: 70
      },
      {
        accessorKey: 'producao_diaria_qtde',
        header: 'Produção/dia',
        cell: (info) => (
          <span className="font-mono text-text-muted text-right tabular-nums">
            {formatNumber(Number(info.getValue() ?? 0))}
          </span>
        ),
        meta: { label: 'Produção/dia' },
        size: 110
      },
      {
        accessorKey: 'custo_unit_calc',
        header: 'Custo unitário',
        cell: (info) => (
          <span className="font-mono text-text text-right tabular-nums">
            {fmtBRL4(info.getValue() as number)}
          </span>
        ),
        meta: { label: 'Custo unitário' },
        size: 130
      },
      {
        accessorKey: 'versao',
        header: 'Versão',
        cell: (info) => (
          <span className="inline-flex items-center gap-1.5">
            <span className="font-mono text-text-muted">v{String(info.getValue())}</span>
            <Badge variant="success">vigente</Badge>
          </span>
        ),
        meta: { label: 'Versão' },
        size: 120
      },
      {
        accessorKey: 'created_at',
        header: 'Atualizada em',
        cell: (info) => (
          <span className="font-mono text-2xs text-text-dim">
            {formatDate(info.getValue() as string)}
          </span>
        ),
        meta: { label: 'Atualizada em' },
        size: 110
      }
    ],
    []
  )

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Composições"
        subtitle="Serviços com composição de custo unitário (insumos × produção por dia)."
        actions={
          podeEditar ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setOpenImport(true)}>
                <FileUp size={12} /> Importar
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => navigate({ to: '/orcamento/composicoes/nova' })}
              >
                <Plus size={12} /> Nova composição
              </Button>
            </div>
          ) : null
        }
      />
      <CadeiaTravaBanner obraId={obraId} />
      {error ? (
        <div className="mx-3 my-2 text-2xs font-mono text-danger bg-danger/10 border border-danger/30 rounded px-2 py-1.5">
          {error.message}
        </div>
      ) : null}
      {cpus.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="calculator"
            title="Nenhuma composição"
            description="Crie a primeira composição ou importe várias de uma vez com o modelo padrão."
            action={
              podeEditar ? (
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setOpenImport(true)}>
                    <FileUp size={12} /> Importar modelo
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => navigate({ to: '/orcamento/composicoes/nova' })}
                  >
                    <Plus size={12} /> Nova composição
                  </Button>
                </div>
              ) : null
            }
          />
        </div>
      ) : (
        <DataTable
          exportTitulo="Composições"
          data={cpus}
          columns={columns}
          loading={isLoading}
          globalSearchPlaceholder="Buscar composição…"
          emptyMessage="Nenhuma composição encontrada"
          onRowClick={(row) =>
            navigate({ to: '/orcamento/composicoes/$id', params: { id: row.id } })
          }
          enableRowSelection={podeEditar}
          selectionActions={
            podeEditar
              ? (rows, clear) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleBulkDelete(rows, clear)}
                    className="text-danger hover:bg-danger/10"
                    disabled={bulkDeleting}
                  >
                    <Trash2 size={12} /> {bulkDeleting ? 'Excluindo…' : `Excluir ${rows.length}`}
                  </Button>
                )
              : undefined
          }
        />
      )}

      <ImportComposicoesDialog open={openImport} onOpenChange={setOpenImport} obraId={obraId} />
    </div>
  )
}
