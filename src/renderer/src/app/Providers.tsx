import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { Toaster } from 'sonner'
import { router } from './router'
import { useShortcuts } from '@/hooks/useShortcuts'
import { AuthGate } from './AuthGate'

function ShortcutsBoot(): null {
  useShortcuts()
  return null
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
        }
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <ShortcutsBoot />
        <RouterProvider router={router} />
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
