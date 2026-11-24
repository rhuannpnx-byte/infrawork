import { describe, expect, it } from 'vitest'
import { avancarPosicao, estacaParaMetros, resolverLocal } from './estaca'
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
    expect(resolverLocal(eixo('estaca'), 'EST 15', 'EST 10')).toEqual({
      ok: true,
      trechoId: 'e1',
      inicioM: 200,
      fimM: 300,
    })
  })
  it('fora do eixo é recusado', () => {
    const r = resolverLocal(eixo('estaca'), 'EST 10', 'EST 500')
    expect(r.ok).toBe(false)
  })
  it('diz em que campo está o erro (inicial, final ou os dois)', () => {
    const fora = resolverLocal(eixo('estaca'), 'EST 10', 'EST 500')
    expect(fora.ok ? null : fora.campos).toEqual({
      final: 'Valor inválido ou fora do eixo (EST 0 a EST 100).',
    })
    const vazio = resolverLocal(eixo('estaca'), '', '')
    expect(vazio.ok ? null : Object.keys(vazio.campos).sort()).toEqual(['final', 'inicial'])
    const iguais = resolverLocal(eixo('km'), '1+500', '1,5')
    expect(iguais.ok ? null : iguais.campos).toEqual({
      final: 'Informe um valor diferente do inicial.',
    })
  })
  it('área não pede estacas; sem local passa', () => {
    expect(resolverLocal({ ...eixo('m'), tipo: 'area' }, '', '')).toEqual({
      ok: true,
      trechoId: 'e1',
      inicioM: null,
      fimM: null,
    })
    expect(resolverLocal(null, '', '')).toEqual({
      ok: true,
      trechoId: null,
      inicioM: null,
      fimM: null,
    })
  })
})

describe('avancarPosicao', () => {
  it('anda uma estaca para frente e para trás, no texto que o campo aceita', () => {
    expect(avancarPosicao(eixo('estaca'), '50', 1)).toBe('51')
    expect(avancarPosicao(eixo('estaca'), 'EST 50', 1)).toBe('51')
    expect(avancarPosicao(eixo('estaca'), '50', -1)).toBe('49')
    expect(avancarPosicao(eixo('estaca'), '50+10', 1)).toBe('51+10')
    expect(estacaParaMetros(eixo('estaca'), '51+10')).toBe(1030)
  })
  it('não sai do eixo nem anda a partir de um texto inválido', () => {
    expect(avancarPosicao(eixo('estaca'), '0', -1)).toBeNull()
    expect(avancarPosicao(eixo('estaca'), '100', 1)).toBeNull()
    expect(avancarPosicao(eixo('estaca'), '99', 1)).toBe('100')
    expect(avancarPosicao(eixo('estaca'), '', 1)).toBeNull()
    expect(avancarPosicao(eixo('estaca'), 'abc', 1)).toBeNull()
  })
  it('em km e em metros o passo também é de 20 m', () => {
    expect(avancarPosicao(eixo('km'), '1+500', 1)).toBe('1+520')
    expect(avancarPosicao(eixo('km'), '1,5', 1)).toBe('1+520')
    expect(avancarPosicao(eixo('km'), '0+980', 1)).toBe('1+000')
    expect(estacaParaMetros(eixo('km'), '1+020')).toBe(1020)
    expect(avancarPosicao(eixo('m'), '100', 1)).toBe('120')
    expect(avancarPosicao(eixo('m'), '10', -1)).toBeNull()
  })
  it('em eixo de sentido invertido anda no valor que o usuário lê', () => {
    const inv = {
      ...eixo('estaca'),
      marcador_valor_inicial: 100,
      geometry_sentido: 'invertido' as const,
    }
    expect(avancarPosicao(inv, '50', 1)).toBe('51')
    expect(estacaParaMetros(inv, '51')).toBe(980)
    expect(avancarPosicao(inv, '100', 1)).toBeNull()
  })
})
