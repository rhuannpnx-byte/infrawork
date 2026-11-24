import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useIsAuthenticated, useSession } from '@/core/auth/SessionStore'
import { useFichasDaObra, useObra } from '@/core/db/daos'
import type { DraftFicha, OutFicha, SyncStatus } from '@/core/db/entities'
import { SeloEnvio, SyncStatusIndicator } from '@/features/common/SyncStatusIndicator'
import { useCarreteiroStore } from '@/features/carreteiro/carreteiroStore'
import { excluirRascunho } from '@/features/carreteiro/draftCarreteiroRepo'
import { excluirFicha } from '@/features/carreteiro/carreteiroRepo'
import { totalDasViagens } from '@/features/carreteiro/totalViagens'
import { formatBR } from '@/lib/datas'
import { contar } from '@/lib/texto'

/**
 * Viagens: as fichas em andamento (rascunhos). A ficha gravada sai da tela; só volta a aparecer a que o servidor
 * recusou, para corrigir. Tocar no cartão abre as viagens; o lápis edita a ficha em si (caminhão, data, equipe).
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

  /** Lápis do cartão: edita o cabeçalho da ficha. Com viagens já lançadas, confirma antes. */
  function editar(f: DraftFicha | OutFicha) {
    if (
      f.viagens.length > 0 &&
      !window.confirm(
        `Esta ficha já tem ${contar(f.viagens.length, 'viagem lançada', 'viagens lançadas')}. Editar a ficha mesmo assim?`,
      )
    )
      return
    useCarreteiroStore.getState().abrir(f)
    navigate('/carreteiro/step0', { state: { editar: true } })
  }

  const drafts = fichas?.drafts ?? []
  const enviadas = fichas?.enviadas ?? []
  // gravada sai da tela; a recusada precisa de correção, e a que ainda não subiu vira só uma linha de aviso
  const recusadas = enviadas.filter((f) => f.syncStatus === 'REJEITADA')
  const aguardando = enviadas.filter(
    (f) => f.syncStatus !== 'SYNCED' && f.syncStatus !== 'REJEITADA',
  ).length

  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-base pt-safe pl-safe pr-safe">
        <div className="flex items-center gap-2 px-2 py-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} aria-label="Voltar">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-on-surface">Viagens</h1>
            <p className="truncate text-xs text-on-surface-dim">
              {contar(drafts.length, 'ficha', 'fichas')} em andamento · {obra?.codigo ?? '—'}
            </p>
          </div>
          <SyncStatusIndicator />
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-5 overflow-y-auto p-4 pb-32">
        {drafts.length > 0 && (
          <section>
            <p className="rotulo mb-2">Em andamento</p>
            <ul className="space-y-2">
              {drafts.map((d) => (
                <li key={d.id}>
                  <FichaCard
                    f={d}
                    onClick={() => abrir(d)}
                    onEditar={() => editar(d)}
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
        {recusadas.length > 0 && (
          <section>
            <p className="rotulo mb-2">Recusadas, para corrigir</p>
            <ul className="space-y-2">
              {recusadas.map((f) => (
                <li key={f.id}>
                  <FichaCard
                    f={f}
                    status={f.syncStatus}
                    motivo={f.failureReason}
                    onClick={() => abrir(f)}
                    onEditar={() => editar(f)}
                    onExcluir={() => {
                      if (window.confirm('Excluir esta ficha (e as viagens dela)?'))
                        void excluirFicha(f.id)
                    }}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
        {fichas == null ? (
          <p className="text-sm text-on-surface-dim">Carregando…</p>
        ) : drafts.length === 0 && recusadas.length === 0 ? (
          <p className="text-sm text-on-surface-dim">
            Nenhuma ficha em andamento. Toque em "Nova ficha" para lançar as viagens de um caminhão.
          </p>
        ) : null}
        {aguardando > 0 && (
          <p role="status" className="text-xs text-on-surface-dim">
            {contar(aguardando, 'ficha gravada aguardando', 'fichas gravadas aguardando')} o envio.
          </p>
        )}
      </div>

      <div className="sticky bottom-0 border-t border-border bg-bg-base pt-4 pb-safe-plus-4 px-safe-4">
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
  onEditar,
  onExcluir,
}: {
  f: DraftFicha | OutFicha
  status?: SyncStatus
  motivo?: string | null
  /** abre as viagens da ficha */
  onClick: () => void
  /** abre o cabeçalho da ficha (caminhão, data, motorista, equipe) */
  onEditar: () => void
  onExcluir: () => void
}) {
  const total = totalDasViagens(f.viagens)
  return (
    <div className="card-surface flex items-stretch overflow-hidden">
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center text-left"
      >
        <div className="min-w-0 flex-1 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="tabular font-medium text-on-surface">{formatBR(f.dt)}</p>
            {status && <SeloEnvio status={status} />}
          </div>
          <p className="mt-1 truncate text-sm text-on-surface-dim">
            {[f.veiculoNome ?? 'sem veículo', f.motorista].filter(Boolean).join(' · ')}
          </p>
          <p className="tabular mt-1 text-sm text-on-surface">
            {contar(f.viagens.length, 'viagem', 'viagens')}
            {total && ` · ${total}`}
          </p>
          {motivo && (
            <p className="mt-1 text-xs text-bad">
              Motivo: {motivo}
              <span className="block">Toque para corrigir.</span>
            </p>
          )}
        </div>
        <ChevronRight className="mr-2 h-5 w-5 flex-shrink-0 text-on-surface-muted" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onEditar}
        className="flex w-12 flex-shrink-0 items-center justify-center border-l border-border text-on-surface-dim transition-colors hover:bg-accent/10 hover:text-accent"
        aria-label="Editar a ficha"
        title="Editar a ficha (caminhão, data, motorista, equipe)"
      >
        <Pencil className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={onExcluir}
        className="flex w-12 flex-shrink-0 items-center justify-center border-l border-border text-on-surface-dim transition-colors hover:bg-bad/10 hover:text-bad"
        aria-label="Excluir ficha"
      >
        <Trash2 className="h-5 w-5" />
      </button>
    </div>
  )
}
