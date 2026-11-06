/**
 * MCP do InfraWork (IAs conectadas ao sistema): endereço, status do servidor e do login OAuth e os tokens pessoais
 * do usuário. Usado no menu do usuário e na janela "Conectar IA".
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

export interface TokenIA {
  id: string
  nome: string
  prefixo: string
  criado_em: string
  expira_em: string | null
  ultimo_uso_em: string | null
  revogado_em: string | null
}

export type Estado = 'ok' | 'off' | 'verificando'

export interface StatusMcp {
  servidor: Estado
  oauth: Estado
  tokens: TokenIA[]
  ativos: TokenIA[]
  ultimoUso: string | null
}

/** Endereço do MCP: o do próprio site (ou VITE_MCP_URL, para apontar o dev local para a produção). */
export const MCP_URL: string =
  (import.meta.env.VITE_MCP_URL as string | undefined) ??
  `${typeof window === 'undefined' ? '' : window.location.origin}/mcp`

const CHAVE = ['mcp']

function sb(): NonNullable<typeof supabase> {
  if (!supabase) throw new Error('Supabase não configurado.')
  return supabase
}

async function alcanca(
  url: string,
  conferir: (j: Record<string, unknown>) => boolean
): Promise<boolean> {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!r.ok) return false
    return conferir((await r.json()) as Record<string, unknown>)
  } catch {
    return false
  }
}

const ativo = (t: TokenIA): boolean =>
  !t.revogado_em && (!t.expira_em || new Date(t.expira_em).getTime() > Date.now())

export function useStatusMcp(): { status: StatusMcp; recarregar: () => void } {
  const base = MCP_URL.replace(/\/mcp$/, '')
  const supa = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
  const servidor = useQuery({
    queryKey: [...CHAVE, 'servidor', base],
    staleTime: 60_000,
    retry: false,
    queryFn: () =>
      alcanca(`${base}/.well-known/oauth-protected-resource`, (j) => typeof j.resource === 'string')
  })
  const oauth = useQuery({
    queryKey: [...CHAVE, 'oauth', supa],
    staleTime: 60_000,
    retry: false,
    enabled: !!supa,
    queryFn: () =>
      alcanca(
        `${supa}/.well-known/oauth-authorization-server/auth/v1`,
        (j) => !!j.authorization_endpoint
      )
  })
  const tokens = useQuery({
    queryKey: [...CHAVE, 'tokens'],
    staleTime: 30_000,
    queryFn: async (): Promise<TokenIA[]> => {
      const { data, error } = await sb()
        .from('mcp_token')
        .select('id, nome, prefixo, criado_em, expira_em, ultimo_uso_em, revogado_em')
        .order('criado_em', { ascending: false })
      if (error) throw error
      return data as TokenIA[]
    }
  })
  const estado = (q: { isLoading: boolean; data?: boolean }): Estado =>
    q.isLoading ? 'verificando' : q.data ? 'ok' : 'off'
  const lista = tokens.data ?? []
  const ativos = lista.filter(ativo)
  const ultimoUso = ativos.reduce<string | null>(
    (m, t) => (t.ultimo_uso_em && (!m || t.ultimo_uso_em > m) ? t.ultimo_uso_em : m),
    null
  )
  return {
    status: { servidor: estado(servidor), oauth: estado(oauth), tokens: lista, ativos, ultimoUso },
    recarregar: () => {
      void servidor.refetch()
      void oauth.refetch()
      void tokens.refetch()
    }
  }
}

export function useCriarTokenIA(): ReturnType<
  typeof useMutation<string, Error, { nome: string; dias: number | null }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ nome, dias }) => {
      const { data, error } = await sb().rpc('mcp_token_criar', { _nome: nome, _dias: dias })
      if (error) throw new Error(error.message)
      return (data as { token: string }).token
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...CHAVE, 'tokens'] })
  })
}

export function useRevogarTokenIA(): ReturnType<typeof useMutation<void, Error, string>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await sb().rpc('mcp_token_revogar', { _id: id })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...CHAVE, 'tokens'] })
  })
}
