/**
 * Formas e setas nativas do Excel num .xlsx gerado pelo exceljs, que só sabe pôr imagem. Depois de
 * `workbook.xlsx.writeBuffer()`, `injetarDesenhos` abre o arquivo (zip) e acrescenta a parte de desenho de cada aba
 * (DrawingML), ligando tudo nas relações e nos tipos de conteúdo.
 *
 * As posições são dadas em pixels nominais da aba; `criarGrade` converte para âncoras de célula (coluna/linha +
 * deslocamento), que é o que acompanha a grade em qualquer zoom ou escala de tela.
 */
import type JSZip from 'jszip'

const EMU_POR_PX = 9525

/** Largura de coluna do Excel (em caracteres) que dá exatamente `px` pixels na fonte padrão (Calibri 11). */
export const larguraParaPx = (px: number): number => px / 7

export interface Ancora {
  col: number
  dx: number
  lin: number
  dy: number
}

export interface Grade {
  /** Ponto (x, y) em pixels da aba → âncora de célula. */
  ancora: (x: number, y: number) => Ancora
  xDaColuna: (col: number) => number
  yDaLinha: (lin: number) => number
}

/** Grade de uma aba a partir das larguras das colunas e alturas das linhas, em pixels (índices a partir de 0). */
export function criarGrade(largurasPx: number[], alturasPx: number[]): Grade {
  const acumular = (v: number[]): number[] => {
    const out = [0]
    for (const n of v) out.push(out[out.length - 1] + n)
    return out
  }
  const xs = acumular(largurasPx)
  const ys = acumular(alturasPx)
  const localizar = (bordas: number[], p: number): [number, number] => {
    const max = bordas.length - 2
    let lo = 0
    let hi = max
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1
      if (bordas[m] <= p) lo = m
      else hi = m - 1
    }
    return [lo, Math.max(0, p - bordas[lo])]
  }
  return {
    ancora: (x, y) => {
      const [col, dx] = localizar(xs, x)
      const [lin, dy] = localizar(ys, y)
      return { col, dx, lin, dy }
    },
    xDaColuna: (col) => xs[Math.min(col, xs.length - 1)],
    yDaLinha: (lin) => ys[Math.min(lin, ys.length - 1)]
  }
}

interface FormaBase {
  nome?: string
}
/** Retângulo, retângulo arredondado ou losango preenchido (barra, resumo, marco). */
export interface FormaCaixa extends FormaBase {
  tipo: 'retangulo' | 'arredondado' | 'losango'
  x: number
  y: number
  largura: number
  altura: number
  /** Cor de preenchimento, RRGGBB. */
  cor: string
  borda?: string
  /** Rótulo dentro da forma (ex.: % ou nome curto). */
  texto?: string
  corTexto?: string
}
/** Linha quebrada com seta na ponta (ligação entre tarefas). */
export interface FormaLinha extends FormaBase {
  tipo: 'linha'
  pontos: Array<[number, number]>
  cor: string
  seta?: boolean
  tracejada?: boolean
}
export type Forma = FormaCaixa | FormaLinha

export interface DesenhoDaAba {
  /** `worksheet.id` do exceljs (a parte fica em `xl/worksheets/sheet{id}.xml`). */
  abaId: number
  grade: Grade
  formas: Forma[]
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const emu = (px: number): number => Math.round(px * EMU_POR_PX)

function xmlAncoras(g: Grade, x0: number, y0: number, x1: number, y1: number): string {
  const a = g.ancora(x0, y0)
  const b = g.ancora(x1, y1)
  const p = (t: string, n: Ancora): string =>
    `<xdr:${t}><xdr:col>${n.col}</xdr:col><xdr:colOff>${emu(n.dx)}</xdr:colOff><xdr:row>${n.lin}</xdr:row><xdr:rowOff>${emu(n.dy)}</xdr:rowOff></xdr:${t}>`
  return p('from', a) + p('to', b)
}

function xmlCaixa(f: FormaCaixa, id: number, g: Grade): string {
  const geom = f.tipo === 'losango' ? 'diamond' : f.tipo === 'arredondado' ? 'roundRect' : 'rect'
  const linha = f.borda
    ? `<a:ln w="6350"><a:solidFill><a:srgbClr val="${f.borda}"/></a:solidFill></a:ln>`
    : '<a:ln><a:noFill/></a:ln>'
  const texto = f.texto
    ? `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" wrap="none" lIns="18000" tIns="0" rIns="18000" bIns="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="l"/><a:r><a:rPr lang="pt-BR" sz="700" b="0"><a:solidFill><a:srgbClr val="${f.corTexto ?? 'FFFFFF'}"/></a:solidFill></a:rPr><a:t>${esc(f.texto)}</a:t></a:r></a:p></xdr:txBody>`
    : ''
  return (
    `<xdr:twoCellAnchor editAs="twoCell">${xmlAncoras(g, f.x, f.y, f.x + f.largura, f.y + f.altura)}` +
    `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${esc(f.nome ?? `Forma ${id}`)}"/><xdr:cNvSpPr/></xdr:nvSpPr>` +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(f.largura)}" cy="${emu(f.altura)}"/></a:xfrm>` +
    `<a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${f.cor}"/></a:solidFill>${linha}</xdr:spPr>` +
    `${texto}</xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`
  )
}

