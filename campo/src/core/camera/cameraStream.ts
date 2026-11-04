/**
 * Wrapper sobre `getUserMedia` com detecção de capability + helper para tirar foto do <video>.
 *
 * Comportamento esperado:
 *  - Chrome desktop/Android: stream funciona, usa `<video>` ao vivo e captura via canvas.
 *  - iOS Safari standalone (PWA "Add to Home Screen"): stream costuma funcionar.
 *  - Webviews embarcadas (Instagram, FB in-app): stream pode falhar.
 *
 * Para qualquer cenário onde stream falha, o caller deve fazer fallback para
 * `<input type="file" accept="image/*" capture="environment">` — que sempre funciona.
 */

export interface CameraStream {
  stream: MediaStream
  track: MediaStreamTrack
  stop: () => void
}

export async function openRearCamera(): Promise<CameraStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('mediaDevices.getUserMedia indisponível')
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  })
  const track = stream.getVideoTracks()[0]
  return {
    stream,
    track,
    stop: () => {
      stream.getTracks().forEach((t) => t.stop())
    },
  }
}

/**
 * Captura um frame do `<video>` em JPEG. Width/height vêm do videoWidth real
 * (não do tamanho exibido), garantindo resolução nativa.
 */
export async function captureFrameFromVideo(
  video: HTMLVideoElement,
  quality = 0.92,
): Promise<Blob> {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) throw new Error('Vídeo ainda não carregou metadata')

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(video, 0, 0, w, h)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob retornou null'))),
      'image/jpeg',
      quality,
    )
  })
}
