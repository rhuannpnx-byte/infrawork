import type ExcelJS from 'exceljs'
import { parseBR } from '@/lib/money'
import type { ColumnSpec, RowError, SheetSpec } from './types'
import { LIMITE_LINHAS } from './types'

/** Normalização textual — DEVE espelhar `public.norm_txt()` no banco. */
export function normalizeTxt(s: string): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Chave de cabeçalho: normalizada, sem `*` e sem parênteses. */
export function headerKey(s: string): string {
  return normalizeTxt(
    String(s ?? '')
      .replace(/\*/g, '')
      .replace(/\([^)]*\)/g, '')
  )
}

/** Valor "cru" de uma célula (resolve fórmula, rich text, hyperlink, data). */
export function rawValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value
  if (v == null) return null
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>
    if ('result' in o) return o.result ?? null
    if ('richText' in o && Array.isArray(o.richText)) {
      return (o.richText as Array<{ text: string }>).map((t) => t.text).join('')
    }
    if ('text' in o) return o.text
    if ('error' in o) return null
  }
  return v
}

export function cellText(cell: ExcelJS.Cell): string {
  const v = rawValue(cell)
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).trim()
}

/** Número a partir da célula. Strings em pt-BR ("1.234,56") são aceitas. */
export function parseNumeroCell(cell: ExcelJS.Cell): {
  value: number | null
  ambiguo?: boolean
  invalido?: boolean
} {
  const v = rawValue(cell)
  if (v == null || v === '') return { value: null }
  if (typeof v === 'number')
    return { value: Number.isFinite(v) ? v : null, invalido: !Number.isFinite(v) }
  if (typeof v === 'boolean') return { value: null, invalido: true }
  const s = String(v)
    .trim()
    .replace(/^R\$\s*/i, '')
    .replace(/%$/, '')
  if (s === '') return { value: null }
  if (!/^[-+]?[\d.,\s]+$/.test(s)) return { value: null, invalido: true }
  const n = parseBR(s).toNumber()
  if (!Number.isFinite(n)) return { value: null, invalido: true }
  // "1.500" (um ponto, sem vírgula, 3 dígitos após) é ambíguo: 1,5 ou 1500?
  const ambiguo = !s.includes(',') && /^[-+]?\d{1,3}\.\d{3}$/.test(s)
  return { value: n, ambiguo }
}

/** Percentual: célula formatada como % → fração; senão "25" → 0,25; "0,25" → 0,25. */
export function parsePercentCell(cell: ExcelJS.Cell): { value: number | null; invalido?: boolean } {
  const { value, invalido } = parseNumeroCell(cell)
  if (invalido) return { value: null, invalido: true }
  if (value == null) return { value: null }
  const fmt = String(cell.numFmt ?? '')
  const raw = rawValue(cell)
  const textoComPct = typeof raw === 'string' && /%\s*$/.test(raw.trim())
  if (fmt.includes('%') && typeof raw === 'number') return { value }
  if (textoComPct) return { value: value / 100 }
  return { value: value > 1 ? value / 100 : value }
}

export interface HeaderMatch {
  rowIdx: number
  /** key da coluna → índice (1-based) na planilha */
  colIdx: Record<string, number>
  missing: string[]
}

/** Localiza a linha de cabeçalho nas primeiras `maxScan` linhas. */
export function findHeaderRow(
  ws: ExcelJS.Worksheet,
  columns: ColumnSpec[],
  maxScan = 10
): HeaderMatch | null {
  const wanted = new Map<string, string>() // headerKey → col.key
  for (const col of columns) {
    wanted.set(headerKey(col.header), col.key)
    for (const a of col.aliases ?? []) wanted.set(headerKey(a), col.key)
  }
  let best: HeaderMatch | null = null
  for (let r = 1; r <= Math.min(ws.rowCount, maxScan); r++) {
    const row = ws.getRow(r)
    const colIdx: Record<string, number> = {}
    for (let c = 1; c <= Math.max(row.cellCount, columns.length); c++) {
      const k = headerKey(cellText(row.getCell(c)))
      if (!k) continue
      const key = wanted.get(k)
      if (key && colIdx[key] == null) colIdx[key] = c
    }
    const found = Object.keys(colIdx).length
    if (found === 0) continue
    const missing = columns.filter((c) => c.required && colIdx[c.key] == null).map((c) => c.header)
    const cand: HeaderMatch = { rowIdx: r, colIdx, missing }
    if (!best || found > Object.keys(best.colIdx).length) best = cand
    if (missing.length === 0 && found >= columns.filter((c) => c.required).length) return cand
  }
  return best
}

export function getSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  const alvo = normalizeTxt(name)
  return wb.worksheets.find((ws) => normalizeTxt(ws.name) === alvo)
}

export interface ParsedSheetRow<T> {
  row: number
  data: Partial<T>
  erros: RowError[]
  avisos: RowError[]
}

export interface ParsedSheet<T> {
  rows: ParsedSheetRow<T>[]
  errosGerais: RowError[]
  header: HeaderMatch | null
}

function enumValue(col: ColumnSpec, texto: string): string | null {
  if (!col.enum) return texto
  const k = normalizeTxt(texto)
  return col.enum.map[k] ?? col.enum.synonyms?.[k] ?? null
}

/**
 * Lê uma aba conforme o `SheetSpec`: localiza o cabeçalho, converte cada
 * célula para o tipo da coluna e devolve erros/avisos por linha.
 */
