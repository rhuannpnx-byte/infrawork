import { describe, expect, it } from 'vitest'
import {
  atalhoDisponivel,
  cortar,
  diasDoMes,
  mesesDoPeriodo,
  nomeDoMes,
  periodoDoAtalho,
  periodoEmVigor,
  rotuloPeriodo,
} from './periodo'

const HOJE = '2026-11-23'
const DESDE = '2026-08-26'

describe('período da Visão estratégica', () => {
  it('atalhos terminam hoje e contam o dia de hoje', () => {
    expect(periodoDoAtalho('7d', HOJE, DESDE)).toEqual({ de: '2026-11-17', ate: HOJE })
    expect(periodoDoAtalho('30d', HOJE, DESDE)).toEqual({ de: '2026-10-25', ate: HOJE })
    expect(periodoDoAtalho('mes', HOJE, DESDE)).toEqual({ de: '2026-11-01', ate: HOJE })
    expect(periodoDoAtalho('mes-anterior', HOJE, DESDE)).toEqual({
      de: '2026-10-01',
      ate: '2026-10-31',
    })
    expect(periodoDoAtalho('tudo', HOJE, DESDE)).toEqual({ de: DESDE, ate: HOJE })
  })
  it('corta ao que o servidor entrega', () => {
    expect(periodoDoAtalho('30d', HOJE, '2026-11-10')).toEqual({ de: '2026-11-10', ate: HOJE })
    expect(periodoDoAtalho('mes-anterior', '2026-09-05', DESDE)).toEqual({
      de: DESDE,
      ate: '2026-08-31',
    })
  })
  it('mês passado some quando a produção começa neste mês', () => {
    expect(atalhoDisponivel('mes-anterior', HOJE, '2026-11-03')).toBe(false)
    expect(atalhoDisponivel('mes-anterior', HOJE, DESDE)).toBe(true)
    expect(periodoEmVigor('mes-anterior', null, HOJE, '2026-11-03')).toEqual({
      de: '2026-11-03',
      ate: HOJE,
    })
  })
  it('datas digitadas: aceita invertidas e corta fora do intervalo', () => {
    expect(cortar({ de: '2026-11-10', ate: '2026-10-20' }, HOJE, DESDE)).toEqual({
      de: '2026-10-20',
      ate: '2026-11-10',
    })
    expect(cortar({ de: '2026-01-01', ate: '2027-01-01' }, HOJE, DESDE)).toEqual({
      de: DESDE,
      ate: HOJE,
    })
    expect(periodoEmVigor('livre', { de: '2026-10-05', ate: '2026-10-09' }, HOJE, DESDE)).toEqual({
      de: '2026-10-05',
      ate: '2026-10-09',
    })
  })
  it('meses tocados pelo período e os dias de cada um', () => {
    expect(mesesDoPeriodo({ de: '2026-10-25', ate: HOJE })).toEqual(['2026-10', '2026-11'])
    expect(mesesDoPeriodo({ de: '2026-12-20', ate: '2027-02-02' })).toEqual([
      '2026-12',
      '2027-01',
      '2027-02',
    ])
    expect(diasDoMes('2026-11')).toHaveLength(30)
    expect(diasDoMes('2028-02')).toHaveLength(29)
    expect(diasDoMes('2026-11')[0]).toBe('2026-11-01')
    expect(nomeDoMes('2026-11')).toBe('novembro de 2026')
  })
  it('rótulo curto', () => {
    expect(rotuloPeriodo({ de: '2026-10-25', ate: HOJE })).toBe('25/10 a 23/11')
    expect(rotuloPeriodo({ de: HOJE, ate: HOJE })).toBe('23/11')
  })
})
