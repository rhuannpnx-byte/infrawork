// Projeção de um ponto (foto) sobre os trechos importados (KMZ). Dado um lat/lng,
// acha o trecho cuja polilinha está mais próxima e a posição ao longo dela, em
// METROS INTERNOS (origem = início da geometria), que é o que posicao.ts espera
// pra converter em marcador real (km/estaca/custom).

import nearestPointOnLine from '@turf/nearest-point-on-line'
import along from '@turf/along'
import type { ObraTrecho } from '@/types/gerencial'
import {
  formatMarcador,
  divisorMetrosPorUnidade,
  metrosToMarcador,
  marcadorToMetros,
  type TrechoCtx
} from '@/lib/format/posicao'

export interface ProjecaoTrecho {
  trecho: ObraTrecho
  /** Distância ao longo da polilinha do início (metros internos). */
  metrosInternos: number
  /** Distância perpendicular do ponto à linha (metros) — usada pra escolher o trecho. */
  distAoTrechoM: number
}

/** ObraTrecho satisfaz TrechoCtx (mesmos campos de unidade/sentido/limites). */
export function trechoCtx(t: ObraTrecho): TrechoCtx {
  return {
    unidade_espaco_padrao: t.unidade_espaco_padrao,
    unidade_custom_label: t.unidade_custom_label,
    unidade_custom_divisor_m: t.unidade_custom_divisor_m,
    marcador_valor_inicial: t.marcador_valor_inicial,
    geometry_sentido: t.geometry_sentido,
    geometry_comprimento_m: t.geometry_comprimento_m
  }
}

/** Rótulo curto da unidade adotada no trecho. */
export function unidadeLabel(t: ObraTrecho): string {
  switch (t.unidade_espaco_padrao) {
    case 'km': return 'km'
    case 'm': return 'm'
    case 'estaca': return 'est'
    case 'custom': return t.unidade_custom_label?.trim() || 'un'
  }
}

/**
 * Projeta (lng, lat) sobre o trecho mais próximo (menor distância perpendicular).
 * Ignora trechos sem geometria. Retorna null se nenhum trecho tem linha válida.
 */
export function projetarPontoNoTrecho(
  lng: number,
  lat: number,
  trechos: ObraTrecho[]
): ProjecaoTrecho | null {
  let best: ProjecaoTrecho | null = null
  for (const t of trechos) {
    const geom = t.geometry_geojson
    if (!geom || !Array.isArray(geom.coordinates) || geom.coordinates.length < 2) continue
    const snapped = nearestPointOnLine(
      geom,
      { type: 'Point', coordinates: [lng, lat] },
      { units: 'meters' }
    )
    const distAoTrechoM = Number(snapped.properties.dist ?? Infinity)
    const metrosInternos = Number(snapped.properties.location ?? 0)
    if (!best || distAoTrechoM < best.distAoTrechoM) {
      best = { trecho: t, metrosInternos, distAoTrechoM }
    }
  }
  return best
}

/** Marcador real (km/estaca) formatado de uma projeção. */
export function marcadorFormatado(proj: ProjecaoTrecho): string {
  return formatMarcador(proj.metrosInternos, trechoCtx(proj.trecho))
}

/**
 * Distância entre duas projeções, formatada na unidade adotada.
 * - Mesmo trecho: diferença ao longo da linha (|m2 − m1|) ÷ divisor da unidade.
 * - Trechos diferentes: cai pra distância geodésica reta (em metros).
 */
export function distanciaFormatada(
  a: ProjecaoTrecho,
  b: ProjecaoTrecho,
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number
): string {
  if (a.trecho.id === b.trecho.id) {
    const divisor = divisorMetrosPorUnidade(trechoCtx(a.trecho))
    const unidades = Math.abs(b.metrosInternos - a.metrosInternos) / divisor
    return `${fmtNum(unidades)} ${unidadeLabel(a.trecho)}`
  }
  const metros = haversineM(aLat, aLng, bLat, bLng)
  return `${fmtNum(metros)} m (reta)`
}

function fmtNum(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

// ─── Marcadores de controle (km/estaca) ao longo do trecho ────────────────

export interface MarcadorControle {
  lat: number
  lng: number
  label: string
  /** Posição em metros internos (origem = início da geometria). */
  posicaoM: number
}

function labelMarcador(v: number, t: ObraTrecho): string {
  const n = Number.isInteger(v) ? String(v) : v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  switch (t.unidade_espaco_padrao) {
    case 'km': return `km ${n}`
    case 'estaca': return `E${n}`
    case 'm': return `${n}m`
    case 'custom': return `${n} ${t.unidade_custom_label?.trim() || ''}`.trim()
  }
}

/**
 * Gera marcadores em valores REDONDOS da unidade do trecho (km inteiros,
 * estacas, etc.) ao longo da geometria. Respeita sentido + valor inicial.
 * Limita a densidade total (~1500) ampliando o passo em trechos longos — a
 * decimação fina por zoom é feita no render.
 */
export function gerarMarcadoresControle(t: ObraTrecho): MarcadorControle[] {
  const geom = t.geometry_geojson
  if (!geom || !Array.isArray(geom.coordinates) || geom.coordinates.length < 2) return []
  const comprimento = Number(t.geometry_comprimento_m ?? 0)
  if (comprimento <= 0) return []

  const ctx = trechoCtx(t)
  const divisor = divisorMetrosPorUnidade(ctx)
  // Passo em unidades de marcador: 'm' usa 100m; demais usam 1 unidade.
  let passo = t.unidade_espaco_padrao === 'm' ? 100 / divisor : 1

  const mIni = metrosToMarcador(0, ctx)
  const mFim = metrosToMarcador(comprimento, ctx)
  const lo = Math.min(mIni, mFim)
  const hi = Math.max(mIni, mFim)

  // Limita densidade total.
  const previstos = (hi - lo) / passo
  if (previstos > 1500) passo *= Math.ceil(previstos / 1500)

  const out: MarcadorControle[] = []
  const start = Math.ceil(lo / passo) * passo
  for (let v = start; v <= hi + 1e-6; v += passo) {
    const interno = marcadorToMetros(v, ctx)
    if (interno < 0.5 || interno > comprimento - 0.5) continue
    const pt = along(geom, interno, { units: 'meters' })
    out.push({
      lat: pt.geometry.coordinates[1],
      lng: pt.geometry.coordinates[0],
      label: labelMarcador(v, t),
      posicaoM: interno
    })
  }
  return out
}

/**
 * Decima marcadores conforme o zoom para manter o espaçamento visual mínimo
 * (~60px), evitando empilhamento de tooltips. Espelha a lógica de MapaTrecho.
 */
export function decimarPorZoom(
  todos: MarcadorControle[],
  zoom: number,
  centerLat: number
): MarcadorControle[] {
  if (todos.length <= 2) return todos
  const passoMetros = todos[1].posicaoM - todos[0].posicaoM
  if (passoMetros <= 0) return todos
  const metrosPorPixel = (156543.03 * Math.cos((centerLat * Math.PI) / 180)) / Math.pow(2, zoom)
  const passoPixels = passoMetros / metrosPorPixel
  if (passoPixels >= 60) return todos
  const step = Math.max(1, Math.ceil(60 / passoPixels))
  const out: MarcadorControle[] = []
  for (let i = 0; i < todos.length; i += step) out.push(todos[i])
  return out
}

/** Distância geodésica simples (metros). */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const toRad = (d: number): number => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}
