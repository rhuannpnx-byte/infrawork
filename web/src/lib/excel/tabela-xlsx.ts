// Exportação .xlsx genérica da tabela Previsto × Realizado:
//   - Aba "Comparativo": tabela plana (mesmas colunas da tela).
//   - 1 aba por serviço: produção semanal previsto × realizado + média semanal.
// Roda no browser (exceljs) e devolve um Blob para download.

import ExcelJS from 'exceljs'
import { XLSX_MIME } from '@/lib/files/download'

export interface TabelaExportColuna {
  header: string
  numFmt?: string
}
export interface TabelaExportSemana {
  prev: number
  real: number
  media: number | null
  range: string
}
export interface TabelaExportServico {
  codigo: string
  descricao: string
  unidade: string
  mediaNec: number | null
  semanas: TabelaExportSemana[]
}
export interface TabelaXlsxPayload {
  obraNome: string
  titulo: string
  filenameBase: string
  colunas: TabelaExportColuna[]
  linhas: Array<Array<string | number | null>>
  servicos: TabelaExportServico[]
  /** abas a mais (resumos), cada uma com as suas colunas e linhas */
  abasExtras?: Array<{
    nome: string
    titulo: string
    colunas: TabelaExportColuna[]
    linhas: Array<Array<string | number | null>>
    linhasTotal?: number[]
  }>
}

const NUM = '#,##0.0'

function headerStyle(row: ExcelJS.Row): void {
  const azul = 'FF1F2937'
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: azul } }
    c.alignment = { vertical: 'middle' }
  })
}

function sanitizeSheetName(nome: string, usados: Set<string>): string {
  const base =
    (nome || 'servico')
      .replace(/[\\/?*[\]:]/g, '-')
      .slice(0, 28)
      .trim() || 'servico'
  let f = base
  let i = 2
  while (usados.has(f.toLowerCase())) f = `${base.slice(0, 25)} (${i++})`
  usados.add(f.toLowerCase())
  return f
}

function abaComparativo(wb: ExcelJS.Workbook, p: TabelaXlsxPayload): void {
  // tabela simples (sem relatório por serviço): a aba leva o nome da tabela
  const ws = wb.addWorksheet(
    p.servicos.length ? 'Comparativo' : sanitizeSheetName(p.titulo, new Set<string>())
  )
  ws.mergeCells(1, 1, 1, Math.max(1, p.colunas.length))
  ws.getCell(1, 1).value = p.titulo
  ws.getCell(1, 1).font = { bold: true, size: 14 }
  ws.mergeCells(2, 1, 2, Math.max(1, p.colunas.length))
  ws.getCell(2, 1).value =
    `Obra: ${p.obraNome}    •    Gerado em: ${new Date().toLocaleString('pt-BR')}`
  ws.getCell(2, 1).font = { italic: true, size: 10, color: { argb: 'FF666666' } }

  const headerRow = 4
  const hr = ws.getRow(headerRow)
  p.colunas.forEach((c, i) => (hr.getCell(i + 1).value = c.header))
  headerStyle(hr)

  p.colunas.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    col.width = i === 1 ? 40 : Math.max(12, c.header.length + 4)
  })

  let r = headerRow + 1
  for (const linha of p.linhas) {
    const row = ws.getRow(r)
    linha.forEach((v, i) => {
      const cell = row.getCell(i + 1)
      cell.value = v as ExcelJS.CellValue
      const fmt = p.colunas[i]?.numFmt
      if (fmt && typeof v === 'number') cell.numFmt = fmt
    })
    r++
  }
  ws.views = [{ state: 'frozen', ySplit: headerRow }]
}

