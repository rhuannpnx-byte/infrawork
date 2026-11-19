/**
 * Aba "Gantt" do relatório de viabilidade: colunas fixas com a estrutura de tópicos do plano, grade de tempo e as
 * barras desenhadas como formas do Excel, com as setas das predecessoras. A aba é protegida (só visualização).
 */
import type { Workbook, Worksheet, Borders, Fill, PaperSize } from 'exceljs'
import { criarGrade, larguraParaPx, type DesenhoDaAba, type Forma } from '@/lib/excel/desenho-xlsx'
import type { LigacaoGantt, LinhaGantt } from './tipos'

const DIA_MS = 86_400_000
const ALTURA_LINHA = 20
const ALTURA_BARRA = 11
const ALTURA_RESUMO = 5
const FOLGA_SETA = 6

const COR = {
  cabecalho: '1F2937',
  cabecalhoTexto: 'FFFFFF',
  resumoFundo: 'F3F4F6',
  linha: 'ECEEF1',
  linhaMes: 'C3C8D0',
  tarefa: '2F5597',
  critica: 'C0392B',
  resumo: '111827',
  marco: '7C3AED',
  seta: '6B7280',
  texto: '111827',
  textoFraco: '6B7280'
}

const utc = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
const dataBR = (iso: string | null): string =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

const COLUNAS_FIXAS: Array<{ titulo: string; px: number }> = [
  { titulo: 'Nº', px: 38 },
  { titulo: 'EAP', px: 66 },
  { titulo: 'Tarefa', px: 310 },
  { titulo: 'Duração', px: 60 },
  { titulo: 'Início', px: 76 },
  { titulo: 'Término', px: 76 },
  { titulo: 'Predecessoras', px: 104 }
]
const LINHAS_CABECALHO = 3

const fundo = (cor: string): Fill => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: `FF${cor}` }
})

export interface EscalaGantt {
  /** Dias por coluna da grade de tempo (1 = diária, 7 = semanal). */
  diasPorColuna: 1 | 7
  pxPorDia: number
  inicioMs: number
  colunas: number
}

/** Escala da grade: diária em plano curto, semanal nos demais; começa na segunda-feira da semana do início. */
export function escalaDoPlano(inicioISO: string, fimISO: string): EscalaGantt {
  const ini = utc(inicioISO)
  const fim = Math.max(utc(fimISO), ini)
  // segunda-feira anterior (getUTCDay: 0 = domingo)
  const recuo = (new Date(ini).getUTCDay() + 6) % 7
  const inicioMs = ini - recuo * DIA_MS
  const dias = Math.round((fim - inicioMs) / DIA_MS) + 1
  if (dias <= 126)
    return { diasPorColuna: 1, pxPorDia: 16, inicioMs, colunas: Math.ceil((dias + 7) / 7) * 7 }
  return { diasPorColuna: 7, pxPorDia: 4, inicioMs, colunas: Math.ceil(dias / 7) + 2 }
}

/**
 * Caminho da seta entre duas tarefas, em pixels. Sai da ponta da predecessora (fim nas ligações T*, início nas I*)
 * e chega na ponta da sucessora (início nas *I, fim nas *T), sempre em trechos horizontais e verticais.
 */
export function rotaDaLigacao(
  tipo: LigacaoGantt['tipo'],
  pred: { x0: number; x1: number; yMeio: number },
  suc: { x0: number; x1: number; yMeio: number; yTopo: number; yBase: number }
): Array<[number, number]> {
  const saiDoFim = tipo === 'TI' || tipo === 'TT' || tipo === 'EST'
  const chegaNoInicio = tipo === 'TI' || tipo === 'II' || tipo === 'EST'
  const sai = saiDoFim ? 1 : -1
  const entra = chegaNoInicio ? 1 : -1
  const p0: [number, number] = [saiDoFim ? pred.x1 : pred.x0, pred.yMeio]
  const p1: [number, number] = [chegaNoInicio ? suc.x0 : suc.x1, suc.yMeio]
  if (pred.yMeio === suc.yMeio) return [p0, p1]
  const abaixo = suc.yMeio > pred.yMeio
  const xDobra = p0[0] + sai * FOLGA_SETA
  const xChegada = p1[0] - entra * FOLGA_SETA
  // caminho direto: desce (ou sobe) e entra pela borda da sucessora, quando ela começa depois da dobra
  if (sai === entra && (xChegada - xDobra) * sai >= 0) {
    const xDesce = p1[0] + entra * 3
    return [p0, [xDesce, p0[1]], [xDesce, abaixo ? suc.yTopo : suc.yBase]]
  }
  // volta: contorna pela divisa das linhas e entra de lado
  const yDivisa = abaixo
    ? suc.yTopo - (ALTURA_LINHA - ALTURA_BARRA) / 2
    : suc.yBase + (ALTURA_LINHA - ALTURA_BARRA) / 2
  return [p0, [xDobra, p0[1]], [xDobra, yDivisa], [xChegada, yDivisa], [xChegada, p1[1]], p1]
}

