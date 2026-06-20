// Gerencia o ciclo de vida de UMA sessão Baileys: conexão, QR, reconexão e
// reflexo do status na tabela whatsapp_sessao. Repassa eventos de mensagem
// para o listener.

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import { useSupabaseAuthState, type SupabaseAuthState } from './authState.js'
import { supabase } from './supabase.js'
import { logger } from './logger.js'
import { config } from './config.js'

/** Hook chamado logo após o socket ser criado para o main registrar os
 *  listeners de mensagem (live) e de histórico (backfill). */
type AttachHandlers = (sock: WASocket) => void

export class Session {
  readonly sessaoId: string
  private sock: WASocket | null = null
  private parar = false
  private attach: AttachHandlers
  private tentativasReconexao = 0
  // Auth state carregado UMA vez e reusado entre reconexões. A memória é sempre
  // a fonte mais avançada do ratchet Signal; recarregar do banco a cada
  // reconexão rebobinaria a sessão e quebraria a decriptação (mensagens "de
  // versão anterior"). Só é descartado em logout (creds invalidadas).
  private auth: SupabaseAuthState | null = null

  constructor(sessaoId: string, attach: AttachHandlers) {
    this.sessaoId = sessaoId
    this.attach = attach
  }

  get socket(): WASocket | null {
    return this.sock
  }

  private async setStatus(patch: Record<string, unknown>): Promise<void> {
    await supabase.from('whatsapp_sessao').update(patch).eq('id', this.sessaoId)
  }

  async start(): Promise<void> {
    this.parar = false
    if (!this.auth) this.auth = await useSupabaseAuthState(this.sessaoId)
    const { state, saveCreds } = this.auth
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
      version,
      auth: state,
      logger: logger.child({ mod: 'baileys' }),
      markOnlineOnConnect: false,
      syncFullHistory: config.baileysSyncFullHistory
    })
    this.sock = sock

    sock.ev.on('creds.update', () => void saveCreds())
    this.attach(sock)

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update
      if (qr) {
        void this.setStatus({ status: 'aguardando_qr', qr_code: qr, ultimo_erro: null })
      }
      if (connection === 'open') {
        this.tentativasReconexao = 0 // conexão estável → zera o backoff
        const phone = sock.user?.id?.split(':')[0]?.split('@')[0] ?? null
        void (async () => {
          // Troca de conta: se o número conectado mudou, os grupos (e vínculos)
          // da conta anterior não valem mais — limpa para não exibir grupos antigos.
          if (phone) {
            const { data: prev } = await supabase
              .from('whatsapp_sessao')
              .select('phone')
              .eq('id', this.sessaoId)
              .maybeSingle()
            if (prev?.phone && prev.phone !== phone) {
              await supabase.from('whatsapp_grupo').delete().eq('sessao_id', this.sessaoId)
              logger.info({ de: prev.phone, para: phone }, 'conta trocada — grupos antigos removidos')
            }
          }
          await this.setStatus({
            status: 'conectado',
            qr_code: null,
            phone,
            last_seen: new Date().toISOString(),
            ultimo_erro: null
          })
          logger.info({ phone }, 'sessão conectada')
        })()
      }
      if (connection === 'close') {
        const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode
        const deslogado = code === DisconnectReason.loggedOut
        logger.warn({ code, deslogado }, 'conexão fechada')
        if (deslogado) {
          // sessão invalidada: limpa creds e marca desconectado (exige novo QR).
          // Descarta o auth em memória para o próximo start recarregar do zero.
          void this.setStatus({ status: 'desconectado', creds: null, qr_code: null })
          this.sock = null
          this.auth = null
        } else if (!this.parar) {
          // Backoff exponencial (5s → 60s) para não martelar a reconexão, o que
          // o WhatsApp interpreta como comportamento de bot.
          const espera = Math.min(5000 * 2 ** this.tentativasReconexao, 60_000)
          this.tentativasReconexao++
          void this.setStatus({ status: 'erro', ultimo_erro: String(lastDisconnect?.error) })
          logger.info({ espera, tentativa: this.tentativasReconexao }, 'reconectando com backoff')
          setTimeout(() => {
            if (!this.parar) void this.start()
          }, espera)
        }
      }
    })
  }

  /** Logout solicitado pelo usuário: encerra a sessão no WhatsApp, limpa as
   *  credenciais e marca desconectado. */
  async stop(): Promise<void> {
    this.parar = true
    try {
      if (this.sock) await this.sock.logout()
    } catch (e) {
      logger.warn({ err: e }, 'erro ao fazer logout')
    }
    this.sock = null
    this.auth = null
    await this.setStatus({ status: 'desconectado', creds: null, qr_code: null })
  }

  /** Fecha o socket localmente SEM alterar o status no banco. Usado no
   *  shutdown do processo (deploy/reboot): o estado desejado permanece
   *  'conectado' e o agente reconecta usando as credenciais salvas. */
  closeQuiet(): void {
    this.parar = true
    try {
      this.sock?.end(undefined)
    } catch (e) {
      logger.warn({ err: e }, 'erro ao fechar socket')
    }
    this.sock = null
  }
}
