import { createContext, useContext } from 'react'

/**
 * Sinaliza, para a subárvore de uma aba, se ela está visível (ativa) no momento.
 * Componentes que medem layout ou precisam repintar ao reaparecer (Leaflet,
 * virtualizador do Gantt) leem `useTabVisible()` e reagem na transição.
 *
 * Default `true`: fora do sistema de abas, tudo se comporta como visível.
 */
export const TabVisibleContext = createContext(true)

export function useTabVisible(): boolean {
  return useContext(TabVisibleContext)
}
