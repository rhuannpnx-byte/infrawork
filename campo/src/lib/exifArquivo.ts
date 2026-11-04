import piexif from 'piexifjs'

/** Origem de uma foto escolhida na galeria: quando e onde ela foi tirada (não quando foi enviada). */
export interface OrigemArquivo {
  data: Date
  lat: number | null
  lng: number | null
}

function lerDataUrl(file: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    r.readAsDataURL(file)
  })
}

/** "AAAA:MM:DD HH:MM:SS" (EXIF, hora local da câmera) → Date. */
export function dataExif(v: unknown): Date | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(String(v ?? ''))
  if (!m) return null
  const d = new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Data e GPS do EXIF da foto da galeria (JPEG). Sem EXIF, a data é a da última modificação do arquivo e não há
 * coordenadas — nunca a posição atual do aparelho, que pode estar longe de onde a foto foi tirada.
 */
export async function lerOrigemArquivo(file: File): Promise<OrigemArquivo> {
  const origem: OrigemArquivo = {
    data: new Date(file.lastModified || Date.now()),
    lat: null,
    lng: null,
  }
  if (!/jpe?g/i.test(file.type)) return origem
  try {
    const ex = piexif.load(await lerDataUrl(file))
    const d = dataExif(ex.Exif?.[piexif.ExifIFD.DateTimeOriginal])
    if (d) origem.data = d
    const g = ex.GPS
    const la = g?.[piexif.GPSIFD.GPSLatitude] as [number, number][] | undefined
    const lo = g?.[piexif.GPSIFD.GPSLongitude] as [number, number][] | undefined
    if (la && lo) {
      const lat = piexif.GPSHelper.dmsRationalToDeg(la, String(g?.[piexif.GPSIFD.GPSLatitudeRef] ?? 'N'))
      const lng = piexif.GPSHelper.dmsRationalToDeg(lo, String(g?.[piexif.GPSIFD.GPSLongitudeRef] ?? 'E'))
      if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
        origem.lat = lat
        origem.lng = lng
      }
    }
  } catch {
    /* sem EXIF legível */
  }
  return origem
}
