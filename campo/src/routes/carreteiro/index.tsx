import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useIsAuthenticated, useSession } from '@/core/auth/SessionStore'
import { useFichasDaObra, useObra } from '@/core/db/daos'
import type { DraftFicha, OutFicha, SyncStatus } from '@/core/db/entities'
import { SyncStatusIndicator } from '@/features/common/SyncStatusIndicator'
import { useCarreteiroStore } from '@/features/carreteiro/carreteiroStore'
import { excluirRascunho } from '@/features/carreteiro/draftCarreteiroRepo'
import { excluirFicha } from '@/features/carreteiro/carreteiroRepo'
import { cn } from '@/lib/cn'
import { formatBR, formatNumero } from '@/lib/datas'

const STATUS: Record<SyncStatus, { label: string; cls: string }> = {
  PENDING: { label: 'pendente', cls: 'bg-warn/15 text-warn' },
  SYNCING: { label: 'enviando', cls: 'bg-info/15 text-info' },
  SYNCED: { label: 'enviada', cls: 'bg-ok/15 text-ok' },
  FAILED: { label: 'falhou', cls: 'bg-bad/15 text-bad' },
  REJEITADA: { label: 'recusada', cls: 'bg-bad/15 text-bad' },
}

/**
 * Viagens: fichas em andamento (rascunhos) e as fichas gravadas — recusadas pelo servidor abrem para correção.
 * Uma ficha = um caminhão num dia, com as viagens de carga e descarga; a produção do dia dos serviços é a soma.
 */
export function CarreteiroIndexRoute() {
  const authed = useIsAuthenticated()
  const session = useSession()
  const navigate = useNavigate()
  const obra = useObra(session?.obraAtualId)
  const fichas = useFichasDaObra(session?.obraAtualId)

  if (!authed) return <Navigate to="/login" replace />
  if (!session?.obraAtualId) return <Navigate to="/" replace />

  function nova() {
    useCarreteiroStore.getState().nova(session!.obraAtualId!, obra?.codigo ?? '')
    navigate('/carreteiro/step0')
  }
  function abrir(f: DraftFicha | OutFicha) {
    useCarreteiroStore.getState().abrir(f)
    navigate('/carreteiro/step1')
  }

  const drafts = fichas?.drafts ?? []
  const enviadas = fichas?.enviadas ?? []

  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-base/95 backdrop-blur pt-safe pl-safe pr-safe">
        <div className="flex items-center gap-2 px-2 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} aria-label="Voltar">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-on-surface">Viagens</h1>
            <p className="truncate text-xs text-on-surface-dim">
              {obra?.codigo ?? '—'} · {drafts.length} em andamento
            </p>
          </div>
          <SyncStatusIndicator />
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-5 overflow-y-auto p-4 pb-32">
        {drafts.length > 0 && (
          <section>
            <p className="mb-2 text-xs font-bold uppercase text-accent">Em andamento</p>
            <ul className="space-y-2">
              {drafts.map((d) => (
                <li key={d.id}>
                  <FichaCard
                    f={d}
                    onClick={() => abrir(d)}
                    onExcluir={() => {
                      if (window.confirm('Descartar esta ficha em andamento?'))
                        void excluirRascunho(d.id)
                    }}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <p className="mb-2 text-xs font-bold uppercase text-on-surface-dim">Fichas gravadas</p>
          {enviadas.length === 0 ? (
            <p className="text-sm text-on-surface-dim">Nenhuma ficha gravada neste aparelho.</p>
          ) : (
            <ul className="space-y-2">
              {enviadas.map((f) => (
                <li key={f.id}>
                  <FichaCard
                    f={f}
                    status={f.syncStatus}
                    motivo={f.syncStatus === 'REJEITADA' ? f.failureReason : null}
                    onClick={() => abrir(f)}
                    onExcluir={() => {
                      if (window.confirm('Excluir esta ficha (e as viagens dela)?'))
                        void excluirFicha(f.id)
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="sticky bottom-0 border-t border-border bg-bg-base/95 p-4 backdrop-blur pl-safe pr-safe pb-safe-plus-4">
        <Button variant="primary" size="lg" onClick={nova} className="w-full gap-2">
          <Plus className="h-5 w-5" />
          Nova ficha
        </Button>
      </div>
    </main>
  )
}

function FichaCard({
  f,
  status,
  motivo,
  onClick,
  onExcluir,
}: {
  f: DraftFicha | OutFicha
  status?: SyncStatus
  motivo?: string | null
  onClick: () => void
  onExcluir: () => void
}) {
  const total = f.viagens.reduce((s, v) => s + v.quantidade, 0)
  const un = f.viagens[0]?.unidade ?? ''
  return (
    <div className="card-surface flex items-stretch overflow-hidden">
      <button type="button" onClick={onClick} className="min-w-0 flex-1 p-4 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-on-surface">{formatBR(f.dt)}</p>
          {status && (
            <span
              className={cn(
                'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                STATUS[status].cls,
              )}
            >
              {STATUS[status].label}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-sm text-on-surface-dim">
          {[f.veiculoNome ?? 'sem veículo', f.motorista].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-1 text-sm text-on-surface">
          <span className="font-bold">{f.viagens.length}</span> viagem(ns)
          {total > 0 && ` · ${formatNumero(total, 2)} ${un}`}
        </p>
        {motivo && (
          <p className="mt-1 text-xs text-bad">Recusada: {motivo} — toque para corrigir</p>
        )}
      </button>
      <button
        type="button"
        onClick={onExcluir}
        className="flex items-center px-3 text-on-surface-dim transition-colors hover:bg-bad/10 hover:text-bad"
        aria-label="Excluir"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <div className="flex items-center pr-3 text-on-surface-muted">
        <ChevronRight className="h-4 w-4" />
      </div>
    </div>
  )
}
