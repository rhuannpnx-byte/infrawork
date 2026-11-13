// Acessibilidade das telas: roda o axe (WCAG 2 A e AA) em cada rota do menu e lista as violações por regra.
//   E2E_EMAIL=… E2E_PASSWORD=… E2E_EMPRESA_ID=… E2E_OBRA_ID=… [E2E_URL=…] [E2E_TEMA=light|dark]
//   [E2E_ROTAS=/,/orcamento] [E2E_LARGURA=1440] [E2E_SAIDA=acessibilidade.json] node scripts/acessibilidade-telas.mjs
// Sai com erro se houver violação grave ou crítica.
import { writeFileSync } from 'node:fs'
import { AxeBuilder } from '@axe-core/playwright'
import { ROTAS } from './rotas-telas.mjs'
import { URL_BASE, abrirSessao } from './sessao-telas.mjs'

const TEMA = process.env.E2E_TEMA === 'dark' ? 'dark' : 'light'
const rotas = process.env.E2E_ROTAS ? process.env.E2E_ROTAS.split(',') : ROTAS
const LARGURA = Number(process.env.E2E_LARGURA ?? 1440)
const { browser, page } = await abrirSessao({
  tema: TEMA,
  largura: LARGURA,
  altura: LARGURA < 600 ? 844 : 900
})

const porRegra = new Map()
const porRota = {}
for (const rota of rotas) {
  await page.goto(`${URL_BASE}${rota}`)
  await page.waitForTimeout(Number(process.env.E2E_ESPERA ?? 2200))
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    // mapa (Leaflet) e gráficos (SVG do Recharts) têm marcação própria fora do nosso controle
    .exclude('.leaflet-container')
    .exclude('.recharts-wrapper')
    .analyze()
  const graves = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  porRota[rota] = violations.map((v) => ({
    regra: v.id,
    impacto: v.impact,
    ocorrencias: v.nodes.length,
    exemplos: v.nodes.slice(0, 3).map((n) => n.target.join(' '))
  }))
  for (const v of violations) {
    const r = porRegra.get(v.id) ?? { impacto: v.impact, ajuda: v.help, total: 0, rotas: new Set() }
    r.total += v.nodes.length
    r.rotas.add(rota)
    porRegra.set(v.id, r)
  }
  console.log(
    `${graves.length ? '✗' : '✓'} ${rota}${violations.length ? ` — ${violations.map((v) => `${v.id}×${v.nodes.length}`).join(', ')}` : ''}`
  )
}
await browser.close()

console.log(`\nResumo (${TEMA}):`)
const regras = [...porRegra.entries()].sort((a, b) => b[1].total - a[1].total)
for (const [id, r] of regras)
  console.log(`  ${r.impacto.padEnd(8)} ${id} — ${r.total} em ${r.rotas.size} tela(s): ${r.ajuda}`)
if (!regras.length) console.log('  nenhuma violação')
writeFileSync(process.env.E2E_SAIDA ?? 'acessibilidade.json', JSON.stringify(porRota, null, 2))
const graves = regras.filter(([, r]) => r.impacto === 'serious' || r.impacto === 'critical')
process.exit(graves.length ? 1 : 0)
