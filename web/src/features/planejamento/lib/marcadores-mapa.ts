// Marcadores de posição (km, estaca, unidade própria) ao longo da linha do trecho, como definidos na
// importação do KML/KMZ. Usado pelo mapa do eixo (Planejamento) e pelos mapas de Acompanhamento.

import {
  divisorMetrosPorUnidade,
  formatMarcadorCompacto,
  type TrechoCtx
} from '@/lib/format/posicao'
import type { ObraTrecho } from '@/types/gerencial'

export interface MarcadorTrecho {
  /** Posição em metros ao longo da linha, a partir do primeiro ponto. */
  posicaoM: number
  /** Ex.: "km 5", "EST 12". */
  label: string
}

export function contextoDoTrecho(t: ObraTrecho): TrechoCtx {
  return {
    unidade_espaco_padrao: t.unidade_espaco_padrao,
    unidade_custom_label: t.unidade_custom_label,
    unidade_custom_divisor_m: t.unidade_custom_divisor_m,
    marcador_valor_inicial: t.marcador_valor_inicial,
    geometry_sentido: t.geometry_sentido,
    geometry_comprimento_m: t.geometry_comprimento_m
  }
}

/** Um marcador a cada unidade (1 km, 1 estaca…), do início ao fim da linha; o sentido decide a numeração. */
export function marcadoresDoTrecho(t: ObraTrecho): MarcadorTrecho[] {
  if (!t.geometry_geojson || !t.geometry_comprimento_m) return []
  const ctx = contextoDoTrecho(t)
  const passo = divisorMetrosPorUnidade(ctx)
  const comprimento = Number(t.geometry_comprimento_m)
  if (!(passo > 0) || !(comprimento > 0)) return []
  const out: MarcadorTrecho[] = []
  for (let pos = 0; pos <= comprimento; pos += passo)
    out.push({ posicaoM: pos, label: formatMarcadorCompacto(pos, ctx) })
  return out
}

const RAIO_TERRA_M = 6371008.8

function distanciaM(a: number[], b: number[]): number {
  const rad = Math.PI / 180
  const dLat = (b[1] - a[1]) * rad
  const dLng = (b[0] - a[0]) * rad
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2
  return 2 * RAIO_TERRA_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/**
 * Coloca os marcadores (em ordem crescente de posição) sobre a linha numa passada só. Mesma distância
 * (haversine) que o turf usa para o comprimento gravado na importação.
 */
export function posicionarMarcadores<T extends { posicaoM: number }>(
  coords: number[][],
  marcadores: T[]
): Array<T & { lat: number; lng: number }> {
  const out: Array<T & { lat: number; lng: number }> = []
  if (coords.length < 2) return out
  let seg = 0
  let inicioSeg = 0
  let tamSeg = distanciaM(coords[0], coords[1])
  for (const m of marcadores) {
    while (m.posicaoM > inicioSeg + tamSeg && seg < coords.length - 2) {
      inicioSeg += tamSeg
      seg++
      tamSeg = distanciaM(coords[seg], coords[seg + 1])
    }
    const f = tamSeg > 0 ? Math.min(1, Math.max(0, (m.posicaoM - inicioSeg) / tamSeg)) : 0
    const [lng0, lat0] = coords[seg]
    const [lng1, lat1] = coords[seg + 1]
    out.push({ ...m, lat: lat0 + (lat1 - lat0) * f, lng: lng0 + (lng1 - lng0) * f })
  }
  return out
}

const MIN_PIXEL_SPACING = 60

/**
 * Desbasta os marcadores conforme o zoom para os rótulos não se empilharem: mantém pelo menos 60 px entre
 * dois marcadores visíveis (Web Mercator: 1 px ≈ 156543 × cos(lat) / 2^zoom metros).
 */
export function filtrarPorZoom<T extends { posicaoM: number }>(
  todos: T[],
  zoom: number,
  centerLat: number
): T[] {
  if (todos.length <= 2) return todos
  // abs: trecho invertido gera passo negativo
  const passoMetros = Math.abs(todos[1].posicaoM - todos[0].posicaoM)
  if (passoMetros <= 0) return todos
  const metrosPorPixel = (156543.03 * Math.cos((centerLat * Math.PI) / 180)) / Math.pow(2, zoom)
  const passoPixels = passoMetros / metrosPorPixel
  if (passoPixels >= MIN_PIXEL_SPACING) return todos
  const step = Math.max(1, Math.ceil(MIN_PIXEL_SPACING / passoPixels))
  const out: T[] = []
  for (let i = 0; i < todos.length; i += step) out.push(todos[i])
  if (out[out.length - 1] !== todos[todos.length - 1]) out.push(todos[todos.length - 1])
  return out
}
