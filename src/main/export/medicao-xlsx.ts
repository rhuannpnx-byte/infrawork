// Geração da planilha .xlsx de "Valor Agregado":
//   - Aba "Medição": medição unitária do período (colunas separadas + cabeçalho)
//   - 1 aba por serviço (código): memória de cálculo da produção dia-a-dia
//   - Aba "Fotos": relatório fotográfico do período com imagens embutidas
// Roda no processo main, reusando o exceljs já presente.

import ExcelJS from 'exceljs'

export interface MedicaoExportRow {
  tipo: 'servico' | 'indireto'
  grupo_codigo: string
  grupo_descricao: string
  item_codigo: string
  item_descricao: string
  unidade: string
  qtd_contratual: number
  pct_avanco: number
  medicao_qtd: number
  venda_unitaria: number
  medicao_valor: number
}

export interface MemoriaDia {
  data: string
  /** Produção do agregador no dia (unidade do agregador). */
  aggQtd: number
  /** % de avanço do agregador no dia. */
  pct: number
  /** Quantidade do filho no dia = pct × quantidade contratual. */
  qtd: number
  /** Valor do dia = qtd × venda unitária. */
  valor: number
  /** Frentes/equipes do dia (contexto). */
  contexto: string
}

export interface MemoriaServico {
  /** Código do filho (vira o nome da aba). */
  codigo: string
  descricao: string
  unidade: string
  agregadorCodigo: string
  agregadorDescricao: string
  agregadorUnidade: string
  qtdContratual: number
  vendaUnitaria: number
  dias: MemoriaDia[]
}

export interface FotoExport {
  base64: string
  extension: 'jpeg' | 'png'
  data: string
  servico: string
  frente: string
  obs: string
}

export interface MedicaoExportPayload {
  obraNome: string
  periodoLabel: string
  /** Período formatado p/ nome de arquivo: "DD.MM.YYYY - DD.MM.YYYY". */
  periodoArquivo: string
  medicao: MedicaoExportRow[]
  memorias: MemoriaServico[]
  fotos: FotoExport[]
}

const MOEDA = 'R$ #,##0.00'
const NUM = '#,##0.00'
const PCT = '0.0%'
const AZUL = 'FF1F2937'

function brDataHora(): string {
  return new Date().toLocaleString('pt-BR')
}

/** Cabeçalho padrão (obra/período/gerado em) no topo de uma aba. Retorna a próxima linha livre. */
function escreverCabecalho(
  ws: ExcelJS.Worksheet,
  obraNome: string,
  periodoLabel: string,
  titulo: string,
  subtitulo?: string
): number {
  ws.mergeCells('A1:I1')
  ws.getCell('A1').value = titulo
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.mergeCells('A2:I2')
  ws.getCell('A2').value = `Obra: ${obraNome}`
  ws.getCell('A2').font = { bold: true, size: 11 }
  ws.mergeCells('A3:I3')
  ws.getCell('A3').value = `Período: ${periodoLabel}    •    Gerado em: ${brDataHora()}`
  ws.getCell('A3').font = { italic: true, size: 10, color: { argb: 'FF666666' } }
  let next = 4
  if (subtitulo) {
    ws.mergeCells(`A4:I4`)
    ws.getCell('A4').value = subtitulo
    ws.getCell('A4').font = { bold: true, size: 11 }
    next = 5
  }
  return next + 1 // 1 linha em branco antes do conteúdo
}

function estilizarHeaderRow(row: ExcelJS.Row, colsEsq: number): void {
  row.eachCell((c, col) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
    c.alignment = { horizontal: col <= colsEsq ? 'left' : 'right', vertical: 'middle' }
  })
}

function sanitizeSheetName(nome: string, usados: Set<string>): string {
  const base =
    (nome || 'servico')
      .replace(/[\\/?*[\]:]/g, '-')
      .slice(0, 28)
      .trim() || 'servico'
  let nomeFinal = base
  let i = 2
  while (usados.has(nomeFinal.toLowerCase())) {
    nomeFinal = `${base.slice(0, 25)} (${i++})`
  }
  usados.add(nomeFinal.toLowerCase())
  return nomeFinal
}

