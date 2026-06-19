// Exporta a matriz do Histograma planejado (recurso × semana) para .xlsx.
// Roda no RENDERER (como os demais geradores), embutindo o logo InfraWork.

import ExcelJS from 'exceljs'
import infraworkIcon from '@/assets/infrawork-icon.png'
import type { RecursoHistograma, UnidadeTempo } from './histograma-recursos'
import { RECURSO_GRUPO_LABEL, unidadeEfetiva } from './histograma-recursos'
import type { RecursoGrupo } from '@/types/orcamento'

export interface HistogramaXlsxInput {
  obraNome: string
  planoNome: string
  unidadeTempo: UnidadeTempo
  semanas: string[]
  recursos: RecursoHistograma[]
}

const NUM = '#,##0.##'
const AZUL = 'FF1E3A5F'

/** 'YYYY-MM-DD' → 'dd/mm'. */
function ddmm(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

async function logoBuffer(): Promise<ArrayBuffer | null> {
  try {
    const resp = await fetch(infraworkIcon)
    return await resp.arrayBuffer()
  } catch {
    return null
  }
}

export async function gerarHistogramaRecursosXlsx(input: HistogramaXlsxInput): Promise<Blob> {
  const { obraNome, planoNome, unidadeTempo, semanas, recursos } = input
  const metricaLabel =
    unidadeTempo === 'horas' ? 'homem-hora' : unidadeTempo === 'dias' ? 'homem-dia' : 'recursos ativos'
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Histograma', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 5 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  })

  const COL_FIXAS = 2 // Recurso, Unid.
  const totalCols = COL_FIXAS + semanas.length + 1 // + Total

  // Logo (âncora oneCell, não depende de merge).
  const buf = await logoBuffer()
  if (buf) {
    const imgId = wb.addImage({ buffer: buf, extension: 'png' })
    ws.addImage(imgId, {
      tl: { col: 0.1, row: 0.1 },
      ext: { width: 130, height: 46 }
    })
  }

  const lastColLetter = ws.getColumn(totalCols).letter

  // Cabeçalho textual (linhas 1–3), deixando a coluna A p/ o logo.
  ws.mergeCells(`D1:${lastColLetter}1`)
  ws.getCell('D1').value = 'Histograma Planejado de Recursos'
  ws.getCell('D1').font = { bold: true, size: 14, color: { argb: AZUL } }

  ws.mergeCells(`D2:${lastColLetter}2`)
  ws.getCell('D2').value = obraNome
  ws.getCell('D2').font = { size: 11, color: { argb: 'FF444444' } }

  ws.mergeCells(`D3:${lastColLetter}3`)
  ws.getCell('D3').value = `Planejamento: ${planoNome}  ·  MO/Equip. em ${metricaLabel}`
  ws.getCell('D3').font = { italic: true, size: 10, color: { argb: 'FF666666' } }

  ws.getRow(1).height = 18
  ws.getRow(4).height = 6

  // Cabeçalho de colunas (linha 5).
  const HEAD = 5
  const headers = ['Recurso', 'Unid.', ...semanas.map(ddmm), 'Total/Pico']
  const headRow = ws.getRow(HEAD)
  headers.forEach((h, i) => {
    const c = headRow.getCell(i + 1)
    c.value = h
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
    c.alignment = { horizontal: i < COL_FIXAS ? 'left' : 'center', vertical: 'middle' }
    c.border = { bottom: { style: 'thin', color: { argb: 'FFBBBBBB' } } }
  })
  headRow.height = 16

  // Larguras.
  ws.getColumn(1).width = 34
  ws.getColumn(2).width = 8
  for (let i = 0; i < semanas.length; i++) ws.getColumn(COL_FIXAS + 1 + i).width = 9
  ws.getColumn(totalCols).width = 12

  // Linhas agrupadas por grupo.
  let r = HEAD + 1
  const grupos = Array.from(new Set(recursos.map((x) => x.grupo))) as RecursoGrupo[]
  for (const g of grupos) {
    const doGrupo = recursos.filter((x) => x.grupo === g)
    if (doGrupo.length === 0) continue

    // Cabeçalho do grupo.
    ws.mergeCells(`A${r}:${lastColLetter}${r}`)
    const gc = ws.getCell(`A${r}`)
    gc.value = RECURSO_GRUPO_LABEL[g] ?? g
    gc.font = { bold: true, size: 10, color: { argb: AZUL } }
    gc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF2F8' } }
    r++

    for (const rec of doGrupo) {
      const row = ws.getRow(r)
      row.getCell(1).value = rec.nome
      row.getCell(2).value = unidadeEfetiva(rec, unidadeTempo)
      row.getCell(1).font = { size: 9 }
      row.getCell(2).font = { size: 9, color: { argb: 'FF888888' } }
      semanas.forEach((s, i) => {
        const cell = row.getCell(COL_FIXAS + 1 + i)
        const v = rec.porSemana[s] ?? 0
        if (v > 0) {
          cell.value = v
          cell.numFmt = NUM
        }
        cell.alignment = { horizontal: 'center' }
        cell.font = { size: 9 }
      })
      const totalCell = row.getCell(totalCols)
      const usaPico =
        unidadeTempo === 'recursos' && (rec.grupo === 'MO' || rec.grupo === 'MVE')
      totalCell.value = usaPico ? rec.pico : rec.total
      totalCell.numFmt = NUM
      totalCell.font = { size: 9, bold: true }
      totalCell.alignment = { horizontal: 'center' }
      r++
    }
  }

  const out = await wb.xlsx.writeBuffer()
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
}
