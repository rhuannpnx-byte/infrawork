// Máscara/normalização de telefone WhatsApp no padrão brasileiro COM DDI.
// Armazenamos só dígitos (ex.: 5564999998888) e exibimos formatado
// (+55 (64) 99999-9999). O DDI 55 é assumido como prefixo.

/** Mantém só dígitos; limita a 13 (55 + DDD + 9 dígitos). String vazia → ''. */
export function onlyDigitsPhone(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace(/\D/g, '').slice(0, 13)
}

/**
 * Formata progressivamente um número de WhatsApp BR a partir de dígitos crus
 * (com ou sem máscara). Trata os 2 primeiros dígitos como DDI, os 2 seguintes
 * como DDD e o restante (8–9 dígitos) como o número.
 *   "5564999998888" → "+55 (64) 99999-8888"
 */
export function maskWhatsappBR(value: string | null | undefined): string {
  const d = onlyDigitsPhone(value)
  if (d.length === 0) return ''

  const cc = d.slice(0, 2)
  const ddd = d.slice(2, 4)
  const rest = d.slice(4)

  let out = `+${cc}`
  if (d.length >= 3) out += ` (${ddd}`
  if (d.length >= 5) out += ') '
  if (rest) {
    if (rest.length <= 4) out += rest
    else out += `${rest.slice(0, rest.length - 4)}-${rest.slice(rest.length - 4)}`
  }
  return out
}
