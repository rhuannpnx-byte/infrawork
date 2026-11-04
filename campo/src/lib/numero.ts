/** Números digitados no padrão brasileiro (1.234,56). */

/**
 * "1234,56" / "1.234,56" / "1234.56" → "1.234,56". Tolerante a entrada com
 * pontos e vírgulas misturados (operador colando texto). Mantém apenas a
 * PRIMEIRA vírgula como decimal; o resto vira separador de milhar.
 */
export function formatNumberBR(raw: string): string {
  // Teclado sem vírgula: um ponto seguido de menos de 3 dígitos é decimal ("2.5" → 2,5); grupos de milhar
  // sempre têm 3 dígitos ("1.234" continua mil duzentos e trinta e quatro).
  if (!raw.includes(',')) {
    const i = raw.lastIndexOf('.')
    if (i !== -1 && raw.length - i - 1 < 3) raw = `${raw.slice(0, i)},${raw.slice(i + 1)}`
  }
  // Os demais pontos são milhar; tudo que não é dígito ou vírgula sai.
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
