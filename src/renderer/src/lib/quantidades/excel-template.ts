// Gera Excel formatado pra captura de quantidades por trecho.
//
// Layout (padrão Campo/Conteúdo, cada par em células separadas):
//
//   Row 1:  TITLE (merged A1:totalCols)               — bold, dark bg, white text
//   Rows 2-5:
//     A2:C5 LOGO (merged 4×3, ícone quadrado centralizado)
//     D2 "Empresa"      E2 <valor>     F2 "Modo"         G2 <valor>
//     D3 "Obra"         E3 <valor>     F3 "Comprimento"  G3 <valor>
//     D4 "Trecho"       E4 <valor>     F4 "Unidade base" G4 <valor>
//     D5 "Versão"       E5 <valor>     F5 "Gerado em"    G5 <valor>
//   Row 6:  D6 "Comentário"  E6:G6 <valor> (apenas se comentário existir)
//   Row 7:  blank separator
//   Row 8:  header da tabela de dados — bold, fill cor do trecho
//   Row 9+: data
//
// Cada Campo: bg cinza-claro + texto pequeno UPPERCASE em negrito.
// Cada Conteúdo: texto normal, fundo branco.
//
// Header magic: "Início (m)", "Fim (m)", "Unid Inicial", "Unid Final" — esses
// 4 nomes são reconhecidos pelo parser de import.

import ExcelJS from 'exceljs'
import infraworkIcon from '@/assets/infrawork-icon.png'
import type { SegmentoAnalitico } from './grade'

export interface GerarTemplateExcelInput {
  empresaNome: string
  obraCodigo: string
  obraNome: string
  trechoNome: string
  trechoCor: string
  template: { nome: string; modo: 'analitico' | 'simplificado' }
  versao: { numero: number; is_atual: boolean; comentario: string | null }
  unidadeBaseLabel: string
  comprimentoM: number
  colunas: Array<{ id: string; nome: string; unidade: string }>
  grade: SegmentoAnalitico[]
  valoresExistentes: Map<number, Map<string, number>>
}

const COLS_LOGO = 3       // A, B, C  — área da logo quadrada
const COLS_HEADER = 4     // D, E, F, G — 2 pares Campo/Conteúdo
const HEADER_FIXED_COLS = COLS_LOGO + COLS_HEADER  // 7

