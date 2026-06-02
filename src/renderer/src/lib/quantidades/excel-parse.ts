// Parse de Excel de quantidades preenchido pelo usuário.
//
// Estratégia:
//   1) Lê com ExcelJS.
//   2) Encontra header row (linha que contém "Início (m)" e "Fim (m)").
//   3) Mapeia colunas após "Unid Final" pros IDs do template (match nome, case-insensitive).
//   4) Pra cada data row: lê posições (em m OU labels), valores por coluna.
//   5) Modo analítico → 1 segmento por linha do Excel.
//   6) Modo simplificado → cada linha é uma faixa; distribui proporcionalmente
//      pelos segmentos da grade analítica do trecho. Output final SEMPRE no
//      formato analítico (1 segmento por unidade mínima).

import ExcelJS from 'exceljs'
import { gerarGradeAnalitica, type TrechoUnidadeConfig } from './grade'
import { distribuirProporcional } from './distribuir'
import { parseLabelParaMetros } from './parse-label'

export interface ParseExcelResult {
  segmentos: Array<{
    ordem: number
    posicao_inicio_m: number
    posicao_fim_m: number
    unidade_inicio_label: string | null
    unidade_fim_label: string | null
    valores: Map<string, number> // coluna_id → valor
  }>
  warnings: Array<{ row: number | null; msg: string }>
}

export interface ParseExcelInput {
  file: File
  modo: 'analitico' | 'simplificado'
  /** Colunas do template — usadas pra mapear header do Excel. */
  colunas: Array<{ id: string; nome: string; unidade: string }>
  /** Config do trecho — usada pra parsear labels + gerar grade analítica (modo simplificado). */
  trecho: TrechoUnidadeConfig
}

const MAX_LINHAS = 10_000

