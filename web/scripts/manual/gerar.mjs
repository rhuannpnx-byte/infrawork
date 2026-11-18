// Gera os manuais do usuário em PDF a partir dos textos em Markdown desta pasta e das capturas de tela.
//
//   node scripts/manual/gerar.mjs [web|campo]        (sem argumento, gera os dois)
//
// O texto usa um Markdown enxuto: # capítulo, ## seção, ### subseção, listas, tabelas, **negrito**, *itálico*,
// [[Rótulo da tela]] para botões e menus, ![Legenda](arquivo.png) para figuras e blocos :::nota, :::atencao e
// :::dica fechados por :::. O sumário recebe os números de página numa segunda passada.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const AQUI = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(AQUI, '../..')
const SAIDA = resolve(WEB, '../manuais')
const FONTE = pathToFileURL(
  join(WEB, 'node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2')
).href
const FONTE_EXT = pathToFileURL(
  join(WEB, 'node_modules/@fontsource-variable/archivo/files/archivo-latin-ext-wght-normal.woff2')
).href

const MANUAIS = {
  web: {
    prefixo: 'web-',
    imagens: 'imagens/web',
    titulo: 'InfraWork Web',
    subtitulo: 'Manual do usuário',
    descricao: 'Orçamento, planejamento e acompanhamento de obras de infraestrutura',
    saida: 'InfraWork - Manual do usuario - Web.pdf'
  },
  campo: {
    prefixo: 'campo-',
    imagens: 'imagens/campo',
    titulo: 'InfraWork Campo',
    subtitulo: 'Manual do usuário',
    descricao: 'Aplicativo para celular: produção, viagens e fotos direto da frente de serviço',
    saida: 'InfraWork - Manual do usuario - App de campo.pdf'
  }
}

const VERSAO = process.env.MANUAL_VERSAO ?? '1.0'
const DATA = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

