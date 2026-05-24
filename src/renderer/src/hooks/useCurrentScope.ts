import { useEffect, useMemo } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useObraStore } from '@/stores/obra-store'
import type { AuthObra } from '@/types/auth'

interface ScopeInfo {
  /** Empresa atual: God escolhe via picker; demais herdam do profile. */
  empresaId: string | null
  /** Obra atualmente selecionada (escopo do trabalho do usuário). */
  obraId: string | null
  obra: AuthObra | null
  /** Lista de obras visíveis ao caller, já filtrada pela empresa atual (relevante p/ God). */
  obrasNaEmpresa: AuthObra[]
  isGod: boolean
  precisaSelecionarEmpresa: boolean
  precisaSelecionarObra: boolean
}

/**
 * Resolve a "empresa e obra atualmente em uso" para o caller, combinando
 * `auth-store` (lista de obras visíveis + papel) com `obra-store` (seleção
 * persistida). Também faz auto-saneamento: se a seleção persistida apontar
 * para uma obra à qual o usuário não tem mais acesso, é limpa.
 */
export function useCurrentScope(): ScopeInfo {
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const callerEmpresaId = useAuthStore((s) => s.profile?.empresa_id ?? null)
  const obras = useAuthStore((s) => s.obras)
  const currentEmpresaId = useObraStore((s) => s.currentEmpresaId)
  const currentObraId = useObraStore((s) => s.currentObraId)
  const setEmpresaId = useObraStore((s) => s.setEmpresaId)
  const setObraId = useObraStore((s) => s.setObraId)

  const isGod = role === 'god'
  // Para Adm/Eng/Apoio a empresa "atual" é a do profile, ignorando a do store.
  const empresaId = isGod ? currentEmpresaId : callerEmpresaId

  const obrasNaEmpresa = useMemo(
    () => (empresaId ? obras.filter((o) => o.empresa_id === empresaId) : []),
    [obras, empresaId]
  )

  // Sanitização: se a obra selecionada não existe mais na lista visível
  // (revogação, troca de empresa, etc.), zera.
  useEffect(() => {
    if (!currentObraId) return
    if (!obrasNaEmpresa.some((o) => o.id === currentObraId)) {
      setObraId(null)
    }
  }, [currentObraId, obrasNaEmpresa, setObraId])

  // Para God: se a empresa selecionada não existe mais (deletada, etc.), zera.
  useEffect(() => {
    if (!isGod || !currentEmpresaId) return
    if (!obras.some((o) => o.empresa_id === currentEmpresaId)) {
      setEmpresaId(null)
    }
  }, [isGod, currentEmpresaId, obras, setEmpresaId])

  const obra = currentObraId ? obrasNaEmpresa.find((o) => o.id === currentObraId) ?? null : null

  return {
    empresaId,
    obraId: obra?.id ?? null,
    obra,
    obrasNaEmpresa,
    isGod,
    precisaSelecionarEmpresa: isGod && !empresaId,
    precisaSelecionarObra: !!empresaId && !obra
  }
}
