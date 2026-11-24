import { describe, expect, it } from 'vitest'
import { diasDoMes, mesesDosDias, nomeDoMes } from './mapa-calor-mes'

describe('mapa de calor por mês de calendário', () => {
  it('lista os meses do período, do mais antigo ao mais recente', () => {
    expect(mesesDosDias(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])).toEqual([
      '2026-10',
      '2026-11'
    ])
    expect(mesesDosDias(['2027-01-03', '2026-12-30'])).toEqual(['2026-12', '2027-01'])
    expect(mesesDosDias([])).toEqual([])
  })
  it('traz o mês inteiro, mesmo quando o período pega só parte dele', () => {
    const nov = diasDoMes('2026-11')
    expect(nov).toHaveLength(30)
    expect(nov[0]).toBe('2026-11-01')
    expect(nov[29]).toBe('2026-11-30')
    expect(diasDoMes('2028-02')).toHaveLength(29)
    expect(diasDoMes('2026-12')).toHaveLength(31)
  })
  it('nome do mês por extenso', () => {
    expect(nomeDoMes('2026-11')).toBe('novembro de 2026')
    expect(nomeDoMes('2027-03')).toBe('março de 2027')
  })
})
