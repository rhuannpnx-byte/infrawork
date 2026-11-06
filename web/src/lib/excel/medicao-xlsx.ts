// Geração da planilha .xlsx de "Valor Agregado":
//   - Aba "Medição": medição unitária do período (colunas separadas + cabeçalho)
//   - 1 aba por serviço (código): memória de cálculo da produção dia-a-dia
//   - Aba "Fotos": relatório fotográfico do período com imagens embutidas
// Roda no browser (exceljs) e devolve um Blob para download.

import ExcelJS from 'exceljs'
import { XLSX_MIME } from '@/lib/files/download'
import type { QuadroViagens } from '@/features/acompanhamento/lib/qdm-viagens'

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
  /** Estaca(s) do dia. */
  estaca: string
  /** Material(is) do dia. */
  material: string
  /** Observação(ões) do dia. */
  observacao: string
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
  /** Serviço lançado por viagens: a memória é o quadro de distribuição das viagens. */
  qdm?: QuadroViagens
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
  const azul = 'FF1F2937'
  row.eachCell((c, col) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: azul } }
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
    if (row.tipo === 'indireto' && !row.item_codigo) {
      // Fallback: indireto sem itens de receita cadastrados.
      l.getCell(1).value = row.grupo_codigo
      ws.mergeCells(r, 2, r, 5)
      l.getCell(2).value = row.item_descricao || 'Indireto'
      l.getCell(2).font = { italic: true }
      l.getCell(6).value = row.pct_avanco
      l.getCell(6).numFmt = PCT
      ws.mergeCells(r, 7, r, 8)
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
  if (m.qdm) {
    abaQuadroViagens(wb, p, m, m.qdm, usados)
    return
  }
  const ws = wb.addWorksheet(sanitizeSheetName(m.codigo, usados))
  ws.columns = [
    { key: 'data', width: 12 },
    { key: 'aggQtd', width: 18 },
    { key: 'pct', width: 10 },
    { key: 'qtd', width: 16 },
    { key: 'acum', width: 16 },
    { key: 'valor', width: 16 },
    { key: 'estaca', width: 18 },
    { key: 'material', width: 24 },
    { key: 'obs', width: 34 },
    { key: 'contexto', width: 34 }
  ]
  const ini = escreverCabecalho(
    ws,
    p.obraNome,
    p.periodoLabel,
    'Memória de cálculo — produção dia-a-dia',
    `Serviço (filho): ${m.codigo} — ${m.descricao}`
  )

  // Linha de informações do agregador / contrato.
  ws.mergeCells(ini, 1, ini, 10)
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
    'Estaca',
    'Material',
    'Observação',
    'Frentes / Equipes'
  ]
  const hr = ws.getRow(headerRow)
  header.forEach((h, i) => (hr.getCell(i + 1).value = h))
  estilizarHeaderRow(hr, 1)
  // Cabeçalhos de colunas de texto: alinhar à esquerda (estaca..frentes).
  for (let c = 7; c <= 10; c++) hr.getCell(c).alignment = { horizontal: 'left', vertical: 'middle' }

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
    l.getCell(7).value = d.estaca
    l.getCell(8).value = d.material
    l.getCell(9).value = d.observacao
    l.getCell(9).alignment = { wrapText: true, vertical: 'top' }
    l.getCell(10).value = d.contexto
    l.getCell(10).alignment = { wrapText: true, vertical: 'top' }
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

// ─── Aba por serviço lançado por viagens: quadro de distribuição (QDM) ─────────
function tituloSecao(ws: ExcelJS.Worksheet, r: number, texto: string): void {
  ws.mergeCells(r, 1, r, 11)
  ws.getCell(r, 1).value = texto
  ws.getCell(r, 1).font = { bold: true, size: 12 }
}

