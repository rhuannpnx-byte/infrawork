import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useIsAuthenticated, useSession } from '@/core/auth/SessionStore'
import { useObra, useSessoesDaObra, type SessaoProducao } from '@/core/db/daos'
import { SeloEnvio, SyncStatusIndicator } from '@/features/common/SyncStatusIndicator'
import { cn } from '@/lib/cn'
import { formatBR } from '@/lib/datas'
import { contar, plural } from '@/lib/texto'
import { useProducaoStore } from '@/features/producao/producaoStore'
import { loadSessionItensAsDrafts } from '@/features/producao/producaoRepo'

/**
 * Ponto de entrada do fluxo de Produção. Lista APENAS sessões com itens
 * pendentes de sincronização — sessões 100% SYNCED somem imediato.
 *
 * Comportamento (atualizado 2026-05-24):
 *  - Sessão com qualquer item PENDING/SYNCING/FAILED aparece.
 *  - Sessão 100% SYNCED some da lista IMEDIATAMENTE (não espera virar o dia).
 *  - Pra continuar adicionando lançamentos no mesmo dia/equipe, criar nova
 *    sessão.
 *  - Tocar num card carrega os itens da sessão no store e navega pra Session.
 *
 * Sync rodando em segundo plano por engine global (foregroundSync). Removido
 * botão manual "Sincronizar" — o `SyncStatusIndicator` do header mostra o
 * estado e permite forçar ciclo se quiser.
 */
