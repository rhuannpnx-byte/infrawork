import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { LoginRoute } from '@/routes/login'
import { HomeRoute } from '@/routes/home'
import { ProducaoListRoute } from '@/routes/producao/list'
import { ProducaoSetupRoute } from '@/routes/producao/setup'
import { ProducaoSessionRoute } from '@/routes/producao/session'
import { CarreteiroIndexRoute } from '@/routes/carreteiro/index'
import { CarreteiroStep0Route } from '@/routes/carreteiro/step0'
import { CarreteiroStep1Route } from '@/routes/carreteiro/step1'
import { CarreteiroStep2Route } from '@/routes/carreteiro/step2'
import { CarreteiroSuccessRoute } from '@/routes/carreteiro/success'
import { useCarreteiroStore } from '@/features/carreteiro/carreteiroStore'
import { bootstrapAutoSave } from '@/features/carreteiro/draftCarreteiroRepo'
import { FotosListRoute } from '@/routes/fotos/list'
import { FotosCaptureRoute } from '@/routes/fotos/capture'
import { useIsAuthenticated, useTokenValid } from '@/core/auth/SessionStore'
import { ReauthBanner } from '@/features/auth/ReauthBanner'
import { NovaVersaoBanner } from '@/features/common/NovaVersaoBanner'
import { ligarRenovacaoDeToken } from '@/core/auth/authBridge'
import { useForegroundSyncListeners } from '@/core/sync/foregroundSync'
import { requestPersistentStorage } from '@/core/platform/persistStorage'
import { initPhotoStorage } from '@/core/storage'
import { initCameraProvider } from '@/core/camera'
import { ToastHost } from '@/features/common/Toast'
import { ToastReconnected } from '@/features/common/ToastReconnected'
import { IosInstallBanner } from '@/features/install/IosInstallBanner'

/**
 * Root da aplicação:
 *  - LoaderScreen com identidade InfraWork enquanto useSyncExternalStore resolve.
 *  - Token vencido NÃO desloga: ReauthBanner convida a entrar de novo (offline-first).
 *  - Foreground sync engine ativo enquanto autenticado.
 *  - SW auto-update — autoUpdate + skipWaiting/clientsClaim.
 *  - Routing com guard de auth no nível das rotas (sem flash de login pós-login).
 */

function useReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    Promise.all([initPhotoStorage(), initCameraProvider()])
      .catch((err) => console.warn('[boot] provider init falhou:', err))
      .finally(() => setReady(true))
  }, [])
  return ready
}

/**
 * LoaderScreen — splash com identidade InfraWork. Usado em três momentos:
 *  - Boot inicial (antes do useSyncExternalStore resolver localStorage)
 *  - Carregamento de dados em rotas (passando `label` opcional)
 *  - Transições autenticadas (ex.: aguardando session refresh)
 *
 * Visual: icon centralizado com glow azul radial sutil de fundo, wordmark logo
 * abaixo, spinner discreto. Mesma vibe da Tela de Início standalone do PWA.
 */
export function LoaderScreen({ label }: { label?: string } = {}) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-bg-base">
      {/* Glow radial sutil — ecoa o efeito do icon-source.png */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(circle at center, rgba(77,142,255,0.18) 0%, transparent 55%)',
        }}
      />
      <div className="relative flex flex-col items-center gap-8 px-8">
        {/* Wordmark com glow — peça única (icon + texto INFRAWORK).
            Largura responsiva, max-w pra não estourar em tablet. */}
        <img
          src="/logo-wordmark-glow-640.webp"
          alt="InfraWork"
          className="h-auto w-full max-w-[320px]"
          decoding="async"
        />
        <div className="flex items-center gap-2 text-xs text-on-surface-dim">
          <div className="h-3 w-3 animate-spin rounded-full border border-accent border-t-transparent" />
          <span>{label ?? 'Carregando…'}</span>
        </div>
      </div>
    </div>
  )
}

function Splash() {
  return <LoaderScreen />
}

export function App() {
  const ready = useReady()
  const authed = useIsAuthenticated()
  const tokenValid = useTokenValid()

  // Foreground sync ativo enquanto autenticado (Chrome+iOS).
  // No Chrome também temos Background Sync via SW; iOS depende disso aqui.
  useForegroundSyncListeners(authed)

  // Auto-save das fichas de viagens em andamento (várias em paralelo, sobrevivem a recarregar o app) e o relógio da
  // sessão acompanhando a renovação de token do Supabase.
  useEffect(() => {
    bootstrapAutoSave(useCarreteiroStore)
    return ligarRenovacaoDeToken()
  }, [])

  // Storage persistente — defende contra eviction do IndexedDB (perda de fotos
  // pendentes em memory pressure). Chrome Android aceita sem prompt quando PWA
  // está instalado; iOS Safari faz best-effort. Idempotente. Roda uma vez ao
  // estar autenticado.
  useEffect(() => {
    if (!authed) return
    void requestPersistentStorage()
  }, [authed])

  if (!ready) return <Splash />

  return (
    <>
      <NovaVersaoBanner />
      <ReauthBanner />
      {authed && <ToastReconnected />}
      {authed && <IosInstallBanner />}
      <ToastHost />
      <Routes>
        {/* /login: se já autenticado, redireciona pra home no nível de rota.
            Sem isso, há um frame de flicker entre sessionStore.set e useAuth.navigate. */}
        <Route
          path="/login"
          element={authed && tokenValid ? <Navigate to="/" replace /> : <LoginRoute />}
        />
        <Route path="/" element={authed ? <HomeRoute /> : <Navigate to="/login" replace />} />
        <Route path="/producao" element={<ProducaoListRoute />} />
        <Route path="/producao/setup" element={<ProducaoSetupRoute />} />
        <Route path="/producao/session" element={<ProducaoSessionRoute />} />
        <Route path="/carreteiro" element={<CarreteiroIndexRoute />} />
        <Route path="/carreteiro/step0" element={<CarreteiroStep0Route />} />
        <Route path="/carreteiro/step1" element={<CarreteiroStep1Route />} />
        <Route path="/carreteiro/step2" element={<CarreteiroStep2Route />} />
        <Route path="/carreteiro/success" element={<CarreteiroSuccessRoute />} />
        <Route path="/fotos" element={<FotosListRoute />} />
        <Route path="/fotos/capture" element={<FotosCaptureRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
