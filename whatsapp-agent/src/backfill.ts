// Backfill do histórico de grupos. Consome a fila `whatsapp_job` e processa as
// imagens que chegam pelo sync de histórico do WhatsApp (messaging-history.set),
// além de solicitar mais histórico sob demanda quando possível.
//
// ⚠️ Limitação real do WhatsApp: o histórico disponível é limitado e a mídia de
// mensagens antigas pode já ter expirado (não baixável). O backfill cobre o que
// o dispositivo conseguir sincronizar — por isso o progresso é "best effort".

import type { WAMessage, WASocket, WAMessageKey } from '@whiskeysockets/baileys'
import { supabase } from './supabase.js'
import { logger } from './logger.js'
import { getMonitorados, type GrupoMonitorado } from './groups.js'
import { processarMensagem } from './listener.js'

export interface Anchor {
  key: WAMessageKey
  ts: number
}

interface JobAtivo {
  jobId: string
  jid: string
  mon: GrupoMonitorado
  limite: number
  processadas: number
  subidas: number
  ignoradas: number
  ultimaAtividade: number
  ultimoFetch: number
  ancora?: Anchor
}

const IDLE_MS = 30_000 // sem novas mensagens por 30s ⇒ conclui o job
const FETCH_THROTTLE_MS = 8_000 // intervalo mínimo entre pedidos de histórico

/** Reconstrói uma âncora a partir do campo whatsapp_grupo.ultima_msg. */
function anchorFromDb(jid: string, ultimaMsg: unknown): Anchor | undefined {
  const m = ultimaMsg as { id?: string; fromMe?: boolean; ts?: number } | null
  if (!m?.id || !m.ts) return undefined
  return { key: { remoteJid: jid, id: m.id, fromMe: !!m.fromMe }, ts: Number(m.ts) }
}

export class BackfillManager {
  private ativos = new Map<string, JobAtivo>() // jid → job
  private getSock: () => WASocket | null
  private getAnchor: (jid: string) => Anchor | undefined
  private sessaoId: string

  constructor(
    sessaoId: string,
    getSock: () => WASocket | null,
    getAnchor: (jid: string) => Anchor | undefined
  ) {
    this.sessaoId = sessaoId
    this.getSock = getSock
    this.getAnchor = getAnchor
  }

  /** Reivindica jobs pendentes e os marca rodando. */
  async claimPending(): Promise<void> {
    const sock = this.getSock()
    if (!sock) return
    const { data: jobs } = await supabase
      .from('whatsapp_job')
      .select(
        'id, grupo_id, params, whatsapp_grupo!inner(wa_group_jid, obra_id, monitorar, ultima_msg)'
      )
      .eq('status', 'pendente')
      .eq('tipo', 'backfill')
      .order('criado_em', { ascending: true })
      .limit(5)

    for (const j of jobs ?? []) {
      const grupo = (
        j as unknown as {
          whatsapp_grupo: { wa_group_jid: string; obra_id: string | null; ultima_msg: unknown }
        }
      ).whatsapp_grupo
      if (!grupo?.obra_id) {
        await this.finalizar(j.id as string, 'erro', 'Grupo sem obra vinculada', null)
        continue
      }
      const jid = grupo.wa_group_jid

      // Âncora: memória (mais recente em runtime) ou DB (última mensagem persistida).
      const ancora = this.getAnchor(jid) ?? anchorFromDb(jid, grupo.ultima_msg)
      if (!ancora) {
        await this.finalizar(
          j.id as string,
          'erro',
          'Sem mensagem de referência ainda. Envie/aguarde uma mensagem nova no grupo e tente novamente.',
          null
        )
        continue
      }

      const limite = Number((j.params as { limite?: number } | null)?.limite ?? 500)
      this.ativos.set(jid, {
        jobId: j.id as string,
        jid,
        mon: { grupoId: j.grupo_id as string, obraId: grupo.obra_id },
        limite,
        processadas: 0,
        subidas: 0,
        ignoradas: 0,
        ultimaAtividade: Date.now(),
        ultimoFetch: 0,
        ancora
      })
      await supabase
        .from('whatsapp_job')
        .update({ status: 'rodando', iniciado_em: new Date().toISOString() })
        .eq('id', j.id)
      logger.info({ jobId: j.id, jid, limite }, 'backfill iniciado')

      // Solicita o primeiro lote de histórico (a partir da âncora).
      void this.pedirMaisHistorico(jid)
    }
  }

