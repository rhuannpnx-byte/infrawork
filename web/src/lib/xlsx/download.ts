import ExcelJS from 'exceljs'

export { downloadBlob } from '@/lib/files/download'

/**
 * Remove notas/comentários do .xlsx. O Excel atual grava o vínculo planilha →
 * comentários com caminho absoluto ("/xl/comments/comment1.xml") e o ExcelJS
 * 4.4 quebra ao ler ("Cannot read properties of undefined (reading
 * 'comments')"). A importação não usa comentários, então só tiramos os vínculos.
 */
async function semComentarios(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(buf)
  const rels = Object.keys(zip.files).filter((p) => /^xl\/worksheets\/_rels\/[^/]+\.rels$/i.test(p))
  for (const p of rels) {
    const xml = await zip.file(p)!.async('string')
    const limpo = xml.replace(
      /<Relationship\b[^>]*Type="[^"]*\/(?:comments|threadedComment)"[^>]*\/>/gi,
      ''
    )
    if (limpo !== xml) zip.file(p, limpo)
  }
  return zip.generateAsync({ type: 'arraybuffer' })
}

/** Carrega um .xlsx (ArrayBuffer); se o ExcelJS falhar, tenta sem os comentários. */
export async function loadWorkbook(buf: ArrayBuffer): Promise<ExcelJS.Workbook> {
  try {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    return wb
  } catch (e) {
    let limpo: ArrayBuffer
    try {
      limpo = await semComentarios(buf)
    } catch {
      throw e
    }
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(limpo)
    return wb
  }
}

/** Carrega um arquivo .xlsx escolhido pelo usuário. */
export async function loadWorkbookFromFile(file: File): Promise<ExcelJS.Workbook> {
  return loadWorkbook(await file.arrayBuffer())
}
