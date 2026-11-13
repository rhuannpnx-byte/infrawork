// Acessibilidade dos diálogos: abre cada um pelo botão da tela, roda o axe só dentro dele e confere o teclado
// (o foco entra no diálogo, o Esc fecha e o foco volta ao botão). Não grava nada.
//   E2E_EMAIL=… E2E_PASSWORD=… E2E_EMPRESA_ID=… E2E_OBRA_ID=… [E2E_URL=…] [E2E_TEMA=light|dark]
//   [E2E_SAIDA=pasta-das-capturas] node scripts/acessibilidade-dialogos.mjs
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { AxeBuilder } from '@axe-core/playwright'
import { URL_BASE, abrirSessao } from './sessao-telas.mjs'

// rota e nome acessível do botão que abre o diálogo (texto ou aria-label)
const CENARIOS = [
  ['/', 'Buscar páginas, obras e ações', { exato: false }],
  ['/', 'Configurações'],
  ['/', 'Atalhos de teclado'],
  ['/gerencial/empresas', 'Nova empresa'],
  ['/gerencial/usuarios', 'Novo usuário'],
  ['/gerencial/obras', 'Nova obra'],
  ['/orcamento/taxas', 'Nova taxa'],
  ['/planejamento/cronograma', 'Plano'],
  ['/planejamento/cronograma', 'Marcos'],
  ['/planejamento/cronograma', 'Criar tarefas'],
  ['/planejamento/cronograma', 'Filtro'],
  ['/planejamento/cronograma', 'Exibir'],
  ['/planejamento/equipes', 'Nova equipe'],
  ['/planejamento/equipes', 'Novo encarregado'],
  ['/acompanhamento/viagens', 'Nova ficha'],
  ['/acompanhamento/lancar', 'Importar planilha']
]

const TEMA = process.env.E2E_TEMA === 'dark' ? 'dark' : 'light'
const SAIDA = process.env.E2E_SAIDA
if (SAIDA) mkdirSync(SAIDA, { recursive: true })
const { browser, page } = await abrirSessao({ tema: TEMA })

let falhas = 0
let rotaAberta = null
for (const [rota, botao, opcoes] of CENARIOS) {
  if (rota !== rotaAberta) {
    await page.goto(`${URL_BASE}${rota}`)
    await page.waitForTimeout(2200)
    rotaAberta = rota
  }
  const gatilho = page.getByRole('button', { name: botao, exact: opcoes?.exato ?? true }).first()
  if (!(await gatilho.count()) || !(await gatilho.isEnabled().catch(() => false))) {
    console.log(`? ${rota} › ${botao} — botão ausente ou desabilitado`)
    continue
  }
  await gatilho.click()
  await page.waitForTimeout(500)
  // diálogo, painel lateral ou popover (o último que abriu)
  const camada = page.locator('[role="dialog"], [data-portal-popover]').last()
  if (!(await camada.count())) {
    console.log(`? ${rota} › ${botao} — nada abriu`)
    continue
  }
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .include('[role="dialog"], [data-portal-popover]')
    .analyze()
  const focoDentro = await page.evaluate(() => {
    const c = [...document.querySelectorAll('[role="dialog"], [data-portal-popover]')].pop()
    return !!c && c.contains(document.activeElement)
  })
  if (SAIDA) {
    const nome = `${TEMA}__${rota.slice(1).replace(/\//g, '_') || 'inicio'}__${botao.toLowerCase().replace(/[^a-z0-9à-ú]+/gi, '-')}`
    await page.screenshot({ path: join(SAIDA, `${nome}.png`) })
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const fechou = (await page.locator('[role="dialog"], [data-portal-popover]').count()) === 0
  const ok = violations.length === 0 && fechou
  if (!ok) falhas++
  console.log(
    `${ok ? '✓' : '✗'} ${rota} › ${botao}${focoDentro ? '' : ' (foco não entrou)'}${fechou ? '' : ' — Esc não fechou'}${violations.length ? ` — ${violations.map((v) => `${v.id}×${v.nodes.length}`).join(', ')}` : ''}`
  )
  for (const v of violations)
    console.log(`    ${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)
  if (!fechou) {
    await page.goto(`${URL_BASE}${rota}`)
    await page.waitForTimeout(2000)
  }
}
await browser.close()
console.log(falhas ? `\n${falhas} diálogo(s) com problema` : '\nTUDO OK')
process.exit(falhas ? 1 : 0)
