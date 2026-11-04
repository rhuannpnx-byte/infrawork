import { captureFrameFromVideo, openRearCamera, type CameraStream } from './cameraStream'
import type { CameraProvider, CameraStreamHandle, CapturedPhoto } from './cameraProvider'

/**
 * Web/PWA: encapsula o stream `getUserMedia` existente atrás da interface
 * `CameraProvider`. Comportamento idêntico ao código pré-Capacitor.
 */
export const webCameraProvider: CameraProvider = {
  kind: 'web',
  async openStream(video: HTMLVideoElement): Promise<CameraStreamHandle> {
    const stream: CameraStream = await openRearCamera()
    video.srcObject = stream.stream
    return {
      async capture(quality = 0.92): Promise<CapturedPhoto> {
        const blob = await captureFrameFromVideo(video, quality)
        return { blob, width: video.videoWidth, height: video.videoHeight }
      },
      stop() {
        stream.stop()
        video.srcObject = null
      },
    }
  },
}
