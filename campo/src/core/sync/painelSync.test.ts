import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sessao, painel } = vi.hoisted(() => ({ sessao: { current: vi.fn() }, painel: vi.fn() }))
vi.mock('@/core/auth/SessionStore', () => ({ sessionStore: sessao }))
vi.mock('@/core/api/endpoints', () => ({ catalogEndpoints: { painel } }))

import { db } from '@/core/db/dexie'
import { ApiError } from '@/core/api/fetchClient'
import { refreshPainel, refreshPainelDaObraAtual } from './painelSync'
import type { PainelDto } from '@/types/dtos'

const retrato = (versao: string) =>
  ({ versao, gerado_em: 'x', obra: { id: 'o1' } }) as unknown as PainelDto

beforeEach(async () => {
  await db.cat_painel.clear()
  painel.mockReset()
  sessao.current.mockReset()
})

describe('refreshPainel', () => {
  it('guarda o retrato e só regrava quando a versão muda', async () => {
    painel.mockResolvedValue(retrato('v1'))
    expect(await refreshPainel('o1')).toBe(true)
    const antes = (await db.cat_painel.get('o1'))!
    expect(antes.versao).toBe('v1')
    expect(await refreshPainel('o1')).toBe(false)
    painel.mockResolvedValue(retrato('v2'))
    expect(await refreshPainel('o1')).toBe(true)
    expect((await db.cat_painel.get('o1'))!.versao).toBe('v2')
  })

  it('sem rede mantém o retrato guardado', async () => {
    painel.mockResolvedValue(retrato('v1'))
    await refreshPainel('o1')
    painel.mockRejectedValue(new ApiError(0, 'Sem conexão com o servidor'))
    await expect(refreshPainel('o1')).rejects.toThrow()
    expect((await db.cat_painel.get('o1'))?.versao).toBe('v1')
  })

  it('perdeu o acesso: apaga o retrato daquela obra', async () => {
    painel.mockResolvedValue(retrato('v1'))
    await refreshPainel('o1')
    painel.mockRejectedValue(new ApiError(400, 'Sem acesso à visão estratégica desta obra'))
    await expect(refreshPainel('o1')).rejects.toThrow()
    expect(await db.cat_painel.get('o1')).toBeUndefined()
  })

  it('retrato recente não é buscado de novo no ciclo comum', async () => {
    painel.mockResolvedValue(retrato('v1'))
    await refreshPainel('o1')
    await refreshPainel('o1', { seMaisAntigoQueMs: 5 * 60_000 })
    expect(painel).toHaveBeenCalledTimes(1)
  })
})

describe('refreshPainelDaObraAtual', () => {
  it('apontador nunca chama o servidor', async () => {
    sessao.current.mockReturnValue({ role: 'apontador', obraAtualId: 'o1' })
    await refreshPainelDaObraAtual(true)
    expect(painel).not.toHaveBeenCalled()
  })
  it('engenheiro busca a obra atual', async () => {
    sessao.current.mockReturnValue({ role: 'engenheiro', obraAtualId: 'o1' })
    painel.mockResolvedValue(retrato('v1'))
    await refreshPainelDaObraAtual(true)
    expect(painel).toHaveBeenCalledWith('o1')
  })
})
