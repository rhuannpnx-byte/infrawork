import { useEffect, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useUIStore } from '@/stores/ui-store'
import { useTabsStore } from '@/stores/tabs-store'
import { useAuthStore } from '@/stores/auth-store'
import { MODULES } from '@/config/modules'

// Sequência "g + letra" → chave do módulo (não a rota): abrimos via openModule,
// gateado por papel, para o papel não pular para módulos ocultos (ex.: cliente).
const GO_SEQUENCE_MAP: Record<string, string> = {
  g: 'gerencial'
  // Demais módulos voltarão aqui quando forem implementados.
}

const TIMEOUT_MS = 800

export function useShortcuts(): void {
  const openModal = useUIStore((s) => s.openModal)
  const closeModal = useUIStore((s) => s.closeModal)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const closeActiveTab = useTabsStore((s) => s.closeTab)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const cycleActive = useTabsStore((s) => s.cycleActive)
  const reopenLastClosed = useTabsStore((s) => s.reopenLastClosed)

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

  // Cmd/Ctrl + W — close current tab
  useHotkeys('mod+w', (e) => {
    e.preventDefault()
    if (activeTabId) closeActiveTab(activeTabId)
  })

  // Cmd/Ctrl + Shift + T — reopen last closed
  useHotkeys('mod+shift+t', (e) => {
    e.preventDefault()
    reopenLastClosed()
  })

  // Cmd/Ctrl + 1..9 — switch tab (cycle by index)
  useHotkeys('mod+1, mod+2, mod+3, mod+4, mod+5, mod+6, mod+7, mod+8, mod+9', (e, handler) => {
    e.preventDefault()
    const key = handler.keys?.find((k) => /^\d$/.test(k))
    const n = key ? parseInt(key, 10) : NaN
    if (!Number.isFinite(n)) return
    const { tabs, setActive } = useTabsStore.getState()
    const tab = tabs[n - 1]
    if (tab) setActive(tab.id)
  })

  // ? — keyboard shortcuts overlay
  useHotkeys('shift+slash, ?', (e) => {
    e.preventDefault()
    openModal('shortcuts')
  })

  // Esc — close topmost modal
  useHotkeys('escape', () => {
    const { activeModals } = useUIStore.getState()
    const last = Array.from(activeModals).pop()
    if (last) closeModal(last)
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
          const visivel = !!mod && (!mod.requiredRoles || (!!role && mod.requiredRoles.includes(role)))
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

  // Side effect: ensure all module shortcuts are registered (for display)
  void MODULES
  void cycleActive
}
