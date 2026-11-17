/** Conversão entre UTM (SIRGAS 2000 / WGS 84) e latitude e longitude, em graus. */

const A = 6378137
const F = 1 / 298.257222101
const K0 = 0.9996
const E2 = F * (2 - F)
const EP2 = E2 / (1 - E2)
const RAD = Math.PI / 180

export interface Fuso {
  zona: number
  sul: boolean
}

/** Lê "22S", "22 S", "23K" (faixa de latitude) ou "22": no Brasil, sem letra, vale o hemisfério sul. */
export function lerFuso(texto: string | null | undefined): Fuso | null {
  const m = /^\s*(\d{1,2})\s*([A-Za-z])?\s*$/.exec(texto ?? '')
  if (!m) return null
  const zona = Number(m[1])
  if (zona < 1 || zona > 60) return null
  const letra = (m[2] ?? 'S').toUpperCase()
  // "S" e "N" são hemisférios; as demais são faixas de latitude (C a M no sul, N a X no norte)
  return { zona, sul: letra === 'S' || (letra !== 'N' && letra < 'N') }
}

const meridiano = (f: Fuso): number => (f.zona * 6 - 183) * RAD

export function utmParaGeo(e: number, n: number, f: Fuso): [lon: number, lat: number] {
  const x = e - 500000
  const y = f.sul ? n - 10000000 : n
  const m = y / K0
  const mu = m / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256))
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2))
  const p1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu)
  const sen = Math.sin(p1)
  const cos = Math.cos(p1)
  const tan = sen / cos
  const c1 = EP2 * cos * cos
  const t1 = tan * tan
  const n1 = A / Math.sqrt(1 - E2 * sen * sen)
  const r1 = (A * (1 - E2)) / (1 - E2 * sen * sen) ** 1.5
  const d = x / (n1 * K0)
  const lat =
    p1 -
    ((n1 * tan) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6) / 720)
  const lon =
    meridiano(f) +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5) / 120) /
      cos
  return [lon / RAD, lat / RAD]
}

export function geoParaUtm(lon: number, lat: number, f: Fuso): [e: number, n: number] {
  const p = lat * RAD
  const sen = Math.sin(p)
  const cos = Math.cos(p)
  const tan = sen / cos
  const n1 = A / Math.sqrt(1 - E2 * sen * sen)
  const t = tan * tan
  const c = EP2 * cos * cos
  const a = cos * (lon * RAD - meridiano(f))
  const m =
    A *
    ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * p -
      ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * p) +
      ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * p) -
      ((35 * E2 ** 3) / 3072) * Math.sin(6 * p))
  const e =
    500000 +
    K0 *
      n1 *
      (a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120)
  const n =
    K0 *
    (m +
      n1 *
        tan *
        (a ** 2 / 2 +
          ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24 +
          ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720))
  return [e, f.sul ? n + 10000000 : n]
}
