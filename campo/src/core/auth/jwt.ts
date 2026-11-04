/**
 * Decode local do JWT (header.payload.signature). Não valida assinatura — só lê o
 * payload pra extrair `exp` (em segundos epoch) e calcular o `expiresAtEpochMs`
 * que a SessionStore guarda.
 *
 * O backend não devolve `expiresAt` separado; o JWT é a única fonte da verdade.
 * Se o decode falhar (token malformado ou claim sem `exp`), caímos para 12h default,
 * que é o `JWT_EXPIRES_IN` configurado no backend.
 */

const FALLBACK_TTL_MS = 12 * 60 * 60 * 1000

export function extractExpiresAtMs(token: string): number {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return Date.now() + FALLBACK_TTL_MS
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { exp?: number }
    if (typeof payload.exp === 'number') return payload.exp * 1000
  } catch {
    /* ignore */
  }
  return Date.now() + FALLBACK_TTL_MS
}

function base64UrlDecode(s: string): string {
  // base64url → base64 padrão
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  // atob → string binária; converter para UTF-8
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}
