import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import type {
  WhatsAppSessao,
  WhatsAppGrupo,
  WhatsAppJob,
  WhatsAppMensagemLog,
  WhatsAppOraculoAcesso,
  WhatsAppOraculoConversa,
  WhatsAppOraculoLog
} from '@/types/whatsapp'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

const SESSAO_COLS =
  'id, nome, status, qr_code, phone, last_seen, ultimo_erro, empresa_id, criado_em, updated_at'

/** Sessão WhatsApp corrente (a mais recente). Faz polling para refletir
 *  QR/status atualizados pelo agente em ~3s. */
export function useSessao(): ReturnType<typeof useQuery<WhatsAppSessao | null>> {
  return useQuery({
    queryKey: ['whatsapp', 'sessao'],
    queryFn: async (): Promise<WhatsAppSessao | null> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('whatsapp_sessao')
        .select(SESSAO_COLS)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as WhatsAppSessao | null
    },
    refetchInterval: 3000
  })
}

/** Cria (se necessário) e solicita conexão: status='aguardando_qr'. O agente
 *  detecta e gera o QR (ou reconecta usando creds salvas). */
export function useConectarSessao(): ReturnType<
  typeof useMutation<{ id: string }, Error, { nome?: string; empresaId: string | null }>
> {
  const qc = useQueryClient()
  const profileId = useAuthStore((s) => s.profile?.id ?? null)
  return useMutation({
    mutationFn: async ({ nome, empresaId }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data: existente } = await supabase
        .from('whatsapp_sessao')
        .select('id')
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existente) {
        const { error } = await supabase
          .from('whatsapp_sessao')
          .update({ status: 'aguardando_qr', ultimo_erro: null })
          .eq('id', existente.id)
        if (error) throw error
        return { id: existente.id as string }
      }

      const { data, error } = await supabase
        .from('whatsapp_sessao')
        .insert({
          nome: nome?.trim() || 'Sessão WhatsApp',
          status: 'aguardando_qr',
          empresa_id: empresaId,
          criado_por: profileId
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['whatsapp', 'sessao'] })
  })
}

/** Desconecta: status='desconectado' (o agente faz logout e limpa creds). */
export function useDesconectarSessao(): ReturnType<
  typeof useMutation<void, Error, { id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('whatsapp_sessao')
        .update({ status: 'desconectado' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['whatsapp', 'sessao'] })
  })
}

const GRUPO_COLS =
  'id, sessao_id, wa_group_jid, nome, monitorar, obra_id, participantes, visto_em, criado_em'

export function useGrupos(
  sessaoId: string | null | undefined
): ReturnType<typeof useQuery<WhatsAppGrupo[]>> {
  return useQuery({
    queryKey: ['whatsapp', 'grupos', sessaoId],
    enabled: !!sessaoId,
    queryFn: async (): Promise<WhatsAppGrupo[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('whatsapp_grupo')
        .select(GRUPO_COLS)
        .eq('sessao_id', sessaoId!)
        .order('nome', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as WhatsAppGrupo[]
    },
    refetchInterval: 10000
  })
}

/** Atualiza monitoramento e/ou obra vinculada de um grupo. */
export function useAtualizarGrupo(): ReturnType<
  typeof useMutation<void, Error, { id: string; monitorar?: boolean; obra_id?: string | null }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('whatsapp_grupo').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['whatsapp', 'grupos'] })
  })
}

const JOB_COLS =
  'id, grupo_id, tipo, status, params, progresso, erro, criado_em, iniciado_em, concluido_em'

