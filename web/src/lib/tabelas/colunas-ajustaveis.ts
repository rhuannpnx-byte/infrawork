/**
 * Largura das colunas ajustável em todas as tabelas do sistema, sem mexer em cada tela: um observador do documento
 * põe uma alça na borda direita de cada cabeçalho de `<table>` com `<thead>`. Arrastar a alça (ou usar as setas
 * com ela em foco) muda a largura; duplo clique volta a tabela às larguras automáticas. A largura fica guardada no
 * navegador, por tela e pela assinatura do cabeçalho, e volta ao abrir a tela de novo.
 *
 * Para ficar de fora (colunas fixas com deslocamento calculado, grades com largura própria), a tabela ou um
 * ancestral leva `data-sem-ajuste`.
 */
import { storageKey } from '@/lib/storage-keys'

export const LARGURA_MINIMA = 48
const PASSO_TECLADO = 16
const CHAVE = storageKey('tabelas.larguras.v1')
const ALCA = 'data-ajuste-coluna'

// ─── Funções puras (testadas) ───────────────────────────────────────────────

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** Rota sem identificadores: a largura vale para a tela, em qualquer obra ou registro. */
export function normalizarRota(caminho: string): string {
  return caminho.replace(UUID, ':id').replace(/\/+$/, '') || '/'
}

/** Cabeçalho que identifica a tabela; números (contagens, datas) não mudam a assinatura. */
export function assinaturaCabecalho(textos: string[]): string {
  return textos
    .map((t) =>
      t
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\d+([.,/]\d+)*/g, '#')
    )
    .join('¦')
}

/** Largura de cada coluna a partir das células do cabeçalho (a célula que junta colunas divide a largura). */
export function larguraPorColuna(celulas: Array<{ largura: number; span: number }>): number[] {
  const out: number[] = []
  for (const c of celulas) {
    const span = Math.max(1, c.span)
    // para cima: a medida tem fração de pixel, e um pixel a menos já corta o texto com reticências
    for (let i = 0; i < span; i++) out.push(Math.max(LARGURA_MINIMA, Math.ceil(c.largura / span)))
  }
  return out
}

/** Nova lista de larguras com a coluna `i` em `largura` (nunca abaixo do mínimo). */
export function comLargura(larguras: number[], i: number, largura: number): number[] {
  return larguras.map((l, j) => (j === i ? Math.max(LARGURA_MINIMA, Math.round(largura)) : l))
}

// ─── Larguras guardadas ─────────────────────────────────────────────────────

type Guardadas = Record<string, number[]>

function lerGuardadas(): Guardadas {
  try {
    const bruto = localStorage.getItem(CHAVE)
    const v = bruto ? (JSON.parse(bruto) as unknown) : null
    return v && typeof v === 'object' ? (v as Guardadas) : {}
  } catch {
    return {}
  }
}

function gravarGuardadas(chave: string, larguras: number[] | null): void {
  try {
    const todas = lerGuardadas()
    if (larguras) todas[chave] = larguras
    else delete todas[chave]
    localStorage.setItem(CHAVE, JSON.stringify(todas))
  } catch {
    // sem armazenamento (navegação privada, bloqueio): a largura vale até recarregar a tela
  }
}

// ─── Tabela no documento ────────────────────────────────────────────────────

interface Estado {
  chave: string
  aplicada: boolean
}
const estados = new WeakMap<HTMLTableElement, Estado>()

function linhaCabecalho(tabela: HTMLTableElement): HTMLTableRowElement | null {
  const linhas = tabela.tHead?.rows
  return linhas && linhas.length ? linhas[linhas.length - 1] : null
}

function textoCelula(c: HTMLTableCellElement): string {
  return (c.textContent ?? '').trim()
}

function totalColunas(linha: HTMLTableRowElement): number {
  let n = 0
  for (const c of Array.from(linha.cells)) n += Math.max(1, c.colSpan)
  return n
}

function chaveDa(linha: HTMLTableRowElement): string {
  const textos = Array.from(linha.cells).map(textoCelula)
  return `${normalizarRota(window.location.pathname)}|${totalColunas(linha)}|${assinaturaCabecalho(textos)}`
}

