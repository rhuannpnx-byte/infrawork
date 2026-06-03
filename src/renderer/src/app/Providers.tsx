import { useState, type ReactNode } from 'react'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster, toast } from 'sonner'
import { useShortcuts } from '@/hooks/useShortcuts'
import { AuthGate } from './AuthGate'
import { AppShell } from '@/components/layout/AppShell'
import { TabViewport } from './TabViewport'
import { Modals } from '@/components/modals/Modals'

function ShortcutsBoot(): null {
  useShortcuts()
  return null
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return 'Erro desconhecido'
  }
}

export function Providers(): ReactNode {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1
          }
        },
        // Mutation falhada sem .onError local nao some no console: vira toast
        // tecnico (PRODUCT.md: "Mensagens vao ao ponto").
        mutationCache: new MutationCache({
          onError: (err, _vars, _ctx, mutation) => {
            // Quando a mutation define seu proprio onError, deixa ele assumir.
            if (mutation.options.onError) return

            console.error('[mutation]', err)
            toast.error(`Falha: ${describeError(err)}`)
          }
        }),
        // Erros de fetch (query) que escaparam de .onError tambem aparecem.
        queryCache: new QueryCache({
          onError: (err, query) => {
            if (query.options.meta?.silent) return

            console.error('[query]', err)
          }
        })
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <ShortcutsBoot />
        <AppShell>
          <TabViewport />
        </AppShell>
        <Modals />
      </AuthGate>
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: 'var(--bg-elevated)',
            color: 'var(--text)',
            border: '1px solid var(--border-strong)',
            fontSize: '12px',
            fontFamily: '"IBM Plex Sans", system-ui'
          }
        }}
      />
    </QueryClientProvider>
  )
}