export function ProducaoListRoute() {
  const authed = useIsAuthenticated()
  const session = useSession()
  const navigate = useNavigate()
  const obra = useObra(session?.obraAtualId)

  const sessoes = useSessoesDaObra(session?.obraAtualId)

  // Rascunho em memória — se o usuário voltou da Session sem finalizar.
  const rascunhoItens = useProducaoStore((s) => s.itens)
  const rascunhoObraId = useProducaoStore((s) => s.obraId)
  const rascunhoEncarregadoNome = useProducaoStore((s) => s.encarregadoNome)
  const rascunhoEquipeNome = useProducaoStore((s) => s.equipeNome)
  const rascunhoDt = useProducaoStore((s) => s.dt)
  // só o que é novo ou foi alterado conta como "em construção": abrir uma sessão já gravada para olhar não conta
  const rascunhoNovos = rascunhoItens.filter((i) => i.syncStatus == null).length
  const rascunhoIsAtual = rascunhoNovos > 0 && rascunhoObraId === session?.obraAtualId

  const [opening, setOpening] = useState(false)

  if (!authed) return <Navigate to="/login" replace />
  if (session?.obraAtualId == null) return <Navigate to="/" replace />

  function handleNovaSessao() {
    // CRÍTICO: limpa o rascunho em memória antes de navegar — sem isso, os itens
    // da sessão anterior aparecem "somados" na nova sessão.
    useProducaoStore.getState().reset()
    navigate('/producao/setup')
  }

  function handleContinuarRascunho() {
    navigate('/producao/session')
  }

  function handleDescartarRascunho() {
    if (
      !window.confirm(
        `Descartar ${contar(rascunhoNovos, 'lançamento', 'lançamentos')} da sessão em construção? Esta ação não pode ser desfeita.`,
      )
    ) {
      return
    }
    useProducaoStore.getState().reset()
  }

  async function abrirSessao(s: SessaoProducao) {
    setOpening(true)
    try {
      const drafts = await loadSessionItensAsDrafts({
        obraId: s.obraId,
        dt: s.dt,
        encarregadoId: s.encarregadoId,
        equipeId: s.equipeId,
      })
      const store = useProducaoStore.getState()
      store.reset()
      store.setObra(s.obraId, s.obraCodigo)
      store.setEncarregado(s.encarregadoId, s.encarregadoNome)
      store.setEquipe(s.equipeId, s.equipeNome)
      store.setDt(s.dt)
      store.setItens(drafts)
      navigate('/producao/session')
    } catch (e) {
      console.error('[producao/list] abrirSessao falhou:', e)
      window.alert(
        e instanceof Error ? e.message : 'Não foi possível abrir a sessão. Tente de novo.',
      )
    } finally {
      setOpening(false)
    }
  }

  const totalPendentes = (sessoes ?? []).reduce((acc, s) => acc + s.pendentes, 0)

  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-base pt-safe pl-safe pr-safe">
        <div className="flex items-center gap-2 px-2 py-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} aria-label="Voltar">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-on-surface">Produção</h1>
            <p className="truncate text-xs text-on-surface-dim">
              {contar(sessoes?.length ?? 0, 'sessão', 'sessões')}
              {totalPendentes > 0 && ` · ${totalPendentes} a enviar`} · {obra?.codigo ?? '—'}
            </p>
          </div>
          <SyncStatusIndicator />
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto p-4 pb-32">
        {rascunhoIsAtual && (
          <div className="mb-4 rounded-md border border-accent-line bg-accent/10 p-4">
            <p className="rotulo text-accent">Sessão em construção</p>
            <p className="mt-1 text-on-surface">
              <strong>{contar(rascunhoNovos, 'lançamento', 'lançamentos')}</strong>{' '}
              {plural(rascunhoNovos, 'não finalizado', 'não finalizados')}
              {[rascunhoDt && formatBR(rascunhoDt), rascunhoEncarregadoNome, rascunhoEquipeNome]
                .filter(Boolean)
                .map((t) => ` · ${t}`)
                .join('')}
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleContinuarRascunho}
                className="flex-1"
              >
                Continuar
              </Button>
              <Button variant="outline" size="sm" onClick={handleDescartarRascunho}>
                Descartar
              </Button>
            </div>
          </div>
        )}

        {sessoes == null ? (
          <div className="mt-12 text-center text-on-surface-dim">Carregando…</div>
        ) : sessoes.length === 0 && !rascunhoIsAtual ? (
          <div className="flex h-64 items-center justify-center">
            <div className="text-center">
              <p className="font-medium text-on-surface">Nenhuma sessão nos últimos 7 dias</p>
              <p className="mt-2 text-sm text-on-surface-dim">
                Toque em "Nova sessão" para lançar a produção do dia.
              </p>
            </div>
          </div>
        ) : sessoes.length > 0 ? (
          <>
            <p className="mb-3 text-xs text-on-surface-dim">
              Toque numa sessão para ver ou adicionar lançamentos. As sessões já enviadas ficam
              nesta lista por 7 dias.
            </p>
            <ul className="space-y-3">
              {sessoes.map((s) => (
                <li key={s.key}>
                  <SessaoCard sessao={s} onClick={() => void abrirSessao(s)} disabled={opening} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <div className="sticky bottom-0 border-t border-border bg-bg-base pt-4 pb-safe-plus-4 px-safe-4">
        <Button variant="primary" size="lg" onClick={handleNovaSessao} className="w-full gap-2">
          <Plus className="h-5 w-5" />
          Nova sessão
        </Button>
      </div>
    </main>
  )
}

// ----------------------------------------------------------------------------
//  Card de sessão
// ----------------------------------------------------------------------------

function SessaoCard({
  sessao,
  onClick,
  disabled,
}: {
  sessao: SessaoProducao
  onClick: () => void
  disabled?: boolean
}) {
  const reasons = [
    ...new Set(
      sessao.itens
        .filter(
          (i) => (i.syncStatus === 'FAILED' || i.syncStatus === 'REJEITADA') && i.failureReason,
        )
        .map((i) => i.failureReason!),
    ),
  ]

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'card-surface flex w-full items-start gap-3 p-4 text-left',
        'transition-colors',
        disabled ? 'cursor-not-allowed opacity-50' : 'active:bg-bg-elevated',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="tabular font-medium text-on-surface">{formatBR(sessao.dt)}</p>
          <SeloEnvio status={sessao.statusDominante} />
        </div>
        <p className="mt-1 truncate text-sm text-on-surface-dim">
          {[sessao.encarregadoNome, sessao.equipeNome].filter(Boolean).join(' · ') ||
            'Sem encarregado nem equipe'}
        </p>
        <p className="tabular mt-2 text-sm text-on-surface">
          {contar(sessao.total, 'lançamento', 'lançamentos')}
          {sessao.pendentes > 0 && sessao.pendentes !== sessao.total && (
            <span className="text-warn"> · {sessao.pendentes} a enviar</span>
          )}
        </p>
        {reasons.length > 0 && (
          <p className="mt-1 text-xs text-bad">
            Motivo: {reasons.join('; ')}
            <span className="block">Toque para corrigir.</span>
          </p>
        )}
      </div>
      <ChevronRight className="mt-1 h-5 w-5 flex-shrink-0 text-on-surface-muted" />
    </button>
  )
}
