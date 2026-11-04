import { v7 as uuidv7Lib } from 'uuid'

/**
 * UUID v7 client-side — prefixo timestamp, ordenável, idempotência grátis com `ON CONFLICT (id)`.
 * Mesmo padrão do app Android (core/util/UuidV7.kt).
 */
export function uuidv7(): string {
  return uuidv7Lib()
}
