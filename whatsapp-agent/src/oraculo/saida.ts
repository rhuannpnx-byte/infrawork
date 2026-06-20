// Mensagens de SAÍDA do Oráculo (operador → usuário, enfileiradas pela plataforma
// em whatsapp_oraculo_saida). Envia pelo WhatsApp para o usuário e marca o status.

import type { WASocket } from '@whiskeysockets/baileys'
import { supabase } from '../supabase.js'
import { logger } from '../logger.js'
import { enviarTexto } from '../reply.js'

function soDigitos(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

/**
 * Resolve para QUAL jid enviar ao usuário. Preferimos o `remetente_jid` da
 * conversa mais recente dele — é a identidade (possivelmente @lid) onde o
 * aparelho dele estabeleceu a sessão Signal. Enviar no PN quando a sessão vive
 * no @lid usa outra sessão e a mensagem chega como "versão anterior". Só caímos
 * no PN quando o usuário nunca iniciou uma conversa (não há sessão mesmo).
 */
async function resolverDestino(userId: string, num: string): Promise<string> {
  const { data } = await supabase
    .from('whatsapp_oraculo_conversa')
    .select('remetente_jid, ultima_interacao')
    .eq('user_id', userId)
    .order('ultima_interacao', { ascending: false })
    .limit(1)
    .maybeSingle()
  const jid = (data as { remetente_jid: string | null } | null)?.remetente_jid
  return jid && jid.trim().length > 0 ? jid : `${num}@s.whatsapp.net`
}

/** Processa até 10 mensagens pendentes, enviando para o usuário. */
export async function processarSaidas(sock: WASocket): Promise<void> {
  const { data } = await supabase
    .from('whatsapp_oraculo_saida')
    .select('id, texto, user_id, profiles:user_id(whatsapp, ativo)')
    .eq('status', 'pendente')
    .order('criado_em')
    .limit(10)

  for (const row of data ?? []) {
    const id = (row as { id: string }).id
    const texto = (row as { texto: string }).texto
    const userId = (row as { user_id: string }).user_id
    const p = (row as unknown as { profiles: { whatsapp: string | null; ativo: boolean } | null })
      .profiles
    const num = soDigitos(p?.whatsapp)
    if (!p?.ativo || !num) {
      await supabase
        .from('whatsapp_oraculo_saida')
        .update({ status: 'erro', erro: 'Usuário inativo ou sem WhatsApp' })
        .eq('id', id)
      continue
    }
    const jid = await resolverDestino(userId, num)
    try {
      await enviarTexto(sock, jid, texto)
      await supabase
        .from('whatsapp_oraculo_saida')
        .update({ status: 'enviado', enviado_em: new Date().toISOString(), erro: null })
        .eq('id', id)
      logger.info({ id, jid }, 'mensagem de saída enviada')
    } catch (e) {
      await supabase
        .from('whatsapp_oraculo_saida')
        .update({ status: 'erro', erro: String(e) })
        .eq('id', id)
      logger.error({ err: e, id }, 'falha ao enviar mensagem de saída')
    }
  }
}