export function useJobs(grupoIds: string[]): ReturnType<typeof useQuery<WhatsAppJob[]>> {
  return useQuery({
    queryKey: ['whatsapp', 'jobs', grupoIds],
    enabled: grupoIds.length > 0,
    queryFn: async (): Promise<WhatsAppJob[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('whatsapp_job')
        .select(JOB_COLS)
        .in('grupo_id', grupoIds)
        .order('criado_em', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as unknown as WhatsAppJob[]
    },
    refetchInterval: 4000
  })
}

export function useCriarBackfill(): ReturnType<
  typeof useMutation<{ id: string }, Error, { grupo_id: string; limite?: number }>
> {
  const qc = useQueryClient()
  const profileId = useAuthStore((s) => s.profile?.id ?? null)
  return useMutation({
    mutationFn: async ({ grupo_id, limite }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('whatsapp_job')
        .insert({
          grupo_id,
          tipo: 'backfill',
          status: 'pendente',
          params: { limite: limite ?? 500 },
          criado_por: profileId
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['whatsapp', 'jobs'] })
  })
}

const LOG_COLS =
  'id, grupo_id, wa_message_id, remetente, decisao, foto_id, ai_resultado, erro, processado_em'

export function useLog(grupoIds: string[]): ReturnType<typeof useQuery<WhatsAppMensagemLog[]>> {
  return useQuery({
    queryKey: ['whatsapp', 'log', grupoIds],
    enabled: grupoIds.length > 0,
    queryFn: async (): Promise<WhatsAppMensagemLog[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('whatsapp_mensagem_log')
        .select(LOG_COLS)
        .in('grupo_id', grupoIds)
        .order('processado_em', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data ?? []) as unknown as WhatsAppMensagemLog[]
    },
    refetchInterval: 5000
  })
}

// ─── Oráculo ─────────────────────────────────────────────────────────────

const ORACULO_ACESSO_COLS =
  'id, user_id, empresa_id, ativo, criado_por, criado_em, updated_at, usuario:user_id(id, nome, email, role, whatsapp, ativo)'

/** Usuários habilitados a usar o Oráculo (RLS: god tudo, adm sua empresa). */
export function useOraculoAcessos(): ReturnType<typeof useQuery<WhatsAppOraculoAcesso[]>> {
  return useQuery({
    queryKey: ['whatsapp', 'oraculo-acessos'],
    queryFn: async (): Promise<WhatsAppOraculoAcesso[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('whatsapp_oraculo_acesso')
        .select(ORACULO_ACESSO_COLS)
        .order('criado_em', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as WhatsAppOraculoAcesso[]
    },
    refetchInterval: 15000
  })
}

/** Habilita o Oráculo para um ou mais usuários (upsert por user_id). */
export function useHabilitarOraculo(): ReturnType<
  typeof useMutation<void, Error, Array<{ user_id: string; empresa_id: string | null }>>
> {
  const qc = useQueryClient()
  const profileId = useAuthStore((s) => s.profile?.id ?? null)
  return useMutation({
    mutationFn: async (usuarios) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const rows = usuarios.map((u) => ({
        user_id: u.user_id,
        empresa_id: u.empresa_id,
        ativo: true,
        criado_por: profileId
      }))
      const { error } = await supabase
        .from('whatsapp_oraculo_acesso')
        .upsert(rows, { onConflict: 'user_id' })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['whatsapp', 'oraculo-acessos'] })
  })
}

/** Liga/desliga o acesso de um usuário (sem remover o registro). */
export function useAtualizarOraculoAcesso(): ReturnType<
  typeof useMutation<void, Error, { id: string; ativo: boolean }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ativo }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('whatsapp_oraculo_acesso')
        .update({ ativo })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['whatsapp', 'oraculo-acessos'] })
  })
}

/** Remove a habilitação de um usuário. */
export function useRemoverOraculoAcesso(): ReturnType<
  typeof useMutation<void, Error, { id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('whatsapp_oraculo_acesso').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['whatsapp', 'oraculo-acessos'] })
  })
}

/** Conversas ativas do Oráculo (read-only; agente gerencia). */
export function useOraculoConversas(): ReturnType<typeof useQuery<WhatsAppOraculoConversa[]>> {
  return useQuery({
    queryKey: ['whatsapp', 'oraculo-conversas'],
    queryFn: async (): Promise<WhatsAppOraculoConversa[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('whatsapp_oraculo_conversa')
        .select('id, sessao_id, remetente_jid, user_id, obra_id, estado, ultima_interacao, criado_em')
        .order('ultima_interacao', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as unknown as WhatsAppOraculoConversa[]
    },
    refetchInterval: 15000
  })
}

/** Últimas perguntas respondidas pelo Oráculo (auditoria). */
export function useOraculoLog(): ReturnType<typeof useQuery<WhatsAppOraculoLog[]>> {
  return useQuery({
    queryKey: ['whatsapp', 'oraculo-log'],
    queryFn: async (): Promise<WhatsAppOraculoLog[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('whatsapp_oraculo_log')
        .select('id, conversa_id, user_id, obra_id, pergunta, resposta, tools, erro, criado_em')
        .order('criado_em', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as unknown as WhatsAppOraculoLog[]
    },
    refetchInterval: 15000
  })
}
