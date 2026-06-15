// Geração da planilha .xlsx "Programação Mensal" (Previsto × Realizado por
// serviço), SEM divisão de pista/lado. Roda no RENDERER (como o template de
// trecho), permitindo embutir o logo via fetch do asset e evitando depender do
// processo main para a geração.
//
// Identidade visual alinhada aos relatórios InfraWork: logo no topo-esquerdo +
// bloco Título/Obra/Período, cabeçalho de colunas em azul-escuro com texto
// branco. Formato numérico '0.##' — SEM separador de milhar e SEM casas
// decimais forçadas; aplicado só a células com valor (vazia fica em branco).

import ExcelJS from 'exceljs'
import infraworkIcon from '@/assets/infrawork-icon.png'

export interface ProgMensalDia {
  dia: number
  weekday: string
  iso: string
}

export interface ProgMensalServico {
  nome: string
  unidade: string
  prev: number[]
  real: number[]
}

export interface ProgramacaoMensalInput {
  obraNome: string
  mesLabel: string
  dias: ProgMensalDia[]
  servicos: ProgMensalServico[]
}

// Paleta InfraWork
const AZUL = 'FF1F2937'
const AZUL_2 = 'FF374151'
const CINZA_LBL = 'FFF3F4F6'
const VERDE_LBL = 'FFE7F5EC'
const ZEBRA = 'FFFAFAFA'
const BORDA = 'FFD9DCE1'
const TEXTO = 'FF111827'
const TEXTO_DIM = 'FF6B7280'
const AZUL_TXT = 'FF1D4ED8'
const VERDE_TXT = 'FF047857'
const NUM = '0.##'

function soma(arr: number[]): number {
  return Math.trunc(arr.reduce((a, b) => a + b, 0) * 100) / 100
}

function brDataHora(): string {
  return new Date().toLocaleString('pt-BR')
}

const thin = (argb: string): Partial<ExcelJS.Border> => ({ style: 'thin', color: { argb } })

