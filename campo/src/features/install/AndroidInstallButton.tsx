import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { isStandalone } from '@/core/platform/install'

/**
 * Botão discreto pra disparar o install prompt nativo do Chrome Android.
 *
 * Chrome dispara `beforeinstallprompt` quando detecta que o site é PWA-eligible
 * (HTTPS, manifest válido, SW ativo) e ainda não está instalado. O default do
 * Chrome era mostrar uma mini-infobar, mas em versões recentes ele NÃO mostra
 * mais nada por padrão — o site precisa expor o trigger.
 *
 * Esconde quando:
 *  - Já está rodando standalone (instalado)
 *  - Browser não disparou `beforeinstallprompt` (iOS Safari, etc — esses são
 *    cobertos pelo `IosInstallBanner` ou pelo install manual via menu)
 *  - Usuário aceitou ou recusou (após userChoice, evento não dispara de novo
 *    na mesma sessão)
 *
 * Renderizar onde fizer sentido — ex: footer da home, próximo ao logout.
 */

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'monitor_android_install_dismissed_until'

function isSnoozed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const until = Number(raw)
    return Number.isFinite(until) && Date.now() < until
  } catch {
    return false
  }
}

function snoozeFor(days: number) {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + days * 24 * 60 * 60 * 1000))
  } catch {
    /* sem persist */
  }
}

export function AndroidInstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState<boolean>(() => isStandalone())

  useEffect(() => {
    if (installed) return

    function onBeforeInstall(e: Event) {
      // Preveni o mini-infobar default (em browsers antigos) — vamos controlar UI
      e.preventDefault()
      if (isSnoozed()) return
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    function onAppInstalled() {
      setInstalled(true)
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [installed])

  if (installed || !deferredPrompt) return null

  async function handleInstall() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    if (choice.outcome === 'dismissed') {
      // Pausa 7 dias pra não pedir de novo na próxima sessão
      snoozeFor(7)
    }
    // Evento `beforeinstallprompt` só dispara uma vez por sessão — esvazia
    setDeferredPrompt(null)
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void handleInstall()}
      className="gap-1.5"
      aria-label="Instalar app"
    >
      <Download className="h-4 w-4" />
      Instalar
    </Button>
  )
}