function xmlLinha(f: FormaLinha, id: number, g: Grade): string {
  const xs = f.pontos.map((p) => p[0])
  const ys = f.pontos.map((p) => p[1])
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const w = Math.max(...xs) - x0
  const h = Math.max(...ys) - y0
  // caminho em unidades de EMU relativas à caixa da forma (largura ou altura zero é válido para linha reta)
  const pt = (p: [number, number]): string => `<a:pt x="${emu(p[0] - x0)}" y="${emu(p[1] - y0)}"/>`
  const caminho =
    `<a:moveTo>${pt(f.pontos[0])}</a:moveTo>` +
    f.pontos
      .slice(1)
      .map((p) => `<a:lnTo>${pt(p)}</a:lnTo>`)
      .join('')
  return (
    `<xdr:twoCellAnchor editAs="twoCell">${xmlAncoras(g, x0, y0, x0 + w, y0 + h)}` +
    `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${esc(f.nome ?? `Ligação ${id}`)}"/><xdr:cNvSpPr/></xdr:nvSpPr>` +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>` +
    `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/>` +
    `<a:pathLst><a:path w="${emu(w)}" h="${emu(h)}" fill="none">${caminho}</a:path></a:pathLst></a:custGeom>` +
    `<a:noFill/><a:ln w="9525" cap="flat"><a:solidFill><a:srgbClr val="${f.cor}"/></a:solidFill>` +
    `${f.tracejada ? '<a:prstDash val="dash"/>' : ''}<a:miter lim="800000"/>` +
    `${f.seta === false ? '' : '<a:tailEnd type="triangle" w="med" len="med"/>'}</a:ln></xdr:spPr>` +
    `</xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`
  )
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const RELS_VAZIO = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`

async function ler(zip: JSZip, caminho: string): Promise<string | null> {
  const f = zip.file(caminho)
  return f ? f.async('string') : null
}

/**
 * Acrescenta os desenhos ao .xlsx (buffer do exceljs) e devolve o arquivo final. Marca também a proteção da aba
 * para cobrir os objetos, quando a aba está protegida: sem isso as formas continuam arrastáveis.
 */
export async function injetarDesenhos(
  arquivo: ArrayBuffer | Uint8Array,
  desenhos: DesenhoDaAba[]
): Promise<Uint8Array> {
  const { default: JSZipLib } = await import('jszip')
  const zip = await JSZipLib.loadAsync(arquivo)
  let tipos = (await ler(zip, '[Content_Types].xml')) ?? ''
  const novosTipos: string[] = []

  for (const d of desenhos) {
    if (d.formas.length === 0) continue
    const caminhoAba = `xl/worksheets/sheet${d.abaId}.xml`
    const xmlAba = await ler(zip, caminhoAba)
    if (!xmlAba) throw new Error(`Aba ${d.abaId} não encontrada no arquivo gerado.`)

    const nomeDesenho = `desenhoIw${d.abaId}.xml`
    const corpo = d.formas.map((f, i) =>
      f.tipo === 'linha' ? xmlLinha(f, i + 2, d.grade) : xmlCaixa(f, i + 2, d.grade)
    )
    zip.file(
      `xl/drawings/${nomeDesenho}`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}">` +
        corpo.join('') +
        `</xdr:wsDr>`
    )
    novosTipos.push(
      `<Override PartName="/xl/drawings/${nomeDesenho}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
    )

    // relação aba → desenho
    const caminhoRels = `xl/worksheets/_rels/sheet${d.abaId}.xml.rels`
    const rels = (await ler(zip, caminhoRels)) ?? RELS_VAZIO
    const rIdAba = 'rIdDesenhoIw'
    zip.file(
      caminhoRels,
      rels.replace(
        '</Relationships>',
        `<Relationship Id="${rIdAba}" Type="${REL}/drawing" Target="../drawings/${nomeDesenho}"/></Relationships>`
      )
    )

    // <drawing> entra depois de pageSetup/headerFooter e antes de legacyDrawing, tableParts e extLst
    let nova = xmlAba.includes('xmlns:r=')
      ? xmlAba
      : xmlAba.replace('<worksheet ', `<worksheet xmlns:r="${REL}" `)
    const marca = `<drawing r:id="${rIdAba}"/>`
    const antes = ['<legacyDrawing', '<tableParts', '<extLst', '</worksheet>'].find((t) =>
      nova.includes(t)
    )!
    nova = nova.replace(antes, marca + antes)
    // proteção da aba também para objetos e cenários
    nova = nova.replace(/<sheetProtection ([^>]*?)\/>/, (m: string, attrs: string) =>
      /objects=/.test(attrs) ? m : `<sheetProtection ${attrs} objects="1" scenarios="1"/>`
    )
    zip.file(caminhoAba, nova)
  }

  tipos = tipos.replace('</Types>', `${novosTipos.join('')}</Types>`)
  zip.file('[Content_Types].xml', tipos)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
