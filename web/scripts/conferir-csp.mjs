// Confere a política de segurança (CSP) de um build: serve a pasta `dist` com os cabeçalhos do `vercel.json`
// e acusa o que o navegador bloquear (fonte, script de tema, estilo).
//   node scripts/conferir-csp.mjs [pasta-do-projeto]      (padrão: o próprio web; ex.: ../campo)
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { chromium } from 'playwright'

const projeto = resolve(process.argv[2] ?? '.')
const dist = join(projeto, 'dist')
if (!existsSync(dist)) {
  console.error(`sem ${dist}: rode o build antes`)
  process.exit(2)
}
const vercel = JSON.parse(readFileSync(join(projeto, 'vercel.json'), 'utf-8'))
const cabecalhos = Object.fromEntries(
  (vercel.headers ?? [])
    .filter((h) => h.source === '/(.*)' || h.source === '/:path*')
    .flatMap((h) => h.headers.map((x) => [x.key, x.value]))
)
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json'
}

const servidor = createServer((req, res) => {
  const caminho = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let arquivo = join(dist, caminho)
  if (!existsSync(arquivo) || statSync(arquivo).isDirectory()) arquivo = join(dist, 'index.html')
  res.writeHead(200, {
    ...cabecalhos,
    'Content-Type': TIPOS[extname(arquivo)] ?? 'application/octet-stream'
  })
  res.end(readFileSync(arquivo))
})
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok))
const url = `http://127.0.0.1:${servidor.address().port}/`

const browser = await chromium.launch()
const page = await browser.newPage()
const bloqueios = []
await page.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', (e) => {
    console.error(`CSP bloqueou ${e.violatedDirective}: ${e.blockedURI}`)
  })
})
page.on('console', (m) => {
  // a conexão com o Supabase fica fora da conferência: a URL local do build não está na política
  if (m.type() === 'error' && /CSP|Content Security Policy/i.test(m.text()) && !/connect-src/.test(m.text()))
    bloqueios.push(m.text().slice(0, 220))
})
await page.goto(url)
await page.waitForTimeout(2500)
const fontes = await page.evaluate(async () => {
  // força o carregamento da fonte do corpo: a página pode ainda não ter texto pintado
  const familia = getComputedStyle(document.body).fontFamily.split(',')[0].trim()
  await document.fonts.load(`16px ${familia}`).catch(() => [])
  await document.fonts.ready
  return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family)
})
const tema = await page.evaluate(() => document.documentElement.dataset.theme ?? null)
await browser.close()
servidor.close()

console.log(`política: ${cabecalhos['Content-Security-Policy'] ? 'presente' : 'AUSENTE no vercel.json'}`)
console.log(`tema aplicado antes da pintura: ${tema ?? 'não'}`)
console.log(`fontes carregadas: ${[...new Set(fontes)].join(', ') || 'nenhuma'}`)
console.log(bloqueios.length ? `BLOQUEIOS:\n  ${bloqueios.join('\n  ')}` : 'sem bloqueio de CSP')
process.exit(bloqueios.length ? 1 : 0)
