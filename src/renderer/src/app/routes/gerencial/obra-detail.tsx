import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft, Plus, Trash2, KeyRound, Users, Power, PowerOff, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { useAuthStore } from '@/stores/auth-store'
import { useUIStore } from '@/stores/ui-store'
import {
  useObra,
  useObraPermissoes,
  useRevokePermissao,
  useUsuarios,
  useSetObraAtiva,
  useDeleteObra
} from '@/features/gerencial/hooks'
import { GrantPermissaoDialog } from '@/features/gerencial/modals/GrantPermissaoDialog'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

export function ObraDetailPage(): ReactNode {
  const { id } = useParams({ strict: false }) as { id: string }
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.profile?.role)
  const callerEmpresaId = useAuthStore((s) => s.profile?.empresa_id ?? null)
  const openModal = useUIStore((s) => s.openModal)

  const { data: obra, isLoading: loadingObra } = useObra(id)
  const { data: permissoes = [], isLoading: loadingPerms } = useObraPermissoes(id)
  const { data: usuarios = [] } = useUsuarios()
  const revoke = useRevokePermissao()
  const setAtiva = useSetObraAtiva()
  const deleteObra = useDeleteObra()

  const [openGrant, setOpenGrant] = useState(false)
  const [openDelete, setOpenDelete] = useState(false)
  const [confirmCodigo, setConfirmCodigo] = useState('')

  const podeAcessar = role === 'god' || (role === 'adm' && obra && callerEmpresaId === obra.empresa_id)
  const podeGerirPerms = podeAcessar

  // Apoios que herdam acesso via cada engenheiro da lista
  const apoiosPorEngenheiro = useMemo(() => {
    const map = new Map<string, Array<{ id: string; nome: string }>>()
    for (const u of usuarios) {
      if (u.role === 'apoio' && u.engenheiro_id) {
        const arr = map.get(u.engenheiro_id) ?? []
        arr.push({ id: u.id, nome: u.nome })
        map.set(u.engenheiro_id, arr)
      }
    }
    return map
  }, [usuarios])

  if (loadingObra) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">Carregando obra…</div>
    )
  }
  if (!obra) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <EmptyState icon="folder-x" title="Obra não encontrada" />
        <Button variant="ghost" onClick={() => navigate({ to: '/gerencial/obras' })}>
          <ArrowLeft size={11} /> Voltar
        </Button>
      </div>
    )
  }
  if (!podeAcessar) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title={obra.nome} subtitle="Acesso restrito" />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState icon="shield" title="Sem permissão para gerenciar esta obra" />
        </div>
      </div>
    )
  }

  const existingUserIds = permissoes.map((p) => p.user_id)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={obra.nome}
        subtitle={`${obra.codigo} · ${obra.empresa?.nome ?? '—'}`}
        breadcrumb={['Gerencial', 'Obras', obra.codigo]}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/gerencial/obras' })}>
              <ArrowLeft size={11} /> Voltar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!podeAcessar || setAtiva.isPending}
              onClick={() => {
                void setAtiva
                  .mutateAsync({ obra_id: obra.id, ativa: !obra.ativa })
                  .then((r) =>
                    toast.success(
                      r.ativa
                        ? `Obra ${obra.codigo} reabilitada.`
                        : `Obra ${obra.codigo} desabilitada — não aparece mais para seleção nem no agente do WhatsApp.`
                    )
                  )
                  .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao atualizar'))
              }}
            >
              {obra.ativa ? (
                <>
                  <PowerOff size={11} /> Desabilitar
                </>
              ) : (
                <>
                  <Power size={11} /> Reabilitar
                </>
              )}
            </Button>
            <Button variant="default" size="sm" onClick={() => setOpenGrant(true)} disabled={!podeGerirPerms}>
              <Plus size={11} /> Conceder acesso
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-auto p-5 space-y-4">
        {!obra.ativa ? (
          <div className="rounded border border-warn/40 bg-warn/10 px-4 py-2.5 text-xs flex items-center gap-2">
            <PowerOff size={14} className="text-warn shrink-0" />
            <span className="text-warn">
              Obra <strong>desabilitada</strong> — não aparece para seleção no app nem no contexto do
              agente do WhatsApp. Use <strong>Reabilitar</strong> para voltar a usá-la.
            </span>
          </div>
        ) : null}

        {/* Sumário da obra */}
        <div className="grid grid-cols-4 gap-3">
          <Block label="Código" value={obra.codigo} mono />
          <Block label="Status" value={obra.status.replace('_', ' ')} />
          <Block label="Empresa" value={obra.empresa?.nome ?? '—'} />
          <Block label="Criada em" value={formatDate(obra.created_at)} mono />
        </div>

        {/* Permissões */}
        <section className="rounded border border-border bg-bg-panel">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <div className="flex items-center gap-2">
              <KeyRound size={12} className="text-accent" />
              <h2 className="text-sm font-semibold text-text">Usuários com acesso</h2>
            </div>
            <span className="text-2xs font-mono text-text-dim">
              {permissoes.length} {permissoes.length === 1 ? 'usuário' : 'usuários'}
            </span>
          </div>

          {loadingPerms ? (
            <div className="px-3 py-8 text-center text-text-muted text-xs">Carregando…</div>
          ) : permissoes.length === 0 ? (
            <div className="px-3 py-10">
              <EmptyState
                icon="key-round"
                title="Nenhum usuário com acesso"
                description="Conceda acesso a um Engenheiro ou Cliente da empresa para que possa visualizar esta obra. Apoios vinculados a um engenheiro herdam o acesso automaticamente."
                action={
                  <Button variant="default" size="sm" onClick={() => setOpenGrant(true)}>
                    <Plus size={11} /> Conceder acesso
                  </Button>
                }
              />
            </div>
          ) : (
            <table className="w-full text-xs tabular">
              <thead>
                <tr className="border-b border-border text-text-dim text-2xs uppercase font-mono">
                  <th className="text-left px-3 py-2 font-medium">Engenheiro</th>
                  <th className="text-left px-3 py-2 font-medium">Apoios herdam</th>
                  <th className="text-left px-3 py-2 font-medium">Concedido por</th>
                  <th className="text-left px-3 py-2 font-medium">Em</th>
                  <th className="text-right px-3 py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {permissoes.map((p) => {
                  const apoios = apoiosPorEngenheiro.get(p.user_id) ?? []
                  return (
                    <tr key={p.id} className="border-b border-border last:border-b-0 hover:bg-bg-hover">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={p.usuario?.role === 'cliente' ? 'default' : 'success'}>
                            {p.usuario?.role === 'cliente' ? 'cliente' : 'eng'}
                          </Badge>
                          <div>
                            <div className="text-text font-medium">{p.usuario?.nome ?? '—'}</div>
                            <div className="text-2xs font-mono text-text-dim">{p.usuario?.email ?? ''}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {apoios.length === 0 ? (
                          <span className="text-2xs text-text-dim font-mono">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1 max-w-[260px]">
                            {apoios.slice(0, 3).map((a) => (
                              <Badge key={a.id}>
                                <Users size={9} /> {a.nome}
                              </Badge>
                            ))}
                            {apoios.length > 3 ? (
                              <span className="text-2xs font-mono text-text-dim">+{apoios.length - 3}</span>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-text-muted">{p.concedente?.nome ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-2xs text-text-dim">{formatDate(p.created_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={revoke.isPending}
                          onClick={() => {
                            openModal('confirmDelete', {
                              entityName: `acesso de ${p.usuario?.nome ?? 'engenheiro'} à obra ${obra.codigo}`,
                              linkedCount: apoios.length,
                              linkedDescription:
                                apoios.length > 0
                                  ? `Ao revogar, ${apoios.length} ${apoios.length === 1 ? 'Apoio vinculado' : 'Apoios vinculados'} também perderão o acesso a esta obra.`
                                  : undefined,
                              onConfirm: () => {
                                void revoke
                                  .mutateAsync({ obra_id: obra.id, user_id: p.user_id })
                                  .then(() => toast.success('Acesso revogado.'))
                                  .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao revogar'))
                              }
                            })
                          }}
                        >
                          <Trash2 size={11} /> Revogar
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* Zona de perigo — exclusão definitiva */}
        <section className="rounded border border-danger/40 bg-danger/5">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-danger/30">
            <AlertTriangle size={12} className="text-danger" />
            <h2 className="text-sm font-semibold text-danger">Zona de perigo</h2>
          </div>
          <div className="px-3 py-3 flex items-center justify-between gap-4">
            <div className="text-xs text-text-muted max-w-[640px]">
              <div className="text-text font-medium mb-0.5">Excluir esta obra permanentemente</div>
              Apaga a obra e <strong>todos os dados vinculados</strong> — orçamento, CPUs,
              planejamento/cronograma, trechos, produção e fotos do acompanhamento, documentação e
              permissões. <strong>Esta ação não pode ser desfeita.</strong> Se a intenção for apenas
              tirá-la de uso, prefira <strong>Desabilitar</strong>.
            </div>
            <Button
              variant="danger"
              size="sm"
              className="shrink-0"
              disabled={!podeAcessar}
              onClick={() => {
                setConfirmCodigo('')
                setOpenDelete(true)
              }}
            >
              <Trash2 size={11} /> Excluir obra
            </Button>
          </div>
        </section>
      </div>

      <GrantPermissaoDialog
        open={openGrant}
        onOpenChange={setOpenGrant}
        obraId={obra.id}
        obraEmpresaId={obra.empresa_id}
        obraCodigo={obra.codigo}
        existingUserIds={existingUserIds}
      />

      <Dialog open={openDelete} onOpenChange={(o) => !o && !deleteObra.isPending && setOpenDelete(false)} size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-danger" />
            Excluir obra permanentemente
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-text">
            Isto apaga <strong>{obra.nome}</strong> e <strong>todos os dados vinculados</strong>{' '}
            (orçamento, planejamento, acompanhamento, fotos, documentação). Operação{' '}
            <strong className="text-danger">irreversível</strong>.
          </p>
          <p className="mt-3 text-xs text-text-muted">
            Para confirmar, digite o código da obra{' '}
            <span className="font-mono text-accent">{obra.codigo}</span>:
          </p>
          <Input
            autoFocus
            value={confirmCodigo}
            onChange={(e) => setConfirmCodigo(e.target.value)}
            placeholder={obra.codigo}
            className="mt-1.5 font-mono"
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpenDelete(false)} disabled={deleteObra.isPending}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            disabled={confirmCodigo.trim() !== obra.codigo || deleteObra.isPending}
            onClick={() => {
              void deleteObra
                .mutateAsync({ obra_id: obra.id })
                .then(() => {
                  toast.success(`Obra ${obra.codigo} excluída permanentemente.`)
                  setOpenDelete(false)
                  navigate({ to: '/gerencial/obras' })
                })
                .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao excluir a obra'))
            }}
          >
            <Trash2 size={11} /> {deleteObra.isPending ? 'Excluindo…' : 'Excluir definitivamente'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}

function Block({ label, value, mono }: { label: string; value: string; mono?: boolean }): ReactNode {
  return (
    <div className="rounded border border-border bg-bg-panel p-3">
      <div className="text-2xs font-mono uppercase tracking-wider text-text-dim mb-1">{label}</div>
      <div className={cn('text-md font-semibold text-text', mono && 'font-mono')}>{value}</div>
    </div>
  )
}
