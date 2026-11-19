/** Geometria de trechos no Node: o parser de KML/KMZ do web com o DOMParser do @xmldom/xmldom. */
import { DOMParser } from '@xmldom/xmldom'
import length from '@turf/length'
import bbox from '@turf/bbox'
import { lineString } from '@turf/helpers'
import { areaDaColecao, parseAreaKmzOrKml, parseKmzOrKml } from '@/lib/kml/parse'

const g = globalThis as Record<string, unknown>
if (!g.DOMParser) g.DOMParser = DOMParser

export interface Geometria {
  geometry_geojson: { type: 'LineString'; coordinates: number[][] }
  geometry_bounds: { south: number; west: number; north: number; east: number }
  geometry_comprimento_m: number
  geometry_importado_em: string
}

/** De um KML/KMZ em base64 (primeira polilinha). */
export async function geometriaDeKml(base64: string, nome = 'trecho.kml'): Promise<Geometria> {
  const bytes = Buffer.from(base64.replace(/^data:[^,]*,/, ''), 'base64')
  const r = await parseKmzOrKml(new File([bytes], nome))
  return {
    geometry_geojson: r.geometry as Geometria['geometry_geojson'],
    geometry_bounds: r.bounds,
    geometry_comprimento_m: r.comprimentoM,
    geometry_importado_em: new Date().toISOString()
  }
}

export interface GeometriaArea {
  geometry_geojson: { type: 'Polygon'; coordinates: number[][][] }
  geometry_bounds: { south: number; west: number; north: number; east: number }
  geometry_comprimento_m: null
  geometry_importado_em: string
}

/** Contorno de área: de um KML/KMZ em base64 (primeiro polígono) ou de coordenadas [lng, lat] do anel. */
export async function geometriaDeArea(
  kmlBase64: string | undefined,
  coords: number[][] | undefined
): Promise<GeometriaArea> {
  const r = kmlBase64
    ? await parseAreaKmzOrKml(
        new File([Buffer.from(kmlBase64.replace(/^data:[^,]*,/, ''), 'base64')], 'area.kml')
      )
    : areaDaColecao({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [coords ?? []] }
          }
        ]
      })
  return {
    geometry_geojson: r.geometry as GeometriaArea['geometry_geojson'],
    geometry_bounds: r.bounds,
    geometry_comprimento_m: null,
    geometry_importado_em: new Date().toISOString()
  }
}

/** De coordenadas [lng, lat] (GeoJSON LineString). */
export function geometriaDeCoordenadas(coords: number[][]): Geometria {
  if (coords.length < 2) throw new Error('A polilinha precisa de pelo menos 2 pontos [lng, lat].')
  const c = coords.map((p) => [p[0]!, p[1]!])
  const line = lineString(c)
  const [west, south, east, north] = bbox(line)
  return {
    geometry_geojson: { type: 'LineString', coordinates: c },
    geometry_bounds: { south, west, north, east },
    geometry_comprimento_m: Math.round(length(line, { units: 'kilometers' }) * 100000) / 100,
    geometry_importado_em: new Date().toISOString()
  }
}
