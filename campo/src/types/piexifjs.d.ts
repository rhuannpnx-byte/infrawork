/**
 * Tipagem mínima de piexifjs — só o que vamos usar para injetar GPS + DateTime no JPEG após
 * o watermark queimado. piexifjs trabalha em base64 (não Blob), por isso fazemos a conversão
 * em `core/camera/WatermarkRenderer.ts` em uma única passagem.
 *
 * Não existe @types/piexifjs publicado; tipagem manual aqui resolve o `import` sem `any`.
 */
declare module 'piexifjs' {
  export interface ExifIFD {
    [tag: number]: number | string | Array<number | string> | [number, number] | [number, number][]
  }

  export interface ExifObject {
    '0th'?: ExifIFD
    Exif?: ExifIFD
    GPS?: ExifIFD
    Interop?: ExifIFD
    '1st'?: ExifIFD
    thumbnail?: string | null
  }

  export const ImageIFD: {
    Orientation: number
    DateTime: number
    Make: number
    Model: number
    Software: number
    [key: string]: number
  }

  export const ExifIFD: {
    DateTimeOriginal: number
    DateTimeDigitized: number
    UserComment: number
    [key: string]: number
  }

  export const GPSIFD: {
    GPSVersionID: number
    GPSLatitudeRef: number
    GPSLatitude: number
    GPSLongitudeRef: number
    GPSLongitude: number
    GPSAltitudeRef: number
    GPSAltitude: number
    GPSDateStamp: number
    GPSTimeStamp: number
    [key: string]: number
  }

  export function load(jpegData: string): ExifObject
  export function dump(exifObj: ExifObject): string
  export function insert(exifString: string, jpegData: string): string
  export function remove(jpegData: string): string

  export const GPSHelper: {
    degToDmsRational(deg: number): [number, number][]
    dmsRationalToDeg(dmsArray: [number, number][], ref: string): number
  }
}