export function parseSheet<T>(
  ws: ExcelJS.Worksheet | undefined,
  spec: SheetSpec,
  opts: { maxRows?: number; required?: boolean } = {}
): ParsedSheet<T> {
  const maxRows = opts.maxRows ?? LIMITE_LINHAS
  const errosGerais: RowError[] = []
  if (!ws) {
    if (opts.required !== false) {
      errosGerais.push({
        sheet: spec.name,
        row: 0,
        code: 'ABA_AUSENTE',
        msg: `Aba "${spec.name}" não encontrada no arquivo.`,
        nivel: 'erro'
      })
    }
    return { rows: [], errosGerais, header: null }
  }
  const colunas = spec.columns.filter((c) => !c.calculada)
  const header = findHeaderRow(ws, colunas)
  if (!header) {
    errosGerais.push({
      sheet: spec.name,
      row: 0,
      code: 'HEADER_NAO_ENCONTRADO',
      msg: `Cabeçalho não encontrado na aba "${spec.name}". Use o modelo padrão.`,
      nivel: 'erro'
    })
    return { rows: [], errosGerais, header: null }
  }
  if (header.missing.length > 0) {
    errosGerais.push({
      sheet: spec.name,
      row: header.rowIdx,
      code: 'COLUNA_OBRIGATORIA_AUSENTE',
      msg: `Colunas obrigatórias ausentes na aba "${spec.name}": ${header.missing.join(', ')}.`,
      nivel: 'erro'
    })
    return { rows: [], errosGerais, header }
  }

  const rows: ParsedSheetRow<T>[] = []
  const ultima = ws.rowCount
  for (let r = header.rowIdx + 1; r <= ultima; r++) {
    const row = ws.getRow(r)
    // linha totalmente vazia → ignora
    let vazia = true
    for (const col of colunas) {
      const ci = header.colIdx[col.key]
      if (ci && cellText(row.getCell(ci)) !== '') {
        vazia = false
        break
      }
    }
    if (vazia) continue
    if (rows.length >= maxRows) {
      errosGerais.push({
        sheet: spec.name,
        row: r,
        code: 'LIMITE_LINHAS',
        msg: `Limite de ${maxRows} linhas por importação excedido.`,
        nivel: 'erro'
      })
      break
    }

    const data: Record<string, unknown> = {}
    const erros: RowError[] = []
    const avisos: RowError[] = []
    for (const col of colunas) {
      const ci = header.colIdx[col.key]
      const cell = ci ? row.getCell(ci) : null
      const texto = cell ? cellText(cell) : ''
      const base = { sheet: spec.name, row: r, col: col.header }
      if (texto === '') {
        data[col.key] = null
        if (col.required)
          erros.push({
            ...base,
            code: 'CAMPO_OBRIGATORIO',
            msg: `"${col.header}" é obrigatório.`,
            nivel: 'erro'
          })
        continue
      }
      switch (col.tipo) {
        case 'text':
        case 'code':
          data[col.key] = texto
          break
        case 'enum': {
          const v = enumValue(col, texto)
          if (v == null) {
            erros.push({
              ...base,
              code: 'ENUM_INVALIDO',
              msg: `"${texto}" não é um valor válido para "${col.header}". Use: ${col.enum?.values.join(', ')}.`,
              nivel: 'erro'
            })
            data[col.key] = null
          } else data[col.key] = v
          break
        }
        case 'number':
        case 'integer': {
          const p = parseNumeroCell(cell!)
          if (p.invalido || p.value == null) {
            erros.push({
              ...base,
              code: 'NUMERO_INVALIDO',
              msg: `"${texto}" não é um número válido em "${col.header}".`,
              nivel: 'erro'
            })
            data[col.key] = null
            break
          }
          let v = p.value
          if (col.tipo === 'integer') v = Math.round(v)
          if (col.min != null && v < col.min)
            erros.push({
              ...base,
              code: 'NUMERO_INVALIDO',
              msg: `"${col.header}" deve ser ≥ ${col.min}.`,
              nivel: 'erro'
            })
          if (col.max != null && v > col.max)
            erros.push({
              ...base,
              code: 'NUMERO_INVALIDO',
              msg: `"${col.header}" deve ser ≤ ${col.max}.`,
              nivel: 'erro'
            })
          if (p.ambiguo)
            avisos.push({
              ...base,
              code: 'NUMERO_AMBIGUO',
              msg: `"${texto}" foi lido como ${v}. Digite números (não texto) para evitar ambiguidade.`,
              nivel: 'aviso'
            })
          data[col.key] = v
          break
        }
        case 'percent': {
          const p = parsePercentCell(cell!)
          if (p.invalido || p.value == null) {
            erros.push({
              ...base,
              code: 'NUMERO_INVALIDO',
              msg: `"${texto}" não é um percentual válido em "${col.header}".`,
              nivel: 'erro'
            })
            data[col.key] = null
          } else data[col.key] = p.value
          break
        }
      }
    }
    rows.push({ row: r, data: data as unknown as Partial<T>, erros, avisos })
  }
  return { rows, errosGerais, header }
}

/** Ordena códigos hierárquicos "1.2.10" numericamente. */
export function compareCodigo(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? -1
    const vb = pb[i] ?? -1
    if (va !== vb) return va - vb
  }
  return 0
}

export function parentCodigo(codigo: string): string | null {
  const i = codigo.lastIndexOf('.')
  return i < 0 ? null : codigo.slice(0, i)
}
