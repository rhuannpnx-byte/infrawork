// Mensagens de SAÍDA do Oráculo (operador → usuário, enfileiradas pela plataforma
// em whatsapp_oraculo_saida). Envia pelo WhatsApp para o número do usuário e
// marca o status.

import type { WASocket } from '@whiskeysockets/baileys'
import { supabase } from '../supabase.js'
import { logger } from '../logger.js'
import { enviarTexto } from '../reply.js'

function soDigitos(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

/** Processa até 10 mensagens pendentes, enviando para o JID de telefone do usuário. */
export async function processarSaidas(sock: WASocket): Promise<void> {
  const { data } = await supabase
    .from('whatsapp_oraculo_saida')
    .select('id, texto, profiles:user_id(whatsapp, ativo)')
    .eq('status', 'pendente')
    .order('criado_em')
    .limit(10)

  for (const row of data ?? []) {
    const id = (row as { id: string }).id
    const texto = (row as { texto: string }).texto
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
    const jid = `${num}@s.whatsapp.net`
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
