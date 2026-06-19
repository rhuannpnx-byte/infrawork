// Orquestrador do agente. Reconcilia a sessão desejada (linha em
// whatsapp_sessao), processa fotos ao vivo, descobre grupos e roda backfills.

import type { WASocket, WAMessage } from '@whiskeysockets/baileys'
import { config } from './config.js'
import { logger } from './logger.js'
import { supabase } from './supabase.js'
import { Session } from './session.js'
import { descobrirGrupos, getMonitorados, type GrupoMonitorado } from './groups.js'
import { processarMensagem } from './listener.js'
import { BackfillManager, type Anchor } from './backfill.js'
import { atenderDM, extrairTexto } from './oraculo/index.js'
import { processarSaidas } from './oraculo/saida.js'

let current: Session | null = null
let backfill: BackfillManager | null = null
let monitorados = new Map<string, GrupoMonitorado>()
let ultimaDescoberta = 0
let conectado = false

// Âncora (mensagem mais recente vista) por grupo — necessária para o backfill
// pedir histórico via fetchMessageHistory. Persistida no DB para grupos
// monitorados (sobrevive a reinícios).
const anchors = new Map<string, Anchor>()

function getSock(): WASocket | null {
  return current?.socket ?? null
}

/** Registra a mensagem mais recente de um grupo como âncora. Para grupos
 *  monitorados, persiste em whatsapp_grupo.ultima_msg. */
function recordAnchor(jid: string, msg: WAMessage): void {
  const ts = Number(msg.messageTimestamp ?? 0)
  if (!ts || !msg.key?.id) return
  const prev = anchors.get(jid)
  if (prev && prev.ts >= ts) return
  anchors.set(jid, {
    key: { remoteJid: jid, id: msg.key.id, fromMe: !!msg.key.fromMe },
    ts
  })
  const mon = monitorados.get(jid)
  logger.debug({ jid, ts, monitorado: !!mon }, 'âncora registrada')
  if (mon) {
    void supabase
      .from('whatsapp_grupo')
      .update({ ultima_msg: { id: msg.key.id, fromMe: !!msg.key.fromMe, ts } })
      .eq('id', mon.grupoId)
  }
}

async function sincronizarGrupos(): Promise<void> {
  if (!current) return
  const ok = await descobrirGrupos(current)
  if (ok) {
    ultimaDescoberta = Date.now()
    monitorados = await getMonitorados(current.sessaoId)
  }
}

function attach(sessaoId: string) {
  backfill = new BackfillManager(sessaoId, getSock, (jid) => anchors.get(jid))
  return (sock: WASocket): void => {
    // Descobre os grupos assim que a conexão abre (com um respiro para
    // estabilizar) — groupFetchAllParticipating falha se chamado cedo demais.
    sock.ev.on('connection.update', (u) => {
      if (u.connection === 'open') {
        conectado = true
        setTimeout(() => void loopSeguro(sincronizarGrupos, 'descoberta-on-open'), 5000)
      } else if (u.connection === 'close') {
        conectado = false
      }
    })

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      logger.debug(
        { type, n: messages.length, jids: messages.map((m) => m.key.remoteJid).slice(0, 5) },
        'messages.upsert'
      )
      for (const msg of messages) {
        const jid = msg.key.remoteJid
        if (!jid) continue

        // ── DM (privado) → Oráculo: só mensagens novas, de texto, não nossas ──
        if (!jid.endsWith('@g.us')) {
          // Loga qualquer mensagem não-grupo recebida (revela @s.whatsapp.net vs @lid).
          if (type === 'notify' && !msg.key.fromMe) {
            const texto = extrairTexto(msg)
            const senderPn = msg.key.senderPn ?? null
            logger.info({ jid, senderPn, type, temTexto: !!texto }, 'mensagem privada recebida')
            if (texto) {
              try {
                await atenderDM(sock, sessaoId, jid, texto, senderPn, msg.key)
              } catch (e) {
                logger.error({ err: e }, 'erro no atendimento do oráculo')
              }
            }
          }
          continue
        }
        // Âncora capturada de qualquer evento (notify=ao vivo, append=carga de
        // mensagens já existentes) — habilita o backfill desse grupo.
        recordAnchor(jid, msg)
        // Ingestão ao vivo só para mensagens novas de grupos monitorados.
        if (type !== 'notify') continue
        const mon = monitorados.get(jid)
        if (!mon) continue
        try {
          await processarMensagem(sock, mon, msg)
        } catch (e) {
          logger.error({ err: e }, 'erro no processamento ao vivo')
        }
      }
    })

    sock.ev.on('messaging-history.set', async ({ messages }) => {
      try {
        // Captura âncoras (mensagens vêm em ordem reversa: a 1ª por grupo é a
        // mais recente, então recordAnchor só grava a newest).
        for (const msg of messages) {
          const jid = msg.key.remoteJid
          if (jid && jid.endsWith('@g.us')) recordAnchor(jid, msg)
        }
        await backfill?.onHistory(messages)
      } catch (e) {
        logger.error({ err: e }, 'erro no histórico (backfill)')
      }
    })
  }
}

