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
import { IconButton } from '@/components/ui/IconButton'
import { ErroConsulta } from '@/components/ui/estado'
import { DataTable } from '@/components/data-table/DataTable'
import { RequireObra } from '@/components/layout/RequireObra'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { useRecursos, useToggleAtivoRecurso } from '@/features/orcamento/hooks/recursos'
import { previewCascadeRecursos } from '@/features/orcamento/hooks/cascade'
import { supabase } from '@/lib/supabase/client'
import { NewRecursoDialog } from '@/features/orcamento/modals/NewRecursoDialog'
import { EditRecursoDialog } from '@/features/orcamento/modals/EditRecursoDialog'
import { ImportRecursosDialog } from '@/features/orcamento/modals/ImportRecursosDialog'
import { RecursoPrecoHistoricoDialog } from '@/features/orcamento/modals/RecursoPrecoHistoricoDialog'
import { fmtBRL4 } from '@/lib/money'
import { contar } from '@/lib/rotulos'
import { RECURSO_GRUPO_LABEL, type Recurso, type RecursoGrupo } from '@/types/orcamento'
import { detalheDoErro } from '@/features/orcamento/lib/erro'

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
  const { data: recursos = [], isLoading, error, refetch } = useRecursos(obraId)
  const { mutate: alternarAtivo, isPending: alternandoAtivo } = useToggleAtivoRecurso()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [openNew, setOpenNew] = useState(false)
  const [openImport, setOpenImport] = useState(false)
  const [editando, setEditando] = useState<Recurso | null>(null)
  const [precosOpen, setPrecosOpen] = useState<{ id: string; nome: string } | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const { data: cadeiaTrava, isLoading: travaCarregando } = useCadeiaTrava(obraId)
  const podeEditar =
    (role === 'god' || role === 'adm' || role === 'engenheiro') && !travaCarregando && !cadeiaTrava

  const handleBulkDelete = async (rows: Recurso[], clear: () => void): Promise<void> => {
    if (rows.length === 0) return

    let preview
    try {
      preview = await previewCascadeRecursos(rows.map((r) => r.id))
    } catch (err) {
      toast.error(
        `Não foi possível conferir onde os recursos são usados. ${detalheDoErro(err) ?? ''}`.trim()
      )
      return
    }

    const ok = await confirm({
      title: `Excluir ${contar(rows.length, 'recurso', 'recursos')}?`,
      description: (
        <div className="space-y-2">
          <p>O histórico de preços é excluído junto. Não dá para desfazer.</p>
          {preview.cpuItensAfetados > 0 ? (
            <p>
              <strong className="font-semibold text-text">
                {contar(preview.cpuItensAfetados, 'linha', 'linhas')} de composição
              </strong>{' '}
              {preview.cpuItensAfetados === 1
                ? 'usa esses recursos e também será excluída'
                : 'usam esses recursos e também serão excluídas'}
              , em{' '}
              <strong className="font-semibold text-text">
                {contar(preview.cpusAfetadas, 'composição', 'composições')}
              </strong>
              . As composições continuam existindo, sem esses insumos, e o custo unitário é
              recalculado.
            </p>
          ) : null}
          {preview.itensOrcamentoComCpuOrigem > 0 ? (
            <p>
              {contar(preview.itensOrcamentoComCpuOrigem, 'serviço', 'serviços')} do orçamento{' '}
              {preview.itensOrcamentoComCpuOrigem === 1 ? 'usa' : 'usam'} essas composições: o custo{' '}
              {preview.itensOrcamentoComCpuOrigem === 1 ? 'dele' : 'deles'} é recalculado na hora,
              sem esses recursos.
            </p>
          ) : null}
          {preview.cpuItensAfetados === 0 ? <p>Nenhuma composição usa esses recursos.</p> : null}
        </div>
      ),
      confirmLabel: rows.length === 1 ? 'Excluir recurso' : 'Excluir recursos',
      variant: 'danger'
    })
    if (!ok) return

    // Limpa a seleção e fecha o painel imediatamente — UX responsiva.
    clear()
    setBulkDeleting(true)

    try {
      // Step 1: apagar cpu_items dependentes em uma única query (libera RESTRICT).
      if (preview.cpuItemIdsParaApagar.length > 0) {
        const { error: errCi } = await supabase
          .from('cpu_item')
          .delete()
          .in('id', preview.cpuItemIdsParaApagar)
        if (errCi) {
          toast.error(`Não foi possível remover os recursos das composições. ${errCi.message}`)
          return
        }
      }

      // Step 2: apagar todos os recursos em UMA query (1 round-trip).
      // recurso_preco vai por CASCADE.
      const ids = rows.map((r) => r.id)
      const { error: errRec } = await supabase.from('recurso').delete().in('id', ids)
      if (errRec) {
        console.error('[recurso bulk delete]', errRec)
        toast.error(`Não foi possível excluir os recursos. ${errRec.message}`)
        return
      }

      toast.success(`${contar(rows.length, 'recurso excluído', 'recursos excluídos')}.`)
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
          <span className="text-text-dim whitespace-nowrap">
            {(info.getValue() as string) ?? '—'}
          </span>
        ),
        meta: { label: 'Código' },
        size: 140
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
        cell: (info) => <span className="text-text-muted">{String(info.getValue())}</span>,
        meta: { label: 'Unidade' },
        size: 70
      },
      {
        accessorKey: 'preco_vigente',
        header: 'Preço vigente',
        cell: (info) => {
          const v = info.getValue() as number | null | undefined
          return (
            <span className="text-text">{v !== null && v !== undefined ? fmtBRL4(v) : '—'}</span>
          )
        },
        meta: { label: 'Preço vigente', align: 'right' },
        size: 160
      },
      {
        accessorKey: 'ativo',
        header: 'Situação',
        cell: (info) =>
          (info.getValue() as boolean) ? (
            <Badge variant="success">Ativo</Badge>
          ) : (
            <Badge>Inativo</Badge>
          ),
        meta: { label: 'Situação' },
        size: 90
      },
      {
        id: 'acoes',
        header: '',
        size: 110,
        enableSorting: false,
        cell: ({ row }) => {
          const nome = row.original.nome
          return (
            <div className="flex items-center gap-1 justify-end">
              <IconButton
                size="sm"
                variant="accent"
                onClick={(e) => {
                  e.stopPropagation()
                  setPrecosOpen({ id: row.original.id, nome })
                }}
                aria-label={`Histórico de preços de ${nome}`}
                title="Histórico de preços"
              >
                <History size={12} aria-hidden />
              </IconButton>
              {podeEditar ? (
                <IconButton
                  size="sm"
                  variant="accent"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditando(row.original)
                  }}
                  aria-label={`Editar ${nome}`}
                  title="Editar"
                >
                  <Pencil size={12} aria-hidden />
                </IconButton>
              ) : null}
              {podeEditar ? (
                <IconButton
                  size="sm"
                  variant="ghost"
                  disabled={alternandoAtivo}
                  onClick={(e) => {
                    e.stopPropagation()
                    alternarAtivo({ id: row.original.id, ativo: !row.original.ativo })
                  }}
                  aria-label={`${row.original.ativo ? 'Desativar' : 'Reativar'} ${nome}`}
                  title={row.original.ativo ? 'Desativar' : 'Reativar'}
                >
                  <Power size={12} aria-hidden />
                </IconButton>
              ) : null}
            </div>
          )
        },
        meta: { label: 'Ações' }
      }
    ],
    [alternarAtivo, alternandoAtivo, podeEditar]
  )

  const botoesNovo = podeEditar ? (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => setOpenImport(true)}>
        <FileUp size={12} aria-hidden /> Importar planilha
      </Button>
      <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
        <Plus size={12} aria-hidden /> Novo recurso
      </Button>
    </div>
  ) : null

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Recursos"
        subtitle="Insumos da obra: mão de obra, equipamentos, combustíveis e materiais"
        actions={botoesNovo}
      />
      <CadeiaTravaBanner obraId={obraId} />
      {error ? (
        <div className="px-5 pt-3">
          <ErroConsulta erro={error} oQue="os recursos" aoTentar={() => void refetch()} compacto />
        </div>
      ) : null}
      {error && recursos.length === 0 ? null : recursos.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="package"
            title="Nenhum recurso cadastrado"
            description={
              podeEditar
                ? 'Cadastre os insumos (mão de obra, equipamentos, combustíveis e materiais) um a um ou importe todos de uma vez pela planilha modelo.'
                : 'Esta obra ainda não tem insumos cadastrados.'
            }
            action={botoesNovo}
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
          emptyDescription="Confira a busca ou cadastre um novo recurso."
          enableRowSelection={podeEditar}
          selectionActions={
            podeEditar
              ? (rows, clear) => (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void handleBulkDelete(rows, clear)}
                    disabled={bulkDeleting}
                  >
                    <Trash2 size={12} aria-hidden />{' '}
                    {bulkDeleting
                      ? 'Excluindo…'
                      : `Excluir ${contar(rows.length, 'recurso', 'recursos')}`}
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