/** `<col>` de cada coluna: usa o `<colgroup>` da tela se bater com o número de colunas; senão cria um. */
function colunasDe(tabela: HTMLTableElement, n: number): HTMLTableColElement[] | null {
  const grupos = Array.from(tabela.children).filter(
    (e): e is HTMLTableColElement => e.tagName === 'COLGROUP'
  )
  const existentes = grupos.flatMap((g) => Array.from(g.children) as HTMLTableColElement[])
  if (existentes.length === n) return existentes
  if (grupos.length) return null
  const grupo = document.createElement('colgroup')
  grupo.setAttribute('data-ajuste-colunas', '')
  for (let i = 0; i < n; i++) grupo.appendChild(document.createElement('col'))
  tabela.insertBefore(grupo, tabela.firstChild)
  return Array.from(grupo.children) as HTMLTableColElement[]
}

function larguras(tabela: HTMLTableElement, n: number): number[] | null {
  const cols = colunasDe(tabela, n)
  if (!cols) return null
  const ja = cols.map((c) => parseFloat(c.style.width))
  if (tabela.dataset.colunasAjustadas && ja.every((l) => Number.isFinite(l))) return ja
  const linha = linhaCabecalho(tabela)
  if (!linha) return null
  return larguraPorColuna(
    Array.from(linha.cells).map((c) => ({
      largura: c.getBoundingClientRect().width,
      span: c.colSpan
    }))
  )
}

function aplicar(tabela: HTMLTableElement, ls: number[]): void {
  const cols = colunasDe(tabela, ls.length)
  if (!cols) return
  cols.forEach((c, i) => (c.style.width = `${ls[i]}px`))
  tabela.style.tableLayout = 'fixed'
  tabela.style.width = `${ls.reduce((s, l) => s + l, 0)}px`
  tabela.style.minWidth = '0'
  tabela.dataset.colunasAjustadas = '1'
  atualizarAlcas(tabela, ls)
}

function limpar(tabela: HTMLTableElement): void {
  if (!tabela.dataset.colunasAjustadas) return
  for (const g of Array.from(tabela.children)) {
    if (g.tagName !== 'COLGROUP') continue
    if (g.hasAttribute('data-ajuste-colunas')) g.remove()
    else for (const c of Array.from(g.children) as HTMLElement[]) c.style.width = ''
  }
  tabela.style.tableLayout = ''
  tabela.style.width = ''
  tabela.style.minWidth = ''
  delete tabela.dataset.colunasAjustadas
}

function atualizarAlcas(tabela: HTMLTableElement, ls: number[]): void {
  const linha = linhaCabecalho(tabela)
  if (!linha) return
  let col = 0
  for (const c of Array.from(linha.cells)) {
    col += Math.max(1, c.colSpan)
    const alca = c.querySelector<HTMLElement>(`:scope > [${ALCA}]`)
    if (alca && ls[col - 1] != null) alca.setAttribute('aria-valuenow', String(ls[col - 1]))
  }
}

/** Ajusta a coluna `i` da tabela e guarda o resultado. */
function ajustar(tabela: HTMLTableElement, i: number, largura: (atual: number) => number): void {
  const linha = linhaCabecalho(tabela)
  if (!linha) return
  const n = totalColunas(linha)
  const ls = larguras(tabela, n)
  if (!ls) return
  const novas = comLargura(ls, i, largura(ls[i]))
  aplicar(tabela, novas)
  const est = estados.get(tabela)
  if (est) gravarGuardadas(est.chave, novas)
}