  /** Alimentado pelo evento messaging-history.set. */
  async onHistory(messages: WAMessage[]): Promise<void> {
    const sock = this.getSock()
    if (!sock || this.ativos.size === 0) return
    for (const msg of messages) {
      const jid = msg.key.remoteJid
      if (!jid) continue
      const job = this.ativos.get(jid)
      if (!job) continue

      // mantém a âncora (mensagem mais antiga vista) para paginar
      const ts = Number(msg.messageTimestamp ?? 0)
      if (!job.ancora || ts < job.ancora.ts) job.ancora = { key: msg.key, ts }

      if (job.processadas >= job.limite) continue
      const decisao = await processarMensagem(sock, job.mon, msg)
      if (decisao !== null) {
        job.processadas++
        if (decisao === 'subida') job.subidas++
        else job.ignoradas++
        job.ultimaAtividade = Date.now()
        if (job.processadas % 10 === 0) await this.gravarProgresso(job)
      }
    }
  }

  private async pedirMaisHistorico(jid: string): Promise<void> {
    const sock = this.getSock()
    const job = this.ativos.get(jid)
    if (!sock || !job || !job.ancora) return
    if (typeof sock.fetchMessageHistory !== 'function') return
    const agora = Date.now()
    if (agora - job.ultimoFetch < FETCH_THROTTLE_MS) return
    job.ultimoFetch = agora
    try {
      const restante = Math.max(1, job.limite - job.processadas)
      await sock.fetchMessageHistory(Math.min(50, restante), job.ancora.key, job.ancora.ts)
      logger.debug({ jid, ancora: job.ancora.ts }, 'histórico solicitado')
    } catch (e) {
      logger.warn({ err: e, jid }, 'falha ao solicitar histórico')
    }
  }

  /** Conclui jobs ociosos ou que atingiram o limite. */
  async sweep(): Promise<void> {
    const agora = Date.now()
    for (const [jid, job] of this.ativos) {
      const ocioso = agora - job.ultimaAtividade > IDLE_MS
      const cheio = job.processadas >= job.limite
      if (ocioso || cheio) {
        await this.finalizar(job.jobId, 'concluido', null, job)
        this.ativos.delete(jid)
        logger.info(
          { jobId: job.jobId, processadas: job.processadas, subidas: job.subidas },
          'backfill concluído'
        )
      } else {
        // ainda ativo: tenta puxar mais histórico
        void this.pedirMaisHistorico(jid)
      }
    }
  }

  private async gravarProgresso(job: JobAtivo): Promise<void> {
    await supabase
      .from('whatsapp_job')
      .update({
        progresso: {
          processadas: job.processadas,
          subidas: job.subidas,
          ignoradas: job.ignoradas
        }
      })
      .eq('id', job.jobId)
  }

  private async finalizar(
    jobId: string,
    status: 'concluido' | 'erro',
    erro: string | null,
    job: JobAtivo | null
  ): Promise<void> {
    await supabase
      .from('whatsapp_job')
      .update({
        status,
        erro,
        concluido_em: new Date().toISOString(),
        progresso: job
          ? { processadas: job.processadas, subidas: job.subidas, ignoradas: job.ignoradas }
          : undefined
      })
      .eq('id', jobId)
  }
}

// re-export para o main usar o mesmo getMonitorados sem import duplicado
export { getMonitorados }
