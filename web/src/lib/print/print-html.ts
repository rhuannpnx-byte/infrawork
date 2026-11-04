/**
 * "Exportar PDF" no browser: carrega o HTML auto-contido do relatório num
 * iframe oculto e abre o diálogo de impressão (Salvar como PDF). O próprio HTML
 * traz `@page { size: A4 landscape; margin: 9mm }`, honrado pelo Chrome/Edge.
 * O nome sugerido do arquivo vem do `<title>` do documento.
 */
export async function printHtmlToPdf(html: string, title: string): Promise<void> {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.opacity = '0'

  const safeTitle = title.replace(/[<>&]/g, '')
  const doc = html.includes('<title>')
    ? html
    : html.replace(/<head([^>]*)>/i, `<head$1><title>${safeTitle}</title>`)

  const loaded = new Promise<void>((resolve) => {
    iframe.addEventListener('load', () => resolve(), { once: true })
  })
  iframe.srcdoc = doc
  document.body.appendChild(iframe)
  await loaded

  const win = iframe.contentWindow
  const idoc = iframe.contentDocument
  if (!win || !idoc) {
    iframe.remove()
    throw new Error('Não foi possível preparar o documento para impressão.')
  }

  // Aguarda decode das imagens (logo embutida) antes de imprimir.
  const imgs = Array.from(idoc.images)
  await Promise.all(
    imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined)))
  )
  await new Promise((r) => setTimeout(r, 200))

  const cleanup = (): void => {
    setTimeout(() => iframe.remove(), 500)
  }
  win.addEventListener('afterprint', cleanup, { once: true })
  win.focus()
  win.print()
  // Safari não dispara afterprint de forma confiável — fallback.
  setTimeout(cleanup, 60_000)
}
