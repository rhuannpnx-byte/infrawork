// Exportação .xlsx genérica da tabela Previsto × Realizado:
//   - Aba "Comparativo": tabela plana (mesmas colunas da tela).
//   - 1 aba por serviço: produção semanal previsto × realizado + média semanal.
// Roda no main, reusando o exceljs já presente.

import ExcelJS from 'exceljs'

export interface TabelaExportColuna { header: string; numFmt?: string }
export interface TabelaExportSemana { prev: number; real: number; media: number | null; range: string }
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
}

const AZUL = 'FF1F2937'
const NUM = '#,##0.0'

function headerStyle(row: ExcelJS.Row): void {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
    c.alignment = { vertical: 'middle' }
  })
}

function sanitizeSheetName(nome: string, usados: Set<string>): string {
  const base = (nome || 'servico').replace(/[\\/?*[\]:]/g, '-').slice(0, 28).trim() || 'servico'
  let f = base
  let i = 2
  while (usados.has(f.toLowerCase())) f = `${base.slice(0, 25)} (${i++})`
  usados.add(f.toLowerCase())
  return f
}

function abaComparativo(wb: ExcelJS.Workbook, p: TabelaXlsxPayload): void {
  const ws = wb.addWorksheet('Comparativo')
  ws.mergeCells(1, 1, 1, Math.max(1, p.colunas.length))
  ws.getCell(1, 1).value = p.titulo
  ws.getCell(1, 1).font = { bold: true, size: 14 }
  ws.mergeCells(2, 1, 2, Math.max(1, p.colunas.length))
  ws.getCell(2, 1).value = `Obra: ${p.obraNome}    •    Gerado em: ${new Date().toLocaleString('pt-BR')}`
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

function abaServico(wb: ExcelJS.Workbook, p: TabelaXlsxPayload, s: TabelaExportServico, usados: Set<string>): void {
  const ws = wb.addWorksheet(sanitizeSheetName(s.codigo, usados))
  ws.columns = [
    { width: 10 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 16 }
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
  const header = ['Semana', 'Período', `Previsto (${s.unidade})`, `Realizado (${s.unidade})`, 'Δ (real−prev)', `Média/dia (${s.unidade})`]
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
    if (w.media != null) { row.getCell(6).value = w.media; row.getCell(6).numFmt = NUM }
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

export async function gerarTabelaXlsx(payload: TabelaXlsxPayload, destino: string): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'InfraWork'
  wb.created = new Date()
  abaComparativo(wb, payload)
  const usados = new Set<string>(['comparativo'])
  for (const s of payload.servicos) abaServico(wb, payload, s, usados)
  await wb.xlsx.writeFile(destino)
}
