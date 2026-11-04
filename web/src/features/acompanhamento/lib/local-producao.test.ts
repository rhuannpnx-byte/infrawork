import { describe, expect, it } from 'vitest'
import {
  localPorNome,
  resolverLocalProducao,
  rotuloLocalProducao,
  type TrechoLocal
} from './local-producao'

const eixo: TrechoLocal = {
  id: 'e1',
  nome: 'Trecho 2 — Contorno',
  tipo: 'eixo',
  comprimento_m: 4500,
  geometry_comprimento_m: null,
  unidade_espaco_padrao: 'km',
  unidade_custom_label: null,
  unidade_custom_divisor_m: null,
  marcador_valor_inicial: 0,
  geometry_sentido: 'natural'
}
const area: TrechoLocal = { ...eixo, id: 'a1', nome: 'OAE Km 3', tipo: 'area', comprimento_m: null }

describe('resolverLocalProducao', () => {
  it('sem local: só texto', () => {
    expect(resolverLocalProducao(null, '1+000', '2+000')).toEqual({
      ok: true,
      trecho_id: null,
      posicao_inicio_m: null,
      posicao_fim_m: null
    })
  })
  it('eixo: estacas no padrão do eixo (canônico ou valor do marcador; invertidas são normalizadas)', () => {
    expect(resolverLocalProducao(eixo, '2+500', '2')).toEqual({
      ok: true,
      trecho_id: 'e1',
      posicao_inicio_m: 2000,
      posicao_fim_m: 2500
    })
  })
  it('eixo em estacas: "EST 100" (como o sistema exibe), "EST 100+10" e "105" valem', () => {
    const est: TrechoLocal = { ...eixo, unidade_espaco_padrao: 'estaca', comprimento_m: 12000 }
    expect(resolverLocalProducao(est, 'EST 100', 'EST 105+10')).toEqual({
      ok: true,
      trecho_id: 'e1',
      posicao_inicio_m: 2000,
      posicao_fim_m: 2110
    })
    expect(resolverLocalProducao(est, '100', '105')).toMatchObject({ ok: true, posicao_fim_m: 2100 })
  })
  it('eixo: estaca faltando, fora do eixo ou faixa vazia → erro', () => {
    expect(resolverLocalProducao(eixo, '', '2')).toMatchObject({ ok: false })
    expect(resolverLocalProducao(eixo, '4+000', '5+000')).toMatchObject({
      ok: false,
      erro: expect.stringMatching(/fora/)
    })
    expect(resolverLocalProducao(eixo, '1', '1')).toMatchObject({ ok: false })
  })
  it('área: sem faixa, estacas ignoradas', () => {
    expect(resolverLocalProducao(area, 'x', 'y')).toEqual({
      ok: true,
      trecho_id: 'a1',
      posicao_inicio_m: null,
      posicao_fim_m: null
    })
  })
})

describe('localPorNome e rótulo', () => {
  it('acha por nome sem acento/caixa e "Área X"', () => {
    expect(localPorNome([eixo, area], 'trecho 2 — contorno')?.id).toBe('e1')
    expect(localPorNome([eixo, area], 'Área OAE km 3')?.id).toBe('a1')
    expect(localPorNome([eixo, area], 'nada')).toBeUndefined()
  })
  it('rótulo', () => {
    expect(
      rotuloLocalProducao({
        trecho_nome: 'T1',
        trecho_tipo: 'eixo',
        estaca_inicial: '1+000',
        estaca_final: '2+000'
      })
    ).toBe('T1 · 1+000 → 2+000')
    expect(rotuloLocalProducao({ trecho_nome: 'OAE', trecho_tipo: 'area' })).toBe('Área OAE')
    expect(rotuloLocalProducao({ estaca_inicial: '5' })).toBe('5')
  })
})
