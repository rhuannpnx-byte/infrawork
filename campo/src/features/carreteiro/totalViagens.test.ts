import { describe, expect, it } from 'vitest'
import { totalDasViagens } from './totalViagens'
import { rotuloFila } from '@/features/common/rotulosEnvio'
import { listar } from '@/lib/texto'

describe('totalDasViagens', () => {
  it('soma quando todas as viagens têm a mesma unidade', () => {
    expect(
      totalDasViagens([
        { quantidade: 12, unidade: 'm³' },
        { quantidade: 12.5, unidade: 'm³' },
      ]),
    ).toBe('24,5 m³')
  })
  it('não soma unidades diferentes (m³ com t) nem ficha vazia', () => {
    expect(
      totalDasViagens([
        { quantidade: 12, unidade: 'm³' },
        { quantidade: 23.5, unidade: 't' },
      ]),
    ).toBeNull()
    expect(totalDasViagens([])).toBeNull()
  })
})

describe('rotuloFila', () => {
  it('recusado não conta como tudo enviado', () => {
    expect(rotuloFila({ online: true, syncing: false, outboxPending: 0, recusados: 2 })).toBe(
      '2 recusados',
    )
    expect(rotuloFila({ online: true, syncing: false, outboxPending: 1, recusados: 1 })).toBe(
      '1 aguardando rede, 1 recusado',
    )
    expect(rotuloFila({ online: true, syncing: false, outboxPending: 0 })).toBe('Tudo enviado')
    expect(rotuloFila({ online: false, syncing: false, outboxPending: 0 })).toBe('Sem rede')
  })
})

describe('listar', () => {
  it('junta com vírgula e "e"', () => {
    expect(listar(['1 lançamento'])).toBe('1 lançamento')
    expect(listar(['1 lançamento', '2 fichas'])).toBe('1 lançamento e 2 fichas')
    expect(listar(['1 lançamento', '2 fichas', '3 fotos'])).toBe('1 lançamento, 2 fichas e 3 fotos')
  })
})
