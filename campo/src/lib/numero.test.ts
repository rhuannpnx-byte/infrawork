import { describe, expect, it } from 'vitest'
import { formatNumberBR, parseNum, parseNumberBR } from './numero'

describe('formatNumberBR', () => {
  it('vírgula é decimal e o milhar ganha ponto', () => {
    expect(formatNumberBR('1234,56')).toBe('1.234,56')
  })
  it('ponto com menos de 3 dígitos depois é decimal (teclado sem vírgula)', () => {
    expect(formatNumberBR('2.5')).toBe('2,5')
    expect(formatNumberBR('12.50')).toBe('12,50')
    expect(formatNumberBR('7.')).toBe('7,')
  })
  it('grupo de 3 dígitos continua milhar', () => {
    expect(formatNumberBR('1.234')).toBe('1.234')
    expect(formatNumberBR('1.234.5')).toBe('1.234,5')
  })
  it('ida e volta até o número', () => {
    expect(parseNum(parseNumberBR(formatNumberBR('2.5')))).toBe(2.5)
    expect(parseNum(parseNumberBR(formatNumberBR('1.234,5')))).toBe(1234.5)
  })
})
