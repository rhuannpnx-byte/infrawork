// Fumaça das telas: entra no web e abre cada rota do menu, acusando erro de página, de console e tela de erro.
//   E2E_EMAIL=… E2E_PASSWORD=… E2E_EMPRESA_ID=… E2E_OBRA_ID=… [E2E_URL=http://localhost:5174] node scripts/fumaca-telas.mjs
import { chromium } from 'playwright'
import { ROTAS } from './rotas-telas.mjs'

const URL = process.env.E2E_URL ?? 'http://localhost:5174'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const erros = []
let rotaAtual = 'login'
page.on('pageerror', (e) => erros.push(`${rotaAtual}: erro de página — ${e.message}`))
const ruins = new Set()
page.on('response', (r) => {
  if (r.status() < 400 || r.url().includes('/.well-known/')) return
  const linha = `${r.status()} ${r.request().method()} ${r.url().split('?')[0]}`
  ruins.add(linha)
  erros.push(`${rotaAtual}: resposta ${linha}`)
})
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  // avisos de aninhamento de HTML do React em desenvolvimento não são erro de execução
  if (
    /favicon|net::ERR_ABORTED|Failed to load resource|cannot be a descendant of|cannot contain a nested/i.test(
      t
    )
  )
    return
  erros.push(`${rotaAtual}: console — ${t.slice(0, 200)}`)
})

await page.goto(URL)
await page.locator('input[type="email"]').fill(process.env.E2E_EMAIL)
await page.locator('input[type="password"]').fill(process.env.E2E_PASSWORD)
await page.locator('button[type="submit"]').click()
await page.waitForFunction(() => !document.querySelector('input[type="password"]'), null, {
  timeout: 20000
})

// escopo (o god entra sem empresa/obra): grava as chaves que o app lê do localStorage
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

let falhas = 0
for (const rota of ROTAS) {
  rotaAtual = rota
  const antes = erros.length
  await page.goto(`${URL}${rota}`)
  await page.waitForTimeout(1800)
  const corpo = (await page.locator('body').innerText()).slice(0, 4000)
  const telaDeErro =
    /algo deu errado|something went wrong|erro inesperado|unexpected application error/i.test(corpo)
  const semObra = /selecione uma (obra|empresa)/i.test(corpo)
  const novos = erros.slice(antes)
  const ok = !telaDeErro && !semObra && novos.length === 0
  if (!ok) falhas++
  console.log(
    `${ok ? '✓' : '✗'} ${rota}${semObra ? ' (sem obra selecionada)' : ''}${telaDeErro ? ' — TELA DE ERRO' : ''}${novos.length ? ` — ${novos.length} erro(s)` : ''}`
  )
  for (const e of novos) console.log(`    ${e}`)
}
await page.screenshot({ path: process.env.E2E_SHOT ?? 'fumaca.png' })
await browser.close()
if (ruins.size) console.log('\nRespostas com erro:\n  ' + [...ruins].join('\n  '))
console.log(falhas ? `\n${falhas} TELA(S) COM PROBLEMA` : '\nTUDO OK')
process.exit(falhas ? 1 : 0)
