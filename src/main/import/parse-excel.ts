// Parser de Excel para o módulo Orçamento (Fase 4).
// Roda no main process do Electron e devolve um payload normalizado
// que a UI envia para a Edge Function `import-iniciar`.
//
// Estratégia em camadas:
//   1. Detecção por HEADER (preferida): varre todas as abas procurando uma
//      linha de cabeçalho que tenha colunas reconhecíveis ("ITEM",
//      "DESCRIÇÃO", "QUANT.", etc.) via dicionário de sinônimos.
//   2. Fallback por COLUNAS FIXAS: se o usuário passar um mapping explícito
//      no template (aba_plan_orc.colunas), usa esse mapping direto.
//   3. Layout TecPav v1.8 (referência): aba "Plan_Orc" com cabeçalho em 5
//      linhas; colunas: E=ITEM, F=DESCRIÇÃO, G=UNID., H=K, I=QUANT.,
//      J=VENDA UNIT, K=VENDA TOTAL.
//
// Suporta também CPUs no mesmo arquivo: aba `CPU_*` com layout fixo
// (rows 11-23 EQ, 24-36 COMB, 37-49 MO, 50-62 MAT) — não importado aqui,
// fica para um importer dedicado.

import ExcelJS from 'exceljs'

export interface ParsedItem {
  idx: number
  codigo: string
  descricao: string
  unidade: string | null
  quantidade: number | null
  venda_unitaria: number | null
  is_folha: boolean
}

export interface ParsedIndireto {
  idx: number
  codigo: string | null
  descricao: string
  tipo: 'mobilizacao' | 'desmob' | 'admin_local' | 'outros'
  valor_total: number
}

export interface ParseResult {
  itens: ParsedItem[]
  indireto: ParsedIndireto[]
  abas_encontradas: string[]
  aba_usada: string | null
  linhas_cabecalho_usadas: number
  colunas_detectadas: Record<string, string> // campo → letra
  log: string[]
}

export interface ColunaMap {
  codigo: string
  descricao: string
  unidade?: string
  quantidade?: string
  venda_unitaria?: string
  bdi?: string
  tipo?: string
  valor_total?: string
}

export interface AbaConfig {
  nome: string
  linhas_cabecalho: number
  colunas: ColunaMap
}

export interface ParseMapping {
  formato: 'xlsx'
  aba_plan_orc?: AbaConfig
  aba_indireto?: AbaConfig
}

const CODIGO_REGEX = /^\d+(\.\d+)*$/

// Sinônimos para detecção automática de coluna pelo texto do cabeçalho.
// Tudo é normalizado (lowercase, sem acento) antes da comparação.
const HEADER_SINONIMOS: Record<keyof ColunaMap, string[]> = {
  codigo: [
    'item',
    'itens',
    'codigo',
    'cod',
    'codigo do item',
    'cod item',
    'id',
    'item no',
    'no item'
  ],
  descricao: [
    'descricao',
    'discriminacao',
    'discriminacao dos servicos',
    'servico',
    'servicos',
    'especificacao',
    'descricao do servico',
    'descricao item'
  ],
  unidade: ['unid', 'unidade', 'un', 'um', 'unid.', 'u'],
  quantidade: ['quant', 'quantidade', 'qtde', 'qtd', 'quant.'],
  venda_unitaria: [
    'venda unit',
    'venda unitaria',
    'preco unitario',
    'preco unit',
    'pr unit',
    'p unit',
    'pu',
    'p.u.',
    'valor unitario',
    'vlr unit',
    'preco de venda',
    'pv unit'
  ],
  bdi: ['k', 'bdi', 'fator', 'bdi%', 'bdi perc', 'mark-up'],
  tipo: ['tipo', 'natureza', 'categoria'],
  valor_total: ['venda total', 'preco total', 'pr total', 'valor total', 'vlr total', 'total']
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-z0-9\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function indexToColLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function colLetterToIndex(letter: string): number {
  let n = 0
  const upper = letter.toUpperCase()
  for (let i = 0; i < upper.length; i++) {
    n = n * 26 + (upper.charCodeAt(i) - 64)
  }
  return n
}

function toNumber(val: ExcelJS.CellValue): number | null {
  if (val == null) return null
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const cleaned = val
      .replace(/\./g, '')
      .replace(',', '.')
      .replace(/[^\d.-]/g, '')
    if (!cleaned) return null
    const n = parseFloat(cleaned)
    return Number.isFinite(n) ? n : null
  }
  if (typeof val === 'object' && 'result' in val) {
    return toNumber((val as { result: ExcelJS.CellValue }).result)
  }
  return null
}

