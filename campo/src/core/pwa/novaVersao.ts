/** Service worker novo pronto (registerType 'prompt'): main.tsx avisa; o NovaVersaoBanner oferece "Atualizar". */
let atualizar: ((reload?: boolean) => Promise<void>) | null = null

export function avisarNovaVersao(fn: (reload?: boolean) => Promise<void>): void {
  atualizar = fn
  window.dispatchEvent(new Event('campo:nova-versao'))
}

export function haNovaVersao(): boolean {
  return atualizar != null
}

export function aplicarNovaVersao(): void {
  void atualizar?.(true)
}
