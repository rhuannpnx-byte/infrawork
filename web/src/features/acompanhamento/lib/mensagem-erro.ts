/**
 * Texto do erro de uma gravação. O banco devolve um objeto `{ message, code }` que não é `Error`: sem isto, o
 * motivo da recusa (regra de um gatilho, por exemplo) não chega à tela.
 */
export function mensagemErro(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message: unknown }).message
    if (typeof m === 'string') return m
  }
  return ''
}

/** O motivo pronto para emendar numa frase: " motivo" ou vazio. */
export function motivoDoErro(e: unknown): string {
  const m = mensagemErro(e).trim()
  return m ? ` ${m}` : ''
}
