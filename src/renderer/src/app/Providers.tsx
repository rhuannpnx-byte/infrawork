import { type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { useShortcuts } from '@/hooks/useShortcuts'
import { queryClient } from '@/lib/query-client'
import { AuthGate } from './AuthGate'
import { AppShell } from '@/components/layout/AppShell'
import { TabViewport } from './TabViewport'
import { Modals } from '@/components/modals/Modals'
import { IngestaoStatus } from '@/features/documentacao/components/IngestaoStatus'

function ShortcutsBoot(): null {
  useShortcuts()
  return null
}

export function Providers(): ReactNode {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <ShortcutsBoot />
        <AppShell>
          <TabViewport />
        </AppShell>
        <Modals />
        <IngestaoStatus />
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
