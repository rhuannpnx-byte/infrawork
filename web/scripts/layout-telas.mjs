// Layout das telas: abre cada rota em várias larguras e acusa o que quebra a leitura: página com rolagem
// horizontal, controle cortado pela borda de um bloco, texto cortado sem reticências, texto cru na tela
// (undefined, NaN, código do banco), letra menor que 11 px e alvo de clique menor que 24 px.
//   E2E_EMAIL=… E2E_PASSWORD=… E2E_EMPRESA_ID=… E2E_OBRA_ID=… [E2E_URL=…] [E2E_TEMA=light|dark]
//   [E2E_LARGURAS=1440,1024,390] [E2E_DENSIDADE=compact] node scripts/layout-telas.mjs [rota …]
import { ROTAS } from './rotas-telas.mjs'
import { URL_BASE, abrirSessao } from './sessao-telas.mjs'

const LARGURAS = (process.env.E2E_LARGURAS ?? '1440,1024,390').split(',').map(Number)
const rotas = process.argv.slice(2).length ? process.argv.slice(2) : ROTAS
const TEMA = process.env.E2E_TEMA === 'dark' ? 'dark' : 'light'

function medir() {
  const largura = window.innerWidth
  const visivel = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0
  }
  const nome = (el) => {
    const t = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40)
    return `${el.tagName.toLowerCase()}${t ? ` "${t}"` : ''}`
  }
  // o ancestral que rola na horizontal (a tabela larga dentro de um bloco com rolagem não é defeito)
  const rola = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX
      if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth) return true
    }
    return false
  }
  const corta = (el) => {
    const r = el.getBoundingClientRect()
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (s.overflowX === 'visible') continue
      const pr = p.getBoundingClientRect()
      if (r.right > pr.right + 2 || r.left < pr.left - 2)
        return s.overflowX === 'hidden' || s.overflowX === 'clip'
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') return false
    }
    return r.right > largura + 2
  }

  const doc = document.scrollingElement
  const rolagem = doc.scrollWidth - largura > 1 ? doc.scrollWidth - largura : 0

  const cortados = []
  const pequenos = []
  for (const el of document.querySelectorAll(
    'button, a[href], input, select, textarea, [role="tab"], [role="radio"]'
  )) {
    if (!visivel(el) || el.closest('[aria-hidden="true"]')) continue
    const r = el.getBoundingClientRect()
    if (!rola(el) && corta(el)) cortados.push(nome(el))
    const caixa = el.type === 'checkbox' || el.type === 'radio'
    if (
      !caixa &&
      el.tagName !== 'A' &&
      (r.width < 24 || r.height < 24) &&
      !el.closest('table, [role="grid"], [role="tree"]')
    )
      pequenos.push(`${nome(el)} ${Math.round(r.width)}×${Math.round(r.height)}`)
  }

  const semReticencias = []
  let miudos = 0
  const amostraMiudos = []
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const vistos = new Set()
  while (tw.nextNode()) {
    const texto = tw.currentNode.nodeValue.trim()
    const el = tw.currentNode.parentElement
    if (!texto || !el || vistos.has(el) || !visivel(el) || el.closest('svg, [aria-hidden="true"]'))
      continue
    vistos.add(el)
    const s = getComputedStyle(el)
    if (parseFloat(s.fontSize) < 11) {
      miudos++
      if (amostraMiudos.length < 4) amostraMiudos.push(`"${texto.slice(0, 30)}" ${s.fontSize}`)
    }
    if (
      el.scrollWidth > el.clientWidth + 1 &&
      (s.overflowX === 'hidden' || s.overflowX === 'clip') &&
      s.textOverflow !== 'ellipsis' &&
      s.whiteSpace === 'nowrap' &&
      !el.closest('[data-density="compact"]')
    )
      semReticencias.push(`"${texto.slice(0, 40)}"`)
  }

  const corpo = document.body.innerText
  const crus = [
    ...new Set(
      (
        corpo.match(
          /\b(undefined|NaN|Invalid Date|\[object Object\])\b|\b[a-z]{2,}_[a-z_]{2,}\b/g
        ) ?? []
      ).filter((t) => !/^(https?|www)/.test(t))
    )
  ]
  return { rolagem, cortados, pequenos, semReticencias, miudos, amostraMiudos, crus }
}

let problemas = 0
for (const largura of LARGURAS) {
  const { browser, page } = await abrirSessao({
    largura,
    altura: largura < 600 ? 844 : 900,
    tema: TEMA
  })
  if (process.env.E2E_DENSIDADE)
    await page.evaluate(
      (d) => localStorage.setItem('infrawork.ui.density', d),
      process.env.E2E_DENSIDADE
    )
  console.log(
    `\n== ${largura} px (${TEMA}${process.env.E2E_DENSIDADE ? `, ${process.env.E2E_DENSIDADE}` : ''}) ==`
  )
  for (const rota of rotas) {
    await page.goto(`${URL_BASE}${rota}`)
    await page.waitForTimeout(1800)
    const m = await page.evaluate(medir)
    const linhas = []
    if (m.rolagem) linhas.push(`rolagem horizontal da página: ${m.rolagem} px`)
    if (m.cortados.length)
      linhas.push(`controle cortado: ${[...new Set(m.cortados)].slice(0, 6).join(', ')}`)
    if (m.semReticencias.length)
      linhas.push(
        `texto cortado sem reticências: ${[...new Set(m.semReticencias)].slice(0, 5).join(', ')}`
      )
    if (m.crus.length) linhas.push(`texto cru: ${m.crus.slice(0, 8).join(', ')}`)
    if (m.miudos) linhas.push(`letra menor que 11 px: ${m.miudos} (${m.amostraMiudos.join(', ')})`)
    if (m.pequenos.length)
      linhas.push(`alvo menor que 24 px: ${[...new Set(m.pequenos)].slice(0, 6).join(', ')}`)
    if (linhas.length) problemas++
    console.log(`${linhas.length ? '✗' : '✓'} ${rota}`)
    for (const l of linhas) console.log(`    ${l}`)
  }
  await browser.close()
}
console.log(problemas ? `\n${problemas} tela(s) com apontamento` : '\nTUDO OK')
process.exit(problemas ? 1 : 0)
