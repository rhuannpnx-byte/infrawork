/**
 * Abstração de câmera — interface única, 2 modos de captura:
 *
 *  - **WebCameraProvider** (PWA): stream ao vivo no `<video>` + botão shutter
 *    que captura frame via canvas. Implementação atual; encapsula
 *    `openRearCamera()` + `captureFrameFromVideo()` de `cameraStream.ts`.
 *
 *  - **NativeCameraProvider** (Capacitor Android): chama `Camera.getPhoto()`
 *    do plugin oficial — abre a UI nativa do Android com autofocus/flash do
 *    próprio sistema. Muito melhor que tentar simular shutter via canvas.
 *
 * O componente `FotosCaptureRoute` consome a abstração e decide entre os 2
 * modos pelo `kind` do provider.
 */

export interface CapturedPhoto {
  /** JPEG cru, antes do watermark. */
  blob: Blob
  /** Dimensões reais (não rendered). Em web vem do `videoWidth`. */
  width: number
  height: number
}

export type CameraProvider =
  | {
      kind: 'web'
      /**
       * Abre stream ao vivo no `<video>` passado. UI de shutter é do app.
       * Caller deve chamar `captureFromStream()` quando o operador tocar.
       */
      openStream(video: HTMLVideoElement): Promise<CameraStreamHandle>
    }
  | {
      kind: 'native'
      /**
       * Dispara a câmera nativa do device. Bloqueia até o operador tirar a
       * foto ou cancelar. Sem necessidade de `<video>` no DOM.
       */
      capture(): Promise<CapturedPhoto>
    }

export interface CameraStreamHandle {
  /** Captura um frame agora (chamado no shutter). */
  capture(quality?: number): Promise<CapturedPhoto>
  /** Para os tracks e libera recurso. Sempre chamar no cleanup. */
  stop(): void
}
