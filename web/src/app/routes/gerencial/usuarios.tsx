import { useMemo, useState, type ReactNode } from 'react'
import { Building2, KeyRound, Plus, Pencil, Trash2 } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ErroConsulta } from '@/components/ui/estado'
import { DataTable } from '@/components/data-table/DataTable'
import { useUsuarios } from '@/features/gerencial/hooks'
import { useAuthStore } from '@/stores/auth-store'
import { NewUsuarioDialog } from '@/features/gerencial/modals/NewUsuarioDialog'
import { EditUsuarioDialog } from '@/features/gerencial/modals/EditUsuarioDialog'
import { DeleteUsuarioDialog } from '@/features/gerencial/modals/DeleteUsuarioDialog'
import { RedefinirSenhaDialog } from '@/features/gerencial/modals/RedefinirSenhaDialog'
import { ObrasDoUsuarioDialog } from '@/features/gerencial/modals/ObrasDoUsuarioDialog'
import { formatDate, formatDateTimeShort, timeAgo } from '@/lib/format'
import { rotuloPapel } from '@/lib/rotulos'
import { VARIANTE_PAPEL } from '@/features/gerencial/lib/papel'
import type { UsuarioComEmpresa } from '@/types/gerencial'

/** "Online agora" = visto nos últimos 2,5 min (heartbeat roda a cada 60s). */
const ONLINE_THRESHOLD_MS = 150_000

function estaOnline(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return false
  const t = new Date(lastSeen).getTime()
  return Number.isFinite(t) && Date.now() - t < ONLINE_THRESHOLD_MS
}

