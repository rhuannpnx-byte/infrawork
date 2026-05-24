import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Link2, Search, Check, AlertTriangle, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { RequireObra } from '@/components/layout/RequireObra'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import {
  useAcompanhamentoLink,
  useListarProjetosSiga,
  useCriarVinculo,
  useSyncManual
} from '@/features/acompanhamento/hooks'
import type { SigaProjeto } from '@/types/acompanhamento'

export function AcompanhamentoVincularPage(): ReactNode {
  return (
    <RequireObra pageTitle="Vínculo SIGA">
      <VincularInner />
    </RequireObra>
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

  const [filtro, setFiltro] = useState('')
  const [selecionado, setSelecionado] = useState<SigaProjeto | null>(null)
  const [confirmando, setConfirmando] = useState(false)

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
    setConfirmando(true)
    try {
      await criar.mutateAsync({
        obra_id: obraId,
        siga_projeto_id: selecionado.id,
        siga_projeto_codigo: selecionado.codigo,
        siga_projeto_nome: selecionado.nome
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
        {link?.ativo ? (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-amber-300 mb-0.5">
                Obra já vinculada a {link.siga_projeto_codigo}
                {link.siga_projeto_nome ? ` — ${link.siga_projeto_nome}` : ''}
              </div>
              <div className="text-text-muted font-mono">
                Selecionar outro projeto abaixo irá <strong>substituir</strong> o vínculo. O cache de
                dados sincronizados é mantido, mas novas sincronizações puxam do novo projeto.
              </div>
            </div>
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
          <div className="rounded border border-accent/40 bg-accent/5 px-4 py-3 flex items-center gap-3">
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
            <Button size="sm" variant="ghost" onClick={() => setSelecionado(null)} disabled={confirmando}>
              Cancelar
            </Button>
            <Button size="sm" variant="default" onClick={onConfirmarVincular} disabled={confirmando}>
              {confirmando ? 'Vinculando…' : 'Confirmar vínculo'}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