export interface AbaGanttEntrada {
  titulo: string
  subtitulo: string
  linhas: LinhaGantt[]
  ligacoes: LigacaoGantt[]
}

/** Monta a aba e devolve o desenho (barras e setas) para `injetarDesenhos`. */
export async function montarAbaGantt(
  wb: Workbook,
  { titulo, subtitulo, linhas, ligacoes }: AbaGanttEntrada
): Promise<DesenhoDaAba> {
  const ws: Worksheet = wb.addWorksheet('Gantt', {
    views: [
      {
        state: 'frozen',
        xSplit: COLUNAS_FIXAS.length,
        ySplit: LINHAS_CABECALHO,
        showGridLines: false,
        zoomScale: 90
      }
    ],
    // 8 = A3 (o tipo do exceljs não lista, mas o Excel aceita)
    pageSetup: {
      orientation: 'landscape',
      paperSize: 8 as unknown as PaperSize,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0
    }
  })

  const comData = linhas.filter((l) => l.inicio && l.fim)
  const inicio = comData.reduce(
    (m, l) => (l.inicio! < m ? l.inicio! : m),
    comData[0]?.inicio ?? '2000-01-03'
  )
  const fim = comData.reduce((m, l) => (l.fim! > m ? l.fim! : m), comData[0]?.fim ?? '2000-01-10')
  const escala = escalaDoPlano(inicio, fim)
  const pxColuna = escala.pxPorDia * escala.diasPorColuna
  const nFixas = COLUNAS_FIXAS.length

  // ── colunas e linhas ──────────────────────────────────────────────────────
  const largurasPx = [
    ...COLUNAS_FIXAS.map((c) => c.px),
    ...Array<number>(escala.colunas).fill(pxColuna)
  ]
  largurasPx.forEach((px, i) => (ws.getColumn(i + 1).width = larguraParaPx(px)))
  const alturasPx = [26, 18, 18, ...Array<number>(linhas.length).fill(ALTURA_LINHA)]
  alturasPx.forEach((px, i) => (ws.getRow(i + 1).height = px * 0.75))

  // ── título ────────────────────────────────────────────────────────────────
  // sem mesclar: o texto avança sobre as células vazias à direita, até a legenda
  const cTitulo = ws.getCell(1, 1)
  cTitulo.value = {
    richText: [
      { text: titulo, font: { bold: true, size: 12, color: { argb: `FF${COR.texto}` } } },
      { text: `   ${subtitulo}`, font: { size: 9, color: { argb: `FF${COR.textoFraco}` } } }
    ]
  }
  cTitulo.alignment = { vertical: 'middle' }
  const cLegenda = ws.getCell(
    1,
    nFixas + 1 + Math.min(escala.colunas - 1, Math.ceil(420 / pxColuna))
  )
  cLegenda.value = {
    richText: [
      { text: '▬ ', font: { color: { argb: `FF${COR.resumo}` }, size: 9 } },
      { text: 'Resumo    ', font: { size: 9, color: { argb: `FF${COR.textoFraco}` } } },
      { text: '■ ', font: { color: { argb: `FF${COR.tarefa}` }, size: 9 } },
      { text: 'Tarefa    ', font: { size: 9, color: { argb: `FF${COR.textoFraco}` } } },
      { text: '■ ', font: { color: { argb: `FF${COR.critica}` }, size: 9 } },
      { text: 'Tarefa crítica    ', font: { size: 9, color: { argb: `FF${COR.textoFraco}` } } },
      { text: '◆ ', font: { color: { argb: `FF${COR.marco}` }, size: 9 } },
      { text: 'Marco    ', font: { size: 9, color: { argb: `FF${COR.textoFraco}` } } },
      { text: '→ ', font: { color: { argb: `FF${COR.seta}` }, size: 9 } },
      { text: 'Predecessora', font: { size: 9, color: { argb: `FF${COR.textoFraco}` } } }
    ]
  }
  cLegenda.alignment = { vertical: 'middle' }

  // ── cabeçalho das colunas fixas ───────────────────────────────────────────
  const fonteCab = { bold: true, size: 9, color: { argb: `FF${COR.cabecalhoTexto}` } }
  COLUNAS_FIXAS.forEach((c, i) => {
    ws.mergeCells(2, i + 1, 3, i + 1)
    const cel = ws.getCell(2, i + 1)
    cel.value = c.titulo
    cel.font = fonteCab
    cel.fill = fundo(COR.cabecalho)
    cel.alignment = { vertical: 'middle', horizontal: i === 2 ? 'left' : 'center' }
  })

  // ── grade de tempo: meses na linha 2, dia de início de cada coluna na linha 3 ─
  const dataDaColuna = (j: number): Date =>
    new Date(escala.inicioMs + j * escala.diasPorColuna * DIA_MS)
  const inicioDeMes: boolean[] = []
  let blocoIni = 0
  for (let j = 0; j <= escala.colunas; j++) {
    const d = j < escala.colunas ? dataDaColuna(j) : null
    const anterior = j > 0 ? dataDaColuna(j - 1) : null
    const mudou = !d || !anterior || d.getUTCMonth() !== anterior.getUTCMonth()
    if (j < escala.colunas) inicioDeMes.push(j === 0 || mudou)
    if (j > 0 && mudou) {
      const ref = dataDaColuna(blocoIni)
      if (j - 1 > blocoIni) ws.mergeCells(2, nFixas + 1 + blocoIni, 2, nFixas + j)
      const cel = ws.getCell(2, nFixas + 1 + blocoIni)
      cel.value = `${MESES[ref.getUTCMonth()]}/${String(ref.getUTCFullYear()).slice(2)}`
      cel.alignment = { horizontal: 'left', vertical: 'middle' }
      blocoIni = j
    }
  }
  for (let j = 0; j < escala.colunas; j++) {
    for (const lin of [2, 3]) {
      const cel = ws.getCell(lin, nFixas + 1 + j)
      cel.font = { ...fonteCab, bold: lin === 2 }
      cel.fill = fundo(COR.cabecalho)
      if (inicioDeMes[j])
        cel.border = { left: { style: 'thin', color: { argb: `FF${COR.linhaMes}` } } }
    }
    const cDia = ws.getCell(3, nFixas + 1 + j)
    cDia.value = dataDaColuna(j).getUTCDate()
    cDia.alignment = { horizontal: 'center', vertical: 'middle' }
    cDia.font = { size: 7, color: { argb: `FF${COR.cabecalhoTexto}` } }
  }

  // ── linhas: colunas fixas e fundo da grade ────────────────────────────────
  const numeroDe = new Map(linhas.map((l, i) => [l.id, i + 1]))
  const predecessoras = new Map<string, string[]>()
  for (const g of ligacoes) {
    const n = numeroDe.get(g.de)
    if (!n || !numeroDe.has(g.para)) continue
    const defasagem = g.defasagemDias ? `${g.defasagemDias > 0 ? '+' : ''}${g.defasagemDias}d` : ''
    const lista = predecessoras.get(g.para) ?? []
    lista.push(`${n}${g.tipo === 'TI' ? '' : g.tipo}${defasagem}`)
    predecessoras.set(g.para, lista)
  }
  const bordaLinha: Partial<Borders> = {
    bottom: { style: 'thin', color: { argb: `FF${COR.linha}` } }
  }
  const bordasGrade = inicioDeMes.map((mes): Partial<Borders> => ({
    ...bordaLinha,
    left: mes
      ? { style: 'thin', color: { argb: `FF${COR.linhaMes}` } }
      : { style: 'thin', color: { argb: `FF${COR.linha}` } }
  }))
  linhas.forEach((l, i) => {
    const r = LINHAS_CABECALHO + 1 + i
    const resumo = l.tipo === 'resumo'
    const valores: Array<string | number> = [
      i + 1,
      l.eap ?? '',
      l.nome,
      l.tipo === 'marco'
        ? 'marco'
        : l.duracaoDias != null
          ? `${l.duracaoDias.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} d`
          : '',
      dataBR(l.inicio),
      dataBR(l.fim),
      (predecessoras.get(l.id) ?? []).join('; ')
    ]
    valores.forEach((v, c) => {
      const cel = ws.getCell(r, c + 1)
      cel.value = v
      cel.font = {
        size: 9,
        bold: resumo,
        color: { argb: `FF${c === 0 || c === 6 ? COR.textoFraco : COR.texto}` }
      }
      cel.alignment = {
        vertical: 'middle',
        horizontal: c === 2 ? 'left' : c === 1 ? 'left' : 'center',
        indent: c === 2 ? Math.min(l.nivel, 12) : 0
      }
      cel.border = bordaLinha
      if (resumo) cel.fill = fundo(COR.resumoFundo)
    })
    for (let j = 0; j < escala.colunas; j++) {
      const cel = ws.getCell(r, nFixas + 1 + j)
      cel.border = bordasGrade[j]
      if (resumo) cel.fill = fundo(COR.resumoFundo)
    }
  })

  // ── barras e setas ────────────────────────────────────────────────────────
  const grade = criarGrade(largurasPx, alturasPx)
  const x0Grade = grade.xDaColuna(nFixas)
  const xDoDia = (iso: string, fimDoDia: boolean): number =>
    x0Grade +
    (Math.round((utc(iso) - escala.inicioMs) / DIA_MS) + (fimDoDia ? 1 : 0)) * escala.pxPorDia
  const caixas = new Map<
    string,
    { x0: number; x1: number; yMeio: number; yTopo: number; yBase: number }
  >()
  const formas: Forma[] = []
  linhas.forEach((l, i) => {
    if (!l.inicio || !l.fim) return
    const yLinha = grade.yDaLinha(LINHAS_CABECALHO + i)
    const yMeio = yLinha + ALTURA_LINHA / 2
    if (l.tipo === 'marco') {
      const x = xDoDia(l.inicio, false)
      const lado = ALTURA_BARRA + 1
      formas.push({
        tipo: 'losango',
        x: x - lado / 2,
        y: yMeio - lado / 2,
        largura: lado,
        altura: lado,
        cor: COR.marco,
        nome: l.nome
      })
      caixas.set(l.id, {
        x0: x - lado / 2,
        x1: x + lado / 2,
        yMeio,
        yTopo: yMeio - lado / 2,
        yBase: yMeio + lado / 2
      })
      return
    }
    const xa = xDoDia(l.inicio, false)
    const xb = Math.max(xDoDia(l.fim, true), xa + 2)
    const altura = l.tipo === 'resumo' ? ALTURA_RESUMO : ALTURA_BARRA
    formas.push({
      tipo: l.tipo === 'resumo' ? 'retangulo' : 'arredondado',
      x: xa,
      y: yMeio - altura / 2,
      largura: xb - xa,
      altura,
      cor: l.tipo === 'resumo' ? COR.resumo : l.critica ? COR.critica : COR.tarefa,
      nome: l.nome
    })
    caixas.set(l.id, {
      x0: xa,
      x1: xb,
      yMeio,
      yTopo: yMeio - altura / 2,
      yBase: yMeio + altura / 2
    })
  })
  for (const g of ligacoes) {
    const a = caixas.get(g.de)
    const b = caixas.get(g.para)
    if (!a || !b) continue
    formas.push({
      tipo: 'linha',
      cor: COR.seta,
      pontos: rotaDaLigacao(g.tipo, a, b),
      tracejada: g.automatica,
      nome: 'Predecessora'
    })
  }

  // ── impressão e proteção ──────────────────────────────────────────────────
  ws.pageSetup.printTitlesRow = `1:${LINHAS_CABECALHO}`
  ws.pageSetup.printTitlesColumn = `A:${ws.getColumn(nFixas).letter}`
  ws.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
  await ws.protect('', { selectLockedCells: true, selectUnlockedCells: true })

  return { abaId: ws.id, grade, formas }
}
