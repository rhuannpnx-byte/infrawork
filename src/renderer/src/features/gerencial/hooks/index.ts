// Hooks do módulo Gerencial.
//
// - Leitura: consulta direta via supabase-js. RLS filtra por papel/empresa.
// - Escrita: via Edge Functions (adminApi) que aplicam defesa em profundidade.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { adminApi } from '@/lib/supabase/functions'
import type {
  Empresa,
  ObraComEmpresa,
  ObraPermissao,
  UsuarioComEmpresa,
  UsuarioRow
} from '@/types/gerencial'

function notReady(): never {
  throw new Error('Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
}

// ─── Empresas ────────────────────────────────────────────────────────────

export function useEmpresas(): ReturnType<typeof useQuery<Empresa[]>> {
  return useQuery({
    queryKey: ['gerencial', 'empresas'],
    queryFn: async (): Promise<Empresa[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('empresas')
        .select('id, nome, cnpj, ativo, created_at')
        .order('nome', { ascending: true })
      if (error) throw error
      return (data ?? []) as Empresa[]
    }
  })
}

export function useCreateEmpresa(): ReturnType<
  typeof useMutation<{ id: string; nome: string; cnpj: string | null }, Error, { nome: string; cnpj?: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => adminApi.createEmpresa(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gerencial', 'empresas'] })
    }
  })
}

// ─── Usuários ────────────────────────────────────────────────────────────

export function useUsuarios(
  opts?: { refetchInterval?: number }
): ReturnType<typeof useQuery<UsuarioComEmpresa[]>> {
  return useQuery({
    queryKey: ['gerencial', 'usuarios'],
    // refetch periódico mantém "Online agora" atualizado (só ligado p/ God na UI).
    refetchInterval: opts?.refetchInterval,
    queryFn: async (): Promise<UsuarioComEmpresa[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      // RLS filtra: God vê tudo, Adm vê própria empresa, Eng vê os Apoios dele.
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'id, email, nome, role, empresa_id, engenheiro_id, ativo, created_at, acessos_count, last_access_at, last_seen_at, empresa:empresa_id(id, nome), engenheiro:engenheiro_id(id, nome)'
        )
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as UsuarioComEmpresa[]
    }
  })
}

/**
 * Engenheiros ativos de uma empresa específica — usado pra atribuir `engenheiro_id`
 * ao criar um Apoio (caso o caller seja Adm) e pra escolher target em
 * grant-obra-permissao.
 */
export function useEngenheiros(empresaId: string | null | undefined): ReturnType<typeof useQuery<UsuarioRow[]>> {
  return useQuery({
    queryKey: ['gerencial', 'engenheiros', empresaId],
    enabled: !!empresaId,
    queryFn: async (): Promise<UsuarioRow[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, nome, role, empresa_id, engenheiro_id, ativo, created_at')
        .eq('role', 'engenheiro')
        .eq('empresa_id', empresaId!)
        .eq('ativo', true)
        .order('nome')
      if (error) throw error
      return (data ?? []) as UsuarioRow[]
    }
  })
}

/**
 * Clientes ativos de uma empresa específica — usado pra escolher target em
 * grant-obra-permissao (clientes recebem permissão direta, como engenheiros).
 */
export function useClientes(empresaId: string | null | undefined): ReturnType<typeof useQuery<UsuarioRow[]>> {
  return useQuery({
    queryKey: ['gerencial', 'clientes', empresaId],
    enabled: !!empresaId,
    queryFn: async (): Promise<UsuarioRow[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, nome, role, empresa_id, engenheiro_id, ativo, created_at')
        .eq('role', 'cliente')
        .eq('empresa_id', empresaId!)
        .eq('ativo', true)
        .order('nome')
      if (error) throw error
      return (data ?? []) as UsuarioRow[]
    }
  })
}

export function useCreateUsuario(): ReturnType<
  typeof useMutation<
    { id: string; email: string; role: string },
    Error,
    Parameters<typeof adminApi.createUsuario>[0]
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => adminApi.createUsuario(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gerencial', 'usuarios'] })
      void qc.invalidateQueries({ queryKey: ['gerencial', 'engenheiros'] })
      void qc.invalidateQueries({ queryKey: ['gerencial', 'clientes'] })
    }
  })
}

// ─── Obras ───────────────────────────────────────────────────────────────

export function useObras(): ReturnType<typeof useQuery<ObraComEmpresa[]>> {
  return useQuery({
    queryKey: ['gerencial', 'obras'],
    queryFn: async (): Promise<ObraComEmpresa[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('obras')
        .select('id, empresa_id, nome, codigo, status, created_at, empresa:empresa_id(id, nome)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ObraComEmpresa[]
    }
  })
}

export function useObra(id: string | undefined): ReturnType<typeof useQuery<ObraComEmpresa>> {
  return useQuery({
    queryKey: ['gerencial', 'obra', id],
    enabled: !!id,
    queryFn: async (): Promise<ObraComEmpresa> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('obras')
        .select('id, empresa_id, nome, codigo, status, created_at, empresa:empresa_id(id, nome)')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as ObraComEmpresa
    }
  })
}

export function useCreateObra(): ReturnType<
  typeof useMutation<{ id: string; nome: string; codigo: string }, Error, Parameters<typeof adminApi.createObra>[0]>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => adminApi.createObra(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gerencial', 'obras'] })
    }
  })
}

// ─── Permissões de obra ──────────────────────────────────────────────────

export function useObraPermissoes(obraId: string | undefined): ReturnType<typeof useQuery<ObraPermissao[]>> {
  return useQuery({
    queryKey: ['gerencial', 'obra-permissoes', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<ObraPermissao[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('obra_permissoes')
        .select(
          'id, obra_id, user_id, concedido_por, created_at, usuario:user_id(id, nome, email, role), concedente:concedido_por(id, nome)'
        )
        .eq('obra_id', obraId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ObraPermissao[]
    }
  })
}

export function useGrantPermissao(): ReturnType<
  typeof useMutation<{ id: string; obra_id: string; user_id: string }, Error, { obra_id: string; user_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => adminApi.grantObraPermissao(body),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['gerencial', 'obra-permissoes', vars.obra_id] })
    }
  })
}

export function useRevokePermissao(): ReturnType<
  typeof useMutation<{ revoked: { id: string } }, Error, { obra_id: string; user_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => adminApi.revokeObraPermissao(body),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['gerencial', 'obra-permissoes', vars.obra_id] })
    }
  })
}
