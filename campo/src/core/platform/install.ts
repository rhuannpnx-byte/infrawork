/**
 * Detecção de plataforma para o banner "Adicionar à Tela de Início".
 *
 * iOS Safari NÃO dispara `beforeinstallprompt` — único caminho de instalação é
 * Compartilhar → Adicionar à Tela de Início. Mostramos um banner customizado para
 * orientar o usuário; é silenciado se já estiver instalado (standalone mode).
 */

export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPhone/iPad/iPod (excluindo Chrome iOS que tem 'CriOS')
  const isIosDevice =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+: identifica como Mac com touch
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))
  const isSafari = !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
  return isIosDevice && isSafari
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS legacy
  const navi = navigator as Navigator & { standalone?: boolean }
  return navi.standalone === true
}

const DISMISS_KEY = 'monitor_ios_install_dismissed_until'

export function shouldShowIosBanner(): boolean {
  if (!isIosSafari()) return false
  if (isStandalone()) return false
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (raw) {
      const until = parseInt(raw, 10)
      if (Number.isFinite(until) && Date.now() < until) return false
    }
  } catch {
    /* localStorage indisponível */
  }
  return true
}

export function dismissIosBannerFor(days: number) {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + days * 24 * 60 * 60 * 1000))
  } catch {
    /* sem persist */
  }
}
