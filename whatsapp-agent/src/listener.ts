// Extrai imagens de mensagens de grupos monitorados e dispara o pipeline de
// ingestão. Usado tanto ao vivo (messages.upsert) quanto no backfill
// (mensagens vindas do histórico).

import { downloadMediaMessage, type WAMessage, type WASocket } from '@whiskeysockets/baileys'
import type { GrupoMonitorado } from './groups.js'
import { processarImagem, type Decisao } from './ingest.js'
import { logger } from './logger.js'

function extrairImagem(msg: WAMessage): { mime: string } | null {
  const img = msg.message?.imageMessage
  if (img) return { mime: img.mimetype ?? 'image/jpeg' }
  // imagem enviada como documento (preserva EXIF) — também aceitamos
  const doc = msg.message?.documentMessage
  if (doc && (doc.mimetype ?? '').startsWith('image/')) return { mime: doc.mimetype as string }
  return null
}

export async function processarMensagem(
  sock: WASocket,
  mon: GrupoMonitorado,
  msg: WAMessage
): Promise<Decisao | null> {
  const img = extrairImagem(msg)
  if (!img) return null
  const waMessageId = msg.key.id
  if (!waMessageId) return null

  let buffer: Buffer
  try {
    buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger: logger.child({ mod: 'download' }), reuploadRequest: sock.updateMediaMessage }
    )) as Buffer
  } catch (e) {
    logger.warn({ err: e, waMessageId }, 'falha ao baixar mídia (pode ter expirado)')
    return null
  }

  const tsSec = Number(msg.messageTimestamp ?? 0)
  return processarImagem({
    grupoId: mon.grupoId,
    obraId: mon.obraId,
    waMessageId,
    remetente: msg.key.participant ?? msg.key.remoteJid ?? null,
    imagem: buffer,
    mime: img.mime,
    timestampMsg: tsSec ? new Date(tsSec * 1000) : new Date()
  })
}
