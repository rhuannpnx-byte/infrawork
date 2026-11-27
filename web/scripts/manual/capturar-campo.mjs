// Capturas do manual do aplicativo de campo, num celular simulado (390 × 844), seguindo os fluxos de verdade.
//   CAMPO_EMAIL=… CAMPO_SENHA=… [CAMPO_ENG_EMAIL=… CAMPO_ENG_SENHA=…] [CAMPO_URL=http://localhost:5175]
//   [CAMPO_VIDEO=quadro.y4m] node scripts/manual/capturar-campo.mjs [etapas]
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, 'imagens/campo')
mkdirSync(SAIDA, { recursive: true })
const URL = process.env.CAMPO_URL ?? 'http://localhost:5175'
const etapas = (process.argv[2] ?? 'acesso,producao,viagens,fotos,painel').split(',')

const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
if (process.env.CAMPO_VIDEO) args.push(`--use-file-for-fake-video-capture=${process.env.CAMPO_VIDEO}`)
const browser = await chromium.launch({ args })

async function celular() {
  const contexto = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2.5,
    isMobile: true,
    hasTouch: true,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    permissions: ['geolocation', 'camera'],
    geolocation: { latitude: -16.6352, longitude: -49.0141, accuracy: 6 },
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
  })
  const page = await contexto.newPage()
  page.on('pageerror', (e) => console.log('  [erro na página]', e.message.slice(0, 160)))
  return page
}
const foto = (page, nome) => page.screenshot({ path: join(SAIDA, `${nome}.jpg`), type: 'jpeg', quality: 90 })
const espera = (page, ms = 1200) => page.waitForTimeout(ms)
const toque = async (page, nome, opcoes = {}) => {
  await page.getByRole('button', { name: nome, exact: opcoes.exact ?? false }).first().click()
  await espera(page, opcoes.espera ?? 900)
}

async function entrar(page, email, senha) {
  await page.goto(URL)
  await espera(page, 1500)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await toque(page, 'Entrar', { exact: true, espera: 1500 })
  // obra: a de demonstração, se houver mais de uma liberada
  await page.waitForFunction(() => /Funciona sem sinal|liberadas?$/m.test(document.body.innerText), null, {
    timeout: 60000
  })
  const seletor = page.getByText('Selecionar obra')
  if (await seletor.count()) {
    await seletor.first().click()
    await espera(page)
    await page.getByText('BR-000').first().click()
    await espera(page, 2500)
  }
  await page.waitForFunction(() => document.body.innerText.includes('Funciona sem sinal'), null, { timeout: 60000 })
  await espera(page, 1000)
}

