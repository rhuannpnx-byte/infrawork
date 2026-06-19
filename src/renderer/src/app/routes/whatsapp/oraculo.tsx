import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Plus, Power, Trash2, AlertTriangle, Sparkles } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { RequireRole } from '@/components/layout/RequireRole'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/data-table/DataTable'
import {
  useOraculoAcessos,
  useAtualizarOraculoAcesso,
  useRemoverOraculoAcesso,
  useOraculoLog
} from '@/features/whatsapp/hooks'
import { HabilitarOraculoDialog } from '@/features/whatsapp/components/HabilitarOraculoDialog'
import { maskWhatsappBR, formatDateTimeShort } from '@/lib/format'
import type { WhatsAppOraculoAcesso } from '@/types/whatsapp'

export function WhatsAppOraculoPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm']} pageTitle="WhatsApp — Oráculo">
      <OraculoInner />
    </RequireRole>
  )
}

function OraculoInner(): ReactNode {
  const { data: acessos = [], isLoading } = useOraculoAcessos()
  const { data: log = [] } = useOraculoLog()
  const atualizar = useAtualizarOraculoAcesso()
  const remover = useRemoverOraculoAcesso()
  const [dialogOpen, setDialogOpen] = useState(false)

  const jaHabilitados = useMemo(() => new Set(acessos.map((a) => a.user_id)), [acessos])

  const onToggle = useCallback(
    async (a: WhatsAppOraculoAcesso): Promise<void> => {
      try {
        await atualizar.mutateAsync({ id: a.id, ativo: !a.ativo })
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Falha ao atualizar')
      }
    },
    [atualizar]
  )

  const onRemover = useCallback(
    async (a: WhatsAppOraculoAcesso): Promise<void> => {
      try {
        await remover.mutateAsync({ id: a.id })
        toast.success(`Acesso removido: ${a.usuario?.nome ?? ''}`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Falha ao remover')
      }
    },
    [remover]
  )

  const columns = useMemo<ColumnDef<WhatsAppOraculoAcesso, unknown>[]>(
    () => [
      {
        id: 'nome',
        header: 'Usuário',
        accessorFn: (a) => a.usuario?.nome ?? '—',
        cell: (info) => (
          <span className="text-text font-medium">{String(info.getValue())}</span>
        ),
        meta: { label: 'Usuário' }
      },
      {
        id: 'role',
        header: 'Papel',
        accessorFn: (a) => a.usuario?.role ?? '',
        cell: (info) => <Badge variant="default">{String(info.getValue() || '—')}</Badge>,
        meta: { label: 'Papel' },
        size: 110
      },
      {
        id: 'whatsapp',
        header: 'WhatsApp',
        accessorFn: (a) => a.usuario?.whatsapp ?? '',
        cell: (info) => {
          const v = info.getValue() as string
          return v ? (
            <span className="font-mono text-text-muted">{maskWhatsappBR(v)}</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-2xs text-warn">
              <AlertTriangle size={11} /> sem WhatsApp
            </span>
          )
        },
        meta: { label: 'WhatsApp' },
        size: 180
      },
      {
        accessorKey: 'ativo',
        header: 'Status',
        cell: (info) =>
          (info.getValue() as boolean) ? (
            <Badge variant="success">ativo</Badge>
          ) : (
            <Badge>pausado</Badge>
          ),
        meta: { label: 'Status' },
        size: 100
      },
      {
        id: 'acoes',
        header: '',
        size: 170,
        cell: ({ row }) => {
          const a = row.original
          return (
            <div className="flex items-center justify-end gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={atualizar.isPending}
                onClick={(e) => {
                  e.stopPropagation()
                  void onToggle(a)
                }}
                title={a.ativo ? 'Pausar' : 'Ativar'}
              >
                <Power size={11} /> {a.ativo ? 'Pausar' : 'Ativar'}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-danger hover:text-danger hover:bg-danger/10"
                disabled={remover.isPending}
                onClick={(e) => {
                  e.stopPropagation()
                  void onRemover(a)
                }}
                title="Remover"
              >
                <Trash2 size={13} />
              </Button>
            </div>
          )
        },
        meta: { label: '' }
      }
    ],
    [atualizar.isPending, remover.isPending, onToggle, onRemover]
  )

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="WhatsApp — Oráculo"
        subtitle="Usuários habilitados a consultar orçamento, planejamento e produção pelo WhatsApp. O acesso respeita as permissões de cada um."
        actions={
          <Button size="sm" variant="default" onClick={() => setDialogOpen(true)}>
            <Plus size={12} /> Habilitar Oráculo
          </Button>
        }
      />

      {acessos.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="sparkles"
            title="Oráculo não habilitado"
            description="Clique em “Habilitar Oráculo” para liberar usuários a conversar com o assistente no WhatsApp."
            action={
              <Button size="sm" variant="default" onClick={() => setDialogOpen(true)}>
                <Plus size={12} /> Habilitar Oráculo
              </Button>
            }
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0">
            <DataTable
              data={acessos}
              columns={columns}
              loading={isLoading}
              globalSearchPlaceholder="Buscar usuário…"
              emptyMessage="Nenhum usuário habilitado"
              enableColumnVisibility={false}
              enableDensity={false}
              enableFilters={false}
              enableExport={false}
            />
          </div>

          {log.length > 0 ? (
            <div className="border-t border-border mt-2 pt-2">
              <div className="flex items-center gap-1.5 px-1 pb-1.5 text-2xs font-mono uppercase text-text-dim">
                <Sparkles size={11} /> Últimas perguntas
              </div>
              <div className="max-h-40 overflow-auto rounded border border-border bg-bg-panel divide-y divide-border/40">
                {log.map((l) => (
                  <div key={l.id} className="px-3 py-1.5 flex items-start gap-2 text-xs">
                    <span className="text-text-dim font-mono text-2xs shrink-0 w-28">
                      {formatDateTimeShort(l.criado_em)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-text">{l.pergunta ?? '—'}</span>
                      <span className="block truncate text-2xs text-text-dim">
                        {l.erro ? `⚠ ${l.erro}` : l.resposta ?? ''}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <HabilitarOraculoDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        jaHabilitados={jaHabilitados}
      />
    </div>
  )
}
