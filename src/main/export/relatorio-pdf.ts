// Imprime o HTML auto-contido do relatório por serviço (montado no renderer) em
// PDF, via uma janela oculta + webContents.printToPDF. `preferCSSPageSize`
// respeita o `@page { size: A4 landscape; margin: 9mm }` do próprio HTML —
// mesmo resultado do Chrome --print-to-pdf usado na validação.

import { BrowserWindow, app } from 'electron'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export async function gerarRelatorioPdf(html: string, destino: string): Promise<void> {
  // HTML grande (logo embutida × N páginas) estoura o limite de data: URL,
  // então gravamos num arquivo temporário e carregamos via loadFile.
  const tmp = join(app.getPath('temp'), `infrawork-relatorio-${Date.now()}.html`)
  await writeFile(tmp, html, 'utf8')

  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: false, javascript: false }
  })
  try {
    await win.loadFile(tmp)
    // pequena folga p/ layout + decode da imagem antes de imprimir
    await new Promise((r) => setTimeout(r, 200))
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true
    })
    await writeFile(destino, pdf)
  } finally {
    win.destroy()
    await unlink(tmp).catch(() => {})
  }
}
