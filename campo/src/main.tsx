import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import './index.css'

// Service Worker do PWA (app shell offline). Em dev fica desligado (vite.config).
void import('virtual:pwa-register').then(({ registerSW }) => {
  registerSW({ immediate: true })
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
