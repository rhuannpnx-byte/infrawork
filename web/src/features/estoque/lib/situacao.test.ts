import { describe, expect, it } from 'vitest'
import { situacaoDoEstoque } from './situacao'

describe('situação do estoque para a cor', () => {
  const normal = (saldo: number | null, minimo: number): ReturnType<typeof situacaoDoEstoque> =>
    situacaoDoEstoque({ status: 'normal', saldo, estoque_minimo: minimo })

  it('até 20% acima do mínimo pede atenção', () => {
    expect(normal(1001, 1000)).toBe('atencao')
    expect(normal(1200, 1000)).toBe('atencao')
  })
  it('acima disso é normal', () => {
    expect(normal(1201, 1000)).toBe('normal')
    expect(normal(5000, 1000)).toBe('normal')
  })
  it('sem mínimo cadastrado não há faixa de atenção', () => {
    expect(normal(10, 0)).toBe('normal')
  })
  it('o status do banco prevalece quando não é normal', () => {
    expect(situacaoDoEstoque({ status: 'baixo', saldo: 900, estoque_minimo: 1000 })).toBe('baixo')
    expect(situacaoDoEstoque({ status: 'zerado', saldo: 0, estoque_minimo: 1000 })).toBe('zerado')
    expect(situacaoDoEstoque({ status: 'sem_saldo', saldo: null, estoque_minimo: 1000 })).toBe(
      'sem_saldo'
    )
  })
})
