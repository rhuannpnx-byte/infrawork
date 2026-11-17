import { describe, expect, it } from 'vitest'
import type { Modelo4D } from './contrato'
import { prepararModelo } from './preparar'
import { Superficie } from './superficie'

// eixo reto para leste, plataforma de 6 m para cada lado a 100 m e taludes descendo até 10 m do eixo
const estacas = [0, 20, 40, 60]
const modelo: Modelo4D = {
  formato: 'infrawork-4d',
  versao: 1,
  nome: 'Superfície',
  origem: { e: 500000, n: 8000000, fuso: '22S' },
  eixos: [{ id: 'E1', nome: 'Eixo', pontos: estacas.map((s) => [s, s, 0, 100]) }],
  classes: [{ id: 'ATE', nome: 'Aterro', disciplina: 'Terraplenagem', terreno: true }],
  secoes: estacas.map((s) => ({
    s,
    perfil: [
      [-10, 96 + s / 20],
      [-6, 100],
      [0, 100.12],
      [6, 100],
      [10, 96]
    ]
  })),
  camadas: [{ classe: 'ATE', s0: 0, s1: 60, faixas: [[-9999, 9999]] }],
  elementos: []
}

describe('superfície da obra', () => {
  const sup = new Superficie(prepararModelo(modelo))

  it('dá a cota acabada na plataforma e no talude, com a estaca e o afastamento', () => {
    expect(sup.em(30, 0)).toMatchObject({ eixo: 0, s: 30, o: 0, z: 100.12 })
    // n positivo é o lado esquerdo neste eixo (afastamento negativo)
    const talude = sup.em(30, -8)!
    expect(talude.o).toBeCloseTo(8)
    expect(talude.z).toBeCloseTo(98)
    // o off-set esquerdo sobe 1 m por estaca: interpola entre as duas seções
    expect(sup.em(30, 10)!.z).toBeCloseTo(97.5)
  })

  it('diz em que fatia o ponto está', () => {
    const p = prepararModelo(modelo)
    const s = new Superficie(p)
    expect(p.fatias[s.em(10, 0)!.fatia]).toMatchObject({ s0: 0, s1: 20 })
    expect(p.fatias[s.em(45, 3)!.fatia]).toMatchObject({ s0: 40, s1: 60 })
  })

  it('fora dos off-sets ou além das pontas do eixo não há obra', () => {
    expect(sup.em(30, 12)).toBeNull()
    expect(sup.em(30, -10.5)).toBeNull()
    expect(sup.em(-15, 0)).toBeNull()
    expect(sup.em(90, 0)).toBeNull()
  })
})
