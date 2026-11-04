import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authEndpoints } from '@/core/api/endpoints'
import { ApiError } from '@/core/api/fetchClient'
import { sessionStore, useSession } from '@/core/auth/SessionStore'
import { contarNaoEnviados } from '@/core/db/daos'
import { deleteDatabase } from '@/core/db/dexie'
import { CHAVE_RASCUNHO_PRODUCAO, useProducaoStore } from '@/features/producao/producaoStore'
import { refreshAllCatalogs } from '@/core/sync/catalogSync'

async function limparDadosLocais() {
  // caches do SW + banco inteiro: não vazar dados do usuário A para o usuário B
  if ('caches' in window) {
    const keys = await caches.keys()
    await Promise.all(
      keys.filter((k) => !k.startsWith('workbox-precache')).map((k) => caches.delete(k)),
    )
  }
  try {
    await deleteDatabase()
  } catch (e) {
    console.warn('[auth] falha ao limpar o banco local:', e)
  }
  useProducaoStore.getState().reset()
  try {
    localStorage.removeItem(CHAVE_RASCUNHO_PRODUCAO)
  } catch {
    /* sem localStorage */
  }
}

interface UseAuthResult {
  session: ReturnType<typeof useSession>
  login: (email: string, senha: string) => Promise<void>
  logout: () => Promise<void>
  loading: boolean
  error: string | null
}

/**
 * Login/logout com o usuário do InfraWork Web (Supabase Auth). Entrar de novo com o mesmo usuário preserva obra,
 * catálogos e filas; outro usuário só entra se não houver nada pendente do anterior.
 */
export function useAuth(): UseAuthResult {
  const navigate = useNavigate()
  const session = useSession()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const login = useCallback(
    async (email: string, senha: string) => {
      setLoading(true)
      setError(null)
      try {
        const r = await authEndpoints.login(email.trim().toLowerCase(), senha)
        const anterior = sessionStore.current()
        const mesmoUsuario = anterior != null && anterior.userId === r.userId
        if (anterior && !mesmoUsuario) {
          const pendentes = await contarNaoEnviados()
          if (pendentes > 0) {
            await authEndpoints.logout()
            setError(
              `Este aparelho tem ${pendentes} lançamento(s) de ${anterior.userNome} ainda não enviados. ` +
                'Entre com esse usuário para enviar, ou use Sair para descartá-los.',
            )
            return
          }
          await limparDadosLocais()
        }
        sessionStore.save({
          token: r.accessToken,
          expiresAtEpochMs: r.expiresAtEpochMs,
          userId: r.userId,
          userNome: r.nome,
          userEmail: r.email,
          role: r.role,
          empresaId: r.empresaId,
          obraAtualId: mesmoUsuario ? anterior.obraAtualId : null,
        })
        if (navigator.storage?.persist) navigator.storage.persist().catch(() => {})
        void refreshAllCatalogs().catch(() => undefined)
        navigate('/', { replace: true })
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setError(e.message)
        else if (e instanceof ApiError && e.isOffline) setError('Sem conexão. Verifique sua rede.')
        else setError(e instanceof Error ? e.message : 'Erro inesperado')
      } finally {
        setLoading(false)
      }
    },
    [navigate],
  )

  const logout = useCallback(async () => {
    const pendentes = await contarNaoEnviados()
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    if (pendentes > 0) {
      const ok = window.confirm(
        `Há ${pendentes} lançamento(s)/foto(s) que ainda NÃO foram enviados ao servidor.\n\n` +
          'Sair agora APAGA esses dados deste aparelho.\n\nDeseja sair mesmo assim?',
      )
      if (!ok) return
    } else if (offline) {
      const ok = window.confirm(
        'Você está sem internet. Se sair agora, só conseguirá entrar de novo quando tiver conexão.\n\nDeseja sair mesmo assim?',
      )
      if (!ok) return
    }
    sessionStore.clear()
    await authEndpoints.logout()
    await limparDadosLocais()
    navigate('/login', { replace: true })
  }, [navigate])

  return { session, login, logout, loading, error }
}
