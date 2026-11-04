/**
 * Abstração de storage de fotos — interface única, 2 implementações:
 *
 *  - `BlobPhotoStorage` (web/PWA): persiste o Blob direto no Dexie. Atual.
 *  - `FilesystemPhotoStorage` (Capacitor Android): persiste o arquivo em
 *    filesystem nativo do device e guarda só o path no Dexie.
 *
 * O resto do app (fotoRepo, fotoSync, list, detail) consome a interface — não
 * sabe qual impl está rodando. Factory `pickPhotoStorage()` resolve em runtime.
 *
 * Por que: em PWA web, Blobs grandes no IndexedDB sofrem com eviction (iOS
 * Safari) + fragmentação de memória. Em native, Filesystem é o lugar certo
 * pra arquivos operacionais; reserva o Dexie pra metadata.
 */

/**
 * Handle persistido no Dexie. É o "endereço" de onde a foto vive.
 *
 * - `kind: 'blob'`  → o Blob inteiro está aqui, foi salvo direto no IndexedDB
 *                     (caso PWA web atual)
 * - `kind: 'path'`  → o arquivo vive no Filesystem nativo (Documents/InfraWork/),
 *                     `path` é a referência. Esse é o caso Android nativo.
 */
export type PhotoHandle =
  | { kind: 'blob'; blob: Blob }
  | { kind: 'path'; path: string; mime: string; size: number }

export interface PhotoStorage {
  /** Persiste uma foto. `id` é o UUID v7 — usado pra montar filename em native. */
  save(blob: Blob, id: string): Promise<PhotoHandle>

  /** Lê o conteúdo como Blob (necessário pro multipart upload). */
  read(handle: PhotoHandle): Promise<Blob>

  /**
   * URL servível pra `<img src=...>`. Em web é `blob:`; em native é `file://`
   * ou similar. Caller é responsável por revogar (`revokePreviewUrl`) quando
   * o componente desmontar.
   */
  previewUrl(handle: PhotoHandle): Promise<string>

  /** Cleanup do recurso da preview URL (revoke blob: URL, etc). */
  revokePreviewUrl(url: string): void

  /** Remove o recurso persistido. Idempotente. */
  delete(handle: PhotoHandle): Promise<void>
}
