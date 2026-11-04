import { useAuthStore } from '@/stores/auth-store'
import { useEmpresas } from '@/features/gerencial/hooks'
import { useCurrentScope } from './useCurrentScope'

/**
 * Empresa do escopo atual: a do perfil (adm/eng/apoio/cliente) ou, para o God
 * (que não tem empresa no perfil), a escolhida no seletor de empresa/obra.
 */
export function useEmpresaAtual(): { id: string; nome: string } | null {
  const doPerfil = useAuthStore((s) => s.empresa)
  const scope = useCurrentScope()
  const { data: empresas = [] } = useEmpresas()
  if (doPerfil) return doPerfil
  const sel = scope.empresaId ? empresas.find((e) => e.id === scope.empresaId) : undefined
  return sel ? { id: sel.id, nome: sel.nome } : null
}
