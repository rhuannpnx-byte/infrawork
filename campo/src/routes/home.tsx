import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Camera, ChevronRight, HardHat, LineChart, LogOut, Truck } from 'lucide-react'
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
import { ModuleCard } from '@/features/common/ModuleCard'
import { SeletorTema } from '@/features/common/SeletorTema'
import { contar, plural } from '@/lib/texto'
import { podeVerPainel } from '@/features/painel/papel'

/**
 * Home — hub do app de campo.
 *  1. Barra: logo + operador + sync + sair
 *  2. Obra atual (abre a escolha da obra)
 *  3. Pendências de envio e situação dos dados offline da obra
 *  4. Módulos: Visão estratégica (só engenheiro, adm e god), Produção, Viagens, Fotos
 *  5. Tema (claro, escuro ou o do sistema)
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
      setCatalogError('Sem conexão. O app usa os dados guardados no aparelho.')
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
  const motivo = !temObra ? 'Escolha a obra primeiro' : 'Os dados da obra ainda não foram baixados'

  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-base pt-safe pl-safe pr-safe">
        <h1 className="sr-only">InfraWork Campo</h1>
        <div className="flex items-center gap-3 py-2 pl-4 pr-2">
          <img src="/icon-288.webp" alt="" className="h-10 w-10 flex-shrink-0" decoding="async" />
          {session?.userNome && (
            <p className="min-w-0 flex-1 truncate border-l border-border pl-3 text-sm text-on-surface-dim">
              {session.userNome}
            </p>
          )}
          <div className="flex flex-shrink-0 items-center gap-1">
            <AndroidInstallButton />
            <SyncStatusIndicator />
            <Button variant="ghost" size="icon" onClick={() => void logout()} aria-label="Sair">
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
        {catalogError && <div className="px-4 pb-2 text-xs text-warn">{catalogError}</div>}
        {espaco && espaco.usado / espaco.total > 0.8 && (
          <div className="px-4 pb-2 text-xs text-bad">
            Pouco espaço no aparelho ({Math.round((100 * espaco.usado) / espaco.total)}% usado).
            Conecte-se à internet para enviar as fotos que estão aguardando.
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
          <div className="flex items-start gap-2 px-1 text-xs text-on-surface-dim">
            <span
              className={cn(
                'mt-1.5 h-2 w-2 flex-shrink-0 rounded-full',
                outbox.recusados > 0 ? 'bg-bad' : 'animate-pulse bg-warn',
              )}
            />
            <span>
              {[
                outbox.producao > 0
                  ? contar(outbox.producao, 'lançamento de produção', 'lançamentos de produção')
                  : null,
                outbox.fichas > 0
                  ? contar(outbox.fichas, 'ficha de viagens', 'fichas de viagens')
                  : null,
                outbox.fotos > 0 ? contar(outbox.fotos, 'foto', 'fotos') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              {outbox.total > 0 ? ' aguardando rede' : ''}
              {outbox.recusados > 0 && (
                <span className="text-bad">
                  {outbox.total > 0 ? ' · ' : ''}
                  {contar(outbox.recusados, 'recusado', 'recusados')} em{' '}
                  {[
                    outbox.recusadosProducao > 0 ? 'Produção' : null,
                    outbox.recusadosFichas > 0 ? 'Viagens' : null,
                  ]
                    .filter(Boolean)
                    .join(' e ')}
                  : abra e corrija
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
          {podeVerPainel(session?.role) && (
            <ModuleCard
              icon={<LineChart className="h-5 w-5" strokeWidth={1.8} />}
              title="Visão estratégica"
              subtitle="Avanço, serviços e equipes da obra"
              badge={0}
              enabled={temObra}
              motivo={motivo}
              onClick={() => navigate('/painel')}
              testId="card-visao-estrategica"
            />
          )}
          <ModuleCard
            icon={<HardHat className="h-5 w-5" strokeWidth={1.8} />}
            title="Produção"
            subtitle="Lançamento dos serviços executados no dia"
            badge={outbox?.producao ?? 0}
            recusados={outbox?.recusadosProducao ?? 0}
            enabled={pronto}
            motivo={motivo}
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
            recusados={outbox?.recusadosFichas ?? 0}
            enabled={pronto && nViagens > 0}
            motivo={pronto ? 'Nenhum serviço da obra é lançado por viagens' : motivo}
            onClick={() => navigate('/carreteiro')}
          />
          <ModuleCard
            icon={<Camera className="h-5 w-5" strokeWidth={1.8} />}
            title="Fotos"
            subtitle="Captura georreferenciada com marca d'água"
            badge={outbox?.fotos ?? 0}
            enabled={pronto}
            motivo={motivo}
            onClick={() => navigate('/fotos')}
          />
        </div>

        <SeletorTema className="pt-2" />
      </div>

      <footer className="sticky bottom-0 border-t border-border bg-bg-panel pb-safe pl-safe pr-safe">
        <div className="tabular mx-auto flex h-9 w-full max-w-2xl items-center justify-between px-4 text-2xs text-on-surface-muted">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                sync.syncing
                  ? 'animate-pulse bg-info'
                  : sync.lastSyncAt
                    ? 'bg-ok'
                    : 'bg-on-surface-muted',
              )}
            />
            {sync.syncing
              ? 'Enviando…'
              : sync.lastSyncAt
                ? `Sincronizado às ${new Date(sync.lastSyncAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                : 'Ainda não sincronizado'}
          </span>
          <span>Campo v{__APP_VERSION__}</span>
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
        'group w-full rounded-md text-left',
        'border border-border-strong bg-bg-panel',
        'transition-colors duration-150 ease-out',
        'hover:border-accent active:border-accent',
      )}
    >
      <div className="flex items-center gap-4 px-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="rotulo">Obra atual</p>
          <p
            className={cn(
              'tabular mt-1 truncate text-xl font-semibold',
              temObra ? 'text-on-surface' : 'text-on-surface-muted',
            )}
          >
            {temObra ? codigo : 'Selecionar obra'}
          </p>
          <p className={cn('mt-0.5 text-xs text-on-surface-dim', temObra && 'truncate')}>
            {temObra
              ? nome
              : totalObras > 0
                ? `${contar(totalObras, 'obra', 'obras')} ${plural(totalObras, 'liberada', 'liberadas')}`
                : sincronizou
                  ? 'Nenhuma obra liberada para você. Peça ao engenheiro para liberar a obra.'
                  : 'Buscando as obras liberadas…'}
          </p>
        </div>
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md border border-border-strong text-on-surface-dim transition-colors group-hover:border-accent group-hover:text-accent">
          <ChevronRight className="h-5 w-5" />
        </div>
      </div>
    </button>
  )
}
