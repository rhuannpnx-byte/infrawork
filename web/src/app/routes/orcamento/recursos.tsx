import { useMemo, useState, type ReactNode } from 'react'
import { CadeiaTravaBanner } from '@/features/orcamento/components/CadeiaTravaBanner'
import { useCadeiaTrava } from '@/features/planejamento/hooks/planejamentos'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, History, Power, Trash2, Pencil, FileUp } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/data-table/DataTable'
import { RequireObra } from '@/components/layout/RequireObra'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { useRecursos, useToggleAtivoRecurso } from '@/features/orcamento/hooks/recursos'
import { previewCascadeRecursos } from '@/features/orcamento/hooks/cascade'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { NewRecursoDialog } from '@/features/orcamento/modals/NewRecursoDialog'
import { EditRecursoDialog } from '@/features/orcamento/modals/EditRecursoDialog'
import { ImportRecursosDialog } from '@/features/orcamento/modals/ImportRecursosDialog'
import { RecursoPrecoHistoricoDialog } from '@/features/orcamento/modals/RecursoPrecoHistoricoDialog'
import { fmtBRL4 } from '@/lib/money'
import { RECURSO_GRUPO_LABEL, type Recurso, type RecursoGrupo } from '@/types/orcamento'

const GRUPO_VARIANT: Record<RecursoGrupo, 'accent' | 'success' | 'warn' | 'default'> = {
  MO: 'warn',
  MVE: 'accent',
  COMBUSTIVEL: 'success',
  MATERIAL: 'default',
  ADM: 'default'
}

export function RecursosPage(): ReactNode {
  return (
    <RequireObra pageTitle="Recursos">
      <RecursosInner />
    </RequireObra>
  )
}

