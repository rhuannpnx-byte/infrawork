import { db } from '@/core/db/dexie'
import { sessionStore } from '@/core/auth/SessionStore'
import type { OutProducao } from '@/core/db/entities'
import type { ServicoDto } from '@/types/dtos'
import type { ApontamentoDraft, ProducaoSessionState } from './producaoStore'
import { pushProducaoOutbox, type PushSummary } from '@/core/sync/producaoSync'
import { triggerForegroundSync } from '@/core/sync/foregroundSync'

/**
 * Grava os apontamentos da sessão no outbox (upsert pelo id — reabrir e finalizar de novo atualiza, não duplica)
 * e tenta enviar na hora. Um apontamento já enviado e não alterado nesta sessão fica como está: reenviá-lo
 * sobrescreveria a correção feita no web (ou recriaria o que o engenheiro excluiu).
 */
export async function saveProducaoSession(
  session: ProducaoSessionState,
): Promise<{ savedCount: number; pushResult: PushSummary | null }> {
  if (session.obraId == null) throw new Error('Sessão de produção sem obra')
  if (session.itens.length === 0) throw new Error('Sessão sem apontamentos')
  const user = sessionStore.current()
  if (!user) throw new Error('Sem sessão de usuário')
  const capturedAt = new Date().toISOString()
  const novas = session.itens.map((d) => paraEntidade(d, session, user.userNome, capturedAt))
  const atuais = await db.out_producao.bulkGet(novas.map((e) => e.id))
  const entities = novas
    .map((e, i) => {
      const a = atuais[i]
      if (!a) return e
      if (a.syncStatus === 'SYNCED' && !mudou(a, e)) return null
      return { ...e, capturedAt: a.capturedAt }
    })
    .filter((e): e is OutProducao => e !== null)
  if (entities.length) await db.out_producao.bulkPut(entities)
  let pushResult: PushSummary | null = null
  try {
    pushResult = await pushProducaoOutbox()
  } catch (e) {
    console.warn('[producaoRepo] envio falhou; fica na fila:', e)
  }
  void triggerForegroundSync('post-save-producao', { ignoreCooldown: true })
  return { savedCount: entities.length, pushResult }
}

/** Itens de uma sessão (obra + dia + encarregado + equipe) de volta como rascunhos, mantendo os ids. */
export async function loadSessionItensAsDrafts(args: {
  obraId: string
  dt: string
  encarregadoId: string | null
  equipeId: string | null
}): Promise<ApontamentoDraft[]> {
  const rows = (
    await db.out_producao.where('[obraId+dt]').equals([args.obraId, args.dt]).toArray()
  ).filter(
    (r) =>
      !r.excluir &&
      (r.encarregadoId ?? null) === (args.encarregadoId ?? null) &&
      (r.equipeId ?? null) === (args.equipeId ?? null),
  )
  const cat = await db.cat_catalogo.get(args.obraId)
  const porId = new Map((cat?.servicos ?? []).map((s) => [s.id, s]))
  return rows.map((r) => ({
    id: r.id,
    servico: porId.get(r.servicoId) ?? servicoDoRegistro(r),
    qtd: r.quantidade,
    localId: r.localId,
    localNome: r.localNome,
    estacaInicial: r.estacaInicial ?? '',
    estacaFinal: r.estacaFinal ?? '',
    posicaoInicioM: r.posicaoInicioM,
    posicaoFimM: r.posicaoFimM,
    materialQtd: r.materialQtd,
    obs: r.obs,
    syncStatus: r.syncStatus,
    failureReason: r.failureReason ?? null,
  }))
}

/** O que muda o lançamento no servidor. */
function mudou(a: OutProducao, b: OutProducao): boolean {
  const k = (o: OutProducao): string =>
    JSON.stringify([
      o.dt,
      o.servicoId,
      o.quantidade,
      o.equipeId,
      o.encarregadoId,
      o.localId,
      o.estacaInicial,
      o.estacaFinal,
      o.posicaoInicioM,
      o.posicaoFimM,
      o.materialQtd,
      o.obs,
    ])
  return k(a) !== k(b)
}

/** Exclui um apontamento: se ainda não foi enviado sai da fila; se já foi, vai como exclusão no próximo envio. */
export async function excluirApontamento(id: string): Promise<void> {
  const r = await db.out_producao.get(id)
  if (!r) return
  if (r.syncStatus === 'SYNCED' || r.syncStatus === 'SYNCING') {
    await db.out_producao.update(id, { excluir: true, syncStatus: 'PENDING' })
    void triggerForegroundSync('excluir-producao', { ignoreCooldown: true })
  } else {
    await db.out_producao.delete(id)
  }
}

function servicoDoRegistro(r: OutProducao): ServicoDto {
  return {
    id: r.servicoId,
    codigo: r.servicoCodigo,
    descricao: r.servicoNome,
    unidade: r.unidade,
    modo_lancamento: 'quantidade',
    controla_material: r.materialNome != null,
    material: r.materialNome ? { id: '', nome: r.materialNome, unidade: r.materialUnidade } : null,
    material_obrigatorio: false,
    habilita_obs: true,
    exige_local: false,
  }
}

function paraEntidade(
  d: ApontamentoDraft,
  s: ProducaoSessionState,
  cadastradorNome: string,
  capturedAt: string,
): OutProducao {
  if (d.qtd == null) throw new Error(`Informe a quantidade de ${d.servico.descricao}`)
  return {
    id: d.id,
    obraId: s.obraId!,
    obraCodigo: s.obraCodigo,
    dt: s.dt,
    servicoId: d.servico.id,
    servicoCodigo: d.servico.codigo,
    servicoNome: d.servico.descricao,
    unidade: d.servico.unidade,
    quantidade: d.qtd,
    equipeId: s.equipeId,
    equipeNome: s.equipeNome,
    encarregadoId: s.encarregadoId,
    encarregadoNome: s.encarregadoNome,
    localId: d.localId,
    localNome: d.localNome,
    estacaInicial: d.estacaInicial.trim() || null,
    estacaFinal: d.estacaFinal.trim() || null,
    posicaoInicioM: d.posicaoInicioM,
    posicaoFimM: d.posicaoFimM,
    materialNome: d.servico.controla_material ? (d.servico.material?.nome ?? null) : null,
    materialUnidade: d.servico.controla_material ? (d.servico.material?.unidade ?? null) : null,
    materialQtd: d.servico.controla_material ? d.materialQtd : null,
    obs: d.servico.habilita_obs ? d.obs : null,
    capturedAt,
    cadastradorNome,
    syncStatus: 'PENDING',
    failureReason: null,
  }
}
