import { storageKey } from '@/lib/storage-keys'
import type { Exibicao } from './aparencia'
import type { CameraSalva, Modo4D } from './CenaCesium'

/** Vista salva: a câmera e o que a cena mostrava (data, modo, classes ocultas e exibição). */
export interface Vista {
  id: string
  nome: string
  camera: CameraSalva
  t: number
  modo: Modo4D
  ocultas: string[]
  exibicao: Exibicao
}

const chave = (modeloId: string): string => storageKey(`modelo4d.vistas.${modeloId}`)

/** As vistas ficam no navegador de quem as salvou, por modelo. */
export function lerVistas(modeloId: string): Vista[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(chave(modeloId)) ?? '[]') as unknown
    return Array.isArray(v) ? (v as Vista[]).filter((x) => x?.id && x.nome && x.camera) : []
  } catch {
    return []
  }
}

export function gravarVistas(modeloId: string, vistas: Vista[]): boolean {
  try {
    window.localStorage.setItem(chave(modeloId), JSON.stringify(vistas))
    return true
  } catch {
    return false
  }
}