function RecursosInner(): ReactNode {
  const scope = useCurrentScope()
  const role = useAuthStore((s) => s.profile?.role)
  const obraId = scope.obraId!
  const { data: recursos = [], isLoading, error } = useRecursos(obraId)
  const toggleAtivo = useToggleAtivoRecurso()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [openNew, setOpenNew] = useState(false)
  const [openImport, setOpenImport] = useState(false)
  const [editando, setEditando] = useState<Recurso | null>(null)
  const [precosOpen, setPrecosOpen] = useState<{ id: string; nome: string } | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const { data: cadeiaTrava } = useCadeiaTrava(obraId)
  const podeEditar = (role === 'god' || role === 'adm' || role === 'engenheiro') && !cadeiaTrava

  const handleBulkDelete = async (rows: Recurso[], clear: () => void): Promise<void> => {
    if (rows.length === 0) return

    let preview
    try {
      preview = await previewCascadeRecursos(rows.map((r) => r.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao avaliar dependências')
      return
    }

    const ok = await confirm({
      title: `Excluir ${rows.length} recurso(s)?`,
      description: (
        <div className="space-y-2">
          <p>O histórico de preços vai junto (cascade).</p>
          {preview.cpuItensAfetados > 0 ? (
            <p>
              <span className="text-warn">{preview.cpuItensAfetados} linha(s) de CPU</span> dependem
              desses recursos e serão <strong>excluídas em cascata</strong>, afetando{' '}
              <span className="text-warn">{preview.cpusAfetadas} composição(ões)</span>. As
              composições continuam existindo mas perdem esses insumos — custo unitário será
              recalculado.
            </p>
          ) : null}
          {preview.itensOrcamentoComCpuOrigem > 0 ? (
            <p>
              <span className="text-text-dim">
                {preview.itensOrcamentoComCpuOrigem} serviço(s) do orçamento
              </span>{' '}
              usam essas composições — o custo deles é recalculado na hora sem esses recursos.
            </p>
          ) : null}
          {preview.cpuItensAfetados === 0 ? (
            <p className="text-text-dim">Nenhuma CPU usa esses recursos — exclusão direta.</p>
          ) : null}
        </div>
      ),
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    if (!ok) return

    if (!SUPABASE_ENABLED || !supabase) {
      toast.error('Supabase não configurado.')
      return
    }

    // Limpa a seleção e fecha o painel imediatamente — UX responsiva.
    clear()
    setBulkDeleting(true)
    const t0 = performance.now()

    try {
      // Step 1: apagar cpu_items dependentes em uma única query (libera RESTRICT).
      if (preview.cpuItemIdsParaApagar.length > 0) {
        const { error: errCi } = await supabase
          .from('cpu_item')
          .delete()
          .in('id', preview.cpuItemIdsParaApagar)
        if (errCi) {
          toast.error(`Falha ao remover linhas de CPU: ${errCi.message}`)
          return
        }
      }

      // Step 2: apagar todos os recursos em UMA query (1 round-trip).
      // recurso_preco vai por CASCADE.
      const ids = rows.map((r) => r.id)
      const { error: errRec } = await supabase.from('recurso').delete().in('id', ids)
      if (errRec) {
        console.error('[recurso bulk delete]', errRec)
        toast.error(`Falha ao excluir recursos: ${errRec.message}`)
        return
      }

      const ms = Math.round(performance.now() - t0)
      toast.success(`${rows.length} recurso(s) excluído(s) em ${ms}ms.`)
    } finally {
      // Invalida caches uma única vez no final.
      void qc.invalidateQueries({ queryKey: ['orcamento', 'recursos'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpus'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpu'] })
      setBulkDeleting(false)
    }
  }

  const columns = useMemo<ColumnDef<Recurso, unknown>[]>(
    () => [
      {
        accessorKey: 'grupo',
        header: 'Grupo',
        cell: (info) => {
          const g = info.getValue() as RecursoGrupo
          return <Badge variant={GRUPO_VARIANT[g]}>{RECURSO_GRUPO_LABEL[g]}</Badge>
        },
        meta: { label: 'Grupo' },
        size: 130
      },
      {
        accessorKey: 'codigo',
        header: 'Código',
        cell: (info) => (
          <span className="font-mono text-2xs text-text-dim">
            {(info.getValue() as string) ?? '—'}
          </span>
        ),
        meta: { label: 'Código' },
        size: 110
      },
      {
        accessorKey: 'nome',
        header: 'Nome',
        cell: (info) => <span className="text-text font-medium">{String(info.getValue())}</span>,
        meta: { label: 'Nome' }
      },
      {
        accessorKey: 'unidade',
        header: 'Un.',
        cell: (info) => (
          <span className="text-text-muted font-mono">{String(info.getValue())}</span>
        ),
        meta: { label: 'Unidade' },
        size: 70
      },
      {
        accessorKey: 'preco_vigente',
        header: 'Preço vigente',
        cell: (info) => {
          const v = info.getValue() as number | null | undefined
          return (
            <span className="font-mono text-text">
              {v !== null && v !== undefined ? fmtBRL4(v) : '—'}
            </span>
          )
        },
        meta: { label: 'Preço vigente' },
        size: 130
      },
      {
        accessorKey: 'ativo',
        header: 'Status',
        cell: (info) =>
          (info.getValue() as boolean) ? (
            <Badge variant="success">ativo</Badge>
          ) : (
            <Badge>inativo</Badge>
          ),
        meta: { label: 'Status' },
        size: 90
      },
      {
        id: 'acoes',
        header: '',
        size: 110,
        cell: ({ row }) => (
          <div className="flex items-center gap-1 justify-end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setPrecosOpen({ id: row.original.id, nome: row.original.nome })
              }}
              className="w-6 h-6 inline-flex items-center justify-center rounded text-text-dim hover:text-accent hover:bg-bg-hover"
              title="Histórico de preços"
            >
              <History size={12} />
            </button>
            {podeEditar ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditando(row.original)
                }}
                className="w-6 h-6 inline-flex items-center justify-center rounded text-text-dim hover:text-accent hover:bg-bg-hover"
                title="Editar"
              >
                <Pencil size={12} />
              </button>
            ) : null}
            {podeEditar ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleAtivo.mutate({ id: row.original.id, ativo: !row.original.ativo })
                }}
                className="w-6 h-6 inline-flex items-center justify-center rounded text-text-dim hover:text-warn hover:bg-bg-hover"
                title={row.original.ativo ? 'Desativar' : 'Reativar'}
              >
                <Power size={12} />
              </button>
            ) : null}
          </div>
        ),
        meta: { label: '' }
      }
    ],
    [toggleAtivo, podeEditar]
  )

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Recursos"
        subtitle="Catálogo de insumos: mão de obra, equipamentos, combustíveis, materiais."
        actions={
          podeEditar ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setOpenImport(true)}>
                <FileUp size={11} /> Importar
              </Button>
              <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
                <Plus size={11} /> Novo recurso
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
      {recursos.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="package"
            title="Nenhum recurso"
            description="Cadastre os insumos (mão de obra, equipamentos, combustíveis, materiais) ou importe todos de uma vez com o modelo padrão."
            action={
              podeEditar ? (
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setOpenImport(true)}>
                    <FileUp size={11} /> Importar modelo
                  </Button>
                  <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
                    <Plus size={11} /> Novo recurso
                  </Button>
                </div>
              ) : null
            }
          />
        </div>
      ) : (
        <DataTable
          exportTitulo="Recursos"
          data={recursos}
          columns={columns}
          loading={isLoading}
          globalSearchPlaceholder="Buscar recurso…"
          emptyMessage="Nenhum recurso encontrado"
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
                    <Trash2 size={11} /> {bulkDeleting ? 'Excluindo…' : `Excluir ${rows.length}`}
                  </Button>
                )
              : undefined
          }
        />
      )}

      <NewRecursoDialog open={openNew} onOpenChange={setOpenNew} obraId={obraId} />
      <ImportRecursosDialog open={openImport} onOpenChange={setOpenImport} obraId={obraId} />
      <EditRecursoDialog
        open={!!editando}
        onOpenChange={(o) => !o && setEditando(null)}
        recurso={editando}
      />
      <ImportRecursosDialog open={openImport} onOpenChange={setOpenImport} obraId={obraId} />
      <EditRecursoDialog
        open={!!editando}
        onOpenChange={(o) => !o && setEditando(null)}
        recurso={editando}
      />
      {precosOpen ? (
        <RecursoPrecoHistoricoDialog
          open={!!precosOpen}
          onOpenChange={(o) => !o && setPrecosOpen(null)}
          recursoId={precosOpen.id}
          recursoNome={precosOpen.nome}
        />
      ) : null}
    </div>
  )
}
