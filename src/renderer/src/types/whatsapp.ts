// Tipos do módulo de Monitoramento WhatsApp (espelham as tabelas whatsapp_*).

export type WhatsAppSessaoStatus = 'desconectado' | 'aguardando_qr' | 'conectado' | 'erro'

export interface WhatsAppSessao {
  id: string
  nome: string
  status: WhatsAppSessaoStatus
  qr_code: string | null
  phone: string | null
  last_seen: string | null
  ultimo_erro: string | null
  empresa_id: string | null
  criado_em: string
  updated_at: string
}

export interface WhatsAppGrupo {
  id: string
  sessao_id: string
  wa_group_jid: string
  nome: string | null
  monitorar: boolean
  obra_id: string | null
  participantes: number | null
  visto_em: string | null
  criado_em: string
}

export type WhatsAppJobStatus = 'pendente' | 'rodando' | 'concluido' | 'erro'

export interface WhatsAppJobProgresso {
  processadas?: number
  subidas?: number
  ignoradas?: number
}

export interface WhatsAppJob {
  id: string
  grupo_id: string
  tipo: 'backfill'
  status: WhatsAppJobStatus
  params: { limite?: number; desde?: string; ate?: string } | null
  progresso: WhatsAppJobProgresso | null
  erro: string | null
  criado_em: string
  iniciado_em: string | null
  concluido_em: string | null
}

export type WhatsAppDecisao = 'subida' | 'sem_geo' | 'nao_servico' | 'erro' | 'duplicada'

export interface WhatsAppMensagemLog {
  id: string
  grupo_id: string
  wa_message_id: string
  remetente: string | null
  decisao: WhatsAppDecisao
  foto_id: string | null
  ai_resultado: Record<string, unknown> | null
  erro: string | null
  processado_em: string
}

// ─── Oráculo (RAG via DM) ───────────────────────────────────────────────────

/** Usuário habilitado a usar o Oráculo (join opcional com profile). */
export interface WhatsAppOraculoAcesso {
  id: string
  user_id: string
  empresa_id: string | null
  ativo: boolean
  criado_por: string | null
  criado_em: string
  updated_at: string
  usuario?: {
    id: string
    nome: string
    email: string
    role: string
    whatsapp: string | null
    ativo: boolean
  } | null
}

export type WhatsAppOraculoEstado = 'triagem' | 'ativa'

export interface WhatsAppOraculoConversa {
  id: string
  sessao_id: string
  remetente_jid: string
  user_id: string | null
  obra_id: string | null
  estado: WhatsAppOraculoEstado
  ultima_interacao: string
  criado_em: string
}

export interface WhatsAppOraculoLog {
  id: string
  conversa_id: string | null
  user_id: string | null
  obra_id: string | null
  pergunta: string | null
  resposta: string | null
  tools: string[] | null
  erro: string | null
  criado_em: string
}