function toString(val: ExcelJS.CellValue): string {
  if (val == null) return ''
  if (typeof val === 'string') return val.trim()
  if (typeof val === 'number') return String(val)
  if (typeof val === 'boolean') return val ? 'true' : 'false'
  if (typeof val === 'object') {
    if ('result' in val) return toString((val as { result: ExcelJS.CellValue }).result)
    if ('text' in val) return String((val as { text: string }).text).trim()
    if ('richText' in val) {
      return ((val as { richText: { text: string }[] }).richText || [])
        .map((r) => r.text)
        .join('')
        .trim()
    }
    if ('hyperlink' in val) {
      return toString((val as { text?: ExcelJS.CellValue }).text ?? null)
    }
  }
  return String(val).trim()
}

// ─── Detecção de coluna pelo header ──────────────────────────────────────

interface HeaderDetection {
  /** Linha onde o cabeçalho foi detectado (1-indexed). */
  header_row: number
  /** Mapping: campo canônico → letra de coluna (A, B, ...). */
  cols: Partial<Record<keyof ColunaMap, string>>
  /** Score: quantas colunas canônicas reconhecemos. */
  score: number
}

function detectarHeader(ws: ExcelJS.Worksheet): HeaderDetection | null {
  // Varre primeiras 20 linhas procurando aquela que tem o maior nº de
  // colunas reconhecíveis. Cabeçalho TecPav fica na linha 5.
  let best: HeaderDetection | null = null
  const maxRow = Math.min(ws.rowCount, 20)
  for (let r = 1; r <= maxRow; r++) {
    const row = ws.getRow(r)
    const cols: Partial<Record<keyof ColunaMap, string>> = {}
    let score = 0
    // Itera células de 1 a 30 (até col AD)
    for (let c = 1; c <= 30; c++) {
      const raw = toString(row.getCell(c).value)
      if (!raw) continue
      const txt = normalize(raw)
      if (!txt || txt.length > 50) continue
      // Tenta casar contra cada campo canônico
      for (const [campo, sinonimos] of Object.entries(HEADER_SINONIMOS) as [
        keyof ColunaMap,
        string[]
      ][]) {
        if (cols[campo]) continue // já preenchido, prioriza primeiro match
        if (sinonimos.some((s) => txt === s || txt === s + '.')) {
          cols[campo] = indexToColLetter(c)
          score++
          break
        }
      }
    }
    // Critério mínimo: precisa ter codigo OU item E descricao
    if (cols.codigo && cols.descricao && score > (best?.score ?? 0)) {
      best = { header_row: r, cols, score }
    }
  }
  return best
}

interface ParseAbaResult {
  itens: ParsedItem[]
  cols_usadas: Partial<Record<keyof ColunaMap, string>>
}