export function UsuariosPage(): ReactNode {
  const role = useAuthStore((s) => s.profile?.role)
  const callerId = useAuthStore((s) => s.profile?.id ?? null)
  const ehGod = role === 'god'
  // Só God vê acesso/presença; refetch periódico mantém "Online" atualizado.
  const {
    data: usuarios = [],
    isLoading,
    error,
    refetch
  } = useUsuarios(ehGod ? { refetchInterval: 45_000 } : undefined)
  const [openNew, setOpenNew] = useState(false)
  const [editTarget, setEditTarget] = useState<UsuarioComEmpresa | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UsuarioComEmpresa | null>(null)
  const [senhaTarget, setSenhaTarget] = useState<UsuarioComEmpresa | null>(null)
  const [obrasTarget, setObrasTarget] = useState<UsuarioComEmpresa | null>(null)

  const podeAcessar = role === 'god' || role === 'adm' || role === 'engenheiro'
  // Edição/exclusão: só God e Adm.
  const podeGerenciar = role === 'god' || role === 'adm'

  /** Adm não mexe em God; ninguém se exclui. */
  const podeEditarLinha = (u: UsuarioComEmpresa): boolean =>
    podeGerenciar && !(role === 'adm' && u.role === 'god')
  const podeExcluirLinha = (u: UsuarioComEmpresa): boolean =>
    podeEditarLinha(u) && u.id !== callerId
  /** Senha: quem edita; o engenheiro, a do seu apoio e a dos apontadores (o servidor confere as obras). */
  const podeRedefinirSenha = (u: UsuarioComEmpresa): boolean =>
    u.id !== callerId &&
    (podeEditarLinha(u) ||
      (role === 'engenheiro' &&
        ((u.role === 'apoio' && u.engenheiro_id === callerId) || u.role === 'apontador')))

  const columns = useMemo<ColumnDef<UsuarioComEmpresa, unknown>[]>(
    () => [
      {
        accessorKey: 'nome',
        header: 'Nome',
        cell: (info) => (
          <span className="text-text font-medium" title={info.row.original.email}>
            {String(info.getValue())}
          </span>
        ),
        meta: { label: 'Nome' }
      },
      {
        // o valor da coluna é o rótulo, para a busca e a exportação não mostrarem o código do banco
        id: 'role',
        header: 'Papel',
        accessorFn: (row) => rotuloPapel(row.role),
        cell: ({ row }) => (
          <Badge variant={VARIANTE_PAPEL[row.original.role]}>
            {rotuloPapel(row.original.role)}
          </Badge>
        ),
        meta: { label: 'Papel' },
        size: 150
      },
      {
        id: 'empresa',
        header: 'Empresa',
        accessorFn: (row) => row.empresa?.nome ?? '—',
        cell: (info) => <span className="text-text-muted">{String(info.getValue())}</span>,
        meta: { label: 'Empresa' }
      },
      {
        id: 'engenheiro',
        header: 'Engenheiro responsável',
        accessorFn: (row) => row.engenheiro?.nome ?? (row.role === 'apoio' ? '—' : ''),
        cell: (info) => {
          const v = String(info.getValue() ?? '')
          return v ? (
            <span className="text-text-muted">{v}</span>
          ) : (
            <span className="text-text-dim">—</span>
          )
        },
        meta: { label: 'Engenheiro responsável' }
      },
      {
        id: 'ativo',
        header: 'Situação',
        accessorFn: (row) => (row.ativo ? 'Ativo' : 'Inativo'),
        cell: ({ row }) =>
          row.original.ativo ? <Badge variant="success">Ativo</Badge> : <Badge>Inativo</Badge>,
        meta: { label: 'Situação' },
        size: 90
      },
      ...(ehGod
        ? ([
            {
              id: 'online',
              header: 'Online',
              accessorFn: (row) => row.last_seen_at ?? '',
              cell: (info) => {
                const lastSeen = info.row.original.last_seen_at
                if (estaOnline(lastSeen)) {
                  return (
                    <span className="inline-flex items-center gap-1.5 text-text">
                      <span className="size-2 rounded-full bg-success animate-pulse" aria-hidden />
                      Online
                    </span>
                  )
                }
                return (
                  <span
                    className="text-text-muted"
                    title={lastSeen ? formatDateTimeShort(lastSeen) : undefined}
                  >
                    {lastSeen ? timeAgo(lastSeen) : '—'}
                  </span>
                )
              },
              meta: { label: 'Online' },
              size: 150
            },
            {
              accessorKey: 'acessos_count',
              header: 'Acessos',
              cell: (info) => (
                <span className="tabular text-text-muted">{Number(info.getValue() ?? 0)}</span>
              ),
              meta: { label: 'Acessos' },
              size: 80
            },
            {
              accessorKey: 'last_access_at',
              header: 'Último acesso',
              cell: (info) => {
                const v = info.getValue() as string | null
                return (
                  <span className="tabular text-text-muted">
                    {v ? formatDateTimeShort(v) : '—'}
                  </span>
                )
              },
              meta: { label: 'Último acesso' },
              size: 140
            }
          ] as ColumnDef<UsuarioComEmpresa, unknown>[])
        : []),
      {
        accessorKey: 'created_at',
        header: 'Criado em',
        cell: (info) => (
          <span className="tabular text-text-muted">{formatDate(info.getValue() as string)}</span>
        ),
        meta: { label: 'Criado em' },
        size: 150
      },
      ...(podeAcessar
        ? ([
            {
              id: 'acoes',
              header: 'Ações',
              size: 150,
              enableSorting: false,
              enableHiding: false,
              cell: ({ row }) => {
                const u = row.original
                return (
                  <div className="flex items-center justify-end gap-1">
                    {u.role === 'apontador' && podeRedefinirSenha(u) ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        title={`Obras liberadas para ${u.nome}`}
                        aria-label={`Obras liberadas para ${u.nome}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setObrasTarget(u)
                        }}
                      >
                        <Building2 size={13} />
                      </Button>
                    ) : null}
                    {podeRedefinirSenha(u) ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        title={`Redefinir senha de ${u.nome}`}
                        aria-label={`Redefinir senha de ${u.nome}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSenhaTarget(u)
                        }}
                      >
                        <KeyRound size={13} />
                      </Button>
                    ) : null}
                    {podeEditarLinha(u) ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        title={`Editar usuário ${u.nome}`}
                        aria-label={`Editar usuário ${u.nome}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditTarget(u)
                        }}
                      >
                        <Pencil size={13} />
                      </Button>
                    ) : null}
                    {podeExcluirLinha(u) ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        title={`Excluir usuário ${u.nome}`}
                        aria-label={`Excluir usuário ${u.nome}`}
                        className="text-danger hover:text-danger hover:bg-danger/10"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteTarget(u)
                        }}
                      >
                        <Trash2 size={13} />
                      </Button>
                    ) : null}
                  </div>
                )
              },
              meta: { label: 'Ações', align: 'right' }
            }
          ] as ColumnDef<UsuarioComEmpresa, unknown>[])
        : [])
    ],
    [ehGod, podeGerenciar, role, callerId]
  )

  if (!podeAcessar) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Usuários" />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="shield"
            title="Sem permissão"
            description="Só administradores e engenheiros gerenciam usuários. Peça ao administrador da sua empresa."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Usuários"
        subtitle={
          role === 'god'
            ? 'Todos os usuários do sistema.'
            : role === 'engenheiro'
              ? 'Usuários da sua empresa. Você cadastra apoios e apontadores.'
              : 'Usuários da sua empresa.'
        }
        actions={
          <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
            <Plus size={12} /> Novo usuário
          </Button>
        }
      />
      {error ? (
        <ErroConsulta
          erro={error}
          oQue="os usuários"
          aoTentar={() => void refetch()}
          className="mx-3 my-2"
        />
      ) : null}
      {error && usuarios.length === 0 ? null : usuarios.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="users"
            title="Nenhum usuário cadastrado"
            description={
              role === 'engenheiro'
                ? 'Cadastre o primeiro apoio ou apontador da sua equipe.'
                : 'Cadastre o primeiro usuário para dar acesso ao sistema.'
            }
            action={
              <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
                <Plus size={12} /> Novo usuário
              </Button>
            }
          />
        </div>
      ) : (
        <DataTable
          exportTitulo="Usuários"
          data={usuarios}
          columns={columns}
          loading={isLoading}
          globalSearchPlaceholder="Buscar por nome…"
          emptyMessage="Nenhum usuário encontrado com essa busca."
        />
      )}

      <NewUsuarioDialog open={openNew} onOpenChange={setOpenNew} />
      <EditUsuarioDialog
        open={!!editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
        usuario={editTarget}
      />
      <ObrasDoUsuarioDialog
        open={!!obrasTarget}
        onOpenChange={(o) => !o && setObrasTarget(null)}
        usuario={obrasTarget}
      />
      <RedefinirSenhaDialog
        open={!!senhaTarget}
        onOpenChange={(o) => !o && setSenhaTarget(null)}
        usuario={senhaTarget}
      />
      <DeleteUsuarioDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        usuario={deleteTarget}
      />
    </div>
  )
}
