import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/core/auth/SessionStore', () => ({ sessionStore: { current: () => ({ userNome: 'Apontador' }) } }))
vi.mock('@/core/sync/producaoSync', () => ({ pushProducaoOutbox: vi.fn(async () => null) }))
vi.mock('@/core/sync/foregroundSync', () => ({ triggerForegroundSync: vi.fn() }))

import { db } from '@/core/db/dexie'
import { loadSessionItensAsDrafts, saveProducaoSession } from './producaoRepo'
import type { ApontamentoDraft, ProducaoSessionState } from './producaoStore'
import type { ServicoDto } from '@/types/dtos'

const servico: ServicoDto = {
  id: 's1',
  codigo: '01.01',
  descricao: 'Base',
  unidade: 'm³',
  modo_lancamento: 'quantidade',
  controla_material: false,
  material: null,
  material_obrigatorio: false,
  habilita_obs: true,
  exige_local: false,
}
const item = (id: string, qtd: number): ApontamentoDraft => ({
  id,
  servico,
  qtd,
  localId: null,
  localNome: null,
  estacaInicial: '',
  estacaFinal: '',
  posicaoInicioM: null,
  posicaoFimM: null,
  materialQtd: null,
  obs: null,
})
const sessao = (itens: ApontamentoDraft[]): ProducaoSessionState => ({
  obraId: 'o1',
  obraCodigo: 'CO.081',
  dt: '2026-11-03',
  equipeId: null,
  equipeNome: null,
  encarregadoId: null,
  encarregadoNome: null,
  itens,
})

beforeEach(async () => {
  await db.out_producao.clear()
})

describe('saveProducaoSession', () => {
  it('reabrir e finalizar não reenvia o que já foi enviado sem mudança', async () => {
    await saveProducaoSession(sessao([item('a', 10), item('b', 20)]))
    await db.out_producao.update('a', { syncStatus: 'SYNCED' })
    await db.out_producao.update('b', { syncStatus: 'SYNCED' })
    const drafts = await loadSessionItensAsDrafts({ obraId: 'o1', dt: '2026-11-03', encarregadoId: null, equipeId: null })
    expect(drafts.map((d) => d.syncStatus)).toEqual(['SYNCED', 'SYNCED'])
    // só o "b" muda
    await saveProducaoSession(sessao(drafts.map((d) => (d.id === 'b' ? { ...d, qtd: 25 } : d))))
    expect((await db.out_producao.get('a'))?.syncStatus).toBe('SYNCED')
    const b = await db.out_producao.get('b')
    expect([b?.syncStatus, b?.quantidade]).toEqual(['PENDING', 25])
  })

  it('recusado volta para a fila ao finalizar de novo', async () => {
    await saveProducaoSession(sessao([item('c', 5)]))
    await db.out_producao.update('c', { syncStatus: 'REJEITADA', failureReason: 'Informe o local' })
    await saveProducaoSession(sessao([item('c', 5)]))
    expect((await db.out_producao.get('c'))?.syncStatus).toBe('PENDING')
  })
})
