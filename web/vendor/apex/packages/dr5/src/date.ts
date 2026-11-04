/**
 * DDL::Date (RD-022, RN-022). Evidência: docs/lacunas_menores.md §1; fn:DDL_Date_Set@008ec410.
 * __int64 m_nAS = segundos desde 1970-01-01 00:00, sem fuso. −1 = "sem data".
 * Aritmética em bigint com divisão truncada, como o C++ (int64).
 */
export const NO_DATE = -1n;

/** Dia Juliano por Fliegel–Van Flandern (DDL::anon::ToJulian @0x8ec810). */
export function toJulian(y: number, m: number, d: number): bigint {
  const Y = BigInt(y), M = BigInt(m), D = BigInt(d);
  const a = (M - 14n) / 12n; // truncado, como em C
  return (1461n * (Y + 4800n + a)) / 4n + (367n * (M - 2n - 12n * a)) / 12n - (3n * ((Y + 4900n + a) / 100n)) / 4n + D - 32075n;
}

/** DDL::Date::Set(y,m,d,h,min,s): (JD − 2440588) × 86400 + h×3600 + min×60 + s. */
export function ddlDateFromParts(y: number, m: number, d: number, h = 0, min = 0, s = 0): bigint {
  return (toJulian(y, m, d) - 2440588n) * 86400n + BigInt(h) * 3600n + BigInt(min) * 60n + BigInt(s);
}

/** DDL::Date::GetWeekDay = (m_nAS / 86400 + 3) % 7, com DDL::WeekDay MON = 0 … SUN = 6. */
export function ddlWeekDay(as: bigint): number {
  return Number((as / 86400n + 3n) % 7n);
}

/** DDL::Date::GetHour = (m_nAS / 3600) % 24, sem ajuste de fuso. */
export function ddlHour(as: bigint): number {
  return Number((as / 3600n) % 24n);
}

/** Faixa exibível como "AAAA-MM-DD HH:MM": 0001-01-01 00:00:00 … 9999-12-31 23:59:59. */
export const DDL_DATE_MIN = -62135596800n;
export const DDL_DATE_MAX = 253402300799n;

/** Se m_nAS cabe em "AAAA-MM-DD HH:MM" (anos 1…9999). O i64 do arquivo pode ser qualquer valor. */
export function ddlDateInRange(as: bigint): boolean {
  return as >= DDL_DATE_MIN && as <= DDL_DATE_MAX;
}

/** "AAAA-MM-DD HH:MM" sem fuso, ou null para −1. Lança RangeError fora de ddlDateInRange. */
export function ddlDateToString(as: bigint): string | null {
  if (as === NO_DATE) return null;
  if (!ddlDateInRange(as)) throw new RangeError(`data fora do alcance: ${as}`);
  const d = new Date(Number(as) * 1000);
  const y = d.getUTCFullYear(); // toISOString usa "+YYYYYY"/"-YYYYYY" fora de 0000…9999
  return String(y).padStart(4, "0") + d.toISOString().slice(4, 16).replace("T", " ");
}
