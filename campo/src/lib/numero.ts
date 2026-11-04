/** Números digitados no padrão brasileiro (1.234,56). */

/**
 * "1234,56" / "1.234,56" / "1234.56" → "1.234,56". Tolerante a entrada com
 * pontos e vírgulas misturados (operador colando texto). Mantém apenas a
 * PRIMEIRA vírgula como decimal; o resto vira separador de milhar.
 */
export function formatNumberBR(raw: string): string {
  // Substitui pontos por nada (assume que vieram como milhar) e tudo não
  // dígito-ou-vírgula vira nada.
  let s = raw.replace(/\./g, '').replace(/[^\d,]/g, '')
  const firstComma = s.indexOf(',')
  if (firstComma !== -1) {
    // Mantém só a primeira vírgula (decimal); descarta demais.
    s = s.slice(0, firstComma + 1) + s.slice(firstComma + 1).replace(/,/g, '')
  }
  const [intPart = '', decPart] = s.split(',')
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  if (decPart === undefined) return intFormatted
  // Limita a 4 casas decimais visíveis
  return `${intFormatted},${decPart.slice(0, 4)}`
}

/** "1.234,56" → "1234.56" (formato canônico pra parseNum). */
export function parseNumberBR(display: string): string {
  return display.replace(/\./g, '').replace(',', '.')
}

export function parseNum(s: string): number | null {
  if (s.trim() === '') return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
