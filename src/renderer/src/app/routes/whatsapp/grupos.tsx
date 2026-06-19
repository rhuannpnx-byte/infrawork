import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Users, MapPin, Plus, Unlink } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { RequireRole } from '@/components/layout/RequireRole'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/DataTable'
import { useAuthStore } from '@/stores/auth-store'
import { useSessao, useGrupos, useAtualizarGrupo } from '@/features/whatsapp/hooks'
import { VincularGrupoDialog } from '@/features/whatsapp/components/VincularGrupoDialog'
import type { WhatsAppGrupo } from '@/types/whatsapp'

export function WhatsAppGruposPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm']} pageTitle="WhatsApp — Grupos">
      <GruposInner />
    </RequireRole>
  )
}

function GruposInner(): ReactNode {
  const { data: sessao } = useSessao()
  const { data: grupos, isLoading } = useGrupos(sessao?.id)
  const atualizar = useAtualizarGrupo()
  const obras = useAuthStore((s) => s.obras)

  const [dialogOpen, setDialogOpen] = useState(false)

  // Mapa obra_id → "Código - Nome" para exibição.
  const obraLabel = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of obras) m.set(o.id, `${o.codigo} - ${o.nome}`)
    return m
  }, [obras])

  // Página mostra apenas vínculos ativos (monitorados + com obra).
  const ativos = useMemo(() => (grupos ?? []).filter((g) => g.monitorar && g.obra_id), [grupos])

  const onDesvincular = useCallback(
    async (id: string, nome: string): Promise<void> => {
      try {
        await atualizar.mutateAsync({ id, monitorar: false, obra_id: null })
        toast.success(`Vínculo removido: ${nome}`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Falha ao desvincular')
      }
    },
    [atualizar]
  )

  const columns = useMemo<ColumnDef<WhatsAppGrupo, unknown>[]>(
    () => [
      {
        id: 'grupo',
        accessorFn: (g) => g.nome ?? g.wa_group_jid,
        header: 'Grupo',
        cell: (info) => (
          <div className="flex items-center gap-2">
            <Users size={12} className="text-text-dim shrink-0" />
            <span className="text-text font-medium truncate">{String(info.getValue())}</span>
          </div>
        ),
        meta: { label: 'Grupo' }
      },
      {
        id: 'obra',
        accessorFn: (g) => (g.obra_id ? (obraLabel.get(g.obra_id) ?? '') : ''),
        header: 'Obra vinculada',
        cell: (info) => (
          <div className="flex items-center gap-1.5 text-text">
            <MapPin size={12} className="text-accent shrink-0" />
            <span className="truncate">{String(info.getValue()) || '—'}</span>
          </div>
        ),
        meta: { label: 'Obra vinculada' },
        size: 300
      },
      {
        accessorKey: 'participantes',
        header: 'Participantes',
        cell: (info) => (
          <span className="font-mono text-text-dim">{(info.getValue() as number) ?? '—'}</span>
        ),
        meta: { label: 'Participantes' },
        size: 120
      },
      {
        id: 'acoes',
        header: '',
        size: 130,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              disabled={atualizar.isPending}
              onClick={(e) => {
                e.stopPropagation()
                void onDesvincular(row.original.id, row.original.nome ?? row.original.wa_group_jid)
              }}
            >
              <Unlink size={11} /> Desvincular
            </Button>
          </div>
        ),
        meta: { label: '' }
      }
    ],
    [obraLabel, onDesvincular, atualizar.isPending]
  )

  if (!sessao || sessao.status === 'desconectado') {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="WhatsApp — Grupos" />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="plug-zap"
            title="Sessão desconectada"
            description="Conecte uma sessão na aba Sessão para descobrir os grupos do número."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="WhatsApp — Grupos"
        subtitle="Grupos monitorados e vinculados a uma obra. As fotos georreferenciadas desses grupos sobem para o mapa."
        actions={
          <Button size="sm" variant="default" onClick={() => setDialogOpen(true)}>
            <Plus size={12} /> Novo vínculo
          </Button>
        }
      />

      {ativos.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="link"
            title="Nenhum vínculo ativo"
            description="Clique em “Novo vínculo” para escolher um grupo e associá-lo a uma obra."
            action={
              <Button size="sm" variant="default" onClick={() => setDialogOpen(true)}>
                <Plus size={12} /> Novo vínculo
              </Button>
            }
          />
        </div>
      ) : (
        <DataTable
          data={ativos}
          columns={columns}
          loading={isLoading}
          globalSearchPlaceholder="Buscar grupo ou obra…"
          emptyMessage="Nenhum vínculo encontrado"
          enableColumnVisibility={false}
          enableDensity={false}
          enableFilters={false}
          enableExport={false}
        />
      )}

      <VincularGrupoDialog open={dialogOpen} onOpenChange={setDialogOpen} grupos={grupos ?? []} />
    </div>
  )
}
