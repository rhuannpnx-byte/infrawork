import { describe, expect, it } from 'vitest'
import {
  faixaDaEstaca,
  marcadorParaMetros,
  marcadoresDoTexto,
  type EixoDoLocal
} from '../../../supabase/functions/_shared/siga-estaca'

// BR-060 da 6.508: eixo em km, começando no km 164
const br060: EixoDoLocal = { unidade: 'km', marcador_inicial: 164, sentido: 'natural' }
const doZero: EixoDoLocal = { unidade: 'km', marcador_inicial: 0, sentido: 'natural' }

describe('estaca do SIGA (texto livre) → faixa no eixo', () => {
  it('lê as posições km+metro dos formatos que aparecem na obra', () => {
    expect(marcadoresDoTexto('KM INICIAL 45+390 > KM FINAL 46+429', 'km')).toEqual([45.39, 46.429])
    expect(marcadoresDoTexto('KM INÍCIO 37+340 >  KM FINAL 35+177', 'km')).toEqual([37.34, 35.177])
    expect(marcadoresDoTexto('ESTACA INICIAL 38+800 > ESTACA FINAL 41+226', 'km')).toEqual([
      38.8, 41.226
    ])
    expect(marcadoresDoTexto('INÍCIO > 68+798 | FINAL > 66+820', 'km')).toEqual([68.798, 66.82])
    expect(marcadoresDoTexto('178+220', 'km')).toEqual([178.22])
  })
  it('no eixo em estacas, o que vem depois do + são metros dentro da estaca', () => {
    expect(marcadoresDoTexto('EST 12+10 a 15+5', 'estaca')).toEqual([12.5, 15.25])
    // km+metro escrito num eixo em estacas não é adivinhado
    expect(marcadoresDoTexto('38+800 > 41+226', 'estaca')).toEqual([])
  })
  it('texto sem posição, ou eixo em outra unidade, não vira faixa', () => {
    expect(marcadoresDoTexto('1', 'km')).toEqual([])
    expect(marcadoresDoTexto(null, 'km')).toEqual([])
    expect(marcadoresDoTexto('45+390 > 46+429', 'm')).toEqual([])
  })
  it('converte o marcador em metros a partir do início do eixo, nos dois sentidos', () => {
    expect(marcadorParaMetros(178.22, br060)).toBe(14220)
    expect(marcadorParaMetros(45.39, doZero)).toBe(45390)
    expect(marcadorParaMetros(160, { ...br060, sentido: 'invertido' })).toBe(4000)
    expect(
      marcadorParaMetros(12.5, { unidade: 'estaca', marcador_inicial: 0, sentido: 'natural' })
    ).toBe(250)
  })
  it('a faixa vai da menor à maior posição, mesmo com o km decrescente', () => {
    expect(faixaDaEstaca({ estaca: 'KM INICIAL 37+340 > KM FINAL 35+190' }, doZero)).toEqual({
      inicio_m: 35190,
      fim_m: 37340
    })
  })
  it('usa os campos separados (o app do Monito) quando os dois têm posição', () => {
    expect(
      faixaDaEstaca({ estaca: '178+220 - 179+180', inicial: '178+220', final: '179+180' }, br060)
    ).toEqual({ inicio_m: 14220, fim_m: 15180 })
  })
  it('dois sentidos no mesmo texto: vale o trecho inteiro coberto', () => {
    expect(
      faixaDaEstaca(
        { estaca: 'KM DECRESCENTE 20+750 > 19+450 | KM CRESCENTE 19+410 > 19+570' },
        doZero
      )
    ).toEqual({ inicio_m: 19410, fim_m: 20750 })
  })
  it('uma posição só não é faixa', () => {
    expect(faixaDaEstaca({ estaca: '178+220' }, br060)).toBeNull()
    expect(faixaDaEstaca({ estaca: 'sem estaca' }, br060)).toBeNull()
  })
})
