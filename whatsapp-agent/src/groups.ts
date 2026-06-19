// Descoberta de grupos e leitura da config de monitoramento.

import type { Session } from './session.js'
import { supabase } from './supabase.js'
import { logger } from './logger.js'

export interface GrupoMonitorado {
  grupoId: string
  obraId: string
}

/** Busca todos os grupos de que a sessão participa e faz upsert na tabela.
 *  Preserva `monitorar`/`obra_id` (config do usuário) ao só atualizar metadados.
 *  Retorna true se a listagem foi obtida com sucesso (para controlar retries). */
export async function descobrirGrupos(session: Session): Promise<boolean> {
  const sock = session.socket
  if (!sock) return false
  let grupos: Record<string, { subject?: string; participants?: unknown[] }>
  try {
    grupos = await sock.groupFetchAllParticipating()
  } catch (e) {
    logger.warn({ err: e }, 'falha ao listar grupos')
    return false
  }
  const agora = new Date().toISOString()
  const rows = Object.entries(grupos).map(([jid, meta]) => ({
    sessao_id: session.sessaoId,
    wa_group_jid: jid,
    nome: meta.subject ?? jid,
    participantes: meta.participants?.length ?? null,
    visto_em: agora
  }))
  if (rows.length === 0) {
    logger.info('nenhum grupo retornado pela listagem')
    return true
  }
  const { error } = await supabase
    .from('whatsapp_grupo')
    .upsert(rows, { onConflict: 'sessao_id,wa_group_jid' })
  if (error) {
    logger.error({ error }, 'falha ao upsertar grupos')
    return false
  }
  logger.info({ total: rows.length }, 'grupos sincronizados')
  return true
}

/** Mapa jid → {grupoId, obraId} dos grupos marcados para monitorar. */
export async function getMonitorados(sessaoId: string): Promise<Map<string, GrupoMonitorado>> {
  const { data } = await supabase
    .from('whatsapp_grupo')
    .select('id, wa_group_jid, obra_id')
    .eq('sessao_id', sessaoId)
    .eq('monitorar', true)
    .not('obra_id', 'is', null)

  const map = new Map<string, GrupoMonitorado>()
  for (const g of data ?? []) {
    map.set(g.wa_group_jid as string, {
      grupoId: g.id as string,
      obraId: g.obra_id as string
    })
  }
  return map
}
