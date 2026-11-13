import type { SyncStatus } from '@/core/db/entities'

/**
 * Situação de envio de um lançamento, ficha ou foto: o ÚNICO lugar com os rótulos e o tom de cada estado. As listas
 * de produção, viagens e fotos e a tela de ficha gravada usam o `SeloEnvio` (SyncStatusIndicator.tsx), que lê daqui.
 */
export type TomEnvio = 'ok' | 'warn' | 'bad' | 'info'

export const ROTULO_ENVIO: Record<SyncStatus, { rotulo: string; tom: TomEnvio }> = {
  SYNCED: { rotulo: 'Enviado', tom: 'ok' },
  PENDING: { rotulo: 'Aguardando rede', tom: 'warn' },
  SYNCING: { rotulo: 'Enviando…', tom: 'info' },
  FAILED: { rotulo: 'Erro ao enviar', tom: 'bad' },
  REJEITADA: { rotulo: 'Recusado', tom: 'bad' },
}

export const TOM_ENVIO: Record<TomEnvio, { selo: string; texto: string; ponto: string }> = {
  ok: { selo: 'bg-ok/15 text-ok', texto: 'text-ok', ponto: 'bg-ok' },
  warn: { selo: 'bg-warn/15 text-warn', texto: 'text-warn', ponto: 'bg-warn' },
  bad: { selo: 'bg-bad/15 text-bad', texto: 'text-bad', ponto: 'bg-bad' },
  info: { selo: 'bg-info/15 text-info', texto: 'text-info', ponto: 'bg-info' },
}

/** Estado da fila inteira (indicador do cabeçalho), com as mesmas palavras dos selos. */
export function rotuloFila(s: {
  online: boolean
  syncing: boolean
  outboxPending: number
  recusados?: number
}): string {
  const n = s.outboxPending
  const r = s.recusados ?? 0
  if (s.syncing) return ROTULO_ENVIO.SYNCING.rotulo
  const partes = [
    n > 0 ? `${n} ${ROTULO_ENVIO.PENDING.rotulo.toLowerCase()}` : null,
    r > 0 ? `${r} ${r === 1 ? 'recusado' : 'recusados'}` : null,
  ].filter(Boolean)
  if (partes.length) return partes.join(', ')
  return s.online ? 'Tudo enviado' : 'Sem rede'
}
