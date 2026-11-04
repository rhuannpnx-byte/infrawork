import { describe, expect, it } from 'vitest'
import { resolverLocal } from './estaca'
import type { LocalDto } from '@/types/dtos'

const eixo = (u: LocalDto['unidade_espaco_padrao']): LocalDto => ({
  id: 'e1',
  nome: 'Eixo',
  tipo: 'eixo',
  ordem: 0,
  comprimento_m: 2000,
  geometry_comprimento_m: null,
  unidade_espaco_padrao: u,
  unidade_custom_label: null,
  unidade_custom_divisor_m: null,
  marcador_valor_inicial: 0,
  geometry_sentido: 'natural',
})

describe('resolverLocal', () => {
  it('estacas de 20 m viram a faixa em metros (inicial e final em qualquer ordem)', () => {
    expect(resolverLocal(eixo('estaca'), 'EST 15', 'EST 10')).toEqual({ ok: true, trechoId: 'e1', inicioM: 200, fimM: 300 })
  })
  it('fora do eixo é recusado', () => {
    const r = resolverLocal(eixo('estaca'), 'EST 10', 'EST 500')
    expect(r.ok).toBe(false)
  })
  it('área não pede estacas; sem local passa', () => {
    expect(resolverLocal({ ...eixo('m'), tipo: 'area' }, '', '')).toEqual({ ok: true, trechoId: 'e1', inicioM: null, fimM: null })
    expect(resolverLocal(null, '', '')).toEqual({ ok: true, trechoId: null, inicioM: null, fimM: null })
  })
})
