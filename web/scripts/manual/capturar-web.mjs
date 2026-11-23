// Capturas de tela do manual do sistema web. Cada captura é uma rota e, se preciso, os passos até o estado da tela.
//   MANUAL_EMAIL=… MANUAL_SENHA=… MANUAL_EMPRESA=… MANUAL_OBRA=… node scripts/manual/capturar-web.mjs [fase] [nomes]
// A fase "base" pede a obra com linha de base vigente; a fase "edicao", um plano em edição sem vigente (é quando o
// orçamento e o cronograma aceitam alterações). Sem nomes, tira todas as capturas da fase.
import { mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { abrir, login, URL, assentar } from './navegador.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, 'imagens/web')
const ARQUIVOS = join(AQUI, 'saida')
mkdirSync(SAIDA, { recursive: true })
const [fase = 'base', filtro] = process.argv.slice(2)
const pedidas = filtro ? new Set(filtro.split(',')) : null

const ir = async (page, rota) => {
  await page.goto(`${URL}${rota}`)
  await assentar(page, 1600)
}
const dialogo = (page) => page.getByRole('dialog').last()
const clicar = async (page, nome, opcoes = {}) => {
  await page.getByRole('button', { name: nome, exact: opcoes.exact ?? false }).first().click()
  await page.waitForTimeout(opcoes.espera ?? 900)
}
/** Captura a tela inteira, ou só o elemento (diálogo, painel) com uma margem. */
async function foto(page, nome, alvo) {
  const arquivo = join(SAIDA, `${nome}.jpg`)
  if (!alvo) {
    await page.screenshot({ path: arquivo, type: 'jpeg', quality: 88 })
    return
  }
  const caixa = await alvo.boundingBox()
  const m = 10
  await page.screenshot({
    path: arquivo,
    type: 'jpeg',
    quality: 90,
    clip: {
      x: Math.max(0, caixa.x - m),
      y: Math.max(0, caixa.y - m),
      width: caixa.width + 2 * m,
      height: caixa.height + 2 * m
    }
  })
}

const BASE = {
  inicio: async (p) => {
    await ir(p, '/')
    await foto(p, 'inicio')
  },
  'seletor-obra': async (p) => {
    await ir(p, '/')
    await p.locator('button[title*="trocar empresa ou obra"], button[title="Trocar empresa ou obra"]').first().click()
    await p.waitForTimeout(900)
    await foto(p, 'seletor-obra', dialogo(p))
  },
  busca: async (p) => {
    await ir(p, '/')
    await p.keyboard.press('Control+k')
    await p.waitForTimeout(500)
    await p.keyboard.type('prod')
    await p.waitForTimeout(700)
    await foto(p, 'busca', dialogo(p))
  },
  configuracoes: async (p) => {
    await ir(p, '/')
    await clicar(p, 'Configurações', { exact: true })
    await foto(p, 'configuracoes', dialogo(p))
  },
  'conectar-ia': async (p) => {
    await ir(p, '/')
    await clicar(p, 'Menu do usuário')
    await p.getByText('Conectar IA, tokens e status').click()
    await p.waitForTimeout(1500)
    await foto(p, 'conectar-ia', dialogo(p))
  },
  usuarios: async (p) => {
    await ir(p, '/gerencial/usuarios')
    await foto(p, 'usuarios')
  },
  'usuario-novo': async (p) => {
    await ir(p, '/gerencial/usuarios')
    await clicar(p, 'Novo usuário')
    await foto(p, 'usuario-novo', dialogo(p))
  },
  obras: async (p) => {
    await ir(p, '/gerencial/obras')
    await foto(p, 'obras')
  },
  'obra-detalhe': async (p) => {
    await ir(p, `/gerencial/obras/${process.env.MANUAL_OBRA}`)
    await foto(p, 'obra-detalhe')
  },
  frota: async (p) => {
    await ir(p, '/gerencial/frota')
    await foto(p, 'frota')
  },
  'planejamento-visao': async (p) => {
    await ir(p, '/planejamento')
    await foto(p, 'planejamento-visao')
  },
  parametrizacao: async (p) => {
    await ir(p, '/planejamento/parametrizacao')
    await foto(p, 'parametrizacao')
  },
  calendario: async (p) => {
    await ir(p, '/planejamento/calendario')
    await foto(p, 'calendario')
  },
  equipes: async (p) => {
    await ir(p, '/planejamento/equipes')
    await foto(p, 'equipes')
  },
  locais: async (p) => {
    await ir(p, '/planejamento/trechos')
    await foto(p, 'locais')
  },
  quantidades: async (p) => {
    await ir(p, '/planejamento/trechos')
    await p.getByRole('button', { name: /serviços, versão/ }).first().click()
    await p.waitForTimeout(1800)
    await foto(p, 'quantidades', dialogo(p))
  },
  cronograma: async (p) => {
    await ir(p, '/planejamento/cronograma')
    await p.getByText('Cronograma em dia').first().waitFor({ timeout: 120000 })
    await assentar(p, 1500)
    await foto(p, 'cronograma')
  },
  tarefa: async (p) => {
    await ir(p, '/planejamento/cronograma')
    await p.getByText('Cronograma em dia').first().waitFor({ timeout: 120000 })
    await assentar(p, 1000)
    await p.getByText('Base T1', { exact: true }).first().click({ button: 'right' })
    await p.waitForTimeout(500)
    await p.getByText('Propriedades…').first().click()
    await p.waitForTimeout(1500)
    await foto(p, 'tarefa', dialogo(p))
  },
  'tempo-caminho': async (p) => {
    await ir(p, '/planejamento/tempo-caminho')
    await p.getByText('Cronograma em dia').first().waitFor({ timeout: 120000 }).catch(() => {})
    await assentar(p, 2000)
    await foto(p, 'tempo-caminho')
  },
  'curva-s': async (p) => {
    await ir(p, '/planejamento/curva-s')
    await foto(p, 'curva-s')
  },
  histograma: async (p) => {
    await ir(p, '/planejamento/recursos')
    await assentar(p, 2500)
    await foto(p, 'histograma')
  },
  comparar: async (p) => {
    await ir(p, '/planejamento/comparar')
    const selects = p.locator('main select:visible')
    await selects.nth(0).selectOption({ label: 'Plano executivo — rev. (linha de base)' })
    await selects.nth(1).selectOption({ label: 'Plano executivo (linha de base)' })
    await assentar(p, 2000)
    await foto(p, 'comparar')
  },
  lancar: async (p) => {
    await ir(p, '/acompanhamento/lancar')
    await foto(p, 'lancar')
  },
  'lancar-lote': async (p) => {
    await ir(p, '/acompanhamento/lancar')
    await p.getByRole('tab', { name: 'Em lote' }).click()
    await p.waitForTimeout(1200)
    await foto(p, 'lancar-lote')
  },
  'importar-producao': async (p) => {
    const arquivo = join(ARQUIVOS, 'producao-exemplo.xlsx')
    if (!existsSync(arquivo)) throw new Error('falta saida/producao-exemplo.xlsx (gerar-planilhas.py)')
    await ir(p, '/acompanhamento/lancar')
    await clicar(p, 'Importar planilha')
    await dialogo(p).locator('input[type="file"]').setInputFiles(arquivo)
    await p.waitForTimeout(2500)
    await foto(p, 'importar-producao', dialogo(p))
  },
  producao: async (p) => {
    await ir(p, '/acompanhamento/producao')
    await foto(p, 'producao')
  },
  viagens: async (p) => {
    await ir(p, '/acompanhamento/viagens')
    await foto(p, 'viagens')
  },
  'ficha-viagens': async (p) => {
    await ir(p, '/acompanhamento/viagens')
    await p.getByRole('row').nth(1).click()
    await p.waitForTimeout(1800)
    await foto(p, 'ficha-viagens', dialogo(p))
  },
  dashboard: async (p) => {
    await ir(p, '/acompanhamento')
    await assentar(p, 2500)
    await foto(p, 'dashboard')
  },
  'calendario-producao': async (p) => {
    await ir(p, '/acompanhamento/calendario')
    await foto(p, 'calendario-producao')
  },
  comparativo: async (p) => {
    await ir(p, '/acompanhamento/comparativo')
    await foto(p, 'comparativo')
  },
  'curva-servico': async (p) => {
    await ir(p, '/acompanhamento/comparativo')
    await p.getByText(/Compactação de aterros/).first().click()
    await p.waitForTimeout(1800)
    await foto(p, 'curva-servico')
  },
  'valor-agregado': async (p) => {
    await ir(p, '/acompanhamento/valor-agregado')
    await assentar(p, 2000)
    await foto(p, 'valor-agregado')
  },
  fotos: async (p) => {
    await ir(p, '/acompanhamento/fotos')
    await p
      .waitForFunction(
        () =>
          [...document.querySelectorAll('main img:not(.leaflet-tile)')].filter((i) => i.naturalWidth > 0).length >= 6,
        null,
        { timeout: 30000 }
      )
      .catch(() => console.log('  (miniaturas não carregaram)'))
    await assentar(p, 2500)
    await foto(p, 'fotos')
  },
  performance: async (p) => {
    await ir(p, '/acompanhamento/performance')
    await assentar(p, 2000)
    await foto(p, 'performance')
  },
  transporte: async (p) => {
    await ir(p, '/acompanhamento/transporte')
    await foto(p, 'transporte')
  },
  alertas: async (p) => {
    await ir(p, '/acompanhamento/alertas')
    await clicar(p, 'Recalcular', { espera: 4000 })
    await assentar(p, 1500)
    await foto(p, 'alertas')
  },
  // linha de base no modo Controle: só nome e quantidade na grade, para caberem "% exec." e "Prev. término"
  'cronograma-controle': async (p) => {
    await ir(p, '/planejamento/cronograma')
    const chave = await p.evaluate(() => {
      const auth = Object.keys(localStorage).find((k) => k.endsWith('.auth.v1'))
      return auth.slice(0, -'.auth.v1'.length) + '.cronograma.ui.v2'
    })
    const antes = await p.evaluate((k) => localStorage.getItem(k), chave)
    await p.evaluate(
      ([k, v]) => {
        const s = JSON.parse(v ?? '{"state":{},"version":4}')
        s.state.colunas = ['nome', 'quantidade']
        s.state.larguraGrade = null
        localStorage.setItem(k, JSON.stringify(s))
      },
      [chave, antes]
    )
    await ir(p, '/planejamento/cronograma')
    await p.getByText('Cronograma em dia').first().waitFor({ timeout: 120000 })
    await assentar(p, 1500)
    await foto(p, 'cronograma-controle')
    // devolve a grade ao que era, para as capturas seguintes
    await p.evaluate(
      ([k, v]) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)),
      [chave, antes]
    )
  }
}