function parsePlanAba(
  ws: ExcelJS.Worksheet,
  cols: Partial<Record<keyof ColunaMap, string>>,
  cabecalho: number
): ParseAbaResult {
  if (!cols.codigo || !cols.descricao) {
    return { itens: [], cols_usadas: cols }
  }
  const colCodigo = colLetterToIndex(cols.codigo)
  const colDesc = colLetterToIndex(cols.descricao)
  const colUn = cols.unidade ? colLetterToIndex(cols.unidade) : null
  const colQtd = cols.quantidade ? colLetterToIndex(cols.quantidade) : null
  const colVenda = cols.venda_unitaria ? colLetterToIndex(cols.venda_unitaria) : null

  const itens: ParsedItem[] = []
  let idx = 0
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= cabecalho) return
    const codigo = toString(row.getCell(colCodigo).value)
    const descricao = toString(row.getCell(colDesc).value)
    if (!codigo && !descricao) return
    if (!CODIGO_REGEX.test(codigo)) return
    if (!descricao) return
    const unidade = colUn ? toString(row.getCell(colUn).value) || null : null
    const quantidade = colQtd ? toNumber(row.getCell(colQtd).value) : null
    const venda_unitaria = colVenda ? toNumber(row.getCell(colVenda).value) : null
    const is_folha = Boolean(unidade) && (quantidade != null || venda_unitaria != null)
    itens.push({
      idx: idx++,
      codigo: codigo.trim(),
      descricao: descricao.trim(),
      unidade: is_folha ? unidade : null,
      quantidade: is_folha ? quantidade : null,
      venda_unitaria: is_folha ? venda_unitaria : null,
      is_folha
    })
  })
  return { itens, cols_usadas: cols }
}

// ─── Indireto ────────────────────────────────────────────────────────────

function classificaTipoIndireto(raw: string): ParsedIndireto['tipo'] {
  const s = normalize(raw)
  if (s.startsWith('desmob') || s === 'desm') return 'desmob'
  if (s.startsWith('mob')) return 'mobilizacao'
  if (s.startsWith('adm')) return 'admin_local'
  return 'outros'
}

function parseIndiretoAba(
  ws: ExcelJS.Worksheet,
  cols: ColunaMap,
  cabecalho: number
): ParsedIndireto[] {
  const out: ParsedIndireto[] = []
  const c1 = colLetterToIndex(cols.codigo)
  const c2 = colLetterToIndex(cols.descricao)
  const c3 = cols.tipo ? colLetterToIndex(cols.tipo) : null
  const c4 = cols.valor_total ? colLetterToIndex(cols.valor_total) : null
  let iidx = 0
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= cabecalho) return
    const codigo = toString(row.getCell(c1).value)
    const descricao = toString(row.getCell(c2).value)
    if (!descricao) return
    const tipoRaw = c3 ? toString(row.getCell(c3).value) : 'outros'
    const valor_total = c4 ? (toNumber(row.getCell(c4).value) ?? 0) : 0
    if (valor_total === 0 && !codigo) return
    out.push({
      idx: iidx++,
      codigo: codigo || null,
      descricao: descricao.trim(),
      tipo: classificaTipoIndireto(tipoRaw),
      valor_total
    })
  })
  return out
}

// ─── Main ────────────────────────────────────────────────────────────────

