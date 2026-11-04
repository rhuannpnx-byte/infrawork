import type { CameraProvider } from './cameraProvider'
import { webCameraProvider } from './webCameraProvider'

/** Câmera do navegador (getUserMedia / input file). */
export function cameraProvider(): CameraProvider {
  return webCameraProvider
}

export async function initCameraProvider(): Promise<void> {}

export type { CameraProvider, CapturedPhoto, CameraStreamHandle } from './cameraProvider'
