/**
 * Datas do motor do ApeX: DDL::Date = segundos desde 1970-01-01 00:00, sem fuso (a mesma escala de `Date.UTC`).
 * No banco elas ficam em `timestamp` sem fuso (horário local da obra) e chegam como "AAAA-MM-DDTHH:MM:SS".
 */
export const DIA = 86400

const RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(?:Z|[+-]00(?::?00)?)?$/

/** "AAAA-MM-DD", "AAAA-MM-DD HH:MM[:SS]" ou "AAAA-MM-DDTHH:MM:SS" → segundos. */
export function isoParaSeg(iso: string): number {
  const m = RE.exec(iso.trim())
  if (!m) throw new Error(`data inválida: "${iso}"`)
  return (
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] ?? 0),
      Number(m[5] ?? 0),
      Number(m[6] ?? 0)
    ) / 1000
  )
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** segundos → "AAAA-MM-DDTHH:MM:SS" (timestamp sem fuso) */
export function segParaTimestamp(s: number): string {
  const d = new Date(s * 1000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

/** segundos → "AAAA-MM-DD HH:MM:SS" (formato de data do documento apex-obra/1) */
export function segParaDoc(s: number): string {
  return segParaTimestamp(s).replace('T', ' ')
}

/** segundos → "AAAA-MM-DD" (o dia que contém o instante) */
export function segParaData(s: number): string {
  return segParaTimestamp(s).slice(0, 10)
}

/** início do dia (00:00) */
export function inicioDoDia(s: number): number {
  return Math.floor(s / DIA) * DIA
}

/** Segunda-feira (00:00) da semana que contém o instante. 1970-01-01 foi quinta-feira. */
export function segundaDaSemana(s: number): number {
  const dia = Math.floor(s / DIA)
  const dow = (((dia + 3) % 7) + 7) % 7 // 0 = segunda
  return (dia - dow) * DIA
}

/**
 * Dia do fim de um intervalo [início, fim): o instante final pertence ao dia anterior quando cai exatamente à
 * meia-noite (fim de expediente às 24:00).
 */
export function diaDoFim(inicio: number, fim: number): string {
  return segParaData(fim > inicio && fim % DIA === 0 ? fim - 1 : fim)
}
