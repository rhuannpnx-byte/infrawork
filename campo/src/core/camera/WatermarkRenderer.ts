import piexif, { type ExifIFD } from 'piexifjs'

/**
 * Pipeline: Blob JPEG cru → canvas com overlay (3 linhas + retângulo semitransparente
 * no canto inferior direito) → JPEG com EXIF GPS injetado.
 *
 * Substitui `WatermarkRenderer.kt` do Android. Diferenças:
 *  - Canvas no browser já aplica EXIF orientation ao desenhar `ImageBitmap`.
 *    Por isso forçamos `Orientation = 1` no EXIF de saída.
 *  - GPS é injetado via piexifjs (não tem `androidx.exifinterface` no browser).
 *
 * Performance: para uma foto ~1.5MB de 12MP, o ciclo todo deve completar em ~1-2s
 * em um device de campo médio. Aceitável para captura única — em batch faria valer
 * mover para OffscreenCanvas em Worker.
 */

export interface WatermarkInput {
  blob: Blob
  data: string // ex: "23/05/2026 14:32"
  /** momento da foto para o EXIF (galeria: o do arquivo); sem valor = agora */
  quando?: Date
  servico?: string | null
  encarregado?: string | null
  equipe?: string | null
  lat?: number | null
  lng?: number | null
  accuracy?: number | null
}

export interface WatermarkOutput {
  blob: Blob
  width: number
  height: number
  sha256?: string
}

/**
 * Largura máxima após resize defensivo. Foto de iPhone vem ~4032×3024 (12MP, ~5MB),
 * que pode crashar `createImageBitmap` em mobile com memory pressure. Resize pra
 * 1920×1440 (~3MP) reduz uso de memória em ~4× e mantém qualidade pra documentação.
 */
const MAX_WIDTH = 1920

export async function applyWatermark(input: WatermarkInput): Promise<WatermarkOutput> {
  const t0 = performance.now()

  // `imageOrientation: 'from-image'` força o browser a honrar a tag EXIF
  // Orientation ao decodar. Sem isso, fotos vindas da galeria ou do plugin
  // Capacitor (Android com correctOrientation=true grava Orientation=1 mas
  // outras fontes podem mandar 6/8) renderizam giradas. Default varia entre
  // browsers — explicito é safer.
  const bitmap = await createImageBitmap(input.blob, { imageOrientation: 'from-image' })
  const tBitmap = performance.now()

  // Resize defensivo
  const ratio = bitmap.width > MAX_WIDTH ? MAX_WIDTH / bitmap.width : 1
  const w = Math.round(bitmap.width * ratio)
  const h = Math.round(bitmap.height * ratio)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Canvas 2D context indisponível')
  }
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const tDraw = performance.now()

  drawWatermarkOverlay(ctx, w, h, input)
  const tOverlay = performance.now()

  // toBlob com retry: alguns navegadores retornam null sob memory pressure.
  // Tentativa 1: quality 0.88. Tentativa 2 (fallback): 0.75.
  const jpegBlob = await toBlobWithRetry(canvas)
  const tBlob = performance.now()

  // Injeta EXIF (GPS + Orientation=1 + DateTimeOriginal)
  const withExif = await injectExif(jpegBlob, input)
  const tExif = performance.now()

  console.info(
    `[watermark] OK ${w}×${h} (ratio ${ratio.toFixed(2)}) ` +
      `bitmap=${(tBitmap - t0).toFixed(0)}ms ` +
      `draw=${(tDraw - tBitmap).toFixed(0)}ms ` +
      `overlay=${(tOverlay - tDraw).toFixed(0)}ms ` +
      `toBlob=${(tBlob - tOverlay).toFixed(0)}ms ` +
      `exif=${(tExif - tBlob).toFixed(0)}ms ` +
      `total=${(tExif - t0).toFixed(0)}ms ` +
      `output=${(withExif.size / 1024).toFixed(0)}KB`,
  )

  return { blob: withExif, width: w, height: h }
}

function toBlobWithRetry(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) return resolve(b)
        console.warn('[watermark] toBlob retornou null em quality=0.88, tentando 0.75')
        canvas.toBlob(
          (b2) => {
            if (b2) return resolve(b2)
            reject(
              new Error(
                'Não foi possível gerar a imagem. Pode ser falta de memória: feche outros ' +
                  'aplicativos e tente de novo.',
              ),
            )
          },
          'image/jpeg',
          0.75,
        )
      },
      'image/jpeg',
      0.88,
    )
  })
}

function drawWatermarkOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  input: WatermarkInput,
) {
  const lines = buildLines(input)
  // Tamanho proporcional à foto: ~2% da altura
  const fontSize = Math.max(18, Math.round(h * 0.022))
  const padding = Math.round(fontSize * 0.6)
  const lineHeight = Math.round(fontSize * 1.25)
  // Archivo (a fonte do app, servida junto com ele); system-ui de fallback caso a fonte ainda não tenha
  // carregado quando a foto for tirada (cold start → captura imediata).
  ctx.font = `bold ${fontSize}px "Archivo Variable", system-ui, -apple-system, sans-serif`
  ctx.textBaseline = 'top'

  // Mede largura máxima
  let maxWidth = 0
  for (const line of lines) {
    const m = ctx.measureText(line)
    if (m.width > maxWidth) maxWidth = m.width
  }
  const boxW = Math.round(maxWidth) + padding * 2
  const boxH = lineHeight * lines.length + padding * 2
  const margin = Math.round(h * 0.02)
  const boxX = w - boxW - margin
  const boxY = h - boxH - margin

  // Retângulo semitransparente
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.fillRect(boxX, boxY, boxW, boxH)

  // Texto branco com sombra
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)'
  ctx.shadowBlur = 3
  ctx.shadowOffsetX = 1
  ctx.shadowOffsetY = 1
  ctx.fillStyle = '#ffffff'
  let y = boxY + padding
  for (const line of lines) {
    ctx.fillText(line, boxX + padding, y)
    y += lineHeight
  }
  // Limpa shadow para não afetar próximos draws
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
}

function buildLines(input: WatermarkInput): string[] {
  const lines: string[] = []
  lines.push(input.data)
  if (input.servico) lines.push(input.servico)
  // Encarregado e equipe na mesma linha quando os dois estão presentes (economiza pixel)
  if (input.encarregado && input.equipe) {
    lines.push(`${input.encarregado} · ${input.equipe}`)
  } else if (input.encarregado) {
    lines.push(input.encarregado)
  } else if (input.equipe) {
    lines.push(input.equipe)
  }
  if (input.lat != null && input.lng != null) {
    const acc = input.accuracy != null ? `  ±${Math.round(input.accuracy)}m` : ''
    lines.push(`${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}${acc}`)
  }
  return lines
}

// ----------------------------------------------------------------------------
//  EXIF
// ----------------------------------------------------------------------------

async function injectExif(blob: Blob, input: WatermarkInput): Promise<Blob> {
  const dataUrl = await blobToDataUrl(blob)

  const zeroth: ExifIFD = {}
  const exif: ExifIFD = {}
  const gps: ExifIFD = {}

  // Canvas já aplicou orientation; força Orientation=1 (Top-Left) na saída
  zeroth[piexif.ImageIFD.Orientation] = 1
  zeroth[piexif.ImageIFD.Software] = 'InfraWork PWA'

  // DateTimeOriginal — formato EXIF "YYYY:MM:DD HH:MM:SS"
  exif[piexif.ExifIFD.DateTimeOriginal] = toExifDateTime(input.quando ?? new Date())

  if (input.lat != null && input.lng != null) {
    gps[piexif.GPSIFD.GPSLatitudeRef] = input.lat >= 0 ? 'N' : 'S'
    gps[piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(Math.abs(input.lat))
    gps[piexif.GPSIFD.GPSLongitudeRef] = input.lng >= 0 ? 'E' : 'W'
    gps[piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(Math.abs(input.lng))
  }

  const exifObj = { '0th': zeroth, Exif: exif, GPS: gps, Interop: {}, '1st': {}, thumbnail: null }
  const exifBytes = piexif.dump(exifObj)
  const newDataUrl = piexif.insert(exifBytes, dataUrl)
  return dataUrlToBlob(newDataUrl, 'image/jpeg')
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

function dataUrlToBlob(dataUrl: string, mime: string): Blob {
  const base64 = dataUrl.split(',')[1]
  const bytes = atob(base64)
  const len = bytes.length
  const arr = new Uint8Array(len)
  for (let i = 0; i < len; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

function toExifDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