export async function gerarTemplateExcel(input: GerarTemplateExcelInput): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'InfraWork'
  wb.created = new Date()

  const dataCols = 4 + input.colunas.length  // Início, Fim, UnidIni, UnidFim + user cols
  const totalCols = Math.max(dataCols, HEADER_FIXED_COLS)
  const temComentario = !!input.versao.comentario && input.versao.comentario.trim().length > 0

  // Linha onde começam os headers da tabela de dados (varia se há comentário).
  const headerDataRow = temComentario ? 8 : 7
  const dataStartRow = headerDataRow + 1

  const ws = wb.addWorksheet('Quantidades', {
    views: [{ state: 'frozen', ySplit: headerDataRow }]
  })

  // Carrega logo
  let logoId: number | null = null
  try {
    const res = await fetch(infraworkIcon)
    const buf = await res.arrayBuffer()
    logoId = wb.addImage({ buffer: buf, extension: 'png' })
  } catch {
    // Sem logo se fetch falhar (não bloqueia geração)
  }

  // ─── Colunas: largura ────────────────────────────────────────────────
  // Logo: A,B,C
  for (let c = 1; c <= COLS_LOGO; c++) ws.getColumn(c).width = 10
  // Cabeçalho info: D (Campo) + E (Conteúdo) + F (Campo) + G (Conteúdo)
  ws.getColumn(4).width = 14
  ws.getColumn(5).width = 26
  ws.getColumn(6).width = 16
  ws.getColumn(7).width = 22
  // Data cols (Início (m), Fim (m), Unid Inicial, Unid Final, user cols)
  // Renderizadas a partir da col 1 (A) na row do header de data, então as
  // larguras das cols A-D ja foram setadas acima (mas como logo cols).
  // Conflito: o header de dados precisa de larguras adequadas. Solução:
  // aumentar as larguras das cols A-D de modo a servir tanto pro Logo
  // quanto pros dados.
  ws.getColumn(1).width = 13  // Início (m)
  ws.getColumn(2).width = 13  // Fim (m)
  ws.getColumn(3).width = 14  // Unid Inicial
  ws.getColumn(4).width = 14  // Unid Final (era D Campo no header info)
  // E em diante são user cols
  for (let i = 0; i < input.colunas.length; i++) {
    const colIdx = 5 + i
    ws.getColumn(colIdx).width = Math.max(16, input.colunas[i].nome.length + 6)
  }

  // ─── Row 1: TITLE ────────────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, totalCols)
  const titulo = ws.getCell(1, 1)
  titulo.value = `Template de Quantidades — ${input.template.nome}`
  titulo.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
  titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
  titulo.alignment = { vertical: 'middle', horizontal: 'center' }
  ws.getRow(1).height = 32

  // ─── Rows 2-5: Header info + Logo ────────────────────────────────────
  // Heights pra dar espaço pro logo quadrado
  for (let r = 2; r <= 5; r++) ws.getRow(r).height = 26

  // Logo merged A2:C5 (área quadrada)
  ws.mergeCells(2, 1, 5, COLS_LOGO)
  const logoCell = ws.getCell(2, 1)
  logoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
  logoCell.alignment = { vertical: 'middle', horizontal: 'center' }
  logoCell.border = {
    top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
  }
  if (logoId != null) {
    // Centraliza a logo quadrada na área A2:C5. Tamanho fixo 92×92 px,
    // ofsetada com fração das cells pra centralizar.
    ws.addImage(logoId, {
      tl: { col: 0.55, row: 1.35 } as ExcelJS.Anchor,
      ext: { width: 92, height: 92 }
    })
  }

  // 4 pares Campo/Conteúdo (cols D, E, F, G — índices 4, 5, 6, 7)
  // Importante: as cols 5 (E) e 7 (G) também são usadas pelas user data cols
  // mais abaixo. ExcelJS aplica styling por célula (não por coluna inteira),
  // então não há conflito — só compartilham a mesma largura, o que já tratamos.
  const pairs: Array<[string, string, string, string]> = [
    [
      'Empresa',
      input.empresaNome || '—',
      'Modo',
      input.template.modo === 'analitico' ? 'Analítico' : 'Simplificado'
    ],
    [
      'Obra',
      input.obraCodigo && input.obraNome
        ? `${input.obraCodigo} · ${input.obraNome}`
        : input.obraNome || input.obraCodigo || '—',
      'Comprimento',
      `${(input.comprimentoM / 1000).toFixed(2)} km`
    ],
    ['Trecho', input.trechoNome, 'Unidade base', input.unidadeBaseLabel],
    [
      'Versão',
      `v${input.versao.numero}${input.versao.is_atual ? ' ★ atual' : ' (histórica)'}`,
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
  for (let i = 0; i < pairs.length; i++) {
    const r = 2 + i
    aplicarCampo(ws.getCell(r, 4), pairs[i][0])
    aplicarConteudo(ws.getCell(r, 5), pairs[i][1])
    aplicarCampo(ws.getCell(r, 6), pairs[i][2])
    aplicarConteudo(ws.getCell(r, 7), pairs[i][3])
  }

  // ─── Row 6: Comentário (se houver) ───────────────────────────────────
  if (temComentario) {
    ws.getRow(6).height = 24
    // Logo área se estendeu até row 5, então comentário começa em D6
    aplicarCampo(ws.getCell(6, 4), 'Comentário')
    // Conteúdo merged E6:G6 — pra acomodar texto longo
    ws.mergeCells(6, 5, 6, 7)
    aplicarConteudo(ws.getCell(6, 5), input.versao.comentario!.trim(), { italic: true })
    // Preenche A6:C6 vazios com fundo neutro pra não destoar
    for (let c = 1; c <= COLS_LOGO; c++) {
      ws.getCell(6, c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFFFF' }
      }
    }
  }

  // ─── Row separadora ──────────────────────────────────────────────────
  ws.getRow(headerDataRow - 1).height = 8

  // ─── Header da tabela de dados ───────────────────────────────────────
  const headerLabels = [
    'Início (m)',
    'Fim (m)',
    'Unid Inicial',
    'Unid Final',
    ...input.colunas.map((c) => `${c.nome} (${c.unidade})`)
  ]
  const headerRow = ws.getRow(headerDataRow)
  headerRow.values = headerLabels
  headerRow.height = 30
  for (let c = 1; c <= dataCols; c++) {
    const cell = headerRow.getCell(c)
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: hexToArgb(input.trechoCor) }
    }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFFFFFFF' } },
      bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } },
      left: { style: 'thin', color: { argb: 'FFFFFFFF' } },
      right: { style: 'thin', color: { argb: 'FFFFFFFF' } }
    }
  }

  // ─── Data rows ───────────────────────────────────────────────────────
  if (input.template.modo === 'analitico') {
    for (let i = 0; i < input.grade.length; i++) {
      const seg = input.grade[i]
      const row = ws.getRow(dataStartRow + i)
      const valoresSeg = input.valoresExistentes.get(seg.ordem)
      row.values = [
        seg.posicao_inicio_m,
        seg.posicao_fim_m,
        seg.unidade_inicio_label,
        seg.unidade_fim_label,
        ...input.colunas.map((c) => valoresSeg?.get(c.id) ?? null)
      ]
      applyDataRowStyle(row, i, input.colunas.length)
    }
  } else {
    const temValores = input.valoresExistentes.size > 0
    if (temValores) {
      for (let i = 0; i < input.grade.length; i++) {
        const seg = input.grade[i]
        const row = ws.getRow(dataStartRow + i)
        const valoresSeg = input.valoresExistentes.get(seg.ordem)
        row.values = [
          seg.posicao_inicio_m,
          seg.posicao_fim_m,
          seg.unidade_inicio_label,
          seg.unidade_fim_label,
          ...input.colunas.map((c) => valoresSeg?.get(c.id) ?? null)
        ]
        applyDataRowStyle(row, i, input.colunas.length)
      }
    } else {
      for (let i = 0; i < 20; i++) {
        const row = ws.getRow(dataStartRow + i)
        row.values = [null, null, null, null, ...input.colunas.map(() => null)]
        applyDataRowStyle(row, i, input.colunas.length)
      }
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
}

// ─── Helpers ────────────────────────────────────────────────────────────

function aplicarCampo(cell: ExcelJS.Cell, label: string): void {
  cell.value = label.toUpperCase()
  cell.font = { bold: true, size: 9, color: { argb: 'FF6B7280' }, name: 'Calibri' }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
  }
}

