import '@fontsource-variable/archivo/wght.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { avisarNovaVersao } from '@/core/pwa/novaVersao'
import './index.css'

// Service Worker do PWA (app shell offline). Em dev fica desligado (vite.config).
void import('virtual:pwa-register').then(({ registerSW }) => {
  const atualizar = registerSW({
    immediate: true,
    onNeedRefresh: () => avisarNovaVersao(atualizar),
    // O navegador só procura SW novo ao navegar; o PWA instalado fica aberto por dias. Procura a cada hora e ao
    // voltar para o app (no máximo a cada 10 min) — a faixa "Nova versão disponível" aparece sem reinstalar.
    onRegisteredSW: (_url, reg) => {
      if (!reg) return
      let ultima = Date.now()
      const procurar = () => {
        if (!navigator.onLine || Date.now() - ultima < 10 * 60_000) return
        ultima = Date.now()
        void reg.update().catch(() => undefined)
      }
      setInterval(() => {
        ultima = 0
        procurar()
      }, 60 * 60_000)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') procurar()
      })
    },
  })
})

// Cliente de queries global. staleTime conservador para catálogos (revalidação automática
// só quando o usuário volta ao app — somado ao SW e ao syncEngine.ts isso é suficiente).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min
      gcTime: 24 * 60 * 60 * 1000, // 24h em memória
      retry: 1,
      refetchOnWindowFocus: false, // syncEngine controla refetch
    },
    mutations: {
      retry: 0, // outbox cuida do retry — não duplicar
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
