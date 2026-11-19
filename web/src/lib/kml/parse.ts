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
  // getElementsByTagName (e não querySelector): o mesmo parser roda no Node (MCP, via @xmldom/xmldom)
  if (doc.getElementsByTagName('parsererror').length > 0) {
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

export interface ParsedKmlArea {
  /** Contorno da área (anel externo), em [lng, lat], fechado. */
  geometry: GeoJSON.Polygon
  /** Quantos contornos o arquivo tinha; a UI avisa quando há mais de um (vale o primeiro). */
  totalPoligonos: number
  bounds: { south: number; west: number; north: number; east: number }
}

/**
 * Contorno de uma área (OAE, jazida, canteiro) num KML/KMZ: o primeiro polígono do arquivo; sem polígono, uma
 * polilinha fechada (o último ponto igual ao primeiro) vira o contorno.
 */
export async function parseAreaKmzOrKml(file: File): Promise<ParsedKmlArea> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Limite: 10 MB.`
    )
  }
  const doc = new DOMParser().parseFromString(await readAsKmlText(file), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Arquivo invalido: XML malformado.')
  }
  const fc = kmlToGeoJSON(doc) as GeoJSON.FeatureCollection
  return areaDaColecao(fc)
}

/** Separado da leitura do arquivo para testar sem DOM. */
export function areaDaColecao(fc: GeoJSON.FeatureCollection): ParsedKmlArea {
  const aneis: number[][][] = []
  const juntar = (g: GeoJSON.Geometry | null | undefined): void => {
    if (!g) return
    if (g.type === 'Polygon') {
      if (g.coordinates[0]?.length) aneis.push(g.coordinates[0])
    } else if (g.type === 'MultiPolygon') {
      for (const p of g.coordinates) if (p[0]?.length) aneis.push(p[0])
    } else if (g.type === 'GeometryCollection') {
      g.geometries.forEach(juntar)
    }
  }
  for (const f of fc.features ?? []) juntar(f.geometry)
  if (aneis.length === 0) {
    // sem polígono: polilinha fechada
    for (const f of fc.features ?? []) {
      const g = f.geometry
      if (g?.type !== 'LineString' || g.coordinates.length < 4) continue
      const [a, b] = [g.coordinates[0], g.coordinates[g.coordinates.length - 1]]
      if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) aneis.push(g.coordinates)
    }
  }
  if (aneis.length === 0) {
    throw new Error(
      'Nenhum polígono encontrado no arquivo. Desenhe o contorno da área como polígono no Google Earth.'
    )
  }
  const anel = aneis[0].map((c) => [c[0], c[1]])
  if (anel.length < 4) throw new Error('O polígono precisa de pelo menos 3 pontos.')
  const [p0, pn] = [anel[0], anel[anel.length - 1]]
  if (p0[0] !== pn[0] || p0[1] !== pn[1]) anel.push([p0[0], p0[1]])
  const lng = anel.map((c) => c[0])
  const lat = anel.map((c) => c[1])
  return {
    geometry: { type: 'Polygon', coordinates: [anel] },
    totalPoligonos: aneis.length,
    bounds: {
      south: Math.min(...lat),
      west: Math.min(...lng),
      north: Math.max(...lat),
      east: Math.max(...lng)
    }
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
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  )
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
    const candidatos = Object.values(zip.files).filter((f) => !f.dir && /\.kml$/i.test(f.name))
    if (candidatos.length === 0) {
      throw new Error('KMZ sem arquivo .kml interno.')
    }
    kmlFile = candidatos[0]
  }

  return kmlFile.async('text')
}
