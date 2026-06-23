import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Link2, Link2Off, Search, Check, AlertTriangle, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { RequireObra } from '@/components/layout/RequireObra'
import { RequireRole } from '@/components/layout/RequireRole'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import {
  useAcompanhamentoLink,
  useListarProjetosSiga,
  useCriarVinculo,
  useSyncManual,
  useDesvincular,
  useReativarVinculo
} from '@/features/acompanhamento/hooks'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import type { SigaProjeto } from '@/types/acompanhamento'

export function AcompanhamentoVincularPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm']} pageTitle="Vínculo SIGA">
      <RequireObra pageTitle="Vínculo SIGA">
        <VincularInner />
      </RequireObra>
    </RequireRole>
  )
}

function VincularInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const podeVincular = role === 'god' || role === 'adm'
  const navigate = useNavigate()

  const { data: link } = useAcompanhamentoLink(obraId)
  const projetosQuery = useListarProjetosSiga()
  const criar = useCriarVinculo()
  const sync = useSyncManual()
  const desvincular = useDesvincular()
  const reativar = useReativarVinculo()
  const confirm = useConfirm()

  const [filtro, setFiltro] = useState('')
  const [selecionado, setSelecionado] = useState<SigaProjeto | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [dataCorte, setDataCorte] = useState('')

  // Prefill da data de corte com a já gravada no vínculo (edição de vínculo).
  useEffect(() => {
    if (link?.data_corte) setDataCorte(link.data_corte.slice(0, 10))
  }, [link?.data_corte])

  const projetosFiltrados = useMemo(() => {
    const projs = projetosQuery.data ?? []
    if (!filtro.trim()) return projs
    const q = filtro.trim().toLowerCase()
    return projs.filter(
      (p) =>
        p.codigo.toLowerCase().includes(q) ||
        p.nome.toLowerCase().includes(q) ||
        String(p.id).includes(q)
    )
  }, [projetosQuery.data, filtro])

  if (!podeVincular) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Vínculo SIGA" subtitle={scope.obra?.nome ?? ''} />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="lock"
            title="Acesso restrito"
            description="Apenas ADM ou GOD podem criar/alterar o vínculo da obra com o ERP SIGA. Volte para Visão Geral para acompanhar dados."
            action={
              <Button variant="default" size="sm" onClick={() => navigate({ to: '/acompanhamento' })}>
                Voltar
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  const onConfirmarVincular = async (): Promise<void> => {
    if (!selecionado) return
    if (!dataCorte) {
      toast.error('Defina a data de corte antes de confirmar o vínculo.')
      return
    }
    setConfirmando(true)
    try {
      await criar.mutateAsync({
        obra_id: obraId,
        siga_projeto_id: selecionado.id,
        siga_projeto_codigo: selecionado.codigo,
        siga_projeto_nome: selecionado.nome,
        data_corte: dataCorte
      })
      toast.success(`Obra vinculada ao projeto SIGA ${selecionado.codigo}.`)
      // Dispara carga inicial em background
      sync
        .mutateAsync({ obra_id: obraId, force_full: true })
        .then((r) => {
          const item = r.sincronizados[0]
          if (item?.erro) {
            toast.warning(`Carga inicial com aviso: ${item.erro}`)
          } else {
            const s = item?.stats ?? {}
            toast.success(
              `Carga inicial: ${s.producao_atualizadas ?? 0} produção + ${s.fotos_atualizadas ?? 0} fotos.`
            )
          }
        })
        .catch((e) => toast.error('Carga inicial falhou: ' + (e instanceof Error ? e.message : 'erro')))
      setSelecionado(null)
      navigate({ to: '/acompanhamento' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao vincular')
    } finally {
      setConfirmando(false)
    }
  }

  const onDesvincular = async (): Promise<void> => {
    if (!link?.id) return
    const ok = await confirm({
      title: 'Desvincular obra do SIGA?',
      description:
        'O histórico de produção e fotos já sincronizado será mantido. Você pode reativar depois sem perder dados.',
      confirmLabel: 'Desvincular',
      variant: 'warn'
    })
    if (!ok) return
    try {
      await desvincular.mutateAsync({ id: link.id, obra_id: obraId })
      toast.success('Vínculo desativado.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao desvincular')
    }
  }

  const onReativar = async (): Promise<void> => {
    if (!link?.id) return
    try {
      await reativar.mutateAsync({ id: link.id, obra_id: obraId })
      toast.success('Vínculo reativado.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao reativar')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Vínculo SIGA"
        subtitle={`${scope.obra?.nome ?? ''} — escolha o projeto do ERP que abastecerá esta obra.`}
        actions={
          <Button size="sm" variant="ghost" onClick={() => projetosQuery.refetch()}>
            <RefreshCw size={11} className={projetosQuery.isFetching ? 'animate-spin' : ''} />
            Recarregar lista
          </Button>
        }
      />

      <div className="flex-1 overflow-hidden flex flex-col p-5 space-y-3">
        {link && !link.ativo ? (
          <div className="rounded border border-border bg-bg-panel px-4 py-3 text-xs flex items-center gap-3">
            <Link2Off size={14} className="text-text-dim shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-text mb-0.5">
                Vínculo desativado ({link.siga_projeto_codigo}
                {link.siga_projeto_nome ? ` — ${link.siga_projeto_nome}` : ''})
              </div>
              <div className="text-text-muted font-mono">
                O cache de dados foi mantido. Reative para voltar a sincronizar, ou selecione outro
                projeto abaixo.
              </div>
            </div>
            <Button
              size="sm"
              variant="default"
              onClick={onReativar}
              disabled={reativar.isPending}
            >
              <Link2 size={11} /> Reativar
            </Button>
          </div>
        ) : null}

        {link?.ativo ? (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-amber-300 mb-0.5">
                Obra já vinculada a {link.siga_projeto_codigo}
                {link.siga_projeto_nome ? ` — ${link.siga_projeto_nome}` : ''}
              </div>
              <div className="text-text-muted font-mono">
                Selecionar outro projeto abaixo irá <strong>substituir</strong> o vínculo. O cache de
                dados sincronizados é mantido, mas novas sincronizações puxam do novo projeto.
              </div>
              {link.data_corte ? (
                <div className="text-text-muted font-mono mt-1">
                  Data de corte atual:{' '}
                  <strong className="text-amber-300">
                    {link.data_corte.slice(0, 10).split('-').reverse().join('/')}
                  </strong>{' '}
                  — só produções a partir desta data são sincronizadas.
                </div>
              ) : null}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={onDesvincular}
              disabled={desvincular.isPending}
              className="shrink-0"
            >
              <Link2Off size={11} /> Desvincular
            </Button>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search
              size={11}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none"
            />
            <Input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Filtrar por código, nome ou id…"
              className="pl-7"
            />
          </div>
          <div className="text-2xs font-mono text-text-dim">
            {projetosQuery.isLoading
              ? 'Carregando…'
              : `${projetosFiltrados.length} de ${projetosQuery.data?.length ?? 0}`}
          </div>
        </div>

        {projetosQuery.error ? (
          <div className="rounded border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs font-mono text-red-300 whitespace-pre-wrap">
            Falha ao listar projetos do SIGA: {projetosQuery.error.message}
          </div>
        ) : null}

        <div className="flex-1 overflow-auto rounded border border-border bg-bg-panel">
          <table className="w-full text-xs">
            <thead className="text-text-dim font-mono uppercase text-2xs bg-bg sticky top-0 z-10">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 w-24">Código</th>
                <th className="text-left px-3 py-2">Nome</th>
                <th className="text-right px-3 py-2 w-20">SIGA ID</th>
                <th className="text-right px-3 py-2 w-28">Ação</th>
              </tr>
            </thead>
            <tbody>
              {projetosFiltrados.map((p) => {
                const ehAtual =
                  link?.ativo && link.siga_projeto_id === p.id
                const selecionadoFlag = selecionado?.id === p.id
                return (
                  <tr
                    key={p.id}
                    className={cn(
                      'border-b border-border/40 hover:bg-bg-hover transition-colors',
                      ehAtual && 'bg-accent/5',
                      selecionadoFlag && 'bg-accent-glow'
                    )}
                  >
                    <td className="px-3 py-2 font-mono text-text">{p.codigo}</td>
                    <td className="px-3 py-2 text-text">{p.nome || <span className="text-text-dim italic">sem nome</span>}</td>
                    <td className="px-3 py-2 font-mono text-text-dim text-right">{p.id}</td>
                    <td className="px-3 py-2 text-right">
                      {ehAtual ? (
                        <span className="inline-flex items-center gap-1 text-accent text-2xs font-mono">
                          <Check size={11} /> Atual
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant={selecionadoFlag ? 'default' : 'ghost'}
                          onClick={() => setSelecionado(p)}
                        >
                          <Link2 size={11} />
                          Selecionar
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {projetosFiltrados.length === 0 && !projetosQuery.isLoading ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-text-dim text-xs italic">
                    Nenhum projeto encontrado.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {selecionado ? (
          <div className="rounded border border-accent/40 bg-accent/5 px-4 py-3 space-y-3">
            <div className="flex items-center gap-3">
              <Link2 size={16} className="text-accent shrink-0" />
              <div className="flex-1 text-xs">
                <div className="text-text">
                  Vincular obra <strong>{scope.obra?.nome}</strong> ao projeto SIGA{' '}
                  <strong className="text-accent">{selecionado.codigo}</strong>
                  {selecionado.nome ? ` — ${selecionado.nome}` : ''}?
                </div>
                <div className="text-2xs text-text-muted font-mono mt-0.5">
                  Carga inicial será disparada em background.
                </div>
              </div>
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-text-muted font-mono text-2xs uppercase">
                  Data de corte <span className="text-accent">*</span>
                </span>
                <Input
                  type="date"
                  value={dataCorte}
                  onChange={(e) => setDataCorte(e.target.value)}
                  className="w-40"
                />
              </label>
              <div className="flex-1 text-2xs text-text-dim font-mono leading-relaxed min-w-[12rem]">
                Só serão sincronizadas produções do SIGA com data{' '}
                <strong className="text-text">a partir</strong> desta. Produções anteriores são
                ignoradas e removidas do cache.
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelecionado(null)}
                  disabled={confirmando}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={onConfirmarVincular}
                  disabled={confirmando || !dataCorte}
                >
                  {confirmando ? 'Vinculando…' : 'Confirmar vínculo'}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
