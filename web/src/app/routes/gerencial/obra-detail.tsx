import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import {
  ArrowLeft,
  Plus,
  Trash2,
  KeyRound,
  Users,
  Power,
  PowerOff,
  AlertTriangle,
  Pencil
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Carregando, ErroConsulta } from '@/components/ui/estado'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { useAuthStore } from '@/stores/auth-store'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import {
  useObra,
  useObraPermissoes,
  useRevokePermissao,
  useUsuarios,
  useSetObraAtiva,
  useDeleteObra
} from '@/features/gerencial/hooks'
import { GrantPermissaoDialog } from '@/features/gerencial/modals/GrantPermissaoDialog'
import { EditObraDialog } from '@/features/gerencial/modals/EditObraDialog'
import { rotuloStatusObra } from '@/features/gerencial/lib/status-obra'
import { formatDate } from '@/lib/format'
import { contar, rotuloPapel } from '@/lib/rotulos'
import { cn } from '@/lib/utils'

export function ObraDetailPage(): ReactNode {
  const { id } = useParams({ strict: false }) as { id: string }
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.profile?.role)
  const callerEmpresaId = useAuthStore((s) => s.profile?.empresa_id ?? null)
  const confirmar = useConfirm()

  const {
    data: obra,
    isLoading: loadingObra,
    error: erroObra,
    refetch: recarregarObra
  } = useObra(id)
  const {
    data: permissoes = [],
    isLoading: loadingPerms,
    error: erroPerms,
    refetch: recarregarPerms
  } = useObraPermissoes(id)
  const { data: usuarios = [] } = useUsuarios()
  const revoke = useRevokePermissao()
  const setAtiva = useSetObraAtiva()
  const deleteObra = useDeleteObra()

  const [openGrant, setOpenGrant] = useState(false)
  const [openEdit, setOpenEdit] = useState(false)
  const [openDelete, setOpenDelete] = useState(false)
  const [confirmCodigo, setConfirmCodigo] = useState('')
  const [tentouExcluir, setTentouExcluir] = useState(false)
  const [erroExcluir, setErroExcluir] = useState<string | null>(null)

  const podeAcessar =
    role === 'god' || (role === 'adm' && obra && callerEmpresaId === obra.empresa_id)
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
      <div className="flex h-full items-center justify-center">
        <Carregando texto="Carregando a obra…" />
      </div>
    )
  }
  if (erroObra) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Obra" />
        <ErroConsulta
          erro={erroObra}
          oQue="a obra"
          aoTentar={() => void recarregarObra()}
          className="m-5"
        />
      </div>
    )
  }
  if (!obra) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <EmptyState
          icon="folder-x"
          title="Obra não encontrada"
          description="Ela pode ter sido excluída ou você não tem acesso a ela."
        />
        <Button variant="secondary" onClick={() => navigate({ to: '/gerencial/obras' })}>
          <ArrowLeft size={12} /> Voltar para Obras
        </Button>
      </div>
    )
  }
  if (!podeAcessar) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title={obra.nome} subtitle="Acesso restrito" />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="shield"
            title="Sem permissão"
            description="Só o administrador da empresa gerencia os dados e os acessos desta obra."
          />
        </div>
      </div>
    )
  }

  const existingUserIds = permissoes.map((p) => p.user_id)
  const erroCodigo =
    confirmCodigo.trim() !== obra.codigo
      ? `Digite ${obra.codigo}, exatamente como aparece, para confirmar.`
      : undefined

  const excluir = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    setErroExcluir(null)
    if (erroCodigo) {
      setTentouExcluir(true)
      e.currentTarget.querySelector<HTMLElement>('input')?.focus()
      return
    }
    void deleteObra
      .mutateAsync({ obra_id: obra.id })
      .then(() => {
        toast.success(`Obra ${obra.codigo} excluída permanentemente.`)
        setOpenDelete(false)
        navigate({ to: '/gerencial/obras' })
      })
      .catch((err) =>
        setErroExcluir(
          `Não foi possível excluir a obra. ${err instanceof Error ? err.message : 'Tente de novo.'}`
        )
      )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={obra.nome}
        subtitle={`${obra.codigo} · ${obra.empresa?.nome ?? '—'}`}
        breadcrumb={['Gerencial', 'Obras', obra.codigo]}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/gerencial/obras' })}>
              <ArrowLeft size={12} /> Voltar
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={setAtiva.isPending}
              title={
                obra.ativa
                  ? 'Tira a obra da seleção no web e no app, sem apagar nada'
                  : 'Volta a mostrar a obra para seleção'
              }
              onClick={() => {
                void setAtiva
                  .mutateAsync({ obra_id: obra.id, ativa: !obra.ativa })
                  .then((r) =>
                    toast.success(
                      r.ativa
                        ? `Obra ${obra.codigo} reabilitada.`
                        : `Obra ${obra.codigo} desabilitada. Ela não aparece mais para seleção.`
                    )
                  )
                  .catch((e) =>
                    toast.error(
                      obra.ativa
                        ? 'Não foi possível desabilitar a obra.'
                        : 'Não foi possível reabilitar a obra.',
                      { description: e instanceof Error ? e.message : undefined }
                    )
                  )
              }}
            >
              {obra.ativa ? (
                <>
                  <PowerOff size={12} /> {setAtiva.isPending ? 'Desabilitando…' : 'Desabilitar'}
                </>
              ) : (
                <>
                  <Power size={12} /> {setAtiva.isPending ? 'Reabilitando…' : 'Reabilitar'}
                </>
              )}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setOpenEdit(true)}>
              <Pencil size={12} /> Editar dados
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => setOpenGrant(true)}
              disabled={!podeGerirPerms}
            >
              <Plus size={12} /> Conceder acesso
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-auto p-5 space-y-4">
        {!obra.ativa ? (
          <div
            role="status"
            className="flex items-center gap-2 rounded border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm text-text"
          >
            <PowerOff size={14} className="shrink-0 text-warn" aria-hidden />
            <span>
              Obra <strong>desabilitada</strong>: não aparece para seleção no web nem no app. Use{' '}
              <strong>Reabilitar</strong> para voltar a usá-la.
            </span>
          </div>
        ) : null}

        {/* Sumário da obra */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded border border-border bg-bg-panel p-4 lg:grid-cols-4">
          <Block label="Código" value={obra.codigo} />
          <Block label="Status" value={rotuloStatusObra(obra.status)} />
          <Block label="Empresa" value={obra.empresa?.nome ?? '—'} />
          <Block label="Criada em" value={formatDate(obra.created_at)} numero />
          <Block
            label="Rodovia e trecho"
            value={[obra.rodovia, obra.trecho].filter(Boolean).join(' · ') || '—'}
          />
          <Block
            label="Extensão"
            value={
              obra.extensao_km != null
                ? `${Number(obra.extensao_km).toLocaleString('pt-BR')} km`
                : '—'
            }
            numero
          />
          <Block
            label="Data-base"
            value={obra.data_base_orcamento ? formatDate(obra.data_base_orcamento) : '—'}
            numero
          />
          <Block
            label="Início e término"
            value={`${obra.data_inicio_planejada ? formatDate(obra.data_inicio_planejada) : '—'} a ${obra.data_fim_planejada ? formatDate(obra.data_fim_planejada) : '—'}`}
            numero
          />
        </dl>

        {/* Permissões */}
        <section className="rounded border border-border bg-bg-panel">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <div className="flex items-center gap-2">
              <KeyRound size={14} className="text-accent" aria-hidden />
              <h2 className="text-lg font-semibold text-text">Usuários com acesso</h2>
            </div>
            {loadingPerms || erroPerms ? null : (
              <span className="text-sm text-text-muted">
                {contar(permissoes.length, 'usuário', 'usuários')}
              </span>
            )}
          </div>

          {loadingPerms ? (
            <Carregando texto="Carregando os acessos…" className="px-3" />
          ) : erroPerms ? (
            <ErroConsulta
              erro={erroPerms}
              oQue="os usuários com acesso"
              aoTentar={() => void recarregarPerms()}
              className="m-3"
            />
          ) : permissoes.length === 0 ? (
            <div className="px-3 py-10">
              <EmptyState
                icon="key-round"
                title="Nenhum usuário com acesso"
                description="Conceda acesso a um engenheiro, cliente ou apontador da empresa para que ele veja esta obra. O apoio herda o acesso do seu engenheiro."
                action={
                  <Button variant="default" size="sm" onClick={() => setOpenGrant(true)}>
                    <Plus size={12} /> Conceder acesso
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                    <th className="px-3 py-2">Usuário</th>
                    <th className="px-3 py-2">Apoios que herdam</th>
                    <th className="px-3 py-2">Concedido por</th>
                    <th className="px-3 py-2">Concedido em</th>
                    <th className="px-3 py-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {permissoes.map((p) => {
                    const apoios = apoiosPorEngenheiro.get(p.user_id) ?? []
                    const nome = p.usuario?.nome ?? 'o usuário'
                    return (
                      <tr
                        key={p.id}
                        className="border-b border-border last:border-b-0 hover:bg-bg-hover"
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={p.usuario?.role === 'cliente' ? 'default' : 'success'}>
                              {rotuloPapel(p.usuario?.role)}
                            </Badge>
                            <div className="min-w-0">
                              <div className="text-text font-medium">{p.usuario?.nome ?? '—'}</div>
                              <div className="text-xs text-text-muted">
                                {p.usuario?.email ?? ''}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {apoios.length === 0 ? (
                            <span className="text-text-dim">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1 max-w-[260px]">
                              {apoios.slice(0, 3).map((a) => (
                                <Badge key={a.id}>
                                  <Users size={12} aria-hidden /> {a.nome}
                                </Badge>
                              ))}
                              {apoios.length > 3 ? (
                                <span
                                  className="text-xs text-text-muted"
                                  title={apoios
                                    .slice(3)
                                    .map((a) => a.nome)
                                    .join(', ')}
                                >
                                  e mais {apoios.length - 3}
                                </span>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-text-muted">{p.concedente?.nome ?? '—'}</td>
                        <td className="tabular px-3 py-2 text-text-muted">
                          {formatDate(p.created_at)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={revoke.isPending}
                            aria-label={`Revogar acesso de ${nome}`}
                            onClick={async () => {
                              const ok = await confirmar({
                                title: 'Revogar acesso?',
                                description:
                                  `${p.usuario?.nome ?? 'O usuário'} perde o acesso à obra ${obra.codigo}.` +
                                  (apoios.length > 0
                                    ? ` ${apoios.length === 1 ? '1 apoio vinculado também perde' : `${apoios.length} apoios vinculados também perdem`} o acesso.`
                                    : ''),
                                confirmLabel: 'Revogar',
                                variant: 'danger'
                              })
                              if (!ok) return
                              try {
                                await revoke.mutateAsync({ obra_id: obra.id, user_id: p.user_id })
                                toast.success('Acesso revogado.')
                              } catch (e) {
                                toast.error('Não foi possível revogar o acesso.', {
                                  description: e instanceof Error ? e.message : undefined
                                })
                              }
                            }}
                          >
                            <Trash2 size={12} /> Revogar
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Exclusão definitiva */}
        <section className="rounded border border-danger/40 bg-danger/5">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-danger/30">
            <AlertTriangle size={14} className="text-danger" aria-hidden />
            <h2 className="text-md font-semibold text-text">Excluir a obra</h2>
          </div>
          <div className="px-3 py-3 flex items-center justify-between gap-4">
            <p className="max-w-[640px] text-sm text-text-muted">
              Apaga a obra e <strong>todos os dados ligados a ela</strong>: orçamento, composições,
              planejamento e cronograma, trechos, produção e fotos do acompanhamento, documentação e
              acessos. <strong>Não dá para desfazer.</strong> Para só tirá-la de uso, prefira{' '}
              <strong>Desabilitar</strong>.
            </p>
            <Button
              variant="danger"
              size="sm"
              className="shrink-0"
              onClick={() => {
                setConfirmCodigo('')
                setTentouExcluir(false)
                setErroExcluir(null)
                setOpenDelete(true)
              }}
            >
              <Trash2 size={12} /> Excluir obra
            </Button>
          </div>
        </section>
      </div>

      {openEdit ? <EditObraDialog open onOpenChange={setOpenEdit} obra={obra} /> : null}
      <GrantPermissaoDialog
        open={openGrant}
        onOpenChange={setOpenGrant}
        obraId={obra.id}
        obraEmpresaId={obra.empresa_id}
        obraCodigo={obra.codigo}
        existingUserIds={existingUserIds}
      />

      <Dialog
        open={openDelete}
        onOpenChange={(o) => !o && !deleteObra.isPending && setOpenDelete(false)}
        size="sm"
        disableDismiss={deleteObra.isPending}
      >
        <form onSubmit={excluir} noValidate>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-danger" aria-hidden />
              Excluir obra
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <DialogErrorBanner message={erroExcluir} />
            <p className="text-sm text-text">
              Isto apaga <strong>{obra.nome}</strong> e{' '}
              <strong>todos os dados ligados a ela</strong> (orçamento, planejamento,
              acompanhamento, fotos, documentação).{' '}
              <strong className="text-danger">Não dá para desfazer.</strong>
            </p>
            <Campo
              rotulo={`Para confirmar, digite o código da obra: ${obra.codigo}`}
              erro={tentouExcluir ? erroCodigo : undefined}
            >
              <Input
                autoFocus
                value={confirmCodigo}
                onChange={(e) => setConfirmCodigo(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </Campo>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpenDelete(false)}
              disabled={deleteObra.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="danger" disabled={deleteObra.isPending}>
              <Trash2 size={12} /> {deleteObra.isPending ? 'Excluindo…' : 'Excluir obra'}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  )
}

function Block({
  label,
  value,
  numero
}: {
  label: string
  value: string
  numero?: boolean
}): ReactNode {
  return (
    <div className="min-w-0">
      <dt className="mb-0.5 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
        {label}
      </dt>
      <dd className={cn('text-md font-semibold text-text', numero && 'tabular')}>{value}</dd>
    </div>
  )
}