export async function parseExcelQuantidades(input: ParseExcelInput): Promise<ParseExcelResult> {
  const buf = await input.file.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)

  const ws = wb.worksheets[0]
  if (!ws) {
    return {
      segmentos: [],
      warnings: [{ row: null, msg: 'Arquivo não contém nenhuma planilha.' }]
    }
  }

  // ─── Localiza header row ────────────────────────────────────────────
  let headerRowIdx = -1
  let colIniIdx = -1
  let colFimIdx = -1
  let colUnidIniIdx = -1
  let colUnidFimIdx = -1
  for (let r = 1; r <= Math.min(ws.rowCount, 20); r++) {
    const row = ws.getRow(r)
    for (let c = 1; c <= row.cellCount; c++) {
      const v = String(row.getCell(c).value ?? '')
        .trim()
        .toLowerCase()
      if (v === 'início (m)' || v === 'inicio (m)') colIniIdx = c
      else if (v === 'fim (m)') colFimIdx = c
      else if (v === 'unid inicial' || v === 'unidade inicial') colUnidIniIdx = c
      else if (v === 'unid final' || v === 'unidade final') colUnidFimIdx = c
    }
    if (colIniIdx > 0 && colFimIdx > 0) {
      headerRowIdx = r
      break
    }
  }
  if (headerRowIdx < 0) {
    return {
      segmentos: [],
      warnings: [
        {
          row: null,
          msg: 'Cabeçalho não encontrado. Esperado linha com "Início (m)" e "Fim (m)".'
        }
      ]
    }
  }

  // ─── Mapeia colunas do user pros IDs do template ────────────────────
  const headerRow = ws.getRow(headerRowIdx)
  const userColumns: Array<{ colIdx: number; templateColId: string }> = []
  const warnings: ParseExcelResult['warnings'] = []
  const matchMap = new Map<string, string>()
  for (const c of input.colunas) {
    // Header esperado: "<nome> (<unidade>)" — mas casamos só por nome.
    matchMap.set(c.nome.trim().toLowerCase(), c.id)
  }

  const colunasJaMapeadas = new Set<string>()
  for (let c = 1; c <= headerRow.cellCount; c++) {
    if (c === colIniIdx || c === colFimIdx || c === colUnidIniIdx || c === colUnidFimIdx) continue
    const rawHeader = String(headerRow.getCell(c).value ?? '').trim()
    if (rawHeader.length === 0) continue
    // Remove sufixo " (unidade)" se presente
    const nomeBase = rawHeader
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim()
      .toLowerCase()
    const tplId = matchMap.get(nomeBase)
    if (!tplId) {
      warnings.push({
        row: headerRowIdx,
        msg: `Coluna "${rawHeader}" do Excel não existe no template — ignorada.`
      })
      continue
    }
    if (colunasJaMapeadas.has(tplId)) {
      warnings.push({
        row: headerRowIdx,
        msg: `Coluna "${rawHeader}" duplicada no Excel — usando a primeira ocorrência.`
      })
      continue
    }
    colunasJaMapeadas.add(tplId)
    userColumns.push({ colIdx: c, templateColId: tplId })
  }

  // ─── Lê data rows ────────────────────────────────────────────────────
  const comprimentoM = Number(input.trecho.geometry_comprimento_m)
  type FaixaUser = {
    rowNum: number
    inicio: number
    fim: number
    unid_ini_label: string | null
    unid_fim_label: string | null
    valores: Map<string, number>
  }
  const faixas: FaixaUser[] = []

  const lastRow = Math.min(ws.rowCount, headerRowIdx + MAX_LINHAS)
  if (ws.rowCount > headerRowIdx + MAX_LINHAS) {
    warnings.push({
      row: null,
      msg: `Arquivo tem mais de ${MAX_LINHAS} linhas — apenas as primeiras foram processadas.`
    })
  }

  for (let r = headerRowIdx + 1; r <= lastRow; r++) {
    const row = ws.getRow(r)
    const unidIniRaw =
      colUnidIniIdx > 0 ? String(row.getCell(colUnidIniIdx).value ?? '').trim() : ''
    const unidFimRaw =
      colUnidFimIdx > 0 ? String(row.getCell(colUnidFimIdx).value ?? '').trim() : ''

    let inicio = parseCellNumeric(row.getCell(colIniIdx))
    let fim = parseCellNumeric(row.getCell(colFimIdx))

    // Fallback: tenta parsear das labels de unidade
    if (inicio == null && unidIniRaw) inicio = parseLabelParaMetros(unidIniRaw, input.trecho)
    if (fim == null && unidFimRaw) fim = parseLabelParaMetros(unidFimRaw, input.trecho)

    // Skip linha vazia (sem inicio E sem fim E sem nenhum valor)
    const valoresLinha = new Map<string, number>()
    for (const uc of userColumns) {
      const cell = row.getCell(uc.colIdx)
      const v = parseCellNumeric(cell)
      if (v != null && Number.isFinite(v)) {
        valoresLinha.set(uc.templateColId, v)
      } else {
        // Célula com conteúdo não-numérico que falhou em parsear — avisa o user
        // (caso típico: anotação textual numa célula numérica que silenciaria
        // o valor sem essa diagnose).
        const txt = (cell.text ?? '').trim()
        if (txt !== '') {
          warnings.push({
            row: r,
            msg: `Célula "${txt}" (col "${headerRow.getCell(uc.colIdx).value ?? ''}") não foi reconhecida como número — ignorada.`
          })
        }
      }
    }
    if (inicio == null && fim == null && valoresLinha.size === 0) continue

    if (inicio == null || fim == null) {
      warnings.push({
        row: r,
        msg: 'Linha sem Início e/ou Fim válidos (em metros ou label) — ignorada.'
      })
      continue
    }
    if (fim < inicio) {
      warnings.push({ row: r, msg: 'Fim < Início — linha ignorada.' })
      continue
    }
    if (inicio < 0) {
      warnings.push({ row: r, msg: 'Início negativo — clampado em 0.' })
      inicio = 0
    }
    // Trunca se extrapola comprimento do trecho (em ambas as pontas).
    if (fim > comprimentoM) {
      warnings.push({
        row: r,
        msg: `Fim ${fim.toFixed(2)} m extrapola comprimento do trecho (${comprimentoM.toFixed(2)} m) — truncado.`
      })
      fim = comprimentoM
    }
    if (inicio > comprimentoM) {
      // Faixa inteira fora do trecho — não dá pra distribuir nada. Avisa em vez
      // de silenciosamente perder o valor (que era o que acontecia antes
      // quando o truncamento de `fim` invertia `inicio > fim`).
      warnings.push({
        row: r,
        msg: `Início ${inicio.toFixed(2)} m está fora do trecho (comprimento ${comprimentoM.toFixed(2)} m) — linha ignorada.`
      })
      continue
    }

    faixas.push({
      rowNum: r,
      inicio,
      fim,
      unid_ini_label: unidIniRaw || null,
      unid_fim_label: unidFimRaw || null,
      valores: valoresLinha
    })
  }

  // ─── Modo analítico: 1 linha → 1 segmento ────────────────────────────
  if (input.modo === 'analitico') {
    const segmentos: ParseExcelResult['segmentos'] = faixas.map((f, idx) => ({
      ordem: idx,
      posicao_inicio_m: f.inicio,
      posicao_fim_m: f.fim,
      unidade_inicio_label: f.unid_ini_label,
      unidade_fim_label: f.unid_fim_label,
      valores: f.valores
    }))
    return { segmentos, warnings }
  }

  // ─── Modo simplificado: distribui faixas na grade analítica ──────────
  const grade = gerarGradeAnalitica(input.trecho)
  const segmentosOut: ParseExcelResult['segmentos'] = grade.map((g) => ({
    ordem: g.ordem,
    posicao_inicio_m: g.posicao_inicio_m,
    posicao_fim_m: g.posicao_fim_m,
    unidade_inicio_label: g.unidade_inicio_label,
    unidade_fim_label: g.unidade_fim_label,
    valores: new Map()
  }))
  const ordemToSeg = new Map<number, ParseExcelResult['segmentos'][number]>()
  for (const s of segmentosOut) ordemToSeg.set(s.ordem, s)

  // Acumula por coluna: cada faixa distribui valor entre segmentos da grade
  for (const faixa of faixas) {
    for (const [colId, valor] of faixa.valores) {
      const dist = distribuirProporcional(faixa.inicio, faixa.fim, valor, grade)
      for (const [ordem, parcela] of dist) {
        const seg = ordemToSeg.get(ordem)
        if (!seg) continue
        const atual = seg.valores.get(colId) ?? 0
        seg.valores.set(colId, atual + parcela)
      }
    }
  }

  // Filtra segmentos vazios? Não — mantém todos pra o storage refletir a grade.
  return { segmentos: segmentosOut, warnings }
}

