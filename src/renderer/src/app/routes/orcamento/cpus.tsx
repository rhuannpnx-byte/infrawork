import { useMemo, useState, type ReactNode } from 'react'
import { Plus, FileUp } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { useNavigate } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { DataTable } from '@/components/data-table/DataTable'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { useCpus } from '@/features/orcamento/hooks/cpus'
import { useServicos } from '@/features/orcamento/hooks/servicos'
import { NewCpuVersionDialog } from '@/features/orcamento/modals/NewCpuVersionDialog'
import { ImportCpuDialog } from '@/features/orcamento/modals/ImportCpuDialog'
import { fmtBRL4 } from '@/lib/money'
import { formatDate } from '@/lib/format'
import type { CpuComServico } from '@/types/orcamento'

export function CpusPage(): ReactNode {
  return (
    <RequireObra pageTitle="Composições (CPU)">
      <CpusInner />
    </RequireObra>
  )
}

function CpusInner(): ReactNode {
  const navigate = useNavigate()
  const scope = useCurrentScope()
  const role = useAuthStore((s) => s.profile?.role)
  const obraId = scope.obraId!

  const [servicoFiltro, setServicoFiltro] = useState<string>('')
  const { data: servicos = [] } = useServicos(obraId)
  const { data: cpus = [], isLoading, error } = useCpus(obraId, servicoFiltro || null)
  const [openNew, setOpenNew] = useState(false)
  const [openImport, setOpenImport] = useState(false)

  const podeEditar = role === 'god' || role === 'adm' || role === 'engenheiro'

  const columns = useMemo<ColumnDef<CpuComServico, unknown>[]>(
    () => [
      {
        id: 'servico_codigo',
        header: 'Código',
        accessorFn: (row) => row.servico?.codigo ?? '',
        cell: (info) => (
          <span className="font-mono text-2xs text-text-dim">{String(info.getValue() ?? '—')}</span>
        ),
        meta: { label: 'Código' },
        size: 110
      },
      {
        id: 'servico_nome',
        header: 'Serviço',
        accessorFn: (row) => row.servico?.nome ?? '',
        cell: (info) => (
          <span className="text-text font-medium">{String(info.getValue() ?? '—')}</span>
        ),
        meta: { label: 'Serviço' }
      },
      {
        id: 'unidade',
        header: 'Un.',
        accessorFn: (row) => row.servico?.unidade ?? '',
        cell: (info) => (
          <span className="text-text-muted font-mono">{String(info.getValue() ?? '—')}</span>
        ),
        meta: { label: 'Unidade' },
        size: 60
      },
      {
        accessorKey: 'versao',
        header: 'V',
        cell: (info) => (
          <span className="font-mono text-text-muted">v{String(info.getValue())}</span>
        ),
        meta: { label: 'Versão' },
        size: 50
      },
      {
        accessorKey: 'is_vigente',
        header: 'Vigente',
        cell: (info) =>
          info.getValue() ? <Badge variant="success">vigente</Badge> : <Badge>histórico</Badge>,
        meta: { label: 'Vigente' },
        size: 90
      },
      {
        accessorKey: 'producao_diaria_qtde',
        header: 'Produção/dia',
        cell: (info) => (
          <span className="font-mono text-text-muted text-right tabular-nums">
            {Number(info.getValue() ?? 0).toLocaleString('pt-BR')}
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
        accessorKey: 'created_at',
        header: 'Criada em',
        cell: (info) => (
          <span className="font-mono text-2xs text-text-dim">
            {formatDate(info.getValue() as string)}
          </span>
        ),
        meta: { label: 'Criada em' },
        size: 110
      }
    ],
    []
  )

  const servicosFolha = servicos.filter((s) => s.unidade !== null)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Composições (CPU)"
        subtitle={
          servicoFiltro
            ? 'Mostrando todas as versões do serviço filtrado.'
            : 'Mostrando apenas a versão vigente de cada serviço.'
        }
        actions={
          podeEditar ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setOpenImport(true)}>
                <FileUp size={11} /> Importar CPU
              </Button>
              <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
                <Plus size={11} /> Nova CPU
              </Button>
            </div>
          ) : null
        }
      />
      <div className="px-3 py-2 border-b border-border bg-bg-panel flex items-center gap-2">
        <span className="text-2xs text-text-dim font-mono uppercase">Serviço</span>
        <div className="max-w-md w-full">
          <Select value={servicoFiltro} onChange={(e) => setServicoFiltro(e.target.value)}>
            <option value="">— todos (vigentes) —</option>
            {servicosFolha.map((s) => (
              <option key={s.id} value={s.id}>
                {s.codigo} — {s.nome}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {error ? (
        <div className="mx-3 my-2 text-2xs font-mono text-danger bg-danger/10 border border-danger/30 rounded px-2 py-1.5">
          {error.message}
        </div>
      ) : null}
      {cpus.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="calculator"
            title="Nenhuma CPU"
            description={
              servicosFolha.length === 0
                ? 'Cadastre primeiro um serviço folha (com unidade).'
                : 'Crie a primeira composição vinculada a um serviço.'
            }
            action={
              podeEditar && servicosFolha.length > 0 ? (
                <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
                  <Plus size={11} /> Nova CPU
                </Button>
              ) : null
            }
          />
        </div>
      ) : (
        <DataTable
          data={cpus}
          columns={columns}
          loading={isLoading}
          globalSearchPlaceholder="Buscar CPU…"
          emptyMessage="Nenhuma CPU encontrada"
          onRowClick={(row) => navigate({ to: '/orcamento/cpus/$id', params: { id: row.id } })}
        />
      )}

      <NewCpuVersionDialog open={openNew} onOpenChange={setOpenNew} obraId={obraId} />
      <ImportCpuDialog open={openImport} onOpenChange={setOpenImport} obraId={obraId} />
    </div>
  )
}
