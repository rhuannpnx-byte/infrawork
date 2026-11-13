/** Conversões dos campos dos diálogos do cronograma. */
import { parseNumero } from '@/lib/format/number'

/** "AAAA-MM-DDTHH:MM:SS" (banco) ↔ "AAAA-MM-DDTHH:MM" (datetime-local). */
export const paraInputDataHora = (v: string | null | undefined): string => (v ? v.slice(0, 16) : '')
export const doInputDataHora = (v: string): string | null =>
  v ? (v.length === 16 ? `${v}:00` : v) : null

/** Número digitado nos diálogos do cronograma. É o leitor único de números: `parseNumero`. */
export const lerNumero = parseNumero
