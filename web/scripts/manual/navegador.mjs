// Abre o InfraWork Web no Playwright já com a sessão e a obra escolhidas, para as capturas do manual.
//   MANUAL_EMAIL, MANUAL_SENHA, MANUAL_EMPRESA, MANUAL_OBRA e [MANUAL_URL=http://localhost:5174]
import { chromium } from 'playwright'

export const URL = process.env.MANUAL_URL ?? 'http://localhost:5174'

export async function abrir({ largura = 1440, altura = 900, tema = 'light', escala = 2, entrar = true } = {}) {
  const browser = await chromium.launch()
  const contexto = await browser.newContext({
    viewport: { width: largura, height: altura },
    deviceScaleFactor: escala,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo'
  })
  // no stack local as Edge Functions assinam URLs com o host interno do Docker
  const api = process.env.MANUAL_API ?? 'http://127.0.0.1:55321'
  await contexto.route('http://kong:8000/**', async (route) => {
    const resposta = await route.fetch({ url: route.request().url().replace('http://kong:8000', api) })
    await route.fulfill({ response: resposta })
  })
  const page = await contexto.newPage()
  await page.addInitScript((t) => localStorage.setItem('infrawork.ui.theme', t), tema)
  page.on('pageerror', (e) => console.log('  [erro na página]', e.message.slice(0, 200)))
  if (entrar) await login(page)
  return { browser, contexto, page }
}

export async function login(page, email = process.env.MANUAL_EMAIL, senha = process.env.MANUAL_SENHA) {
  await page.goto(URL)
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(senha)
  await page.locator('button[type="submit"]').click()
  await page.waitForFunction(() => !document.querySelector('input[type="password"]'), null, {
    timeout: 30000
  })
  await page.evaluate(
    ([empresa, obra]) => {
      const auth = Object.keys(localStorage).find((k) => k.endsWith('.auth.v1'))
      const prefixo = auth.slice(0, -'.auth.v1'.length)
      if (empresa) localStorage.setItem(`${prefixo}.scope.empresaId`, empresa)
      if (obra) localStorage.setItem(`${prefixo}.scope.obraId`, obra)
    },
    [process.env.MANUAL_EMPRESA, process.env.MANUAL_OBRA]
  )
}

/** Espera a página assentar: rede ociosa, sem indicadores de carregamento. */
export async function assentar(page, extra = 900) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page
    .waitForFunction(
      () => !document.querySelector('[aria-busy="true"], .animate-pulse, [data-carregando]'),
      null,
      { timeout: 15000 }
    )
    .catch(() => {})
  await page.waitForTimeout(extra)
}
