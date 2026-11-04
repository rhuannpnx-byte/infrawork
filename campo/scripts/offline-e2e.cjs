/**
 * E2E offline do InfraWork (PWA) — duas fases com o MESMO perfil de navegador:
 *   node offline-e2e.cjs online    → servidores no ar: loga (sessão dev), espera SW + catálogos + pré-carga
 *   node offline-e2e.cjs offline   → servidores DERRUBADOS: reabre o app e percorre os módulos
 * Nunca volta a ficar online com outbox cheio (o backend local escreve no SIGA real).
 */
const puppeteer = require('puppeteer-core')
const fs = require('fs')
const path = require('path')

const phase = process.argv[2]
const BASE = 'https://localhost:5174'
const PROFILE = path.join(require('os').tmpdir(), 'iwp-' + (process.env.E2E_RUN || '1'))
const SHOTS = path.join(__dirname, 'shots')
// Sessão dev: cd backend && npx tsx --env-file=.env scripts/mint-dev-session.ts 223 > sessao.json ; E2E_SESSION=caminho/sessao.json
const session = JSON.parse(fs.readFileSync(process.env.E2E_SESSION || path.join(__dirname, 'session.json'), 'utf8'))
fs.mkdirSync(SHOTS, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)
const results = []
function check(nome, ok, detalhe = '') {
  results.push({ nome, ok, detalhe })
  log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${detalhe ? ' — ' + detalhe : ''}`)
}

async function shot(page, nome) {
  await page.screenshot({ path: path.join(SHOTS, `${phase}-${nome}.png`) }).catch(() => {})
}
async function texto(page) {
  return page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n').trim())
}
async function clickText(page, text, { exact = false } = {}) {
  const ok = await page.evaluate(
    (text, exact) => {
      const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase()
      const els = [...document.querySelectorAll('button, a, [role=button]')].filter((e) => e.getClientRects().length > 0 && !e.disabled)
      const m = els.filter((e) => (exact ? norm(e.innerText) === norm(text) : norm(e.innerText).includes(norm(text))))
      if (!m.length) return false
      m.sort((a, b) => a.innerText.length - b.innerText.length)
      m[0].click()
      return true
    },
    text,
    exact,
  )
  await sleep(700)
  return ok
}
/** Itens do PickerSheet aberto (último overlay fixo). */
async function picker(page) {
  return page.evaluate(() => {
    const overlays = [...document.querySelectorAll('.fixed.inset-0')]
    const o = overlays[overlays.length - 1]
    if (!o) return null
    const title = o.querySelector('h2')?.innerText ?? ''
    const items = [...o.querySelectorAll('ul li button')].map((b) => b.innerText.replace(/\s+/g, ' ').trim())
    return { title, count: items.length, amostra: items.slice(0, 4), vazio: o.innerText.replace(/\s+/g, ' ').slice(0, 200) }
  })
}
async function pick(page, predicate) {
  const idx = await page.evaluate((src) => {
    const overlays = [...document.querySelectorAll('.fixed.inset-0')]
    const o = overlays[overlays.length - 1]
    const btns = [...(o?.querySelectorAll('ul li button') ?? [])]
    const fn = src ? new Function('t', `return (${src})(t)`) : () => true
    const i = btns.findIndex((b) => fn(b.innerText))
    const alvo = btns[i >= 0 ? i : 0]
    if (!alvo) return -1
    alvo.click()
    return i >= 0 ? i : 0
  }, predicate ? predicate.toString() : null)
  await sleep(900)
  return idx
}
async function pickIndex(page, i) {
  await page.evaluate((i) => {
    const o = [...document.querySelectorAll('.fixed.inset-0')].pop()
    o?.querySelectorAll('ul li button')[i]?.click()
  }, i)
  await sleep(900)
}
/** Escolhe o item com MAIS lançamentos (é o que a pré-carga de contexto prioriza). */
async function pickMaisLancamentos(page) {
  const escolhido = await page.evaluate(() => {
    const o = [...document.querySelectorAll('.fixed.inset-0')].pop()
    const btns = [...(o?.querySelectorAll('ul li button') ?? [])]
    let melhor = null
    let max = -1
    for (const b of btns) {
      const m = b.innerText.match(/(\d+) lançamento/)
      if (m && !/EPP/.test(b.innerText) && Number(m[1]) > max) {
        max = Number(m[1])
        melhor = b
      }
    }
    if (!melhor) return null
    const t = melhor.innerText.replace(/\s+/g, ' ')
    melhor.click()
    return t
  })
  await sleep(900)
  return escolhido
}
async function setInput(page, seletor, indice, valor) {
  return page.evaluate(
    (seletor, indice, valor) => {
      const o = [...document.querySelectorAll('.fixed.inset-0')].pop() ?? document
      const el = o.querySelectorAll(seletor)[indice]
      if (!el) return false
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, valor)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    },
    seletor,
    indice,
    valor,
  )
}
/** Lê o valor mostrado no campo somente-leitura "INÍCIO" do formulário da linha. */
async function lerInicio(page) {
  return page.evaluate(() => {
    const o = [...document.querySelectorAll('.fixed.inset-0')].pop()
    if (!o) return null
    const linhas = o.innerText.split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean)
    const i = linhas.findIndex((x) => x.toUpperCase() === 'INÍCIO')
    return i >= 0 ? (linhas[i + 1] ?? null) : null
  })
}
async function apagarContextosEmCache(page) {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases()
    let apagados = 0
    for (const d of dbs) {
      await new Promise((res) => {
        const req = indexedDB.open(d.name)
        req.onsuccess = () => {
          const db = req.result
          if (![...db.objectStoreNames].includes('cache_parte_diaria')) return db.close(), res()
          const st = db.transaction('cache_parte_diaria', 'readwrite').objectStore('cache_parte_diaria')
          const c = st.openCursor()
          c.onsuccess = () => {
            const cur = c.result
            if (!cur) return db.close(), res()
            if (String(cur.key).startsWith('contexto:')) {
              cur.delete()
              apagados++
            }
            cur.continue()
          }
        }
        req.onerror = () => res()
      })
    }
    return apagados
  })
}
async function contarOutbox(page) {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases()
    const out = {}
    for (const d of dbs) {
      await new Promise((res) => {
        const req = indexedDB.open(d.name)
        req.onsuccess = () => {
          const db = req.result
          const nomes = [...db.objectStoreNames].filter((n) => n.startsWith('out_'))
          if (!nomes.length) return db.close(), res()
          const tx = db.transaction(nomes, 'readonly')
          let faltam = nomes.length
          for (const n of nomes) {
            const c = tx.objectStore(n).getAll()
            c.onsuccess = () => {
              out[n] = c.result.map((r) => r.syncStatus)
              if (--faltam === 0) db.close(), res()
            }
          }
        }
        req.onerror = () => res()
      })
    }
    return out
  })
}
/** Clica no campo cujo RÓTULO (1ª linha do botão) é exatamente o texto. */
async function clickLabel(page, rotulo) {
  const ok = await page.evaluate((rotulo) => {
    const norm = (x) => x.split(/[ ]+/).join(' ').replace(/[*]/g, '').trim().toLowerCase()
    const escopo = [...document.querySelectorAll('.fixed.inset-0')].pop() ?? document
    const b = [...escopo.querySelectorAll('button')].find((e) => !e.disabled && e.getClientRects().length > 0 && norm(e.innerText.split(String.fromCharCode(10))[0]).startsWith(norm(rotulo)))
    if (!b) return false
    b.click()
    return true
  }, rotulo)
  await sleep(700)
  return ok
}
async function abrirPicker(page, rotulo, nomeCheck, { minimo = 1 } = {}) {
  const abriu = (await clickLabel(page, rotulo)) || (await clickText(page, rotulo))
  const p = abriu ? await picker(page) : null
  check(nomeCheck, !!p && p.count >= minimo, p ? `${p.count} item(ns) · ex.: ${p.amostra.join(' | ').slice(0, 140)}` : `não abriu "${rotulo}"`)
  return p
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    protocolTimeout: 60000,
    userDataDir: PROFILE,
    args: ['--ignore-certificate-errors', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-first-run'],
    defaultViewport: { width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  })
  const page = await browser.newPage()
  const erros = []
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) erros.push(`console: ${m.text().slice(0, 200)}`)
  })
  page.on('dialog', (d) => d.accept())

  try {
    if (phase === 'online') await faseOnline(page)
    else await faseOffline(page)
  } catch (e) {
    check('execução do roteiro', false, e.message)
    await shot(page, 'erro')
  }
  if (erros.length) log('\nErros de página:\n  ' + [...new Set(erros)].slice(0, 12).join('\n  '))
  const falhas = results.filter((r) => !r.ok)
  log(`\n==== ${phase}: ${results.length - falhas.length}/${results.length} ok ====`)
  await browser.close()
  process.exit(falhas.length ? 1 : 0)
}

async function faseOnline(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
  await page.evaluate((s) => localStorage.setItem('monito_session', JSON.stringify(s)), session)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  let sw = false
  for (let i = 0; i < 20 && !sw; i++) {
    await sleep(1000)
    sw = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).some((r) => !!r.active))
  }
  check('service worker ativo', sw)

  // espera catálogos + pré-carga offline
  let estado = null
  for (let i = 0; i < 90; i++) {
    estado = await page.evaluate(() => JSON.parse(localStorage.getItem('monitor.offlineReady') || 'null'))
    if (estado && estado.pdStatus && estado.carrStatus === 'ok') break
    await sleep(2000)
  }
  log('offlineReady =', JSON.stringify(estado))
  check('pré-carga Parte Diária', estado?.pdStatus === 'ok', estado?.pdResumo ?? '')
  check('pré-carga Carreteiro', estado?.carrStatus === 'ok', estado?.carrResumo ?? '')
  const t = await texto(page)
  check('Home mostra "Pronto para uso sem internet"', /Pronto para uso sem internet/.test(t), t.split('\n').find((l) => /internet/i.test(l)) ?? '')
  await shot(page, 'home')
  // deixa o SW terminar o precache
  await sleep(3000)
}

async function faseOffline(page) {
  // ---------- boot sem servidor nenhum
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(2500)
  let t = await texto(page)
  check('app abre sem rede (shell do service worker)', /Parte Diária/.test(t) && /Carreteiro/.test(t), t.slice(0, 80).replace(/\n/g, ' / '))
  await shot(page, '01-home')

  // ---------- token vencido: NÃO pode cair no login
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('monito_session'))
    s.expiresAtEpochMs = Date.now() - 60_000
    localStorage.setItem('monito_session', JSON.stringify(s))
  })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await sleep(2500)
  t = await texto(page)
  check('token vencido + sem rede: continua na Home', !/\/login$/.test(page.url()) && /Carreteiro/.test(t), page.url())
  check('aviso "Sessão expirada" aparece', /Sessão expirada/.test(t))
  check('cards habilitados (projeto do catálogo local)', await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Parte Diária/.test(x.innerText))
    return !!b && !b.disabled
  }))
  await shot(page, '02-home-token-vencido')

  // ---------- PARTE DIÁRIA
  await page.goto(`${BASE}/parte-diaria/step0`, { waitUntil: 'domcontentloaded' })
  await sleep(2000)
  await abrirPicker(page, 'EQUIPAMENTO', 'Parte Diária · lista de equipamentos offline', { minimo: 5 })
  const mveEscolhida = await pickMaisLancamentos(page)
  log('  MVE escolhida:', mveEscolhida)
  const prefixoMve = (mveEscolhida ?? '').split(' ')[0]
  await sleep(2500)
  t = await texto(page)
  check('Parte Diária · contexto de hoje vindo do cache', /contexto do SIGA em cache/.test(t) || !/sem cache deste equipamento/.test(t), (t.split('\n').find((l) => /cache|Sem rede/i.test(l)) ?? '').slice(0, 120))
  await shot(page, '03-pd-step0')
  check('Parte Diária · Continuar liberado', await clickText(page, 'Continuar', { exact: true }))
  await sleep(1200)
  await clickText(page, 'Linha', { exact: true })
  await sleep(1200)
  await abrirPicker(page, 'Obra', 'Parte Diária · obras offline')
  await pick(page)
  await abrirPicker(page, 'Serviço', 'Parte Diária · serviços offline (montados do pacote)', { minimo: 3 })
  await pick(page, (tx) => !/improdutividade|manuten|isento|disposi/i.test(tx))
  await abrirPicker(page, 'Encarregado', 'Parte Diária · encarregados offline')
  await pick(page)
  t = await texto(page)
  check('Parte Diária · horímetro inicial conhecido offline', !/definido no envio/.test(t), (t.split('\n').find((l) => /Início/i.test(l)) ?? '') + ' ' + (t.match(/Início\s*\n?\s*([\d.]+)/)?.[1] ?? ''))
  await shot(page, '04-pd-linha')
  // equipe (se o encarregado tiver mais de uma), término, horas → salvar linha → salvar dia
  if (/Equipe[^\n]*\n\s*Selecionar/.test(t)) {
    await clickLabel(page, 'Equipe')
    await pick(page)
  }
  t = await texto(page)
  const inicio = Number((t.match(/IN.CIO\s*\n\s*([\d.]+)/)?.[1] ?? '').replace(/\./g, ''))
  await setInput(page, 'input[inputmode]', 0, String((Number.isFinite(inicio) ? inicio : 0) + 5))
  await setInput(page, 'input[type=time]', 0, '07:00')
  await setInput(page, 'input[type=time]', 1, '12:00')
  await sleep(600)
  await shot(page, '04b-pd-linha-preenchida')
  const salvouLinha = await clickText(page, 'Salvar linha')
  t = await texto(page)
  check('Parte Diária · linha válida offline (regras locais)', salvouLinha, salvouLinha ? `início ${inicio} → término ${inicio + 5}` : t.split('\n').filter((l) => /obrigat|inválid|deve|maior|menor/i.test(l)).slice(0, 3).join(' | '))
  await sleep(800)
  await shot(page, '04c-pd-linhas')
  await clickText(page, 'Revisar', { exact: true })
  await sleep(2500)
  await shot(page, '04c-pd-revisar')
  await clickText(page, 'Salvar dia')
  await sleep(2500)
  const outPd = await contarOutbox(page)
  check('Parte Diária · salvo no outbox sem rede', /success/.test(page.url()) && (outPd.out_parte_diaria ?? []).length === 1, `url=${page.url().replace(BASE, '')} outbox=${JSON.stringify(outPd.out_parte_diaria ?? [])}`)
  await shot(page, '04d-pd-sucesso')

  // 2º lançamento offline da MESMA MVE: tem que partir do término do 1º (que ainda está no outbox)
  const terminoAnterior = inicio + 5
  await page.goto(`${BASE}/parte-diaria/step0`, { waitUntil: 'domcontentloaded' })
  await sleep(1500)
  await clickLabel(page, 'EQUIPAMENTO')
  await pick(page, new Function('tx', `return tx.indexOf(${JSON.stringify(prefixoMve)}) === 0`))
  await sleep(2500)
  await clickText(page, 'Continuar', { exact: true })
  await sleep(1200)
  t = await texto(page)
  check('Parte Diária · avisa que já há linha pendente desta MVE hoje', /aguardando envio neste aparelho/.test(t))
  await clickText(page, 'Linha', { exact: true })
  await sleep(1200)
  const inicio2 = await lerInicio(page)
  check('Parte Diária · 2º lançamento offline parte do término do 1º', Number(String(inicio2).replace(/[.]/g, '')) === terminoAnterior, `início mostrado=${inicio2} esperado=${terminoAnterior}`)
  await shot(page, '04e-pd-segundo-lancamento')

  // MVE SEM contexto em cache: o horímetro vem do resumo do pacote (todas as MVEs do chefe)
  log('  contextos apagados do cache para o teste:', await apagarContextosEmCache(page))
  // MVE que NUNCA foi aberta online e sem contexto: serviços ainda têm que vir do pacote
  await page.goto(`${BASE}/parte-diaria/step0`, { waitUntil: 'domcontentloaded' })
  await sleep(1500)
  await clickText(page, 'EQUIPAMENTO')
  await pick(page, (tx) => /sem lançamento/.test(tx) && !/EPP/.test(tx))
  await sleep(2500)
  t = await texto(page)
  const seguiu = await clickText(page, 'Continuar', { exact: true })
  check('Parte Diária · MVE sem contexto em cache ainda deixa lançar', seguiu, (t.split('\n').find((l) => /Sem rede/i.test(l)) ?? '').slice(0, 120))
  await sleep(1000)
  await clickText(page, 'Linha', { exact: true })
  await sleep(1000)
  await clickLabel(page, 'Obra')
  await pick(page)
  await abrirPicker(page, 'Serviço', 'Parte Diária · serviços de MVE nunca aberta', { minimo: 3 })
  await pick(page)
  const inicioFrio = await lerInicio(page)
  check('Parte Diária · horímetro inicial SEM contexto em cache (resumo do pacote)', /^[0-9.]+$/.test(String(inicioFrio ?? '')), `início mostrado=${inicioFrio}`)
  await shot(page, '05-pd-mve-fria')

  // ---------- PARTE DIÁRIA · DIA ANTERIOR (contextos já apagados → vem do resumo de ontem do pacote)
  await page.goto(`${BASE}/parte-diaria/step0`, { waitUntil: 'domcontentloaded' })
  await sleep(1500)
  const clicouOntem = await clickText(page, 'Ontem')
  await sleep(800)
  await clickLabel(page, 'EQUIPAMENTO')
  const mveOntem = await pickMaisLancamentos(page)
  await sleep(2500)
  const seguiuOntem = await clickText(page, 'Continuar', { exact: true })
  await sleep(1200)
  await clickText(page, 'Linha', { exact: true })
  await sleep(1200)
  const inicioOntem = await lerInicio(page)
  t = await texto(page)
  const d = new Date(Date.now() - 24 * 3600 * 1000)
  const diaOntem = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', day: '2-digit' }).format(d))
  check('Parte Diária · dá para escolher ONTEM e seguir offline', clicouOntem && seguiuOntem, String(mveOntem).slice(0, 60))
  check('Parte Diária · ontem: formulário é do dia anterior', new RegExp('Dia ' + diaOntem + '\\b').test(t), (t.split(String.fromCharCode(10)).find((l) => /^Dia /.test(l)) ?? ''))
  check('Parte Diária · ontem: horímetro inicial offline (resumo de ontem)', /^[0-9.]+$/.test(String(inicioOntem ?? '')), `início mostrado=${inicioOntem}`)
  await shot(page, '05b-pd-ontem')

  // ---------- CARRETEIRO
  await page.goto(`${BASE}/carreteiro`, { waitUntil: 'domcontentloaded' })
  await sleep(1500)
  await clickText(page, 'Nova ficha')
  await sleep(1500)
  let achouMve = false
  let detalheMve = ''
  for (let tentativa = 0; tentativa < 6 && !achouMve; tentativa++) {
    const p = await (async () => {
      await clickText(page, 'OBRA')
      return picker(page)
    })()
    if (tentativa === 0) check('Carreteiro · obras offline (catálogo local)', !!p && p.count > 0, p ? `${p.count} obra(s)` : '')
    if (!p || p.count === 0) break
    await page.evaluate((i) => {
      const o = [...document.querySelectorAll('.fixed.inset-0')].pop()
      o.querySelectorAll('ul li button')[i]?.click()
    }, tentativa)
    await sleep(2000)
    if (await clickText(page, 'CAMINHÃO/MVE')) {
      const pm = await picker(page)
      if (pm && pm.count > 0) {
        achouMve = true
        detalheMve = `${pm.count} caminhão(ões) · ${pm.amostra.join(' | ').slice(0, 100)}`
        await pick(page, (tx) => !/FROTA PRÓPRIA/.test(tx)) // terceiro
      } else {
        await page.keyboard.press('Escape')
        await page.evaluate(() => [...document.querySelectorAll('.fixed.inset-0')].pop()?.click())
        await sleep(500)
      }
    }
  }
  check('Carreteiro · caminhões da obra offline', achouMve, detalheMve)
  t = await texto(page)
  check('Carreteiro · chefe da obra offline', /CHEFE DE EQUIPE/.test(t) && !/será definido pelo servidor/.test(t), (t.split('\n').find((l) => /chefe conhecido|definido pelo servidor/i.test(l)) ?? 'chefe em cache').slice(0, 100))
  await shot(page, '06-carr-step0')
  if (achouMve) {
    await clickText(page, 'Continuar')
    await sleep(1500)
    await abrirPicker(page, 'Serviço', 'Carreteiro · serviços do caminhão offline')
    await pick(page)
    await abrirPicker(page, 'Origem', 'Carreteiro · locais de carga offline')
    await pick(page)
    await abrirPicker(page, 'Destino padrão', 'Carreteiro · locais de descarga offline')
    await pick(page)
    await setInput(page, 'input[inputmode]', 0, '10')
    await sleep(500)
    await shot(page, '07-carr-step1')
    await clickText(page, 'Adicionar viagem')
    await sleep(1500)
    // modal rápido: horas já vêm preenchidas; falta a quantidade (último campo numérico)
    const n = await page.evaluate(() => [...document.querySelectorAll('.fixed.inset-0')].pop()?.querySelectorAll('input[inputmode]').length ?? 0)
    await setInput(page, 'input[inputmode]', Math.max(0, n - 1), '12')
    await sleep(600)
    await shot(page, '07b-carr-viagem')
    const salvouViagem = await clickText(page, 'Salvar viagem')
    await sleep(1200)
    t = await texto(page)
    check('Carreteiro · viagem válida offline (regras locais)', salvouViagem, salvouViagem ? '' : t.replace(/\n/g, ' / ').slice(-200))
    // o modal pode reabrir para a próxima viagem — fecha
    await page.evaluate(() => {
      const o = [...document.querySelectorAll('.fixed.inset-0')].pop()
      o?.querySelector('[aria-label="Fechar"]')?.click()
    })
    await sleep(700)
    await clickText(page, 'Revisar e salvar')
    await sleep(2000)
    await shot(page, '07c-carr-revisar')
    t = await texto(page)
    const salvouFicha = await clickText(page, 'Salvar ficha')
    await sleep(3000)
    const outCarr = await contarOutbox(page)
    check(
      'Carreteiro · ficha salva no outbox sem rede',
      /success/.test(page.url()) && (outCarr.out_carreteiro ?? []).length === 1,
      `url=${page.url().replace(BASE, '')} outbox=${JSON.stringify(outCarr.out_carreteiro ?? [])}${salvouFicha ? '' : ' · botão indisponível: ' + t.replace(/\n/g, ' / ').slice(-220)}`,
    )
    await shot(page, '07d-carr-sucesso')
  }

  // ---------- CARRETEIRO · FROTA PRÓPRIA (mesmo módulo; o servidor numera a ficha — nada a digitar)
  await page.goto(`${BASE}/carreteiro`, { waitUntil: 'domcontentloaded' })
  await sleep(1500)
  await clickText(page, 'Nova ficha')
  await sleep(1500)
  let achouProprio = false
  for (let tentativa = 0; tentativa < 6 && !achouProprio; tentativa++) {
    await clickLabel(page, 'OBRA')
    await pickIndex(page, tentativa)
    await sleep(2000)
    if (!(await clickLabel(page, 'CAMINHÃO/MVE'))) continue
    const pm = await picker(page)
    const temProprio = !!pm && (await page.evaluate(() => {
      const o = [...document.querySelectorAll('.fixed.inset-0')].pop()
      return [...(o?.querySelectorAll('ul li button') ?? [])].some((b) => /FROTA PRÓPRIA/.test(b.innerText))
    }))
    if (temProprio) {
      achouProprio = true
      await pick(page, (tx) => /FROTA PRÓPRIA/.test(tx))
    } else {
      await page.evaluate(() => [...document.querySelectorAll('.fixed.inset-0')].pop()?.querySelector('[aria-label="Fechar"]')?.click())
      await page.keyboard.press('Escape')
      await sleep(500)
    }
  }
  check('Carreteiro · caminhões de FROTA PRÓPRIA na mesma lista (offline)', achouProprio)
  if (achouProprio) {
    await sleep(1500)
    t = await texto(page)
    const semCampo = await page.evaluate(() => !document.querySelector('#ficha-numero'))
    check('Frota própria · não pede nº da ficha (servidor numera)', semCampo && /gerado pelo servidor/i.test(t))
    await shot(page, '07e-proprio-step0')
    const continuou = await clickText(page, 'Continuar', { exact: true })
    check('Frota própria · segue para as viagens sem digitar nada', continuou)
    await sleep(1500)
    t = await texto(page)
    check('Frota própria · sem quilometragem no cabeçalho', !/Quilometragem/i.test(t))
    await abrirPicker(page, 'Serviço', 'Frota própria · serviços do contrato de produção offline')
    await pick(page)
    await clickLabel(page, 'Origem')
    await pick(page)
    await clickLabel(page, 'Destino padrão')
    await pick(page)
    await sleep(500)
    await clickText(page, 'Adicionar viagem')
    await sleep(1500)
    const n2 = await page.evaluate(() => [...document.querySelectorAll('.fixed.inset-0')].pop()?.querySelectorAll('input[inputmode]').length ?? 0)
    await setInput(page, 'input[inputmode]', Math.max(0, n2 - 1), '9')
    await sleep(600)
    const salvouV = await clickText(page, 'Salvar viagem')
    await sleep(1200)
    await page.evaluate(() => [...document.querySelectorAll('.fixed.inset-0')].pop()?.querySelector('[aria-label="Fechar"]')?.click())
    await sleep(700)
    await clickText(page, 'Revisar e salvar')
    await sleep(2000)
    t = await texto(page)
    check('Frota própria · revisão mostra frota e nº gerado pelo servidor', /Própria/.test(t) && /Gerado pelo servidor/i.test(t))
    await shot(page, '07f-proprio-revisar')
    await clickText(page, 'Salvar ficha')
    await sleep(3000)
    const outP = await contarOutbox(page)
    check('Frota própria · ficha salva no outbox sem rede', salvouV && /success/.test(page.url()) && (outP.out_carreteiro ?? []).length === 2, `url=${page.url().replace(BASE, '')} outbox=${JSON.stringify(outP.out_carreteiro ?? [])}`)
  }

  // ---------- PRODUÇÃO
  await page.goto(`${BASE}/producao/setup`, { waitUntil: 'domcontentloaded' })
  await sleep(1500)
  await abrirPicker(page, 'ENCARREGADO', 'Produção · encarregados offline')
  await pickIndex(page, 1)
  await abrirPicker(page, 'EQUIPE', 'Produção · equipes offline')
  await pickIndex(page, 1)
  await shot(page, '08-producao-setup')
  t = await texto(page)
  log('  produção/setup:', t.replace(/\n/g, ' / ').slice(0, 260))

  // ---------- FOTOS
  await page.goto(`${BASE}/fotos`, { waitUntil: 'domcontentloaded' })
  await sleep(1500)
  t = await texto(page)
  check('Fotos · lista abre offline', /Fotos/.test(t), t.replace(/\n/g, ' / ').slice(0, 100))
  await page.evaluate(() => document.querySelector('[aria-label="Tirar foto"]')?.click())
  await sleep(3500)
  t = await texto(page)
  check('Fotos · tela de captura abre offline', /capture/.test(page.url()), t.replace(/\n/g, ' / ').slice(0, 140))
  await shot(page, '09-fotos-capture')

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await sleep(2000)
  t = await texto(page)
  check('Home · mostra pendência aguardando sincronização', /aguardando sincronização/.test(t), (t.split('\n').find((l) => /aguardando/.test(l)) ?? '').slice(0, 100))
  await shot(page, '10-home-final')
}

main()
