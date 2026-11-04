import type { PhotoHandle, PhotoStorage } from './photoStorage'

/**
 * Implementação web do PhotoStorage — o Blob inteiro fica no Dexie (handle.kind='blob').
 *
 * Comportamento idêntico ao código pré-Capacitor: o Dexie já guardava o Blob
 * em `out_foto.fileBlob`. Aqui só envelopamos numa interface comum.
 *
 * Em iOS Safari isto sofre com eviction sob memory pressure — mitigado por
 * `requestPersistentStorage()` no boot autenticado e pelo fallback de signed
 * URL no `FotoTile` quando o Blob morre.
 */
export class BlobPhotoStorage implements PhotoStorage {
   
  async save(blob: Blob, _id: string): Promise<PhotoHandle> {
    // Não há persistência aqui — quem chama (fotoRepo) salva o handle no
    // Dexie como parte do registro `out_foto`. Tudo fica no IndexedDB junto.
    return { kind: 'blob', blob }
  }

  async read(handle: PhotoHandle): Promise<Blob> {
    if (handle.kind === 'blob') return handle.blob
    throw new Error('BlobPhotoStorage só suporta handles do tipo "blob"')
  }

  async previewUrl(handle: PhotoHandle): Promise<string> {
    if (handle.kind !== 'blob') {
      throw new Error('BlobPhotoStorage só suporta handles do tipo "blob"')
    }
    return URL.createObjectURL(handle.blob)
  }

  revokePreviewUrl(url: string): void {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }

   
  async delete(_handle: PhotoHandle): Promise<void> {
    // No-op: o Blob desaparece quando o registro out_foto é deletado do Dexie.
  }
}