/** Tenta parsear o valor da célula em ordem: cell.value (estruturado) e,
 *  como fallback, cell.text (string formatada que o usuário vê na planilha).
 *  O fallback resgata casos em que `value` retorna estrutura inesperada do
 *  ExcelJS (formula com .result não-numérico, formato customizado, etc). */
function parseCellNumeric(cell: ExcelJS.Cell): number | null {
  const fromValue = parseNumeric(cell.value)
  if (fromValue != null) return fromValue
  const txt = cell.text
  if (typeof txt === 'string' && txt.trim() !== '') {
    return parseNumeric(txt)
  }
  return null
}

function parseNumeric(value: ExcelJS.CellValue): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    // Heurística PT-BR / US:
    //   - Tem vírgula → BR: vírgula é decimal, pontos são milhar (descartar).
    //   - Sem vírgula, múltiplos pontos → BR sem decimal (milhar). Ex: "1.234"
    //   - Sem vírgula, ≤ 1 ponto → US ou inteiro. Ex: "1234.56" ou "1234".
    // O bug antigo era `replace(',', '.')` ingênuo: "1.234,56" → "1.234.56"
    // → Number() = NaN → linha descartada silenciosamente.
    let normalized: string
    if (trimmed.includes(',')) {
      normalized = trimmed.replace(/\./g, '').replace(',', '.')
    } else {
      const dots = (trimmed.match(/\./g) ?? []).length
      normalized = dots > 1 ? trimmed.replace(/\./g, '') : trimmed
    }
    const n = Number(normalized)
    return Number.isFinite(n) ? n : null
  }
  // ExcelJS pode retornar { result } pra formulas, { richText } etc
  if (typeof value === 'object' && value !== null) {
    const obj = value as {
      result?: unknown
      text?: unknown
      richText?: { text?: string }[]
    }
    if (typeof obj.result === 'number') return Number.isFinite(obj.result) ? obj.result : null
    if (typeof obj.result === 'string') return parseNumeric(obj.result)
    if (typeof obj.text === 'string') return parseNumeric(obj.text)
    // richText: concatena os pedaços e tenta parsear.
    if (Array.isArray(obj.richText)) {
      const joined = obj.richText.map((p) => p?.text ?? '').join('')
      return parseNumeric(joined)
    }
  }
  return null
}
