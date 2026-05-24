import { useEffect } from 'react'
import { toast } from 'sonner'

/**
 * Listener para eventos de auto-update vindos do main process.
 * - update:available  → toast informando que o download começou
 * - update:downloaded → toast persistente com botão "Reiniciar agora"
 *
 * O electron-updater é configurado no main process (`src/main/index.ts`) e só
 * roda em builds empacotados — em dev as APIs simplesmente não disparam eventos.
 */
export function useUpdateNotifier(): void {
  useEffect(() => {
    const api = window.infrawork?.updater
    if (!api) return

    const offAvailable = api.onAvailable(({ version }) => {
      toast.info(`Atualização disponível (v${version})`, {
        description: 'Baixando em segundo plano…',
        duration: 5000
      })
    })

    const offDownloaded = api.onDownloaded(({ version }) => {
      toast.success(`Atualização v${version} pronta`, {
        description: 'Reinicie o app para aplicar.',
        duration: Infinity,
        action: {
          label: 'Reiniciar agora',
          onClick: () => api.quitAndInstall()
        }
      })
    })

    return () => {
      offAvailable()
      offDownloaded()
    }
  }, [])
}
