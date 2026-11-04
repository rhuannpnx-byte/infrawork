import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Camera, ChevronRight, HardHat, LogOut, Truck } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useAuth } from '@/features/auth/useAuth'
import { sessionStore, useIsAuthenticated, useSession } from '@/core/auth/SessionStore'
import { PickerSheet } from '@/features/common/PickerSheet'
import { SyncStatusIndicator } from '@/features/common/SyncStatusIndicator'
import { AndroidInstallButton } from '@/features/install/AndroidInstallButton'
import { servicosPorModo, useCatalogo, useObra, useObras, useOutboxCounts } from '@/core/db/daos'
import { useSyncStatus } from '@/core/sync/useSyncStatus'
import { refreshAllCatalogs, refreshCatalogo } from '@/core/sync/catalogSync'
import { cn } from '@/lib/cn'

/**
 * Home — hub do app de campo.
 *  1. Barra: logo + operador + sync + sair
 *  2. Obra atual (abre a escolha da obra)
 *  3. Pendências de envio e situação dos dados offline da obra
 *  4. Módulos: Produção, Viagens, Fotos
 */
export function HomeRoute() {
  const authed = useIsAuthenticated()
  const session = useSession()
  const navigate = useNavigate()
  const { logout } = useAuth()
  const obras = useObras()
  const obraAtual = useObra(session?.obraAtualId)
  const catalogo = useCatalogo(session?.obraAtualId)
  const outbox = useOutboxCounts()
  const sync = useSyncStatus()
  const [showPicker, setShowPicker] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [sincronizou, setSincronizou] = useState(false)
  // espaço do aparelho: fotos pendentes ficam guardadas até subir
  const [espaco, setEspaco] = useState<{ usado: number; total: number } | null>(null)
  useEffect(() => {
    void navigator.storage
      ?.estimate?.()
      .then((e) => e.quota && setEspaco({ usado: e.usage ?? 0, total: e.quota }))
      .catch(() => undefined)
  }, [outbox?.fotos])

  useEffect(() => {
    if (!authed) return
    void refreshCatalogs()
  }, [authed])

  async function refreshCatalogs() {
    setCatalogError(null)
    try {
      await refreshAllCatalogs()
      setSincronizou(true)
    } catch {
      setCatalogError('Sem conexão — usando os dados guardados no aparelho.')
    }
  }

  // uma obra só liberada: já fica selecionada (o apontador não precisa escolher)
  useEffect(() => {
    if (!authed || session?.obraAtualId || obras?.length !== 1) return
    sessionStore.patch({ obraAtualId: obras[0]!.id })
    void refreshCatalogo(obras[0]!.id).catch(() => undefined)
  }, [authed, session?.obraAtualId, obras])

  function selecionarObra(id: string) {
    sessionStore.patch({ obraAtualId: id })
    setShowPicker(false)
    void refreshCatalogo(id).catch(() => undefined)
  }

  if (!authed) return <Navigate to="/login" replace />
  const temObra = obraAtual != null
  const pronto = temObra && !!catalogo
  const nViagens = servicosPorModo(catalogo, 'viagens').length

  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-base/95 backdrop-blur pt-safe pl-safe pr-safe">
        <div className="flex items-center gap-3 px-4 py-3">
          <img
            src="/icon-288.webp"
            alt="InfraWork"
            className="h-10 w-10 flex-shrink-0"
            decoding="async"
          />
          {session?.userNome && (
            <p className="min-w-0 flex-1 truncate border-l border-border pl-3 text-xs text-on-surface-dim">
              {session.userNome}
            </p>
          )}
          <div className="flex flex-shrink-0 items-center gap-1">
            <AndroidInstallButton />
            <SyncStatusIndicator />
            <Button variant="ghost" size="icon" onClick={() => void logout()} aria-label="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {catalogError && <div className="px-4 pb-2 text-xs text-warn">{catalogError}</div>}
        {espaco && espaco.usado / espaco.total > 0.8 && (
          <div className="px-4 pb-2 text-xs text-bad">
            Pouco espaço no aparelho ({Math.round((100 * espaco.usado) / espaco.total)}% usado) — conecte à
            internet para enviar as fotos pendentes.
          </div>
        )}
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-5 px-4 pb-5 pt-5">
        <ObraAtualCard
          codigo={obraAtual?.codigo}
          nome={obraAtual?.nome}
          totalObras={obras?.length ?? 0}
          sincronizou={sincronizou}
          onPick={() => setShowPicker(true)}
        />

        {outbox && (outbox.total > 0 || outbox.recusados > 0) && (
          <div className="flex items-center gap-2 px-1 text-xs text-on-surface-dim">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                outbox.recusados > 0 ? 'bg-bad' : 'animate-pulse bg-warn',
              )}
            />
            <span>
              {[
                outbox.producao > 0 ? `${outbox.producao} produção` : null,
                outbox.fichas > 0 ? `${outbox.fichas} ficha(s) de viagens` : null,
                outbox.fotos > 0 ? `${outbox.fotos} foto(s)` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              {outbox.total > 0 ? ' aguardando envio' : ''}
              {outbox.recusados > 0 && (
                <span className="text-bad">
                  {outbox.total > 0 ? ' · ' : ''}
                  {outbox.recusados} recusado(s) — corrija
                </span>
              )}
            </span>
          </div>
        )}

        {temObra && (
          <p className="px-1 text-xs text-on-surface-dim">
            {catalogo
              ? `Pronto para trabalhar sem sinal · dados da obra de ${new Date(catalogo.fetchedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
              : 'Baixando os dados da obra… conecte-se à internet ao menos uma vez.'}
          </p>
        )}

        <div className="space-y-3">
          <ModuleCard
            icon={<HardHat className="h-5 w-5" strokeWidth={1.8} />}
            title="Produção"
            subtitle="Apontamento dos serviços executados no dia"
            badge={outbox?.producao ?? 0}
            enabled={pronto}
            onClick={() => navigate('/producao')}
          />
          <ModuleCard
            icon={<Truck className="h-5 w-5" strokeWidth={1.8} />}
            title="Viagens"
            subtitle={
              pronto && nViagens === 0
                ? 'Nenhum serviço da obra é lançado por viagens'
                : 'Ficha do caminhão com as viagens de carga e descarga'
            }
            badge={outbox?.fichas ?? 0}
            enabled={pronto && nViagens > 0}
            onClick={() => navigate('/carreteiro')}
          />
          <ModuleCard
            icon={<Camera className="h-5 w-5" strokeWidth={1.8} />}
            title="Fotos"
            subtitle="Captura georreferenciada com marca d'água"
            badge={outbox?.fotos ?? 0}
            enabled={pronto}
            onClick={() => navigate('/fotos')}
          />
        </div>
      </div>

      <footer className="sticky bottom-0 border-t border-border bg-bg-panel pb-safe pl-safe pr-safe">
        <div className="mx-auto flex h-9 w-full max-w-2xl items-center justify-between px-4 font-mono text-[11px] text-on-surface-muted tabular">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                sync.syncing
                  ? 'animate-pulse bg-info'
                  : sync.lastSyncAt
                    ? 'bg-ok'
                    : 'bg-on-surface-muted',
              )}
            />
            {sync.lastSyncAt
              ? `sync ${new Date(sync.lastSyncAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
              : sync.syncing
                ? 'sincronizando…'
                : 'sync pendente'}
          </span>
          <span>InfraWork Campo v{__APP_VERSION__}</span>
        </div>
      </footer>

      <PickerSheet
        open={showPicker}
        title="Selecionar obra"
        items={obras ?? []}
        label={(o) => o.codigo}
        sublabel={(o) => o.nome}
        onPick={(o) => selecionarObra(o.id)}
        onDismiss={() => setShowPicker(false)}
        searchHint="Buscar obra"
        emptyMessage="Nenhuma obra liberada para você. Peça ao engenheiro para liberar o acesso."
        emptyAction={{ label: 'Atualizar', onClick: () => void refreshCatalogs() }}
      />
    </main>
  )
}

// ----------------------------------------------------------------------------
//  Componentes locais
// ----------------------------------------------------------------------------

function ObraAtualCard({
  codigo,
  nome,
  totalObras,
  sincronizou,
  onPick,
}: {
  codigo: string | undefined
  nome: string | undefined
  totalObras: number
  sincronizou: boolean
  onPick: () => void
}) {
  const temObra = codigo != null
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'group relative w-full overflow-hidden rounded-lg text-left',
        'border border-border-strong bg-bg-panel',
        'transition-colors duration-150 ease-out',
        'hover:border-accent/60 active:border-accent',
      )}
    >
      <div className="h-[2px] w-full bg-gradient-to-r from-accent/60 via-accent to-accent/60" />
      <div className="flex items-center gap-4 px-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-on-surface-dim">
            Obra atual
          </p>
          <p
            className={cn(
              'mt-1.5 truncate font-mono text-xl tabular',
              temObra ? 'text-on-surface' : 'italic text-on-surface-muted',
            )}
          >
            {temObra ? codigo : 'Selecionar obra'}
          </p>
          <p className="mt-1 truncate text-[11px] text-on-surface-muted">
            {temObra
              ? nome
              : totalObras > 0
                ? `${totalObras} obra(s) liberada(s)`
                : sincronizou
                  ? 'Nenhuma obra liberada para você — peça ao engenheiro para liberar a obra.'
                  : 'Aguardando sincronização'}
          </p>
        </div>
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-border-strong text-on-surface-dim transition-colors group-hover:border-accent/60 group-hover:text-accent">
          <ChevronRight className="h-4 w-4" />
        </div>
      </div>
    </button>
  )
}

