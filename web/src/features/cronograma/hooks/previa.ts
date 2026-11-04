/**
 * Prévia do resultado depois de um comando das visões (arrastar, nova dependência, compactar): o worker já devolve o
 * cronograma recalculado; ela fica na tela até o cálculo feito a partir do banco (depois da gravação) chegar.
 *
 * `pendentes` conta os comandos ainda gravando por plano: com dois arrastes seguidos, o cálculo da entrada que só tem
 * o primeiro não derruba a prévia do segundo (a barra não volta e salta de novo).
 */
import { create } from 'zustand'
import type { ResultadoCalculo } from '../motor/calculo'

interface Previa {
  /** assinatura da entrada sobre a qual o comando foi aplicado */
  sig: string
  resultado: ResultadoCalculo
}

interface PreviaState {
  porPlano: Record<string, Previa | undefined>
  pendentes: Record<string, number>
  definir: (planoId: string, p: Previa) => void
  limpar: (planoId: string) => void
  iniciarComando: (planoId: string) => void
  terminarComando: (planoId: string) => void
}

export const usePreviaStore = create<PreviaState>((set) => ({
  porPlano: {},
  pendentes: {},
  definir: (planoId, p) => set((s) => ({ porPlano: { ...s.porPlano, [planoId]: p } })),
  limpar: (planoId) =>
    set((s) => {
      if (!s.porPlano[planoId]) return s
      const porPlano = { ...s.porPlano }
      delete porPlano[planoId]
      return { porPlano }
    }),
  iniciarComando: (planoId) =>
    set((s) => ({ pendentes: { ...s.pendentes, [planoId]: (s.pendentes[planoId] ?? 0) + 1 } })),
  terminarComando: (planoId) =>
    set((s) => ({
      pendentes: { ...s.pendentes, [planoId]: Math.max(0, (s.pendentes[planoId] ?? 0) - 1) }
    }))
}))
