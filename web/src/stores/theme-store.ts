import { create } from 'zustand'

export type TemaPreferencia = 'light' | 'dark' | 'system'
export type Tema = 'light' | 'dark'

// A mesma chave e a mesma regra de public/theme-boot.js (que aplica o tema antes da primeira pintura).
const CHAVE = 'infrawork.ui.theme'
const COR_DA_BARRA: Record<Tema, string> = { light: '#f1efeb', dark: '#121211' }

function lerPreferencia(): TemaPreferencia {
  try {
    const v = window.localStorage.getItem(CHAVE)
    return v === 'dark' || v === 'system' ? v : 'light'
  } catch {
    return 'light'
  }
}

function sistemaEscuro(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

function resolver(pref: TemaPreferencia): Tema {
  if (pref === 'system') return sistemaEscuro() ? 'dark' : 'light'
  return pref
}

function aplicar(tema: Tema): void {
  document.documentElement.dataset.theme = tema
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COR_DA_BARRA[tema])
}

interface ThemeStore {
  preferencia: TemaPreferencia
  tema: Tema
  setPreferencia: (p: TemaPreferencia) => void
}

export const useThemeStore = create<ThemeStore>((set) => ({
  preferencia: lerPreferencia(),
  tema: resolver(lerPreferencia()),
  setPreferencia: (preferencia) => {
    try {
      window.localStorage.setItem(CHAVE, preferencia)
    } catch {
      // sem armazenamento (janela privada): vale só para esta sessão
    }
    const tema = resolver(preferencia)
    aplicar(tema)
    set({ preferencia, tema })
  }
}))

window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const { preferencia } = useThemeStore.getState()
  if (preferencia !== 'system') return
  const tema = resolver('system')
  aplicar(tema)
  useThemeStore.setState({ tema })
})