const EDICAO = {
  'orcamento-visao': async (p) => {
    await ir(p, '/orcamento/obra')
    await foto(p, 'orcamento-visao')
  },
  'plan-orc': async (p) => {
    await ir(p, '/orcamento/obra/plan-orc')
    await assentar(p, 1500)
    await foto(p, 'plan-orc')
  },
  'importar-orcamento': async (p) => {
    const arquivo = join(ARQUIVOS, 'orcamento-exemplo.xlsx')
    if (!existsSync(arquivo)) throw new Error('falta saida/orcamento-exemplo.xlsx')
    await ir(p, '/orcamento/obra/plan-orc')
    await clicar(p, 'Importar planilha')
    await dialogo(p).locator('input[type="file"]').setInputFiles(arquivo)
    await p.waitForTimeout(2500)
    await foto(p, 'importar-orcamento', dialogo(p))
  },
  rateio: async (p) => {
    await ir(p, '/orcamento/obra/plan-orc')
    await p.getByText('Sarjeta triangular de concreto STC 02').first().hover()
    await p.getByRole('button', { name: 'Mais ações de 03.01' }).first().click({ force: true })
    await p.waitForTimeout(500)
    await p.getByRole('menuitem', { name: /Ratear|rateio/ }).first().click()
    await p.waitForTimeout(1200)
    await foto(p, 'rateio', dialogo(p))
  },
  'servico-painel': async (p) => {
    await ir(p, '/orcamento/obra/plan-orc')
    await p.getByText('Compactação de aterros a 100% PN', { exact: true }).first().dblclick()
    await p.waitForTimeout(1500)
    await foto(p, 'servico-painel', dialogo(p))
  },
  lucratividade: async (p) => {
    await ir(p, '/orcamento/obra/lucratividade')
    await foto(p, 'lucratividade')
  },
  recursos: async (p) => {
    await ir(p, '/orcamento/recursos')
    await foto(p, 'recursos')
  },
  composicoes: async (p) => {
    await ir(p, '/orcamento/composicoes')
    await foto(p, 'composicoes')
  },
  'composicao-editor': async (p) => {
    await ir(p, '/orcamento/composicoes')
    await p.getByText(/Base de brita graduada/).first().click()
    await assentar(p, 1800)
    await foto(p, 'composicao-editor')
  },
  servicos: async (p) => {
    await ir(p, '/orcamento/servicos')
    await p.getByText(/Base de brita graduada/).first().click().catch(() => {})
    await assentar(p, 1500)
    await foto(p, 'servicos')
  },
  indireto: async (p) => {
    await ir(p, '/orcamento/obra/indireto')
    await foto(p, 'indireto')
  },
  taxas: async (p) => {
    await ir(p, '/orcamento/taxas')
    if (await p.getByText('Ativa', { exact: true }).count() === 0) {
      await clicar(p, 'Nova taxa')
      await dialogo(p).getByRole('button', { name: 'Criar taxa' }).click()
      await assentar(p, 1500)
    }
    await foto(p, 'taxas')
  },
  aditivos: async (p) => {
    await ir(p, '/orcamento/obra/aditivos')
    await p.getByText(/Aditivo 1/).first().click().catch(() => {})
    await assentar(p, 1500)
    await foto(p, 'aditivos')
  },
  reajustes: async (p) => {
    await ir(p, '/orcamento/obra/reajustes')
    await p.getByText(/Reajuste 1|Reajuste anual/).first().click().catch(() => {})
    await assentar(p, 1500)
    await foto(p, 'reajustes')
  },
  'criar-tarefas': async (p) => {
    await ir(p, '/planejamento/cronograma')
    await p.getByText('Cronograma em dia').first().waitFor({ timeout: 120000 })
    await clicar(p, 'Criar tarefas', { espera: 1800 })
    await foto(p, 'criar-tarefas', dialogo(p))
  },
  escopo: async (p) => {
    await ir(p, '/planejamento/cronograma')
    await p.getByText('Cronograma em dia').first().waitFor({ timeout: 120000 })
    await clicar(p, 'Escopo', { exact: true })
    await p.getByText('do valor orçado já está em tarefas').waitFor({ timeout: 20000 })
    // abre um serviço que ainda tem quantidade a distribuir, para mostrar as tarefas dele
    await p.getByRole('complementary', { name: 'Escopo distribuído' }).getByText(/Imprimação/).first().click()
    await assentar(p, 900)
    await foto(p, 'escopo')
    await clicar(p, 'Recolher o escopo')
  },
  'travar-linha-de-base': async (p) => {
    await ir(p, '/planejamento/cronograma')
    await p.getByText('Cronograma em dia').first().waitFor({ timeout: 120000 })
    await clicar(p, 'Travar como linha de base', { espera: 1200 })
    await foto(p, 'travar-linha-de-base', dialogo(p))
  },
  'importar-quantidades': async (p) => {
    const arquivo = join(ARQUIVOS, 'quantidades-exemplo.xlsx')
    if (!existsSync(arquivo)) throw new Error('falta saida/quantidades-exemplo.xlsx')
    await ir(p, '/planejamento/trechos')
    await clicar(p, 'Importar quantidades')
    const escolha = p.waitForEvent('filechooser')
    await dialogo(p).getByRole('button', { name: 'Escolher planilha' }).click()
    await (await escolha).setFiles(arquivo)
    await p.waitForTimeout(2500)
    await clicar(p, /Continuar|Avançar|Próximo/, { espera: 1500 }).catch(() => {})
    await foto(p, 'importar-quantidades', dialogo(p))
  }
}

const capturas = fase === 'edicao' ? EDICAO : BASE
const { browser, page } = await abrir({ escala: 1.5 })
let falhas = 0
for (const [nome, fazer] of Object.entries(capturas)) {
  if (pedidas && !pedidas.has(nome)) continue
  try {
    await fazer(page)
    console.log(`ok   ${nome}`)
  } catch (e) {
    falhas++
    console.log(`FALHA ${nome}: ${String(e.message).split('\n')[0].slice(0, 160)}`)
    await page.keyboard.press('Escape').catch(() => {})
  }
}
await browser.close()
if (falhas) process.exitCode = 1
export { login }
