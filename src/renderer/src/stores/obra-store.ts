// Seleção atual de empresa + obra na sessão.
//
// Regras:
//   - God: precisa selecionar empresa E obra (ambas controlam o escopo dos demais
//     módulos). Sem empresa selecionada, a lista de obras não tem sentido.
//   - Adm/Eng/Apoio: empresa é fixa pelo profile (a do JWT). Só precisam
//     escolher uma obra.
//
// Persistência: localStorage. Cada empresa/obra é um par {id} — quando o app
// rebootar a gente revalida contra o `auth-store.obras` antes de aceitar a
// seleção (descarta IDs que o usuário não tem mais acesso).

import { create } from 'zustand'

const EMPRESA_KEY = 'infrawork.scope.empresaId'
const OBRA_KEY = 'infrawork.scope.obraId'

function read(key: string): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(key)
}
function write(key: string, value: string | null): void {
  if (typeof window === 'undefined') return
  if (value === null) window.localStorage.removeItem(key)
  else window.localStorage.setItem(key, value)
}

interface ObraStore {
  currentEmpresaId: string | null
  currentObraId: string | null
  setEmpresaId: (id: string | null) => void
  setObraId: (id: string | null) => void
  clear: () => void
}

export const useObraStore = create<ObraStore>((set) => ({
  currentEmpresaId: read(EMPRESA_KEY),
  currentObraId: read(OBRA_KEY),
  setEmpresaId: (id) => {
    write(EMPRESA_KEY, id)
    // Trocar empresa invalida a obra anterior
    write(OBRA_KEY, null)
    set({ currentEmpresaId: id, currentObraId: null })
  },
  setObraId: (id) => {
    write(OBRA_KEY, id)
    set({ currentObraId: id })
  },
  clear: () => {
    write(EMPRESA_KEY, null)
    write(OBRA_KEY, null)
    set({ currentEmpresaId: null, currentObraId: null })
  }
}))
