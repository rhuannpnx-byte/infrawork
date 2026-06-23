import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ExternalLink, Trash2 } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { RequireRole } from '@/components/layout/RequireRole'
import { RequireObra } from '@/components/layout/RequireObra'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { DataTable } from '@/components/data-table/DataTable'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import {
  useDocumentos,
  useExcluirDocumentos,
  useReclassificarDocumento,
  getDocumentoSignedUrl
} from '@/features/documentacao/hooks/documentos'
import { statusBadge } from '@/features/documentacao/lib/status'
import { TAXONOMIA_CANONICA, type DocumentoComVigente } from '@/types/documentacao'

export function DocumentacaoRepositorioPage(): ReactNode {
  return (
    <RequireRole allow={['god']} pageTitle="Repositório">
      <RequireObra pageTitle="Repositório">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

async function abrir(doc: DocumentoComVigente): Promise<void> {
  const v = doc.versao_vigente
  if (!v) {
    toast.error('Documento sem versão vigente.')
    return
  }
  const url = await getDocumentoSignedUrl(v.storage_bucket, v.storage_key)
  if (!url) {
    toast.error('Não foi possível gerar o link do arquivo.')
    return
  }
  window.open(url, '_blank')
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role)
  const podeEditar = role === 'god' || role === 'adm' || role === 'engenheiro'
  const { data: documentos = [], isLoading } = useDocumentos(obraId)
  const excluir = useExcluirDocumentos()
  const reclassificar = useReclassificarDocumento()
  const confirm = useConfirm()
  const [excluindo, setExcluindo] = useState(false)

  const handleExcluir = async (rows: DocumentoComVigente[], clear: () => void): Promise<void> => {
    if (rows.length === 0) return
    const ok = await confirm({
      title: `Excluir ${rows.length} documento(s)?`,
      description:
        'Os arquivos no Storage, as versões e os embeddings desses documentos serão removidos (cascade). Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    if (!ok) return
    clear()
    setExcluindo(true)
    try {
      await excluir.mutateAsync({ ids: rows.map((r) => r.id), obra_id: obraId })
      toast.success(`${rows.length} documento(s) excluído(s).`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao excluir documentos')
    } finally {
      setExcluindo(false)
    }
  }

  const columns = useMemo<ColumnDef<DocumentoComVigente, unknown>[]>(
    () => [
      {
        accessorKey: 'titulo',
        header: 'Título',
        cell: (info) => <span className="text-text font-medium">{String(info.getValue())}</span>,
        meta: { label: 'Título' },
        size: 280
      },
      {
        accessorKey: 'tipo_nome',
        header: 'Categoria',
        size: 260,
        cell: ({ row }) => {
          const d = row.original
          const conf = d.classificacao_confianca
          const confBadge =
            d.classificacao_origem === 'ia' && conf != null ? (
              <Badge
                variant={conf >= 0.7 ? 'success' : conf >= 0.4 ? 'warn' : 'danger'}
                title="Confiança da classificação por IA"
              >
                IA {(conf * 100).toFixed(0)}%
              </Badge>
            ) : null
          if (!podeEditar) {
            return (
              <span className="text-text-muted inline-flex items-center gap-1.5">
                <span className="font-mono text-text-dim">{d.tipo_codigo}</span>{' '}
                {d.tipo_nome ?? '—'}
                {confBadge}
              </span>
            )
          }
          return (
            <div
              className="flex items-center gap-1.5"
              onClick={(e) => e.stopPropagation()}
              role="presentation"
            >
              <div className="w-40 shrink-0">
                <Select
                  value={d.tipo_codigo}
                  onChange={(e) =>
                    void reclassificar.mutateAsync({
                      documento_id: d.id,
                      obra_id: obraId,
                      tipo_codigo: e.target.value,
                      tipo_sugerido: d.tipo_codigo,
                      nome: d.titulo
                    })
                  }
                >
                  {TAXONOMIA_CANONICA.map((t) => (
                    <option key={t.codigo} value={t.codigo}>
                      {t.codigo} — {t.nome}
                    </option>
                  ))}
                </Select>
              </div>
              {confBadge}
            </div>
          )
        },
        meta: { label: 'Categoria' }
      },
      {
        accessorKey: 'contrato_numero',
        header: 'Contrato',
        cell: ({ row }) => (
          <span className="font-mono text-2xs text-text-muted">
            {row.original.contrato_numero ?? '—'}
          </span>
        ),
        meta: { label: 'Contrato' },
        size: 140
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const b = statusBadge(row.original.status)
          return <Badge variant={b.variant}>{b.label}</Badge>
        },
        meta: { label: 'Status' },
        size: 110
      },
      {
        id: 'versao',
        header: 'Versão',
        cell: ({ row }) => (
          <span className="font-mono text-2xs text-text-dim">
            v{row.original.versao_vigente?.versao ?? '—'}
          </span>
        ),
        meta: { label: 'Versão' },
        size: 70
      },
      {
        id: 'criado',
        header: 'Ingerido em',
        accessorFn: (r) => r.versao_vigente?.created_at ?? r.created_at,
        cell: ({ row }) => {
          const d = row.original.versao_vigente?.created_at ?? row.original.created_at
          return (
            <span className="font-mono text-2xs text-text-muted">
              {new Date(d).toLocaleDateString('pt-BR')}
            </span>
          )
        },
        meta: { label: 'Ingerido em' },
        size: 110
      },
      {
        id: 'acoes',
        header: '',
        enableSorting: false,
        size: 80,
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
        ),
        meta: { label: '' }
      }
    ],
    [podeEditar, obraId, reclassificar]
  )

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Repositório"
        subtitle="Todos os documentos da obra, acháveis por metadados."
      />
      <DataTable
        data={documentos}
        columns={columns}
        loading={isLoading}
        onRowClick={(row) => void abrir(row)}
        globalSearchPlaceholder="Buscar por título, categoria, contrato…"
        emptyMessage="Nenhum documento ingerido"
        emptyDescription="Use a tela de Ingestão ou abra um contrato para adicionar documentos."
        enableRowSelection={podeEditar}
        selectionActions={
          podeEditar
            ? (rows, clear) => (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleExcluir(rows, clear)}
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
  )
}