const page = await celular()
let atual = page
try {
  if (etapas.includes('acesso')) {
    await page.goto(URL)
    await espera(page, 2000)
    await foto(page, 'login')
  }
  await entrar(page, process.env.CAMPO_EMAIL, process.env.CAMPO_SENHA)
  if (etapas.includes('acesso')) await foto(page, 'inicio')

  if (etapas.includes('producao')) {
    await page.getByText('Produção', { exact: true }).first().click()
    await espera(page, 1500)
    await toque(page, 'Nova sessão', { espera: 1500 })
    await page.getByText('Selecionar…').first().click()
    await espera(page)
    await page.getByText('Roberto Souza').first().click()
    await espera(page, 1200)
    await foto(page, 'producao-nova')
    await toque(page, 'Continuar', { exact: true, espera: 1500 })
    await toque(page, 'Adicionar serviço', { espera: 1200 })
    await page.getByText(/Base de brita graduada/).first().click()
    await espera(page, 1200)
    await page.getByLabel(/Quantidade executada/).fill('186,5')
    const qmat = page.getByLabel(/Quantidade de material/)
    if (await qmat.count()) await qmat.fill('233')
    await page.getByText(/^Selecionar/).last().click()
    await espera(page, 900)
    await page.getByText(/Trecho 1/).first().click()
    await espera(page, 900)
    await page.getByLabel(/Estaca inicial/i).first().fill('458')
    await page.getByLabel(/Estaca final/i).first().fill('466')
    await page.getByLabel(/Observação/i).first().click().catch(() => {})
    await espera(page, 600)
    await foto(page, 'producao-lancamento')
    await toque(page, 'Adicionar lançamento', { espera: 1500 })
    await toque(page, /Finalizar sessão/, { espera: 4000 })
    await foto(page, 'producao-enviada')
    await foto(page, 'producao-lista')
  }

  if (etapas.includes('viagens')) {
    await page.goto(URL)
    await espera(page, 2000)
    await page.getByText('Viagens', { exact: true }).first().click()
    await espera(page, 1500)
    await toque(page, 'Nova ficha', { espera: 1500 })
    await page.getByText(/^Selecionar/).first().click()
    await espera(page)
    await page.getByText(/CB-01/).first().click()
    await espera(page)
    await page.getByLabel('Motorista').fill('José Almeida')
    await espera(page, 600)
    await foto(page, 'viagens-ficha')
    await toque(page, 'Continuar para as viagens', { espera: 1500 })
    const viagem = async (estaca, carga, descarga) => {
      await toque(page, 'Nova viagem', { espera: 1500 })
      const sel = page.getByText(/^Selecionar/)
      if (await sel.count()) {
        await sel.first().click()
        await espera(page)
        await page.getByText(/Pista — Trecho 1/).first().click()
        await espera(page)
        await page.getByText(/^Selecionar/).first().click()
        await espera(page)
        await page.getByText(/Bota-fora Km 5/).first().click()
        await espera(page)
      }
      await page.getByLabel(/Estaca de carga/).fill(estaca)
      await page.getByLabel('Hora da carga').fill(carga)
      await page.getByLabel('Hora da descarga').fill(descarga)
      await page.getByLabel(/^Quantidade/).fill('12')
      await page.getByLabel(/NF \/ ticket/i).click()
      await espera(page, 900)
    }
    await viagem('122+10', '07:10', '07:42')
    await foto(page, 'viagens-viagem')
    await toque(page, 'Adicionar viagem', { espera: 1200 })
    await viagem('123', '07:55', '08:24')
    await toque(page, 'Adicionar viagem', { espera: 1200 })
    await viagem('123+10', '08:40', '09:11')
    await toque(page, 'Adicionar viagem', { espera: 1200 })
    await toque(page, /^Revisar/, { espera: 1500 })
    await foto(page, 'viagens-revisar')
    await toque(page, 'Gravar ficha', { espera: 4000 })
    await toque(page, 'Ver fichas', { espera: 1500 })
    await foto(page, 'viagens-lista')
  }
  if (etapas.includes('fotos')) {
    await page.goto(URL)
    await espera(page, 2000)
    await page.getByText('Fotos', { exact: true }).first().click()
    await espera(page, 1500)
    await toque(page, 'Tirar foto', { espera: 4000 })
    await page.waitForFunction(() => /GPS ±/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {})
    await espera(page, 1500)
    await foto(page, 'fotos-camera')
    await page.getByRole('button', { name: 'Tirar foto', exact: true }).click()
    await page.getByAltText("Foto com marca d'água").waitFor({ timeout: 30000 })
    await page.getByRole('button', { name: /^Serviço/ }).click()
    await espera(page)
    await page.getByText(/Base de brita graduada/).first().click()
    await espera(page)
    await page.getByRole('button', { name: /^Encarregado/ }).click()
    await espera(page)
    await page.getByText('Roberto Souza').first().click()
    await espera(page)
    await page.getByLabel('Observações').fill('Base concluída entre as estacas 458 e 466, liberada para imprimação.')
    await page.getByLabel('Observações').blur()
    await page.waitForFunction(() => !document.body.innerText.includes('Atualizando…'), null, { timeout: 30000 })
    await espera(page, 1500)
    await foto(page, 'fotos-conferir')
  }

  if (etapas.includes('painel') && process.env.CAMPO_ENG_EMAIL) {
    const eng = await celular()
    atual = eng
    await entrar(eng, process.env.CAMPO_ENG_EMAIL, process.env.CAMPO_ENG_SENHA)
    await eng.getByText('Visão estratégica').first().click()
    await eng.waitForFunction(() => /Avanço físico/i.test(document.body.innerText), null, { timeout: 60000 })
    await espera(eng, 2500)
    await foto(eng, 'painel-resumo')
    await eng.getByText('Serviços', { exact: true }).last().click()
    await espera(eng, 2000)
    await foto(eng, 'painel-servicos')
    await eng.getByText('Produção', { exact: true }).last().click()
    await espera(eng, 2500)
    await foto(eng, 'painel-producao')
  }
} catch (e) {
  console.log('FALHA:', String(e.message).split('\n')[0].slice(0, 200))
  await atual.screenshot({ path: join(SAIDA, '_falha.jpg'), type: 'jpeg' })
}
await browser.close()
