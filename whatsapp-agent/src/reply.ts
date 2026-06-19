// Envio de mensagens de volta ao WhatsApp (texto e imagem). Antes do Oráculo o
// agente era só receptor; aqui centralizamos o sock.sendMessage.
//
// Comportamento "humano" para reduzir detecção de bot pelo WhatsApp:
//   - marca a mensagem recebida como lida;
//   - envia presença "digitando" e espera um intervalo proporcional ao texto
//     antes de responder; depois "pausado".
//   - pequena espera entre imagens.

import type { WASocket, WAMessageKey } from '@whiskeysockets/baileys'
import { logger } from './logger.js'

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Pausa "humana" antes de responder: base + proporcional ao tamanho + jitter. */
function pausaDigitando(tamTexto: number): number {
  const base = 900 + Math.min(tamTexto * 25, 4000)
  return base + Math.floor(Math.random() * 700)
}

export async function marcarLido(sock: WASocket, key: WAMessageKey): Promise<void> {
  try {
    await sock.readMessages([key])
  } catch {
    /* ignora */
  }
}

export async function enviarTexto(sock: WASocket, jid: string, texto: string): Promise<void> {
  try {
    await sock.sendPresenceUpdate('composing', jid).catch(() => undefined)
    await delay(pausaDigitando(texto.length))
    await sock.sendMessage(jid, { text: texto })
    await sock.sendPresenceUpdate('paused', jid).catch(() => undefined)
  } catch (e) {
    logger.error({ err: e, jid }, 'falha ao enviar texto')
  }
}

export async function enviarImagem(
  sock: WASocket,
  jid: string,
  imagem: Buffer,
  caption?: string
): Promise<void> {
  try {
    await sock.sendPresenceUpdate('composing', jid).catch(() => undefined)
    await delay(700 + Math.floor(Math.random() * 600))
    await sock.sendMessage(jid, { image: imagem, caption })
    await sock.sendPresenceUpdate('paused', jid).catch(() => undefined)
  } catch (e) {
    logger.error({ err: e, jid }, 'falha ao enviar imagem')
  }
}