// ---------------------------------------------------------------- Markdown enxuto

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function inline(t) {
  return esc(t)
    .replace(/\[\[(.+?)\]\]/g, '<span class="ui">$1</span>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
    .replace(/ › /g, ' <span class="seta">›</span> ')
}

const slug = (t) =>
  t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Converte o texto em HTML e devolve também os títulos (para o sumário e a busca das páginas). */
function converter(md, dirImagens) {
  const linhas = md.replace(/\r\n/g, '\n').split('\n')
  const html = []
  const titulos = []
  let cap = 0
  let sec = 0
  let sub = 0
  let fig = 0
  let i = 0
  const lista = (re, tag, classe) => {
    const itens = []
    while (i < linhas.length && re.test(linhas[i])) {
      let item = inline(linhas[i].replace(re, ''))
      const sub = []
      i++
      // linha recuada: subitem ("   - …") ou continuação do item
      while (i < linhas.length && /^ {2,}\S/.test(linhas[i]) && !re.test(linhas[i])) {
        const t = linhas[i].trim()
        if (/^- /.test(t)) sub.push(inline(t.slice(2)))
        else if (sub.length) sub[sub.length - 1] += ' ' + inline(t)
        else item += ' ' + inline(t)
        i++
      }
      const subLista = sub.length ? `<ul class="sub">${sub.map((s) => `<li>${s}</li>`).join('')}</ul>` : ''
      itens.push(`<li>${item}${subLista}</li>`)
    }
    const classes = [classe, itens.length <= 4 ? 'curta' : ''].filter(Boolean).join(' ')
    html.push(`<${tag}${classes ? ` class="${classes}"` : ''}>${itens.join('')}</${tag}>`)
  }
  while (i < linhas.length) {
    const l = linhas[i]
    if (!l.trim()) {
      i++
      continue
    }
    let m
    if ((m = /^# (.+)$/.exec(l))) {
      cap++
      sec = 0
      const id = `c${cap}`
      titulos.push({ nivel: 1, num: `${cap}`, texto: m[1], id })
      html.push(
        `<section class="capitulo" id="${id}"><div class="cap-num">Capítulo ${cap}</div><h1>${inline(m[1])}</h1></section>`
      )
      i++
      continue
    }
    if ((m = /^## (.+)$/.exec(l))) {
      sec++
      sub = 0
      const num = `${cap}.${sec}`
      const id = `s${cap}-${sec}`
      titulos.push({ nivel: 2, num, texto: m[1], id })
      html.push(`<h2 id="${id}"><span class="num">${num}</span>${inline(m[1])}</h2>`)
      i++
      continue
    }
    if ((m = /^### (.+)$/.exec(l))) {
      sub++
      html.push(`<h3 id="${slug(m[1])}-${cap}-${sec}-${sub}">${inline(m[1])}</h3>`)
      i++
      continue
    }
    if ((m = /^#### (.+)$/.exec(l))) {
      html.push(`<h4>${inline(m[1])}</h4>`)
      i++
      continue
    }
    if (/^<!-- *quebra *-->$/.test(l.trim())) {
      html.push('<div class="quebra"></div>')
      i++
      continue
    }
    if ((m = /^!\[(.*?)\]\((.+?)\)(\{(.+?)\})?$/.exec(l.trim()))) {
      fig++
      const arq = join(dirImagens, m[2])
      if (!existsSync(arq)) console.warn(`  ! imagem ausente: ${m[2]}`)
      const classe = m[4] ? ` ${m[4]}` : ''
      // o parágrafo que apresenta a figura vai junto dela para a próxima página, se for o caso
      const anterior = html.length - 1
      if (anterior >= 0 && html[anterior].startsWith('<p>')) html[anterior] = '<p class="antes-fig">' + html[anterior].slice(3)
      html.push(
        `<figure class="fig${classe}"><img src="${pathToFileURL(arq).href}" alt="${esc(m[1])}"><figcaption><span>Figura ${fig}</span>${inline(m[1])}</figcaption></figure>`
      )
      i++
      continue
    }
    if ((m = /^:::(nota|atencao|dica|exemplo)\s*(.*)$/.exec(l))) {
      const tipo = m[1]
      const rotulo =
        m[2] || { nota: 'Nota', atencao: 'Atenção', dica: 'Dica', exemplo: 'Exemplo' }[tipo]
      i++
      const corpo = []
      while (i < linhas.length && linhas[i].trim() !== ':::') corpo.push(linhas[i++])
      i++
      const dentro = converter(corpo.join('\n'), dirImagens).html
      html.push(`<aside class="caixa ${tipo}"><div class="rotulo">${esc(rotulo)}</div>${dentro}</aside>`)
      continue
    }
    if (/^\|/.test(l)) {
      const linhasTab = []
      while (i < linhas.length && /^\|/.test(linhas[i])) linhasTab.push(linhas[i++])
      const celulas = (x) =>
        x
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim())
      const cab = celulas(linhasTab[0])
      const corpo = linhasTab.slice(2).map(celulas)
      html.push(
        `<table${corpo.length <= 6 ? ' class="curta"' : ''}><thead><tr>${cab.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${corpo
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      )
      continue
    }
    if (/^\d+\. /.test(l)) {
      lista(/^\d+\. /, 'ol', 'passos')
      continue
    }
    if (/^- /.test(l)) {
      lista(/^- /, 'ul')
      continue
    }
    // parágrafo: junta as linhas seguidas
    const par = [l.trim()]
    i++
    while (
      i < linhas.length &&
      linhas[i].trim() &&
      !/^(#|- |\d+\. |\||!\[|:::|<!--)/.test(linhas[i].trim())
    )
      par.push(linhas[i++].trim())
    html.push(`<p>${inline(par.join(' '))}</p>`)
  }
  return { html: html.join('\n'), titulos }
}

// ---------------------------------------------------------------- Páginas

const CSS = `
@font-face { font-family: 'Archivo'; src: url('${FONTE}') format('woff2'); font-weight: 100 900;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329,
  U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: 'Archivo'; src: url('${FONTE_EXT}') format('woff2'); font-weight: 100 900;
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329,
  U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
:root {
  --tinta: oklch(21% 0.006 280);
  --apagado: oklch(41% 0.008 90);
  --fraco: oklch(55% 0.009 90);
  --linha: oklch(86% 0.009 90);
  --fundo: oklch(97.6% 0.004 90);
  --painel: oklch(95.4% 0.006 90);
  --acento: oklch(41% 0.165 266);
  --acento-claro: oklch(95% 0.03 266);
  --sucesso: oklch(45% 0.1 158);
  --aviso: oklch(49% 0.105 75);
  --perigo: oklch(46% 0.155 28);
}
@page { size: A4; margin: 22mm 18mm 20mm 18mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'Archivo', sans-serif; font-size: 10pt; line-height: 1.55; color: var(--tinta); margin: 0;
  font-variant-numeric: tabular-nums; hyphens: auto; }
p { margin: 0 0 7pt; orphans: 3; widows: 3; text-align: left; }
strong { font-weight: 650; }
code { font-family: 'Consolas', monospace; font-size: 8.8pt; background: var(--painel); padding: 0 3pt;
  border-radius: 2pt; }
.ui { font-weight: 600; color: var(--acento); white-space: nowrap; }
.seta { color: var(--fraco); }

.capitulo { break-before: page; padding-top: 18mm; margin-bottom: 8mm; border-bottom: 1.2pt solid var(--tinta);
  padding-bottom: 6mm; }
.cap-num { font-size: 9pt; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--acento); }
h1 { font-size: 26pt; line-height: 1.12; font-weight: 700; letter-spacing: -0.01em; margin: 4pt 0 0; }
h2 { font-size: 14.5pt; font-weight: 680; margin: 18pt 0 6pt; break-after: avoid; padding-top: 4pt;
  border-top: 0.6pt solid var(--linha); }
h2 .num { color: var(--acento); margin-right: 8pt; font-weight: 600; }
h3 { font-size: 11.5pt; font-weight: 650; margin: 13pt 0 4pt; break-after: avoid; }
h4 { font-size: 10pt; font-weight: 650; margin: 10pt 0 3pt; color: var(--apagado); text-transform: uppercase;
  letter-spacing: .06em; font-size: 8.5pt; break-after: avoid; }
ul, ol { margin: 0 0 8pt; padding-left: 15pt; }
li { margin: 0 0 3pt; }
ol.passos { list-style: none; counter-reset: passo; padding-left: 0; }
ol.passos > li { counter-increment: passo; position: relative; padding-left: 22pt; margin-bottom: 5pt;
  break-inside: avoid; }
ol.passos > li::before { content: counter(passo); position: absolute; left: 0; top: 0.5pt; width: 14pt;
  height: 14pt; border-radius: 50%; background: var(--acento); color: white; font-size: 7.5pt; font-weight: 700;
  display: flex; align-items: center; justify-content: center; }
ul.sub { margin: 3pt 0 1pt; padding-left: 13pt; }
ul.sub li { margin-bottom: 1.5pt; }

figure.fig { margin: 8pt 0 12pt; break-inside: avoid; text-align: center; }
p.antes-fig { break-after: avoid; }
figure.fig img { max-width: 100%; max-height: 118mm; border: 0.6pt solid var(--linha); border-radius: 3pt;
  box-shadow: 0 1pt 4pt rgba(0,0,0,.08); }
figure.fig.celular img { max-height: 120mm; border-radius: 9pt; border: 1.6pt solid var(--tinta); }
figure.fig.dupla { display: inline-block; width: 48%; vertical-align: top; margin-right: 1.5%; }
figure.fig.pequena img { max-height: 70mm; }
figcaption { font-size: 8.5pt; color: var(--apagado); margin-top: 4pt; }
figcaption span { font-weight: 650; color: var(--tinta); margin-right: 5pt; }

table { width: 100%; border-collapse: collapse; margin: 6pt 0 11pt; font-size: 8.8pt; break-inside: auto; }
table.curta, ul.curta, ol.curta { break-inside: avoid; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { text-align: left; font-weight: 650; background: var(--painel); border-bottom: 1pt solid var(--tinta);
  padding: 4pt 6pt; }
td { border-bottom: 0.5pt solid var(--linha); padding: 4pt 6pt; vertical-align: top; }

.caixa { border: 0.8pt solid var(--linha); border-left-width: 0.8pt; border-radius: 3pt; padding: 7pt 10pt 4pt;
  margin: 8pt 0 11pt; break-inside: avoid; background: var(--fundo); }
.caixa .rotulo { font-size: 7.5pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  margin-bottom: 3pt; }
.caixa.nota .rotulo { color: var(--acento); }
.caixa.nota { background: var(--acento-claro); border-color: oklch(85% 0.05 266); }
.caixa.atencao .rotulo { color: var(--perigo); }
.caixa.atencao { background: oklch(96.5% 0.02 40); border-color: oklch(85% 0.05 40); }
.caixa.dica .rotulo { color: var(--sucesso); }
.caixa.dica { background: oklch(96.5% 0.02 158); border-color: oklch(85% 0.04 158); }
.caixa.exemplo .rotulo { color: var(--aviso); }
.caixa p:last-child, .caixa ul:last-child, .caixa ol:last-child { margin-bottom: 4pt; }
.quebra { break-after: page; }

/* sumário */
.sumario h1 { font-size: 22pt; margin: 0 0 10mm; padding-bottom: 4mm; border-bottom: 1.2pt solid var(--tinta); }
.sumario .entrada { display: flex; align-items: baseline; gap: 6pt; }
.sumario .entrada a { color: inherit; text-decoration: none; display: contents; }
.sumario .n1 { font-weight: 650; font-size: 10.5pt; margin-top: 7pt; }
.sumario .n2 { font-size: 9.5pt; padding-left: 17pt; color: var(--apagado); margin-top: 1.5pt; }
.sumario .num { min-width: 17pt; color: var(--acento); }
.sumario .n2 .num { min-width: 24pt; color: var(--fraco); }
.sumario .pontos { flex: 1; border-bottom: 0.6pt dotted var(--linha); transform: translateY(-2.5pt); }
.sumario .pag { min-width: 16pt; text-align: right; }

/* páginas de abertura */
.abertura { break-after: page; }
.abertura h1 { font-size: 20pt; margin-bottom: 8mm; }
.abertura .ficha { margin-top: 10mm; font-size: 9pt; color: var(--apagado); }
.abertura .ficha td { border: none; padding: 1.5pt 10pt 1.5pt 0; }
`

function htmlCorpo(m, conteudo, paginas) {
  const sumario = conteudo.titulos
    .map((t) => {
      const pag = paginas?.get(t.id) ?? '00'
      return `<div class="entrada n${t.nivel}"><a href="#${t.id}"><span class="num">${t.num}</span><span class="txt">${inline(t.texto)}</span><span class="pontos"></span><span class="pag">${pag}</span></a></div>`
    })
    .join('\n')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${m.titulo} · ${m.subtitulo}</title>
<style>${CSS}</style></head><body>
<section class="sumario abertura"><h1>Sumário</h1>${sumario}</section>
${conteudo.html}
</body></html>`
}

function htmlCapa(m) {
  const marca = readFileSync(join(WEB, '../campo/public/logo-wordmark.svg'), 'utf8')
    .replace(/<\?xml[^>]*>/, '')
    .replace(/<!DOCTYPE[^>]*>/, '')
    .replace(/fill="#e6e8eb"/, 'fill="oklch(98% 0.004 90)"')
    .replace(/width="[^"]*pt" height="[^"]*pt"/, 'width="100%" height="100%"')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
${CSS}
@page { size: A4; margin: 0; }
body { margin: 0; }
.capa { width: 210mm; height: 297mm; position: relative; overflow: hidden; color: oklch(98% 0.004 90);
  background: linear-gradient(160deg, oklch(30% 0.12 266) 0%, oklch(22% 0.07 266) 70%, oklch(19% 0.04 266) 100%); }
.capa svg.curvas { position: absolute; inset: 0; opacity: .13; }
.capa .marca { position: absolute; left: 14mm; top: 22mm; width: 92mm; height: 61mm; }
.capa .titulo { position: absolute; left: 22mm; right: 22mm; bottom: 72mm; }
.capa .tipo { font-size: 11pt; letter-spacing: .22em; text-transform: uppercase; font-weight: 600;
  color: oklch(80% 0.07 266); }
.capa h1 { font-size: 40pt; line-height: 1.05; margin: 6mm 0 5mm; font-weight: 720; color: white;
  letter-spacing: -0.015em; }
.capa .desc { font-size: 13pt; max-width: 135mm; color: oklch(88% 0.02 266); line-height: 1.4; }
.capa .rodape { position: absolute; left: 22mm; right: 22mm; bottom: 20mm; display: flex;
  justify-content: space-between; font-size: 9pt; color: oklch(78% 0.03 266); border-top: 0.6pt solid
  oklch(55% 0.06 266); padding-top: 4mm; }
</style></head><body><div class="capa">
<svg class="curvas" viewBox="0 0 210 297" preserveAspectRatio="none">${Array.from({ length: 22 }, (_, k) => {
    const y = 120 + k * 9
    return `<path d="M -10 ${y} C 50 ${y - 30 - k}, 120 ${y + 25}, 220 ${y - 18 - k * 0.6}" fill="none" stroke="white" stroke-width="0.35"/>`
  }).join('')}</svg>
<div class="marca">${marca}</div>
<div class="titulo"><div class="tipo">${m.subtitulo}</div><h1>${m.titulo}</h1><div class="desc">${m.descricao}</div></div>
<div class="rodape"><span>Versão ${VERSAO} · ${DATA}</span><span>Documento para os usuários do sistema</span></div>
</div></body></html>`
}

// ---------------------------------------------------------------- Montagem

async function pdf(page, html, arquivo, opcoes) {
  const tmp = arquivo.replace(/\.pdf$/, '.html')
  writeFileSync(tmp, html)
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.pdf({ path: arquivo, format: 'A4', printBackground: true, ...opcoes })
}

/** Página de cada título no PDF do corpo, achada pelo texto do título. */
function paginasDosTitulos(arquivo, titulos) {
  const py = `
import sys, json
from pypdf import PdfReader
r = PdfReader(sys.argv[1])
print(json.dumps([p.extract_text() or '' for p in r.pages]))
`
  const textos = JSON.parse(execFileSync('python', ['-c', py, arquivo], { maxBuffer: 64e6 }).toString())
  const norm = (t) => t.replace(/\s+/g, ' ').replace(/[*`[\]]/g, '').trim()
  const mapa = new Map()
  let desde = 1 // a página 1 é o sumário
  for (const t of titulos) {
    const alvo = norm(t.nivel === 1 ? t.texto : `${t.num} ${t.texto}`)
    const curto = alvo.slice(0, 38)
    for (let p = desde; p < textos.length; p++) {
      if (norm(textos[p]).includes(curto)) {
        mapa.set(t.id, p + 1)
        desde = p
        break
      }
    }
    if (!mapa.has(t.id)) console.warn(`  ! página não encontrada para "${t.texto}"`)
  }
  return mapa
}

async function gerar(chave) {
  const m = MANUAIS[chave]
  // o texto pode estar em vários arquivos (web-1-…, web-2-…), lidos em ordem alfabética
  const md = readdirSync(AQUI)
    .filter((f) => f.startsWith(m.prefixo) && f.endsWith('.md'))
    .sort()
    .map((f) => readFileSync(join(AQUI, f), 'utf8'))
    .join('\n\n')
  const conteudo = converter(md, join(AQUI, m.imagens))
  const tmp = join(AQUI, 'saida')
  mkdirSync(tmp, { recursive: true })
  mkdirSync(SAIDA, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const rodape = `<div style="font-family: Archivo, sans-serif; font-size: 7.5pt; color: #6b6b6b; width: 100%;
    margin: 0 18mm; display: flex; justify-content: space-between; border-top: 0.5pt solid #d8d6d0; padding-top: 2mm;">
    <span>${m.titulo} · ${m.subtitulo} · versão ${VERSAO}</span>
    <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`
  const opcoesCorpo = {
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: rodape,
    margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' },
    outline: true,
    tagged: true
  }
  const corpo = join(tmp, `${chave}-corpo.pdf`)
  await pdf(page, htmlCorpo(m, conteudo, null), corpo, opcoesCorpo)
  // a capa não é numerada: a página 1 do rodapé é o sumário, e o sumário usa a mesma contagem
  const paginas = paginasDosTitulos(corpo, conteudo.titulos)
  await pdf(page, htmlCorpo(m, conteudo, paginas), corpo, opcoesCorpo)
  const capa = join(tmp, `${chave}-capa.pdf`)
  await pdf(page, htmlCapa(m), capa, { margin: { top: 0, bottom: 0, left: 0, right: 0 } })
  await browser.close()

  // capa + corpo, com os metadados do documento
  const final = join(SAIDA, m.saida)
  const juntar = `
import sys
from pypdf import PdfReader, PdfWriter
from PIL import Image
capa, corpo, final, titulo = sys.argv[1:5]
w = PdfWriter()
w.append(PdfReader(capa))
w.append(PdfReader(corpo))
# capturas em ~200 dpi no tamanho impresso: o arquivo fica leve para enviar por e-mail
for p in w.pages:
    for im in p.images:
        pil = im.image
        escala = 1500 / max(pil.width, pil.height)
        if escala < 1 and pil.mode in ('RGB', 'L'):
            im.replace(pil.resize((round(pil.width * escala), round(pil.height * escala)), Image.LANCZOS), quality=78)
w.add_metadata({'/Title': titulo, '/Author': 'InfraWork', '/Subject': 'Manual do usuário', '/Creator': 'InfraWork'})
w.page_mode = '/UseOutlines'
w.write(final)
print(len(w.pages))
`
  const total = execFileSync('python', [
    '-c',
    juntar,
    capa,
    corpo,
    final,
    `${m.titulo} · ${m.subtitulo}`
  ])
    .toString()
    .trim()
  console.log(`${m.saida}: ${total} páginas, ${conteudo.titulos.filter((t) => t.nivel === 1).length} capítulos`)
}

const pedidos = process.argv[2] ? [process.argv[2]] : Object.keys(MANUAIS)
for (const k of pedidos) await gerar(k)