function aplicarConteudo(
  cell: ExcelJS.Cell,
  value: string,
  opts?: { italic?: boolean }
): void {
  cell.value = value
  cell.font = {
    size: 10,
    color: { argb: 'FF111827' },
    name: 'Calibri',
    italic: opts?.italic ?? false
  }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
  }
}

function applyDataRowStyle(row: ExcelJS.Row, idx: number, userColsCount: number): void {
  const zebra = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF9FAFB'
  const totalCols = 4 + userColsCount
  for (let c = 1; c <= totalCols; c++) {
    const cell = row.getCell(c)
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } }
    cell.font = { size: 10, name: 'Calibri' }
    cell.border = {
      top: { style: 'hair', color: { argb: 'FFE5E7EB' } },
      bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } },
      left: { style: 'hair', color: { argb: 'FFE5E7EB' } },
      right: { style: 'hair', color: { argb: 'FFE5E7EB' } }
    }
    if (c === 1 || c === 2) {
      cell.numFmt = '#,##0.00'
      cell.alignment = { horizontal: 'right' }
    } else if (c === 3 || c === 4) {
      cell.alignment = { horizontal: 'center' }
    } else {
      cell.numFmt = '#,##0.000'
      cell.alignment = { horizontal: 'right' }
    }
  }
  row.height = 18
}

function hexToArgb(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  return m ? `FF${m[1].toUpperCase()}` : 'FF3B82F6'
}