// ─── Aba Medição ───────────────────────────────────────────────────────────
function abaMedicao(wb: ExcelJS.Workbook, p: MedicaoExportPayload): void {
  const ws = wb.addWorksheet('Medição')
  ws.columns = [
    { key: 'agregador', width: 14 },
    { key: 'cod_servico', width: 14 },
    { key: 'servico', width: 44 },
    { key: 'unidade', width: 8 },
    { key: 'qtd_contratual', width: 16 },
    { key: 'pct', width: 11 },
    { key: 'qtd_medida', width: 16 },
    { key: 'venda_unit', width: 16 },
    { key: 'valor', width: 18 }
  ]
  const ini = escreverCabecalho(ws, p.obraNome, p.periodoLabel, 'Medição unitária do período')

  const header = [
    'Cód. agregador',
    'Cód. serviço',
    'Serviço',
    'Unid.',
    'Qtd contratual',
    '% avanço',
    'Qtd medida',
    'Venda unit.',
    'Valor medido'
  ]
  const hr = ws.getRow(ini)
  header.forEach((h, i) => (hr.getCell(i + 1).value = h))
  estilizarHeaderRow(hr, 3)

  let r = ini + 1
  for (const row of p.medicao) {
    const l = ws.getRow(r)
    if (row.tipo === 'indireto') {
      ws.mergeCells(r, 1, r, 8)
      l.getCell(1).value = row.item_descricao || 'Indireto'
      l.getCell(1).font = { italic: true }
      l.getCell(9).value = row.medicao_valor
      l.getCell(9).numFmt = MOEDA
    } else {
      l.getCell(1).value = row.grupo_codigo
      l.getCell(2).value = row.item_codigo
      l.getCell(3).value = row.item_descricao
      l.getCell(4).value = row.unidade
      l.getCell(5).value = row.qtd_contratual
      l.getCell(5).numFmt = NUM
      l.getCell(6).value = row.pct_avanco
      l.getCell(6).numFmt = PCT
      l.getCell(7).value = row.medicao_qtd
      l.getCell(7).numFmt = NUM
      l.getCell(8).value = row.venda_unitaria
      l.getCell(8).numFmt = MOEDA
      l.getCell(9).value = row.medicao_valor
      l.getCell(9).numFmt = MOEDA
    }
    r++
  }

  const tr = ws.getRow(r)
  ws.mergeCells(r, 1, r, 8)
  tr.getCell(1).value = 'Total medido no período'
  tr.getCell(1).font = { bold: true }
  tr.getCell(1).alignment = { horizontal: 'right' }
  tr.getCell(9).value = p.medicao.reduce((a, x) => a + x.medicao_valor, 0)
  tr.getCell(9).numFmt = MOEDA
  tr.getCell(9).font = { bold: true }

  ws.views = [{ state: 'frozen', ySplit: ini }]
}

// ─── Aba por serviço: memória de cálculo dia-a-dia ───────────────────────────
function abaMemoria(
  wb: ExcelJS.Workbook,
  p: MedicaoExportPayload,
  m: MemoriaServico,
  usados: Set<string>
): void {
  const ws = wb.addWorksheet(sanitizeSheetName(m.codigo, usados))
  ws.columns = [
    { key: 'data', width: 12 },
    { key: 'aggQtd', width: 18 },
    { key: 'pct', width: 10 },
    { key: 'qtd', width: 16 },
    { key: 'acum', width: 16 },
    { key: 'valor', width: 16 },
    { key: 'contexto', width: 42 }
  ]
  const ini = escreverCabecalho(
    ws,
    p.obraNome,
    p.periodoLabel,
    'Memória de cálculo — produção dia-a-dia',
    `Serviço (filho): ${m.codigo} — ${m.descricao}`
  )

  // Linha de informações do agregador / contrato.
  ws.mergeCells(ini, 1, ini, 7)
  ws.getCell(ini, 1).value =
    `Agregador: ${m.agregadorCodigo} — ${m.agregadorDescricao}` +
    `   •   Qtd contratual: ${m.qtdContratual} ${m.unidade || ''}` +
    `   •   Venda unit.: ${m.vendaUnitaria}`
  ws.getCell(ini, 1).font = { italic: true, color: { argb: 'FF666666' } }

  const headerRow = ini + 2
  const header = [
    'Data',
    `Prod. agregador (${m.agregadorUnidade || '—'})`,
    '% dia',
    `Qtd medida (${m.unidade || '—'})`,
    'Acumulado',
    'Valor medido',
    'Frentes / Equipes'
  ]
  const hr = ws.getRow(headerRow)
  header.forEach((h, i) => (hr.getCell(i + 1).value = h))
  estilizarHeaderRow(hr, 1)

  let r = headerRow + 1
  let acum = 0
  let acumValor = 0
  for (const d of m.dias) {
    acum += d.qtd
    acumValor += d.valor
    const l = ws.getRow(r)
    l.getCell(1).value = d.data
    l.getCell(2).value = d.aggQtd
    l.getCell(2).numFmt = NUM
    l.getCell(3).value = d.pct
    l.getCell(3).numFmt = PCT
    l.getCell(4).value = d.qtd
    l.getCell(4).numFmt = NUM
    l.getCell(5).value = acum
    l.getCell(5).numFmt = NUM
    l.getCell(6).value = d.valor
    l.getCell(6).numFmt = MOEDA
    l.getCell(7).value = d.contexto
    r++
  }

  const tr = ws.getRow(r)
  tr.getCell(1).value = 'Total'
  tr.getCell(1).font = { bold: true }
  tr.getCell(4).value = acum
  tr.getCell(4).numFmt = NUM
  tr.getCell(4).font = { bold: true }
  tr.getCell(6).value = acumValor
  tr.getCell(6).numFmt = MOEDA
  tr.getCell(6).font = { bold: true }

  ws.views = [{ state: 'frozen', ySplit: headerRow }]
}