async function getSessaoAlvo(): Promise<{ id: string; status: string } | null> {
  const { data } = await supabase
    .from('whatsapp_sessao')
    .select('id, status')
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? { id: data.id as string, status: data.status as string } : null
}

async function reconcile(): Promise<void> {
  const alvo = await getSessaoAlvo()

  if (!alvo) {
    if (current) {
      current.closeQuiet()
      current = null
    }
    return
  }

  if (alvo.status === 'desconectado') {
    // Só faz logout (limpa creds) se havia uma sessão ativa para esse id —
    // significa que o usuário clicou em "Desconectar" no app.
    if (current && current.sessaoId === alvo.id) {
      await current.stop()
      current = null
    }
    return
  }

  // status conectado | aguardando_qr | erro ⇒ deve estar rodando
  if (!current || current.sessaoId !== alvo.id) {
    if (current) current.closeQuiet()
    current = new Session(alvo.id, attach(alvo.id))
    await current.start()
    logger.info({ sessaoId: alvo.id }, 'sessão iniciada pelo reconcile')
  }

  // atualiza grupos monitorados
  monitorados = await getMonitorados(alvo.id)

  // descoberta periódica de grupos (só quando conectado; só conta sucesso)
  if (conectado && Date.now() - ultimaDescoberta > config.discoverGroupsMs) {
    await sincronizarGrupos()
  }
}

async function tickBackfill(): Promise<void> {
  if (!backfill || !getSock()) return
  try {
    await backfill.claimPending()
    await backfill.sweep()
  } catch (e) {
    logger.error({ err: e }, 'erro no tick de backfill')
  }
}

async function tickSaidas(): Promise<void> {
  const sock = getSock()
  if (!sock || !conectado) return
  await processarSaidas(sock)
}

async function loopSeguro(fn: () => Promise<void>, label: string): Promise<void> {
  try {
    await fn()
  } catch (e) {
    logger.error({ err: e, label }, 'erro no loop')
  }
}

async function main(): Promise<void> {
  logger.info('InfraWork WhatsApp Agent iniciando…')
  // primeira reconciliação imediata
  await loopSeguro(reconcile, 'reconcile')

  setInterval(() => void loopSeguro(reconcile, 'reconcile'), config.pollConfigMs)
  setInterval(() => void loopSeguro(tickBackfill, 'backfill'), 5000)
  setInterval(() => void loopSeguro(tickSaidas, 'saidas'), 4000)

  const encerrar = (): void => {
    logger.info('encerrando… (status preservado para reconexão)')
    if (current) current.closeQuiet()
    process.exit(0)
  }
  process.on('SIGINT', encerrar)
  process.on('SIGTERM', encerrar)
}

void main()
