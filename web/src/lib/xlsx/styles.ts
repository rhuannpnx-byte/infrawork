import type ExcelJS from 'exceljs'

export const COR = {
  branco: 'FFFFFFFF',
  zebra: 'FFF9FAFB',
  campoBg: 'FFF3F4F6',
  campoFg: 'FF6B7280',
  texto: 'FF111827',
  borda: 'FFE5E7EB',
  bordaForte: 'FFD1D5DB',
  cinza: 'FF9CA3AF',
  exemploBg: 'FFFFFBEB'
} as const

const FONTE = 'Calibri'

export function thin(argb: string): Partial<ExcelJS.Borders> {
  const b = { style: 'thin' as const, color: { argb } }
  return { top: b, bottom: b, left: b, right: b }
}

export function hair(argb: string): Partial<ExcelJS.Borders> {
  const b = { style: 'hair' as const, color: { argb } }
  return { top: b, bottom: b, left: b, right: b }
}

/** Cor do cabeçalho das planilhas (a mesma dos exports do InfraWork). */
const AZUL = 'FF1F2937'

/** Cabeçalho de tabela: branco em negrito sobre o azul-escuro padrão. */
export function estiloHeader(cell: ExcelJS.Cell): void {
  cell.font = { bold: true, color: { argb: COR.branco }, size: 10, name: FONTE }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  cell.border = thin(COR.branco)
}

export function estiloTitulo(cell: ExcelJS.Cell): void {
  cell.font = { bold: true, size: 14, color: { argb: COR.branco }, name: FONTE }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
}

export function estiloCampo(cell: ExcelJS.Cell, label: string): void {
  cell.value = label.toUpperCase()
  cell.font = { bold: true, size: 9, color: { argb: COR.campoFg }, name: FONTE }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR.campoBg } }
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  cell.border = thin(COR.borda)
}

export function estiloConteudo(
  cell: ExcelJS.Cell,
  value: string,
  opts?: { italic?: boolean }
): void {
  cell.value = value
  cell.font = { size: 10, color: { argb: COR.texto }, name: FONTE, italic: opts?.italic ?? false }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR.branco } }
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true }
  cell.border = thin(COR.borda)
}

export function estiloLinhaDados(
  cell: ExcelJS.Cell,
  idx: number,
  numFmt?: string,
  align?: 'left' | 'right' | 'center'
): void {
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: idx % 2 === 0 ? COR.branco : COR.zebra }
  }
  cell.font = { size: 10, name: FONTE }
  cell.border = hair(COR.borda)
  if (numFmt) cell.numFmt = numFmt
  cell.alignment = { vertical: 'middle', horizontal: align ?? 'left' }
}

export function estiloExemplo(cell: ExcelJS.Cell, numFmt?: string): void {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR.exemploBg } }
  cell.font = { size: 10, name: FONTE, italic: true, color: { argb: COR.campoFg } }
  cell.border = hair(COR.borda)
  if (numFmt) cell.numFmt = numFmt
}

export function estiloTexto(
  cell: ExcelJS.Cell,
  opts?: { bold?: boolean; size?: number; cor?: string; wrap?: boolean }
): void {
  cell.font = {
    bold: opts?.bold ?? false,
    size: opts?.size ?? 10,
    color: { argb: opts?.cor ?? COR.texto },
    name: FONTE
  }
  cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: opts?.wrap ?? true }
}