// ─── Aba Fotos: relatório fotográfico ────────────────────────────────────────
function abaFotos(wb: ExcelJS.Workbook, p: MedicaoExportPayload): void {
  const ws = wb.addWorksheet('Fotos')
  // Colunas: A–G hospedam a imagem (~320px); H–M o texto da legenda.
  ws.columns = [
    { width: 6.5 },
    { width: 6.5 },
    { width: 6.5 },
    { width: 6.5 },
    { width: 6.5 },
    { width: 6.5 },
    { width: 6.5 },
    { width: 18 },
    { width: 22 },
    { width: 22 },
    { width: 22 },
    { width: 22 }
  ]
  escreverCabecalho(ws, p.obraNome, p.periodoLabel, 'Relatório fotográfico do período')

  const IMG_W = 320
  const IMG_H = 240
  const ROWS_IMG = 12 // ~240px
  const BLOCK = ROWS_IMG + 2
  let r0 = 5 // 0-based: começa após cabeçalho

  for (const f of p.fotos) {
    try {
      const id = wb.addImage({ base64: f.base64, extension: f.extension })
      // Altura das linhas da imagem.
      for (let i = 0; i < ROWS_IMG; i++) ws.getRow(r0 + i + 1).height = 16
      ws.addImage(id, {
        tl: { col: 0.15, row: r0 + 0.15 },
        ext: { width: IMG_W, height: IMG_H }
      })
      // Legenda à direita (cols H..L), mesclada em 4 linhas.
      const capRowIni = r0 + 1
      ws.mergeCells(capRowIni, 8, capRowIni + 5, 12)
      const cap = ws.getCell(capRowIni, 8)
      const linhas = [
        f.data ? `Data: ${f.data}` : '',
        f.servico ? `Serviço: ${f.servico}` : '',
        f.frente ? `Frente: ${f.frente}` : '',
        f.obs ? `Obs: ${f.obs}` : ''
      ].filter(Boolean)
      cap.value = linhas.join('\n')
      cap.alignment = { vertical: 'top', horizontal: 'left', wrapText: true }
      cap.font = { size: 10 }
    } catch {
      /* imagem inválida — pula */
    }
    r0 += BLOCK
  }

  if (p.fotos.length === 0) {
    ws.getCell('A6').value = 'Sem fotos no período.'
    ws.getCell('A6').font = { italic: true, color: { argb: 'FF666666' } }
  }
}

export async function gerarMedicaoXlsx(
  payload: MedicaoExportPayload,
  destino: string
): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'InfraWork'
  wb.created = new Date()

  abaMedicao(wb, payload)

  const usados = new Set<string>(['medição', 'fotos'])
  for (const m of payload.memorias) abaMemoria(wb, payload, m, usados)

  abaFotos(wb, payload)

  await wb.xlsx.writeFile(destino)
}
