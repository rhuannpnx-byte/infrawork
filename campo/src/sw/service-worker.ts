/// <reference lib="webworker" />
import {
  createHandlerBoundToURL,
  precacheAndRoute,
  cleanupOutdatedCaches,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope

// Versão nova espera o operador tocar em "Atualizar" (mensagem SKIP_WAITING, abaixo) — antes pulava a espera
// sozinha e o app recarregava no meio de um lançamento. Ao ativar, assume as abas abertas.
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// vite-plugin-pwa injeta a lista de assets aqui em build time
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// =============================================================================
//  App Shell — SPA navega para index.html cacheado (OFFLINE-FIRST)
//
//  Padrão oficial Workbox pra SPA: `createHandlerBoundToURL('/index.html')`
//  serve index.html DIRETO do precache em qualquer navegação não-asset.
//  React Router cuida da rota interna depois que index.html carrega.
//
//  Antes (bug 2026-05-24): usava `NetworkOnly` aqui — sem rede, navegação falhava
//  sem fallback. App shell estava precacheado mas inacessível offline. Operador
//  fechava o PWA no campo e não conseguia reabrir.
//
//  Agora: index.html SEMPRE vem do cache. Atualização de versão do bundle
//  acontece via `autoUpdate` do vite-plugin-pwa (skipWaiting + clientsClaim) —
//  o registerSW chama no reload com SW novo.
// =============================================================================
const navigationRoute = new NavigationRoute(createHandlerBoundToURL('/index.html'), {
  // assets com hash não são navegação
  denylist: [/^\/assets\//, /\.[a-f0-9]{8}\./],
})
registerRoute(navigationRoute)

// =============================================================================
//  Estáticos (fontes, imagens) — cache first
// =============================================================================
registerRoute(
  ({ request }) => request.destination === 'font' || request.destination === 'image',
  new CacheFirst({
    cacheName: 'campo-static-v1',
  }),
)

// =============================================================================
//  Dados (Supabase): sem cache nem replay no SW. O Dexie é a única fonte offline e
//  o motor de envio do app (foregroundSync) é dono do estado das filas — todas as
//  gravações são idempotentes pelos uuids gerados no aparelho.
// =============================================================================

// =============================================================================
//  Mensagens do app (skip waiting para atualizar SW após confirmação do usuário)
// =============================================================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