function criarAlca(
  tabela: HTMLTableElement,
  celula: HTMLTableCellElement,
  coluna: number
): HTMLElement {
  const alca = document.createElement('span')
  alca.setAttribute(ALCA, '')
  alca.className = 'ajuste-coluna'
  alca.setAttribute('role', 'separator')
  alca.setAttribute('aria-orientation', 'vertical')
  alca.setAttribute('aria-valuemin', String(LARGURA_MINIMA))
  alca.setAttribute('aria-valuemax', '2000')
  alca.setAttribute('aria-valuenow', String(Math.round(celula.getBoundingClientRect().width)))
  const nome = textoCelula(celula) || `coluna ${coluna + 1}`
  alca.setAttribute('aria-label', `Largura da coluna ${nome}`)
  alca.title = 'Arraste para mudar a largura. Duplo clique volta às larguras automáticas.'
  alca.tabIndex = 0

  // a alça fica dentro do cabeçalho: não deixa o clique ordenar a coluna
  alca.addEventListener('click', (e) => e.stopPropagation())
  alca.addEventListener('dblclick', (e) => {
    e.preventDefault()
    e.stopPropagation()
    limpar(tabela)
    const est = estados.get(tabela)
    if (est) gravarGuardadas(est.chave, null)
  })
  alca.addEventListener('keydown', (e) => {
    const passo = (e.shiftKey ? 4 : 1) * PASSO_TECLADO
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      e.stopPropagation()
      ajustar(tabela, coluna, (l) => l + (e.key === 'ArrowRight' ? passo : -passo))
    }
  })
  alca.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const linha = linhaCabecalho(tabela)
    if (!linha) return
    const n = totalColunas(linha)
    const inicial = larguras(tabela, n)
    if (!inicial) return
    aplicar(tabela, inicial)
    const x0 = e.clientX
    const l0 = inicial[coluna]
    alca.setPointerCapture(e.pointerId)
    alca.setAttribute('data-arrastando', '')
    const selecaoAntes = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    let atuais = inicial
    const mover = (ev: PointerEvent): void => {
      atuais = comLargura(atuais, coluna, l0 + ev.clientX - x0)
      aplicar(tabela, atuais)
    }
    const soltar = (): void => {
      alca.removeEventListener('pointermove', mover)
      alca.removeEventListener('pointerup', soltar)
      alca.removeEventListener('pointercancel', soltar)
      alca.removeAttribute('data-arrastando')
      document.body.style.userSelect = selecaoAntes
      const est = estados.get(tabela)
      if (est) gravarGuardadas(est.chave, atuais)
    }
    alca.addEventListener('pointermove', mover)
    alca.addEventListener('pointerup', soltar)
    alca.addEventListener('pointercancel', soltar)
  })
  return alca
}

/** Prepara uma tabela: alças nos cabeçalhos e, se houver, as larguras guardadas. */
function preparar(tabela: HTMLTableElement): void {
  if (tabela.closest('[data-sem-ajuste]')) return
  const linha = linhaCabecalho(tabela)
  if (!linha || totalColunas(linha) < 2) return

  const chave = chaveDa(linha)
  let est = estados.get(tabela)
  if (!est || est.chave !== chave) {
    // colunas mudaram (outra tela no mesmo elemento, coluna escondida): recomeça do automático
    if (est) limpar(tabela)
    est = { chave, aplicada: false }
    estados.set(tabela, est)
  }

  let coluna = 0
  for (const celula of Array.from(linha.cells)) {
    coluna += Math.max(1, celula.colSpan)
    if (celula.colSpan > 1 || celula.querySelector(`:scope > [${ALCA}]`)) continue
    if (getComputedStyle(celula).position === 'static') celula.style.position = 'relative'
    celula.appendChild(criarAlca(tabela, celula, coluna - 1))
  }

  // larguras guardadas: só com a tabela visível (aba escondida mede zero)
  if (!est.aplicada && tabela.offsetWidth > 0) {
    est.aplicada = true
    const guardadas = lerGuardadas()[chave]
    if (guardadas && guardadas.length === totalColunas(linha)) aplicar(tabela, guardadas)
  }
}

function varrer(): void {
  for (const t of Array.from(document.querySelectorAll('table'))) preparar(t)
}

/** Liga o ajuste de colunas no documento inteiro (telas, diálogos e painéis). Devolve a função que desliga. */
export function iniciarColunasAjustaveis(): () => void {
  let agendado = false
  let ultima = 0
  const agendar = (): void => {
    if (agendado) return
    agendado = true
    // no máximo uma varredura a cada 200 ms: gráficos e o cronograma mexem muito no documento
    const espera = Math.max(0, 200 - (performance.now() - ultima))
    window.setTimeout(() => {
      requestAnimationFrame(() => {
        agendado = false
        ultima = performance.now()
        varrer()
      })
    }, espera)
  }
  const observador = new MutationObserver(agendar)
  observador.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    // a troca de aba esconde e mostra a tela por classe ou estilo
    attributeFilter: ['class', 'hidden', 'style']
  })
  agendar()
  return () => observador.disconnect()
}

// ─── Grades que não são <table> (ex.: planilha orçamentária virtualizada) ───

/** Larguras guardadas de uma grade própria (mesmo armazenamento das tabelas). */
export function lerLarguras(chave: string): number[] | null {
  const v = lerGuardadas()[chave]
  return Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? v : null
}

/** Guarda (ou apaga, com `null`) as larguras de uma grade própria. */
export function gravarLarguras(chave: string, larguras: number[] | null): void {
  gravarGuardadas(chave, larguras)
}