function abaQuadroViagens(
  wb: ExcelJS.Workbook,
  p: MedicaoExportPayload,
  m: MemoriaServico,
  q: QuadroViagens,
  usados: Set<string>
): void {
  const ws = wb.addWorksheet(sanitizeSheetName(m.codigo, usados))
  ws.columns = [
    { width: 14 },
    { width: 18 },
    { width: 18 },
    { width: 16 },
    { width: 24 },
    { width: 18 },
    { width: 24 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 12 },
    { width: 22 },
    { width: 18 }
  ]
  const un = q.unidadeVolume || '—'
  const ini = escreverCabecalho(
    ws,
    p.obraNome,
    p.periodoLabel,
    'Memória de cálculo — quadro de distribuição das viagens',
    `Serviço (filho): ${m.codigo} — ${m.descricao}`
  )
  ws.mergeCells(ini, 1, ini, 13)
  ws.getCell(ini, 1).value =
    `Agregador: ${m.agregadorCodigo} — ${m.agregadorDescricao}` +
    `   •   Qtd contratual: ${m.qtdContratual} ${m.unidade || ''}` +
    `   •   Venda unit.: ${m.vendaUnitaria}`
  ws.getCell(ini, 1).font = { italic: true, color: { argb: 'FF666666' } }

  // 1. Quadro de distribuição: origem → destino → DMT
  let r = ini + 2
  tituloSecao(ws, r++, 'Quadro de distribuição das viagens')
  const hq = ws.getRow(r++)
  ;[
    'Origem',
    'Estacas de carga',
    'Destino',
    'Estacas de descarga',
    'Faixa de DMT',
    'Nº de viagens',
    `Volume (${un})`,
    'DMT (km)',
    `Momento (${un}·km)`,
    `Qtd medida (${m.unidade || '—'})`,
    'Valor medido'
  ].forEach((h, i) => (hq.getCell(i + 1).value = h))
  estilizarHeaderRow(hq, 5)
  for (const l of q.linhas) {
    const row = ws.getRow(r++)
    row.getCell(1).value = l.origem
    row.getCell(2).value = l.estacasCarga
    row.getCell(3).value = l.destino
    row.getCell(4).value = l.estacasDescarga
    row.getCell(5).value = l.faixa
    row.getCell(6).value = l.viagens
    row.getCell(7).value = l.volume
    row.getCell(7).numFmt = NUM
    row.getCell(8).value = l.dmtKm
    row.getCell(8).numFmt = '#,##0.000'
    row.getCell(9).value = l.momento
    row.getCell(9).numFmt = NUM
    row.getCell(10).value = l.qtd
    row.getCell(10).numFmt = NUM
    row.getCell(11).value = l.valor
    row.getCell(11).numFmt = MOEDA
  }
  const tq = ws.getRow(r++)
  ws.mergeCells(tq.number, 1, tq.number, 5)
  tq.getCell(1).value = 'Total (DMT médio ponderado pelo volume)'
  tq.getCell(6).value = q.total.viagens
  tq.getCell(7).value = q.total.volume
  tq.getCell(7).numFmt = NUM
  tq.getCell(8).value = q.total.dmtMedioKm
  tq.getCell(8).numFmt = '#,##0.000'
  tq.getCell(9).value = q.total.momento
  tq.getCell(9).numFmt = NUM
  tq.getCell(10).value = q.total.qtd
  tq.getCell(10).numFmt = NUM
  tq.getCell(11).value = q.total.valor
  tq.getCell(11).numFmt = MOEDA
  tq.eachCell((c) => (c.font = { bold: true }))

  // 2. Resumo por faixa de DMT
  r++
  tituloSecao(ws, r++, 'Resumo por faixa de DMT')
  const hf = ws.getRow(r++)
  ;['Faixa de DMT', `Volume (${un})`, `Momento (${un}·km)`, '% do volume'].forEach(
    (h, i) => (hf.getCell(i + 1).value = h)
  )
  estilizarHeaderRow(hf, 1)
  for (const f of q.porFaixa) {
    const row = ws.getRow(r++)
    row.getCell(1).value = f.faixa
    row.getCell(2).value = f.volume
    row.getCell(2).numFmt = NUM
    row.getCell(3).value = f.momento
    row.getCell(3).numFmt = NUM
    row.getCell(4).value = f.pct
    row.getCell(4).numFmt = PCT
  }

  // 3. Relação das viagens
  r++
  tituloSecao(ws, r++, `Relação das viagens (${q.relacao.length})`)
  const hr = ws.getRow(r++)
  ;[
    'Data',
    'Veículo',
    'Motorista',
    'Equipe',
    'Origem',
    'Estaca de carga',
    'Destino',
    'Estaca de descarga',
    `Volume (${un})`,
    'DMT (km)',
    'Cálculo da DMT',
    `Momento (${un}·km)`,
    'NF/ticket'
  ].forEach((h, i) => (hr.getCell(i + 1).value = h))
  estilizarHeaderRow(hr, 9)
  for (const v of q.relacao) {
    const row = ws.getRow(r++)
    row.getCell(1).value = v.data
    row.getCell(2).value = v.veiculo
    row.getCell(3).value = v.motorista
    row.getCell(4).value = v.equipe
    row.getCell(5).value = v.origem
    row.getCell(6).value = v.estacaCarga
    row.getCell(7).value = v.destino
    row.getCell(8).value = v.estacaDescarga
    row.getCell(9).value = v.volume
    row.getCell(9).numFmt = NUM
    row.getCell(10).value = v.dmtKm
    row.getCell(10).numFmt = '#,##0.000'
    row.getCell(11).value = v.dmtCalculo
    row.getCell(12).value = v.momento
    row.getCell(12).numFmt = NUM
    row.getCell(13).value = v.nfTicket
  }
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

export async function gerarMedicaoXlsx(payload: MedicaoExportPayload): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'InfraWork'
  wb.created = new Date()

  abaMedicao(wb, payload)

  const usados = new Set<string>(['medição', 'fotos'])
  for (const m of payload.memorias) abaMemoria(wb, payload, m, usados)

  abaFotos(wb, payload)

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: XLSX_MIME })
}
