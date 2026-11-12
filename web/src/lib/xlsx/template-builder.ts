import ExcelJS from 'exceljs'
import { XLSX_MIME } from '@/lib/files/download'
import type { ColumnSpec, TemplateCtx, TemplateSpec } from './types'
import {
  COR,
  estiloCampo,
  estiloConteudo,
  estiloExemplo,
  estiloHeader,
  estiloLinhaDados,
  estiloTexto,
  estiloTitulo
} from './styles'

export const ABA_INSTRUCOES = 'Instruções'
export const ABA_EXEMPLO = 'Exemplo'
export const ABA_LISTAS = 'Listas'

const TIPO_LABEL: Record<ColumnSpec['tipo'], string> = {
  text: 'texto',
  number: 'número',
  integer: 'inteiro',
  percent: 'percentual',
  enum: 'lista',
  code: 'código'
}

function numFmtDe(col: ColumnSpec): string | undefined {
  if (col.numFmt) return col.numFmt
  switch (col.tipo) {
    case 'number':
      return '#,##0.00##'
    case 'integer':
      return '0'
    case 'percent':
      return '0.00'
    default:
      return undefined
  }
}

function alignDe(col: ColumnSpec): 'left' | 'right' | 'center' {
  return col.tipo === 'number' || col.tipo === 'integer' || col.tipo === 'percent'
    ? 'right'
    : 'left'
}

function colLetter(n: number): string {
  let s = ''
  let x = n
  while (x > 0) {
    const m = (x - 1) % 26
    s = String.fromCharCode(65 + m) + s
    x = Math.floor((x - 1) / 26)
  }
  return s
}

/** Cabeçalho exibido na planilha (obrigatórias com `*`). */
export function headerLabel(col: ColumnSpec): string {
  return col.required ? `${col.header} *` : col.header
}

/**
 * Gera o workbook do modelo: Instruções + abas de dados (em branco, com
 * validações) + Exemplo + Listas (oculta). Devolve um Blob para download.
 */
