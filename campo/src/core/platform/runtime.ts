/**
 * O app de campo do InfraWork Web é só PWA (sem o empacotamento Capacitor do Monito). Mantido como função para
 * os pontos que ainda distinguem ambiente.
 */
export function isNative(): boolean {
  return false
}

export function getPlatform(): 'web' {
  return 'web'
}

export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
}
