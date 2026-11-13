import { useEffect, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useUIStore } from '@/stores/ui-store'
import { useTabsStore } from '@/stores/tabs-store'
import { useAuthStore } from '@/stores/auth-store'
import { MODULES } from '@/config/modules'

// Sequência "g + letra" → chave do módulo (não a rota), tirada do atalho declarado em config/modules.ts. Abre via
// openModule, conferindo o papel, para ninguém pular para um módulo oculto (ex.: cliente). "g h" é o Início.
const GO_SEQUENCE_MAP: Record<string, string> = Object.fromEntries([
  ['h', 'home'],
  ...MODULES.map((m) => [m.shortcut.split(' ')[1], m.key])
])

const TIMEOUT_MS = 800

export function useShortcuts(): void {
  const openModal = useUIStore((s) => s.openModal)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)

  const waitingForG = useRef(false)
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cmd/Ctrl + K — command palette
  useHotkeys('mod+k', (e) => {
    e.preventDefault()
    openModal('commandPalette')
  })

  // Cmd/Ctrl + B — toggle sidebar
  useHotkeys('mod+b', (e) => {
    e.preventDefault()
    toggleSidebar()
  })

  // ─── Vim-style sequence "G + letter" ──────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      const editable = (e.target as HTMLElement | null)?.isContentEditable
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (waitingForG.current) {
        const modKey = GO_SEQUENCE_MAP[e.key.toLowerCase()]
        if (modKey) {
          const role = useAuthStore.getState().profile?.role ?? null
          const mod = MODULES.find((m) => m.key === modKey)
          const visivel =
            modKey === 'home' ||
            (!!mod && (!mod.requiredRoles || (!!role && mod.requiredRoles.includes(role))))
          if (visivel) {
            e.preventDefault()
            useUIStore.getState().setSidebarOpen(true)
            useTabsStore.getState().openModule(modKey)
          }
        }
        waitingForG.current = false
        if (gTimer.current) clearTimeout(gTimer.current)
        gTimer.current = null
        return
      }

      // pelo caractere, não pela tecla: no teclado ABNT2 o "?" não fica na tecla da barra
      if (e.key === '?') {
        e.preventDefault()
        useUIStore.getState().openModal('shortcuts')
        return
      }

      if (e.key.toLowerCase() === 'g') {
        waitingForG.current = true
        gTimer.current = setTimeout(() => {
          waitingForG.current = false
          gTimer.current = null
        }, TIMEOUT_MS)
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (gTimer.current) clearTimeout(gTimer.current)
    }
  }, [])
}
