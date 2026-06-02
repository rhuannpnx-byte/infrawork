// Parser de KML/KMZ client-side pra extrair LineStrings de trechos rodoviarios.
//
// Estrategia:
//   1) Detecta KMZ por magic header (zip = bytes 0x50 0x4B 0x03 0x04) ou extensao.
//   2) KMZ: descompacta via JSZip, le doc.kml interno (pega o primeiro .kml se
//      o nome canonico nao existir).
//   3) KML: le como text direto.
//   4) Parse XML com DOMParser nativo.
//   5) @tmcw/togeojson.kml() converte pra FeatureCollection.
//   6) Filtra features com geometry.type === 'LineString'; pega a PRIMEIRA.
//   7) Calcula comprimento haversine (@turf/length) e bounding box (@turf/bbox).
//
// Erros lancados com mensagens claras pra UI exibir inline:
//   - "Arquivo invalido" — XML malformado ou KMZ corrompido.
//   - "Nenhuma polilinha (LineString) encontrada" — KML so tem pontos/poligonos.
//   - "KMZ sem doc.kml" — KMZ valido mas sem KML interno.

import { kml as kmlToGeoJSON } from '@tmcw/togeojson'
import length from '@turf/length'
import bbox from '@turf/bbox'
import { lineString as turfLineString } from '@turf/helpers'

export interface ParsedKmlResult {
  /** Primeira LineString do arquivo. Sentido conforme arquivo original (KML order). */
  geometry: GeoJSON.LineString
  /** Total de LineStrings encontradas. UI usa pra exibir warning se > 1. */
  totalLineStrings: number
  /** Comprimento haversine total em metros. */
  comprimentoM: number
  /** Bounding box geografico — {south, west, north, east} em graus. */
  bounds: { south: number; west: number; north: number; east: number }
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB — corta arquivos absurdos cedo

export async function parseKmzOrKml(file: File): Promise<ParsedKmlResult> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Limite: 10 MB.`
    )
  }

  const kmlText = await readAsKmlText(file)
  const doc = new DOMParser().parseFromString(kmlText, 'application/xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    throw new Error('Arquivo invalido: XML malformado.')
  }

  const fc = kmlToGeoJSON(doc) as GeoJSON.FeatureCollection
  const lineStrings = (fc.features ?? []).filter(
    (f): f is GeoJSON.Feature<GeoJSON.LineString> =>
      f.geometry?.type === 'LineString' &&
      Array.isArray((f.geometry as GeoJSON.LineString).coordinates) &&
      (f.geometry as GeoJSON.LineString).coordinates.length >= 2
  )

  if (lineStrings.length === 0) {
    throw new Error('Nenhuma polilinha (LineString) encontrada no arquivo.')
  }

  const primeira = lineStrings[0].geometry
  // Validacao: coordenadas devem ter pelo menos lng/lat.
  if (primeira.coordinates.some((c) => !Array.isArray(c) || c.length < 2)) {
    throw new Error('Polilinha com coordenadas invalidas.')
  }

  // Normaliza pra [lng, lat] sem altitude (KML costuma ter [lng, lat, alt]).
  const geometry: GeoJSON.LineString = {
    type: 'LineString',
    coordinates: primeira.coordinates.map((c) => [c[0], c[1]])
  }

  const line = turfLineString(geometry.coordinates)
  const comprimentoKm = length(line, { units: 'kilometers' })
  const comprimentoM = Math.round(comprimentoKm * 1000 * 100) / 100 // 2 casas

  const [west, south, east, north] = bbox(line)

  return {
    geometry,
    totalLineStrings: lineStrings.length,
    comprimentoM,
    bounds: { south, west, north, east }
  }
}

// ─── Helpers privados ───────────────────────────────────────────────────────

async function readAsKmlText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const isKmz = looksLikeZip(bytes) || /\.kmz$/i.test(file.name)
  if (isKmz) {
    return extrairKmlDeKmz(buf, file.name)
  }
  return new TextDecoder('utf-8').decode(bytes)
}

function looksLikeZip(bytes: Uint8Array): boolean {
  // PK\x03\x04 — magic header de ZIP.
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

async function extrairKmlDeKmz(buf: ArrayBuffer, nomeArquivo: string): Promise<string> {
  // Lazy-import: jszip e ~80KB e so e necessario quando o user importa KMZ.
  const JSZip = (await import('jszip')).default
  let zip: import('jszip')
  try {
    zip = await JSZip.loadAsync(buf)
  } catch (e) {
    throw new Error(`KMZ corrompido (${nomeArquivo}): ${(e as Error).message}`)
  }

  // Preferencia: doc.kml na raiz. Fallback: primeiro .kml encontrado.
  let kmlFile = zip.file('doc.kml')
  if (!kmlFile) {
    const candidatos = Object.values(zip.files).filter(
      (f) => !f.dir && /\.kml$/i.test(f.name)
    )
    if (candidatos.length === 0) {
      throw new Error('KMZ sem arquivo .kml interno.')
    }
    kmlFile = candidatos[0]
  }

  return kmlFile.async('text')
}