export async function parseExcelFile(path: string, mapping: ParseMapping): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  const abas: string[] = []
  wb.eachSheet((ws) => abas.push(ws.name))

  const result: ParseResult = {
    itens: [],
    indireto: [],
    abas_encontradas: abas,
    aba_usada: null,
    linhas_cabecalho_usadas: 0,
    colunas_detectadas: {},
    log: []
  }

  result.log.push(`Arquivo aberto — ${abas.length} aba(s): ${abas.join(', ')}`)

  // ──────────────────────────────────────────────────────────────────────
  // ETAPA 1: Tenta mapping explícito (template salvo)
  // ──────────────────────────────────────────────────────────────────────
  if (mapping.aba_plan_orc?.nome && mapping.aba_plan_orc.colunas) {
    const nome = mapping.aba_plan_orc.nome
    const abaMatch = abas.find((a) => a.toLowerCase() === nome.toLowerCase())
    if (abaMatch) {
      const ws = wb.getWorksheet(abaMatch)!
      const r = parsePlanAba(
        ws,
        mapping.aba_plan_orc.colunas,
        mapping.aba_plan_orc.linhas_cabecalho
      )
      result.log.push(
        `Via template explícito: aba="${abaMatch}", header=${mapping.aba_plan_orc.linhas_cabecalho} → ${r.itens.length} item(ns)`
      )
      if (r.itens.length > 0) {
        result.itens = r.itens
        result.aba_usada = abaMatch
        result.linhas_cabecalho_usadas = mapping.aba_plan_orc.linhas_cabecalho
        result.colunas_detectadas = r.cols_usadas as Record<string, string>
      }
    } else {
      result.log.push(`Aba "${nome}" do template não encontrada`)
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // ETAPA 2: Auto-detect por HEADER (a abordagem boa)
  // ──────────────────────────────────────────────────────────────────────
  if (result.itens.length === 0) {
    result.log.push(
      'Iniciando auto-detect por header (busca colunas ITEM/DESCRIÇÃO/QUANT/UNID/VENDA…)'
    )
    let melhor: { aba: string; det: HeaderDetection; itens: ParsedItem[] } | null = null
    for (const nome of abas) {
      const ws = wb.getWorksheet(nome)
      if (!ws || ws.rowCount < 5) continue
      const det = detectarHeader(ws)
      if (!det) continue
      const { itens } = parsePlanAba(ws, det.cols, det.header_row)
      result.log.push(
        `  · "${nome}": header linha ${det.header_row}, ${det.score} col(s) reconhecida(s) [${Object.entries(
          det.cols
        )
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}] → ${itens.length} item(ns)`
      )
      if (itens.length > 0 && (!melhor || itens.length > melhor.itens.length)) {
        melhor = { aba: nome, det, itens }
      }
    }
    if (melhor) {
      result.itens = melhor.itens
      result.aba_usada = melhor.aba
      result.linhas_cabecalho_usadas = melhor.det.header_row
      result.colunas_detectadas = melhor.det.cols as Record<string, string>
      result.log.push(
        `✓ Auto-detect: aba="${melhor.aba}", header=linha ${melhor.det.header_row}, ${melhor.itens.length} itens`
      )
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // ETAPA 3: Indireto (opcional, busca por nome de aba)
  // ──────────────────────────────────────────────────────────────────────
  if (mapping.aba_indireto) {
    const indNome = abas.find((a) => a.toLowerCase() === mapping.aba_indireto!.nome.toLowerCase())
    if (indNome) {
      const ws = wb.getWorksheet(indNome)!
      result.indireto = parseIndiretoAba(
        ws,
        mapping.aba_indireto.colunas,
        mapping.aba_indireto.linhas_cabecalho
      )
      result.log.push(`Indireto "${indNome}": ${result.indireto.length} linha(s)`)
    }
  } else {
    // Auto-detect: procura aba com nome contendo "indireto"
    const indNome = abas.find((a) => normalize(a).includes('indireto'))
    if (indNome) {
      const ws = wb.getWorksheet(indNome)!
      const det = detectarHeader(ws)
      if (det) {
        const cols: ColunaMap = {
          codigo: det.cols.codigo ?? 'A',
          descricao: det.cols.descricao ?? 'B',
          tipo: det.cols.tipo,
          valor_total: det.cols.valor_total ?? det.cols.venda_unitaria
        }
        result.indireto = parseIndiretoAba(ws, cols, det.header_row)
        result.log.push(`Indireto (auto) "${indNome}": ${result.indireto.length} linha(s)`)
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // ETAPA 4: Debug se ainda 0 itens
  // ──────────────────────────────────────────────────────────────────────
  if (result.itens.length === 0) {
    result.log.push('❌ Não detectei colunas canônicas em nenhuma aba.')
    for (const nome of abas.slice(0, 15)) {
      const ws = wb.getWorksheet(nome)
      if (!ws || ws.rowCount < 2) continue
      const sample: string[] = []
      let r = 0
      ws.eachRow({ includeEmpty: false }, (row) => {
        if (r >= 3) return
        r++
        const cells: string[] = []
        for (let c = 1; c <= 10; c++) {
          const v = toString(row.getCell(c).value).slice(0, 25)
          if (v) cells.push(`${indexToColLetter(c)}=${v}`)
        }
        if (cells.length > 0) sample.push(cells.join(' | '))
      })
      if (sample.length > 0) {
        result.log.push(`  · "${nome}":`)
        sample.forEach((s) => result.log.push(`      ${s}`))
      }
    }
  }

  return result
}
