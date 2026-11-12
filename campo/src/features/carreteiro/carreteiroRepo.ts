import { db } from '@/core/db/dexie'
import { sessionStore } from '@/core/auth/SessionStore'
import type { OutFicha } from '@/core/db/entities'
import { pushFichaOutbox, type PushSummary } from '@/core/sync/fichaSync'
import { triggerForegroundSync } from '@/core/sync/foregroundSync'
import type { FichaEmEdicao } from './carreteiroStore'

/**
 * Grava a ficha na fila (upsert pelo id — corrigir e regravar uma ficha recusada atualiza, não duplica), remove o
 * rascunho e tenta enviar.
 */
export async function salvarFicha(f: FichaEmEdicao): Promise<{ pushResult: PushSummary | null }> {
  if (!f.viagens.length) throw new Error('A ficha não tem viagens')
  const user = sessionStore.current()
  if (!user) throw new Error('Sem sessão de usuário')
  const out: OutFicha = {
    ...f,
    viagens: f.viagens.slice(),
    capturedAt: new Date().toISOString(),
    cadastradorNome: user.userNome,
    syncStatus: 'PENDING',
    failureReason: null,
  }
  await db.transaction('rw', db.out_ficha, db.draft_ficha, async () => {
    // a versão do último envio aceito acompanha a correção (o servidor confere que ninguém mudou a ficha depois)
    const atual = await db.out_ficha.get(f.id)
    await db.out_ficha.put({ ...out, versaoServidor: atual?.versaoServidor ?? null })
    await db.draft_ficha.delete(f.id)
  })
  let pushResult: PushSummary | null = null
  try {
    pushResult = await pushFichaOutbox()
  } catch (e) {
    console.warn('[carreteiroRepo] envio falhou; fica na fila:', e)
  }
  void triggerForegroundSync('post-save-ficha', { ignoreCooldown: true })
  return { pushResult }
}

/** Exclui uma ficha: se ainda não foi ao servidor, sai da fila; se já foi, vira exclusão no próximo envio. */
export async function excluirFicha(id: string): Promise<void> {
  const f = await db.out_ficha.get(id)
  if (!f) return
  if (f.syncStatus === 'SYNCED' || f.syncStatus === 'SYNCING') {
    await db.out_ficha.update(id, { excluir: true, syncStatus: 'PENDING' })
    void triggerForegroundSync('excluir-ficha', { ignoreCooldown: true })
  } else {
    await db.out_ficha.delete(id)
  }
}
