/**
 * Erros da camada de API (Supabase). Mantém o contrato do Monito para as telas e o outbox:
 *  - status 0  → offline/tempo esgotado (o outbox guarda e tenta de novo; não consome tentativa)
 *  - status 401 → sessão recusada pelo servidor (ReauthBanner pede novo login; dados locais ficam)
 *  - demais     → recusa do servidor com a mensagem do banco (vira "REJEITADA" com o motivo)
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
  get isUnauthorized() {
    return this.status === 401
  }
  get isOffline() {
    return this.status === 0
  }
}

/** Erro do PostgREST/Auth/Storage (ou de rede) → ApiError. */
export function paraApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e
  const o = (e ?? {}) as {
    message?: string
    code?: string
    status?: number
    name?: string
    details?: unknown
  }
  const msg = o.message ?? String(e)
  // fetch sem rede (TypeError "Failed to fetch"/"NetworkError"), abort por tempo, PostgREST sem resposta
  if (
    o.name === 'TypeError' ||
    o.name === 'AbortError' ||
    /failed to fetch|networkerror|network request failed|load failed|fetch failed|tempo esgotado/i.test(
      msg,
    )
  ) {
    return new ApiError(0, 'Sem conexão com o servidor')
  }
  if (
    o.code === 'PGRST301' ||
    o.status === 401 ||
    /jwt expired|invalid jwt|sessão expirada/i.test(msg)
  ) {
    return new ApiError(401, 'Sessão expirada. Entre de novo.', o.code)
  }
  return new ApiError(o.status ?? 400, msg, o.code, o.details)
}

/** Prazo para chamadas com sinal fraco: estourou, vira "offline" e a tela usa o que tem guardado. */
export async function comPrazo<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const prazo = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new ApiError(0, 'Tempo esgotado')), ms)
  })
  try {
    return await Promise.race([Promise.resolve(p), prazo])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