interface ModuleCardProps {
  icon: React.ReactNode
  title: string
  subtitle: string
  badge: number
  enabled: boolean
  onClick: () => void
}

function ModuleCard({ icon, title, subtitle, badge, enabled, onClick }: ModuleCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      className={cn(
        'group relative w-full overflow-hidden rounded-md text-left',
        'border border-border bg-bg-panel',
        'flex min-h-[80px] items-stretch gap-0',
        'transition-all duration-150 ease-out',
        enabled
          ? 'hover:border-border-strong hover:bg-bg-elevated active:bg-bg-elevated/80'
          : 'cursor-not-allowed opacity-40',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'w-[2px] bg-transparent transition-colors duration-150',
          enabled && 'group-hover:bg-accent group-active:bg-accent',
        )}
      />
      <div className="flex items-center px-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-accent/30 bg-accent-glow text-accent">
          {icon}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center py-3 pr-3">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-base font-semibold text-on-surface">{title}</h3>
          {badge > 0 && (
            <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warn px-1.5 text-[10px] font-bold text-bg-base tabular">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-on-surface-dim">{subtitle}</p>
      </div>
      <div className="flex items-center pr-4 text-on-surface-muted">
        <ChevronRight className="h-4 w-4" />
      </div>
    </button>
  )
}