function abaServico(
  wb: ExcelJS.Workbook,
  p: TabelaXlsxPayload,
  s: TabelaExportServico,
  usados: Set<string>
): void {
  const ws = wb.addWorksheet(sanitizeSheetName(s.codigo, usados))
  ws.columns = [
    { width: 10 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 14 },
    { width: 16 }
  ]
  ws.mergeCells(1, 1, 1, 6)
  ws.getCell(1, 1).value = `${s.codigo} — ${s.descricao}`
  ws.getCell(1, 1).font = { bold: true, size: 13 }
  ws.mergeCells(2, 1, 2, 6)
  ws.getCell(2, 1).value =
    `Obra: ${p.obraNome}   •   Unidade: ${s.unidade}` +
    (s.mediaNec != null ? `   •   Média necessária: ${s.mediaNec.toFixed(1)} ${s.unidade}/dia` : '')
  ws.getCell(2, 1).font = { italic: true, size: 10, color: { argb: 'FF666666' } }

  const headerRow = 4
  const header = [
    'Semana',
    'Período',
    `Previsto (${s.unidade})`,
    `Realizado (${s.unidade})`,
    'Δ (real−prev)',
    `Média/dia (${s.unidade})`
  ]
  const hr = ws.getRow(headerRow)
  header.forEach((h, i) => (hr.getCell(i + 1).value = h))
  headerStyle(hr)

  let r = headerRow + 1
  let totPrev = 0
  let totReal = 0
  s.semanas.forEach((w, i) => {
    const row = ws.getRow(r)
    row.getCell(1).value = `Sem ${i + 1}`
    row.getCell(2).value = w.range
    row.getCell(3).value = w.prev
    row.getCell(3).numFmt = NUM
    row.getCell(4).value = w.real
    row.getCell(4).numFmt = NUM
    row.getCell(5).value = w.real - w.prev
    row.getCell(5).numFmt = NUM
    if (w.media != null) {
      row.getCell(6).value = w.media
      row.getCell(6).numFmt = NUM
    }
    totPrev += w.prev
    totReal += w.real
    r++
  })

  const tr = ws.getRow(r)
  tr.getCell(1).value = 'Total'
  tr.getCell(1).font = { bold: true }
  tr.getCell(3).value = totPrev
  tr.getCell(3).numFmt = NUM
  tr.getCell(3).font = { bold: true }
  tr.getCell(4).value = totReal
  tr.getCell(4).numFmt = NUM
  tr.getCell(4).font = { bold: true }
  tr.getCell(5).value = totReal - totPrev
  tr.getCell(5).numFmt = NUM
  tr.getCell(5).font = { bold: true }

  ws.views = [{ state: 'frozen', ySplit: headerRow }]
}

function abaExtra(
  wb: ExcelJS.Workbook,
  p: TabelaXlsxPayload,
  a: NonNullable<TabelaXlsxPayload['abasExtras']>[number],
  usados: Set<string>
): void {
  const ws = wb.addWorksheet(sanitizeSheetName(a.nome, usados))
  const n = Math.max(1, a.colunas.length)
  ws.mergeCells(1, 1, 1, n)
  ws.getCell(1, 1).value = a.titulo
  ws.getCell(1, 1).font = { bold: true, size: 14 }
  ws.mergeCells(2, 1, 2, n)
  ws.getCell(2, 1).value =
    `Obra: ${p.obraNome}    •    Gerado em: ${new Date().toLocaleString('pt-BR')}`
  ws.getCell(2, 1).font = { italic: true, size: 10, color: { argb: 'FF666666' } }
  const headerRow = 4
  const hr = ws.getRow(headerRow)
  a.colunas.forEach((c, i) => {
    hr.getCell(i + 1).value = c.header
    // texto mais largo que número; a largura segue o maior conteúdo da coluna
    const maior = a.linhas.reduce((m, l) => Math.max(m, String(l[i] ?? '').length), c.header.length)
    ws.getColumn(i + 1).width = Math.min(60, Math.max(12, maior + 3))
  })
  headerStyle(hr)
  const totais = new Set(a.linhasTotal ?? [])
  a.linhas.forEach((linha, k) => {
    const row = ws.getRow(headerRow + 1 + k)
    linha.forEach((v, i) => {
      const cell = row.getCell(i + 1)
      cell.value = v as ExcelJS.CellValue
      const fmt = a.colunas[i]?.numFmt
      if (fmt && typeof v === 'number') cell.numFmt = fmt
      if (totais.has(k)) cell.font = { bold: true }
    })
  })
  ws.views = [{ state: 'frozen', ySplit: headerRow }]
}

export async function gerarTabelaXlsx(payload: TabelaXlsxPayload): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'InfraWork'
  wb.created = new Date()
  abaComparativo(wb, payload)
  const usados = new Set<string>(['comparativo'])
  for (const s of payload.servicos) abaServico(wb, payload, s, usados)
  for (const a of payload.abasExtras ?? []) abaExtra(wb, payload, a, usados)
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: XLSX_MIME })
}
