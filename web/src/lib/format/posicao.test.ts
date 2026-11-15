import { describe, expect, it } from 'vitest'
import { formatMarcador, formatPosicao, parseMarcador, type TrechoCtx } from './posicao'

const ctx = (over: Partial<TrechoCtx>): TrechoCtx => ({
  unidade_espaco_padrao: 'm',
  marcador_valor_inicial: 0,
  geometry_sentido: 'natural',
  geometry_comprimento_m: 99461.6177,
  ...over
})

describe('posição do trecho', () => {
  it('metros com separador de milhar, lidos de volta', () => {
    expect(formatPosicao(305123.01, 'm')).toBe('305.123,01')
    expect(formatPosicao(12.5, 'm')).toBe('12,50')
    const c = ctx({ marcador_valor_inicial: 305000 })
    expect(parseMarcador('305.123,01', c).metros).toBeCloseTo(123.01, 6)
    expect(parseMarcador('305123,01', c).metros).toBeCloseTo(123.01, 6)
    expect(parseMarcador('305.100', c).metros).toBeCloseTo(100, 6)
  })

  for (const unidade of ['m', 'km', 'estaca'] as const)
    for (const sentido of ['natural', 'invertido'] as const)
      it(`o texto do início e do fim do trecho volta válido (${unidade}, ${sentido})`, () => {
        // valor inicial com mais casas do que a tela mostra
        const div = unidade === 'km' ? 1000 : unidade === 'estaca' ? 20 : 1
        const inicial = (sentido === 'natural' ? 305123.0123 : 404584.6311) / div
        const c = ctx({
          unidade_espaco_padrao: unidade,
          marcador_valor_inicial: inicial,
          geometry_sentido: sentido
        })
        const comp = c.geometry_comprimento_m!
        expect(parseMarcador(formatMarcador(0, c), c).metros).toBeCloseTo(0, 2)
        expect(parseMarcador(formatMarcador(comp, c), c).metros).toBeCloseTo(comp, 1)
        expect(parseMarcador(formatMarcador(comp, c), c).metros!).toBeLessThanOrEqual(comp)
      })

  it('fora do trecho continua recusado', () => {
    const c = ctx({ marcador_valor_inicial: 305123.0123 })
    expect(parseMarcador('305.122,90', c).metros).toBeNull()
    expect(parseMarcador('404.584,70', c).metros).toBeNull()
  })
})
