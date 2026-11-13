// Sessão do navegador para os roteiros de tela: abre o web, entra e grava o escopo (empresa e obra).
//   E2E_EMAIL=… E2E_PASSWORD=… E2E_EMPRESA_ID=… E2E_OBRA_ID=… [E2E_URL=http://localhost:5174]
import { chromium } from 'playwright'

export const URL_BASE = process.env.E2E_URL ?? 'http://localhost:5174'

export async function abrirSessao({ largura = 1440, altura = 900, tema = 'light' } = {}) {
  const browser = await chromium.launch()
  // contexto explícito: o axe abre uma página auxiliar no mesmo contexto
  const contexto = await browser.newContext({ viewport: { width: largura, height: altura } })
  const page = await contexto.newPage()
  await page.addInitScript((t) => localStorage.setItem('infrawork.ui.theme', t), tema)
  await page.goto(URL_BASE)
  await page.locator('input[type="email"]').fill(process.env.E2E_EMAIL)
  await page.locator('input[type="password"]').fill(process.env.E2E_PASSWORD)
  await page.locator('button[type="submit"]').click()
  await page.waitForFunction(() => !document.querySelector('input[type="password"]'), null, {
    timeout: 20000
  })
  if (process.env.E2E_EMPRESA_ID && process.env.E2E_OBRA_ID) {
    await page.evaluate(
      ([empresa, obra]) => {
        const auth = Object.keys(localStorage).find((k) => k.endsWith('.auth.v1'))
        const prefixo = auth.slice(0, -'.auth.v1'.length)
        localStorage.setItem(`${prefixo}.scope.empresaId`, empresa)
        localStorage.setItem(`${prefixo}.scope.obraId`, obra)
      },
      [process.env.E2E_EMPRESA_ID, process.env.E2E_OBRA_ID]
    )
  }
  return { browser, page }
}
