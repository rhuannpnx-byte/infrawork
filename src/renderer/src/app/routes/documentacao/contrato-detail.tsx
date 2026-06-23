import { useMemo, useState, type ReactNode } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ArrowLeft, UploadCloud, ExternalLink, Trash2 } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { RequireRole } from '@/components/layout/RequireRole'
import { RequireObra } from '@/components/layout/RequireObra'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/data-table/DataTable'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { useContrato, useExcluirContrato } from '@/features/documentacao/hooks/contratos'
import {
  useDocumentos,
  useExcluirDocumentos,
  getDocumentoSignedUrl
} from '@/features/documentacao/hooks/documentos'
import { statusBadge } from '@/features/documentacao/lib/status'
import { CATEGORIAS_ESSENCIAIS, TAXONOMIA_CANONICA } from '@/types/documentacao'
import type { DocumentoComVigente } from '@/types/documentacao'
import { fmtBRL } from '@/lib/money'

export function DocumentacaoContratoDetailPage(): ReactNode {
  return (
    <RequireRole allow={['god']} pageTitle="Contrato">
      <RequireObra pageTitle="Contrato">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

async function abrir(doc: DocumentoComVigente): Promise<void> {
  const v = doc.versao_vigente
  if (!v) return void toast.error('Documento sem versão vigente.')
  const url = await getDocumentoSignedUrl(v.storage_bucket, v.storage_key)
  if (!url) return void toast.error('Não foi possível gerar o link do arquivo.')
  window.open(url, '_blank')
}

function Inner(): ReactNode {
  const { id } = useParams({ strict: false }) as { id: string }
  const navigate = useNavigate()
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role)
  const podeEditar = role === 'god' || role === 'adm' || role === 'engenheiro'

  const { data: contrato, isLoading: loadingContrato } = useContrato(id)
  const { data: documentos = [], isLoading } = useDocumentos(obraId, id)
  const excluirContrato = useExcluirContrato()
  const excluirDocs = useExcluirDocumentos()
  const confirm = useConfirm()
  const [excluindo, setExcluindo] = useState(false)

  const handleExcluirContrato = async (): Promise<void> => {
    const ok = await confirm({
      title: `Excluir o contrato ${contrato?.numero ?? ''}?`,
      description:
        'Todos os documentos, versões, arquivos no Storage e embeddings vinculados a este contrato serão removidos (cascade). Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir contrato',
      variant: 'danger'
    })
    if (!ok) return
    try {
      await excluirContrato.mutateAsync({ id, obra_id: obraId })
      toast.success('Contrato excluído.')
      navigate({ to: '/documentacao/contratos' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao excluir contrato')
    }
  }

  const handleExcluirDocs = async (
    rows: DocumentoComVigente[],
    clear: () => void
  ): Promise<void> => {
    if (rows.length === 0) return
    const ok = await confirm({
      title: `Excluir ${rows.length} documento(s)?`,
      description:
        'Os arquivos no Storage, as versões e os embeddings serão removidos (cascade). Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    if (!ok) return
    clear()
    setExcluindo(true)
    try {
      await excluirDocs.mutateAsync({ ids: rows.map((r) => r.id), obra_id: obraId })
      toast.success(`${rows.length} documento(s) excluído(s).`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao excluir documentos')
    } finally {
      setExcluindo(false)
    }
  }

  // Saúde documental: categorias essenciais ainda sem documento neste contrato.
  const lacunas = useMemo(() => {
    const presentes = new Set(documentos.map((d) => d.tipo_codigo))
    return CATEGORIAS_ESSENCIAIS.filter((cod) => !presentes.has(cod)).map(
      (cod) => TAXONOMIA_CANONICA.find((t) => t.codigo === cod)!
    )
  }, [documentos])

  const columns = useMemo<ColumnDef<DocumentoComVigente, unknown>[]>(
    () => [
      { accessorKey: 'titulo', header: 'Título', size: 280 },
      {
        accessorKey: 'tipo_nome',
        header: 'Categoria',
        cell: ({ row }) => (
          <span className="text-text-muted">
            <span className="font-mono text-text-dim">{row.original.tipo_codigo}</span>{' '}
            {row.original.tipo_nome ?? '—'}
          </span>
        )
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const b = statusBadge(row.original.status)
          return <Badge variant={b.variant}>{b.label}</Badge>
        }
      },
      {
        id: 'versao',
        header: 'Versão',
        cell: ({ row }) => (
          <span className="font-mono text-2xs text-text-dim">
            v{row.original.versao_vigente?.versao ?? '—'}
          </span>
        )
      },
      {
        id: 'acoes',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-2xs text-accent hover:underline"
            onClick={(e) => {
              e.stopPropagation()
              void abrir(row.original)
            }}
          >
            <ExternalLink size={11} /> Abrir
          </button>
        )
      }
    ],
    []
  )

  if (loadingContrato) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Contrato" />
        <p className="p-4 text-xs text-text-muted">Carregando…</p>
      </div>
    )
  }

  if (!contrato) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Contrato" />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="file-x"
            title="Contrato não encontrado"
            description="Ele pode ter sido removido ou você não tem acesso."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate({ to: '/documentacao/contratos' })}
              >
                <ArrowLeft size={11} /> Voltar
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={`Contrato ${contrato.numero}`}
        subtitle={contrato.objeto ?? contrato.contratante ?? scope.obra?.nome ?? ''}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate({ to: '/documentacao/contratos' })}
            >
              <ArrowLeft size={12} /> Contratos
            </Button>
            {podeEditar ? (
              <>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() =>
                    navigate({ to: '/documentacao/ingestao', search: { contrato: id } })
                  }
                >
                  <UploadCloud size={12} /> Ingerir documentos
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger/10"
                  onClick={() => void handleExcluirContrato()}
                  disabled={excluirContrato.isPending}
                >
                  <Trash2 size={12} /> {excluirContrato.isPending ? 'Excluindo…' : 'Excluir'}
                </Button>
              </>
            ) : null}
          </div>
        }
      />
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Metadados */}
        <div className="grid grid-cols-4 gap-3">
          <Meta label="Contratante" value={contrato.contratante ?? '—'} />
          <Meta label="Processo / SEI" value={contrato.processo_sei ?? '—'} mono />
          <Meta label="Lei / instrumento" value={contrato.lei ?? '—'} />
          <Meta
            label="Vigência"
            value={
              contrato.vigencia_inicio || contrato.vigencia_fim
                ? `${fmtData(contrato.vigencia_inicio)} → ${fmtData(contrato.vigencia_fim)}`
                : '—'
            }
            mono
          />
          <Meta
            label="Valor original"
            value={contrato.valor_original != null ? fmtBRL(contrato.valor_original) : '—'}
            mono
          />
          <Meta
            label="Valor atual"
            value={contrato.valor_atual != null ? fmtBRL(contrato.valor_atual) : '—'}
            mono
          />
          <Meta label="% aditado" value={`${Number(contrato.pct_aditado ?? 0).toFixed(1)}%`} mono />
          <Meta label="Fiscal" value={contrato.fiscal_responsavel ?? '—'} />
          <Meta
            label="Execução"
            value={
              contrato.execucao_inicio || contrato.execucao_fim
                ? `${fmtData(contrato.execucao_inicio)} → ${fmtData(contrato.execucao_fim)}`
                : '—'
            }
            mono
          />
          <Meta label="Índice de reajuste" value={contrato.reajuste_indice ?? '—'} />
          <Meta label="Reajuste elegível em" value={fmtData(contrato.reajuste_elegivel_em)} mono />
        </div>

        {/* Lacunas (saúde documental) */}
        {lacunas.length > 0 ? (
          <div className="rounded border border-warn/30 bg-warn/10 p-3">
            <div className="text-2xs font-mono uppercase tracking-wider text-warn mb-1.5">
              Lacunas — categorias essenciais sem documento ({lacunas.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {lacunas.map((t) => (
                <Badge key={t.codigo} variant="warn">
                  {t.codigo} {t.nome}
                </Badge>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded border border-success/30 bg-success/10 px-3 py-2 text-2xs font-mono text-success">
            Cobertura essencial completa.
          </div>
        )}

        {/* Documentos do contrato */}
        <div className="rounded border border-border">
          <div className="px-3 py-2 border-b border-border text-2xs font-mono uppercase tracking-wider text-text-dim">
            Documentos ({documentos.length})
          </div>
          <div className="p-2">
            <DataTable
              data={documentos}
              columns={columns}
              loading={isLoading}
              onRowClick={(row) => void abrir(row)}
              globalSearchPlaceholder="Filtrar documentos…"
              emptyMessage="Nenhum documento neste contrato"
              emptyDescription="Use “Ingerir documentos” para adicionar (pasta local, OneDrive ou arrastar-e-soltar)."
              initialPageSize={25}
              enableExport={false}
              enableRowSelection={podeEditar}
              selectionActions={
                podeEditar
                  ? (rows, clear) => (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleExcluirDocs(rows, clear)}
                        className="text-danger hover:bg-danger/10"
                        disabled={excluindo}
                      >
                        <Trash2 size={11} /> {excluindo ? 'Excluindo…' : `Excluir ${rows.length}`}
                      </Button>
                    )
                  : undefined
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function fmtData(d: string | null): string {
  return d ? new Date(d).toLocaleDateString('pt-BR') : '—'
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }): ReactNode {
  return (
    <div className="rounded border border-border bg-bg-panel p-3">
      <div className="text-2xs font-mono uppercase tracking-wider text-text-dim mb-1">{label}</div>
      <div className={`text-xs text-text ${mono ? 'font-mono' : ''} break-words`}>{value}</div>
    </div>
  )
}
