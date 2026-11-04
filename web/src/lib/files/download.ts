/**
 * Download de arquivos gerados no browser (substitui o save-dialog do Electron).
 */

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Remove caracteres inválidos em nomes de arquivo (Windows/macOS/Linux). */
export function sanitizeFilename(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/** `Base YYYY-MM-DD HH-MM-SS.ext` — mesmo padrão do app desktop. */
export function nomeComStamp(base: string, ext: string): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  return `${sanitizeFilename(base)} ${stamp}.${ext.replace(/^\./, '')}`
}
