// Capturas das telas: entra no web e fotografa cada rota do menu num tema, para revisão visual.
//   E2E_EMAIL=… E2E_PASSWORD=… E2E_EMPRESA_ID=… E2E_OBRA_ID=… [E2E_URL=http://localhost:5174]
//   [E2E_TEMA=light|dark] [E2E_SAIDA=capturas] [E2E_ROTAS=/,/orcamento] [E2E_LARGURA=1440] node scripts/capturas-telas.mjs
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { ROTAS } from './rotas-telas.mjs'

const URL = process.env.E2E_URL ?? 'http://localhost:5174'
const TEMA = process.env.E2E_TEMA === 'dark' ? 'dark' : 'light'
const SAIDA = process.env.E2E_SAIDA ?? 'capturas'
const LARGURA = Number(process.env.E2E_LARGURA ?? 1440)
const rotas = process.env.E2E_ROTAS ? process.env.E2E_ROTAS.split(',') : ROTAS

mkdirSync(SAIDA, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: LARGURA, height: 900 } })
await page.addInitScript((tema) => localStorage.setItem('infrawork.ui.theme', tema), TEMA)

await page.goto(URL)
if (process.env.E2E_LOGIN_SHOT) {
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(SAIDA, `${TEMA}__login.png`) })
}
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

for (const rota of rotas) {
  await page.goto(`${URL}${rota}`)
  await page.waitForTimeout(Number(process.env.E2E_ESPERA ?? 2200))
  const nome = rota === '/' ? 'inicio' : rota.slice(1).replace(/[/:]/g, '_').slice(0, 60)
  await page.screenshot({ path: join(SAIDA, `${TEMA}__${nome}.png`) })
  console.log(`${TEMA} ${rota}`)
}
await browser.close()
