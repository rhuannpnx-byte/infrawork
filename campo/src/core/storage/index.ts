import { BlobPhotoStorage } from './blobPhotoStorage'
import type { PhotoStorage } from './photoStorage'

/** Fotos ficam no IndexedDB como Blob até o envio (PWA). */
const current: PhotoStorage = new BlobPhotoStorage()

export function photoStorage(): PhotoStorage {
  return current
}

export async function initPhotoStorage(): Promise<void> {}

export type { PhotoHandle, PhotoStorage } from './photoStorage'