export async function gerarProgramacaoMensalXlsx(input: ProgramacaoMensalInput): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'InfraWork'
  wb.created = new Date()

  const nDias = input.dias.length
  const COL_ATIV = 1
  const COL_UNID = 2
  const COL_PR = 3
  const COL_DIA0 = 4
  const COL_TOTAL = COL_DIA0 + nDias
  const totalCols = COL_TOTAL

  const ws = wb.addWorksheet('Programação Mensal', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 6 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  })

  // ── Larguras ──────────────────────────────────────────────────────────────
  ws.getColumn(COL_ATIV).width = 32
  ws.getColumn(COL_UNID).width = 8
  ws.getColumn(COL_PR).width = 7
  for (let i = 0; i < nDias; i++) ws.getColumn(COL_DIA0 + i).width = 7
  ws.getColumn(COL_TOTAL).width = 12

  // ── Logo (A1:C4) ──────────────────────────────────────────────────────────
  for (let r = 1; r <= 4; r++) ws.getRow(r).height = 22
  ws.mergeCells(1, COL_ATIV, 4, COL_PR)
  const logoCell = ws.getCell(1, COL_ATIV)
  logoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
  logoCell.border = { top: thin(BORDA), left: thin(BORDA), bottom: thin(BORDA), right: thin(BORDA) }
  try {
    const buf = await (await fetch(infraworkIcon)).arrayBuffer()
    const logoId = wb.addImage({ buffer: buf, extension: 'png' })
    ws.addImage(logoId, { tl: { col: 0.35, row: 0.45 } as ExcelJS.Anchor, ext: { width: 84, height: 84 } })
  } catch {
    // Sem logo se o fetch falhar — não bloqueia a geração.
    logoCell.value = 'InfraWork'
    logoCell.font = { bold: true, size: 14, color: { argb: AZUL } }
    logoCell.alignment = { vertical: 'middle', horizontal: 'center' }
  }

  // ── Bloco de cabeçalho (à direita do logo) ───────────────────────────────
  ws.mergeCells(1, COL_DIA0, 1, totalCols)
  ws.getCell(1, COL_DIA0).value = 'Programação Mensal — Previsto × Realizado'
  ws.getCell(1, COL_DIA0).font = { bold: true, size: 14, color: { argb: TEXTO } }
  ws.getCell(1, COL_DIA0).alignment = { vertical: 'middle' }

  ws.mergeCells(2, COL_DIA0, 2, totalCols)
  ws.getCell(2, COL_DIA0).value = `Obra: ${input.obraNome}`
  ws.getCell(2, COL_DIA0).font = { bold: true, size: 11, color: { argb: TEXTO } }

  ws.mergeCells(3, COL_DIA0, 4, totalCols)
  ws.getCell(3, COL_DIA0).value = `Período: ${input.mesLabel}    •    Gerado em: ${brDataHora()}`
  ws.getCell(3, COL_DIA0).font = { italic: true, size: 10, color: { argb: TEXTO_DIM } }
  ws.getCell(3, COL_DIA0).alignment = { vertical: 'top' }

  // ── Cabeçalho de colunas (linhas 5 = nº do dia / 6 = dia da semana) ───────
  const H1 = 5
  const H2 = 6
  const fixos: Array<{ col: number; label: string }> = [
    { col: COL_ATIV, label: 'Atividade' },
    { col: COL_UNID, label: 'Unid.' },
    { col: COL_PR, label: 'P/R' },
    { col: COL_TOTAL, label: 'Total' }
  ]
  for (const f of fixos) {
    ws.mergeCells(H1, f.col, H2, f.col)
    const c = ws.getCell(H1, f.col)
    c.value = f.label
    c.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    c.alignment = { vertical: 'middle', horizontal: f.col === COL_ATIV ? 'left' : 'center', wrapText: true }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
  }
  input.dias.forEach((d, i) => {
    const cNum = ws.getCell(H1, COL_DIA0 + i)
    cNum.value = d.dia
    cNum.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    cNum.alignment = { vertical: 'middle', horizontal: 'center' }
    cNum.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
    const cWd = ws.getCell(H2, COL_DIA0 + i)
    cWd.value = d.weekday
    cWd.font = { size: 8, color: { argb: 'FFD1D5DB' } }
    cWd.alignment = { vertical: 'middle', horizontal: 'center' }
    cWd.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_2 } }
  })

  // ── Dados: 2 linhas por serviço (Previsto / Realizado) ────────────────────
  let r = H2 + 1
  input.servicos.forEach((s, idx) => {
    const rPrev = r
    const rReal = r + 1
    const zebra = idx % 2 === 1 ? ZEBRA : 'FFFFFFFF'

    ws.mergeCells(rPrev, COL_ATIV, rReal, COL_ATIV)
    ws.mergeCells(rPrev, COL_UNID, rReal, COL_UNID)
    const cAtiv = ws.getCell(rPrev, COL_ATIV)
    cAtiv.value = s.nome
    cAtiv.font = { bold: true, size: 9, color: { argb: TEXTO } }
    cAtiv.alignment = { vertical: 'middle', wrapText: true }
    cAtiv.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } }
    const cUnid = ws.getCell(rPrev, COL_UNID)
    cUnid.value = s.unidade
    cUnid.font = { size: 9, color: { argb: TEXTO_DIM } }
    cUnid.alignment = { vertical: 'middle', horizontal: 'center' }
    cUnid.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } }

    const cPrevLbl = ws.getCell(rPrev, COL_PR)
    cPrevLbl.value = 'Prev'
    cPrevLbl.font = { bold: true, size: 9, color: { argb: AZUL_TXT } }
    cPrevLbl.alignment = { horizontal: 'center', vertical: 'middle' }
    cPrevLbl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA_LBL } }
    const cRealLbl = ws.getCell(rReal, COL_PR)
    cRealLbl.value = 'Real'
    cRealLbl.font = { bold: true, size: 9, color: { argb: VERDE_TXT } }
    cRealLbl.alignment = { horizontal: 'center', vertical: 'middle' }
    cRealLbl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_LBL } }

    input.dias.forEach((_d, i) => {
      const pv = s.prev[i] ?? 0
      const rv = s.real[i] ?? 0
      const cp = ws.getCell(rPrev, COL_DIA0 + i)
      const cr = ws.getCell(rReal, COL_DIA0 + i)
      if (pv > 0) { cp.value = pv; cp.numFmt = NUM }
      if (rv > 0) { cr.value = rv; cr.numFmt = NUM }
      cp.font = { size: 9, color: { argb: AZUL_TXT } }
      cr.font = { size: 9, color: { argb: VERDE_TXT } }
      cp.alignment = { horizontal: 'center', vertical: 'middle' }
      cr.alignment = { horizontal: 'center', vertical: 'middle' }
      cp.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } }
      cr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } }
    })

    const somaPrev = soma(s.prev)
    const somaReal = soma(s.real)
    const tp = ws.getCell(rPrev, COL_TOTAL)
    const tr = ws.getCell(rReal, COL_TOTAL)
    if (somaPrev > 0) { tp.value = somaPrev; tp.numFmt = NUM }
    if (somaReal > 0) { tr.value = somaReal; tr.numFmt = NUM }
    tp.font = { bold: true, size: 9, color: { argb: AZUL_TXT } }
    tr.font = { bold: true, size: 9, color: { argb: VERDE_TXT } }
    tp.alignment = { horizontal: 'center', vertical: 'middle' }
    tr.alignment = { horizontal: 'center', vertical: 'middle' }
    tp.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA_LBL } }
    tr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_LBL } }

    r += 2
  })

  // ── Bordas finas em toda a grade ──────────────────────────────────────────
  const lastRow = r - 1
  for (let rr = H1; rr <= lastRow; rr++) {
    for (let cc = 1; cc <= totalCols; cc++) {
      ws.getCell(rr, cc).border = { top: thin(BORDA), left: thin(BORDA), bottom: thin(BORDA), right: thin(BORDA) }
    }
  }

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
}
