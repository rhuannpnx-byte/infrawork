import { useEffect, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { useShortcuts } from '@/hooks/useShortcuts'
import { queryClient } from '@/lib/query-client'
import { AuthGate } from './AuthGate'
import { AppShell } from '@/components/layout/AppShell'
import { TabViewport } from './TabViewport'
import { Modals } from '@/components/modals/Modals'
import { installUrlSync } from './url-sync'
import { useThemeStore } from '@/stores/theme-store'

function ShortcutsBoot(): null {
  useShortcuts()
  return null
}

/** Espelha a aba ativa na URL do browser (só depois do login). */
function UrlSyncBoot(): null {
  useEffect(() => installUrlSync(), [])
  return null
}

export function Providers(): ReactNode {
  const tema = useThemeStore((s) => s.tema)
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <ShortcutsBoot />
        <UrlSyncBoot />
        <AppShell>
          <TabViewport />
        </AppShell>
        <Modals />
      </AuthGate>
      <Toaster
        position="bottom-right"
        theme={tema}
        toastOptions={{
          style: {
            background: 'var(--bg-elevated)',
            color: 'var(--text)',
            border: '1px solid var(--border-strong)',
            fontSize: '13px',
            fontFamily: '"Archivo Variable", Archivo, system-ui'
          }
        }}
      />
    </QueryClientProvider>
  )
}
