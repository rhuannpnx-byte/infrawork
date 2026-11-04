import type { OutFoto } from '@/core/db/entities'
import type { PhotoHandle } from './photoStorage'

/**
 * Handle da foto a partir do registro em `out_foto`. `null` quando o navegador descartou o blob (iOS Safari sob
 * pressão de memória) — para fotos já enviadas a tela usa a URL assinada do servidor.
 */
export function handleFromFoto(foto: OutFoto): PhotoHandle | null {
  return foto.fileBlob ? { kind: 'blob', blob: foto.fileBlob } : null
}
