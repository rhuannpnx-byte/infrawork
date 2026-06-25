import { create } from 'zustand'

/** Documento + página exibidos no Visualizador, que agora é um MODAL global do
 * módulo (abre a qualquer tempo): Repositório, Cláusulas e Conversar chamam
 * `abrir(docId, pagina)` e o modal sobe por cima da página atual. */
interface DocumentacaoUIStore {
  aberto: boolean
  docId: string | null
  pagina: number | null
  abrir: (docId: string | null, pagina: number | null) => void
  fechar: () => void
}

export const useDocumentacaoUIStore = create<DocumentacaoUIStore>((set) => ({
  aberto: false,
  docId: null,
  pagina: null,
  abrir: (docId, pagina) => {
    if (!docId) return
    set({ aberto: true, docId, pagina })
  },
  fechar: () => set({ aberto: false })
}))