export async function buildTemplateWorkbook(
  spec: TemplateSpec,
  ctx: TemplateCtx,
  opts: {
    /** Dados para preencher as abas (exportação no formato do modelo), por aba. */
    dados?: Record<string, Array<Record<string, unknown>>>
  } = {}
): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'InfraWork'
  wb.created = new Date()

  // ─── Listas (oculta) — fonte das validações de lista ───────────────────
  const wsListas = wb.addWorksheet(ABA_LISTAS, { state: 'veryHidden' })
  const listaRef = new Map<string, string>() // `${sheet}.${key}` → "Listas!$A$2:$A$9"
  let listaCol = 1
  for (const sheet of spec.sheets) {
    for (const col of sheet.columns) {
      if (col.tipo !== 'enum' || !col.enum) continue
      const letter = colLetter(listaCol)
      wsListas.getCell(1, listaCol).value = `${sheet.name}.${col.key}`
      col.enum.values.forEach((v, i) => {
        wsListas.getCell(i + 2, listaCol).value = v
      })
      listaRef.set(
        `${sheet.name}.${col.key}`,
        `${ABA_LISTAS}!$${letter}$2:$${letter}$${col.enum.values.length + 1}`
      )
      listaCol++
    }
  }

  // ─── Instruções ─────────────────────────────────────────────────────────
  const wsI = wb.addWorksheet(ABA_INSTRUCOES, { views: [{ showGridLines: false }] })
  wsI.columns = [{ width: 18 }, { width: 28 }, { width: 14 }, { width: 14 }, { width: 70 }]
  wsI.mergeCells('A1:E1')
  wsI.getCell('A1').value = spec.titulo
  estiloTitulo(wsI.getCell('A1'))
  wsI.getRow(1).height = 30
  wsI.mergeCells('A2:E2')
  wsI.getCell('A2').value = `InfraWork · modelo ${spec.versao} · não altere os nomes das colunas`
  estiloTexto(wsI.getCell('A2'), { size: 9, cor: COR.campoFg })

  const info: Array<[string, string]> = [
    ['Empresa', ctx.empresaNome || '—'],
    [
      'Obra',
      ctx.obraCodigo && ctx.obraNome
        ? `${ctx.obraCodigo} · ${ctx.obraNome}`
        : ctx.obraNome || ctx.obraCodigo || '—'
    ],
    [
      'Gerado em',
      new Date().toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    ]
  ]
  let r = 4
  for (const [k, v] of info) {
    estiloCampo(wsI.getCell(r, 1), k)
    wsI.mergeCells(r, 2, r, 5)
    estiloConteudo(wsI.getCell(r, 2), v)
    wsI.getRow(r).height = 20
    r++
  }

  r++
  wsI.getCell(r, 1).value = 'COMO USAR'
  estiloTexto(wsI.getCell(r, 1), { bold: true, size: 11 })
  r++
  spec.instrucoes.passos.forEach((p, i) => {
    wsI.mergeCells(r, 1, r, 5)
    wsI.getCell(r, 1).value = `${i + 1}. ${p}`
    estiloTexto(wsI.getCell(r, 1))
    wsI.getRow(r).height = Math.max(18, Math.ceil(p.length / 110) * 15)
    r++
  })

  r++
  wsI.getCell(r, 1).value = 'REGRAS'
  estiloTexto(wsI.getCell(r, 1), { bold: true, size: 11 })
  r++
  for (const regra of spec.instrucoes.regras) {
    wsI.mergeCells(r, 1, r, 5)
    wsI.getCell(r, 1).value = `• ${regra}`
    estiloTexto(wsI.getCell(r, 1))
    wsI.getRow(r).height = Math.max(18, Math.ceil(regra.length / 110) * 15)
    r++
  }

  r++
  wsI.getCell(r, 1).value = 'COLUNAS'
  estiloTexto(wsI.getCell(r, 1), { bold: true, size: 11 })
  r++
  const dicHeader = ['Aba', 'Coluna', 'Obrigatória', 'Tipo', 'Descrição']
  dicHeader.forEach((h, i) => {
    wsI.getCell(r, i + 1).value = h
    estiloHeader(wsI.getCell(r, i + 1))
  })
  r++
  let zi = 0
  for (const sheet of spec.sheets) {
    for (const col of sheet.columns) {
      const vals = [
        sheet.name,
        col.header,
        col.required ? 'sim' : 'não',
        col.calculada
          ? 'calculada (fórmula) — não preencher'
          : col.listaDinamica
            ? 'lista (aceita valor novo)'
            : col.tipo === 'enum' && col.enum
              ? `lista: ${col.enum.values.join(' | ')}`
              : TIPO_LABEL[col.tipo],
        col.help
      ]
      vals.forEach((v, i) => {
        const c = wsI.getCell(r, i + 1)
        c.value = v
        estiloLinhaDados(c, zi, undefined, 'left')
        c.alignment = { vertical: 'top', horizontal: 'left', wrapText: true }
      })
      wsI.getRow(r).height = Math.max(18, Math.ceil(col.help.length / 70) * 15)
      r++
      zi++
    }
  }

  // ─── Abas de dados ──────────────────────────────────────────────────────
  const linhas: Record<string, number> = {}
  for (const sheet of spec.sheets) {
    const ws = wb.addWorksheet(sheet.name, { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.columns = sheet.columns.map((c) => ({ width: c.width ?? Math.max(12, c.header.length + 4) }))
    const hr = ws.getRow(1)
    sheet.columns.forEach((col, i) => {
      const cell = hr.getCell(i + 1)
      cell.value = headerLabel(col)
      estiloHeader(cell)
      if (col.calculada) cell.font = { ...(cell.font ?? {}), italic: true }
      cell.note = col.help
    })
    hr.height = 28

    const dados = opts.dados?.[sheet.name] ?? []
    const blank = Math.max(sheet.blankRows ?? 300, dados.length + 100)
    linhas[sheet.name] = blank
    for (let i = 0; i < blank; i++) {
      const row = ws.getRow(i + 2)
      const d = dados[i]
      sheet.columns.forEach((col, ci) => {
        const cell = row.getCell(ci + 1)
        estiloLinhaDados(cell, i, numFmtDe(col), alignDe(col))
        if (col.calculada) {
          cell.value = { formula: col.calculada(i + 2) } as ExcelJS.CellFormulaValue
          cell.font = { ...(cell.font ?? {}), italic: true, color: { argb: 'FF6B7280' } }
        } else if (d && d[col.key] != null && d[col.key] !== '') {
          cell.value = d[col.key] as ExcelJS.CellValue
        }
      })
      row.height = 18
    }

    // grupo de colunas recolhido
    if (sheet.recolher) {
      const de = sheet.columns.findIndex((c) => c.key === sheet.recolher!.de) + 1
      const ate = sheet.columns.findIndex((c) => c.key === sheet.recolher!.ate) + 1
      if (de > 0 && ate >= de) {
        for (let c = de; c <= ate; c++) {
          const col = ws.getColumn(c)
          col.outlineLevel = 1
          col.hidden = true
        }
        ws.properties.outlineLevelCol = 1
      }
    }

    // validações por coluna (linhas 2..blank+1)
    sheet.columns.forEach((col, ci) => {
      const letter = colLetter(ci + 1)
      const range = `${letter}2:${letter}${blank + 1}`
      if (col.calculada) return
      if (col.listaDinamica) {
        validations(ws).add(range, {
          type: 'list',
          allowBlank: true,
          formulae: [`=${col.listaDinamica}`],
          showErrorMessage: false
        } as ExcelJS.DataValidation)
      } else if (col.tipo === 'enum' && col.enum) {
        const ref = listaRef.get(`${sheet.name}.${col.key}`)
        if (ref) {
          validations(ws).add(range, {
            type: 'list',
            allowBlank: !col.required,
            formulae: [`=${ref}`],
            showErrorMessage: true,
            errorStyle: 'warning',
            errorTitle: 'Valor fora da lista',
            error: `Use um dos valores: ${col.enum.values.join(', ')}`
          })
        }
      } else if (col.tipo === 'number' || col.tipo === 'integer' || col.tipo === 'percent') {
        const min = col.min ?? (col.tipo === 'percent' ? 0 : undefined)
        validations(ws).add(range, {
          type: col.tipo === 'integer' ? 'whole' : 'decimal',
          allowBlank: true,
          operator: min != null ? 'greaterThanOrEqual' : undefined,
          formulae: min != null ? [min] : [],
          showErrorMessage: true,
          errorStyle: 'warning',
          errorTitle: 'Número inválido',
          error: min != null ? `Informe um número ≥ ${min}` : 'Informe um número'
        } as ExcelJS.DataValidation)
      }
    })
  }

  // ─── Abas extras (visualização por fórmula etc.) ───────────────────────
  spec.extras?.(wb, { linhas })

  // ─── Exemplo ────────────────────────────────────────────────────────────
  const wsE = wb.addWorksheet(ABA_EXEMPLO, { views: [{ showGridLines: false }] })
  wsE.getCell('A1').value =
    'Exemplos de preenchimento — esta aba NÃO é importada. Copie o formato para as abas de dados.'
  estiloTexto(wsE.getCell('A1'), { bold: true, cor: COR.campoFg })
  let er = 3
  let maxCols = 1
  for (const ex of spec.exemplo) {
    const sheetSpec = spec.sheets.find((s) => s.name === ex.sheet)
    if (!sheetSpec) continue
    const sheet = { ...sheetSpec, columns: sheetSpec.columns.filter((c) => !c.calculada) }
    maxCols = Math.max(maxCols, sheet.columns.length)
    wsE.getCell(er, 1).value = `Aba "${sheet.name}"`
    estiloTexto(wsE.getCell(er, 1), { bold: true })
    er++
    sheet.columns.forEach((col, i) => {
      const c = wsE.getCell(er, i + 1)
      c.value = headerLabel(col)
      estiloHeader(c)
    })
    er++
    for (const row of ex.rows) {
      sheet.columns.forEach((col, i) => {
        const c = wsE.getCell(er, i + 1)
        const v = row[col.key]
        c.value = v == null ? null : (v as ExcelJS.CellValue)
        estiloExemplo(c, numFmtDe(col))
      })
      er++
    }
    er++
  }
  for (let i = 1; i <= maxCols; i++) wsE.getColumn(i).width = 20

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: XLSX_MIME })
}

/** `worksheet.dataValidations` existe em runtime no ExcelJS, mas não na tipagem. */
function validations(ws: ExcelJS.Worksheet): {
  add: (range: string, v: ExcelJS.DataValidation) => void
} {
  return (
    ws as unknown as {
      dataValidations: { add: (range: string, v: ExcelJS.DataValidation) => void }
    }
  ).dataValidations
}
