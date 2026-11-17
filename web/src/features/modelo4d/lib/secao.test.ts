import { describe, expect, it } from 'vitest'
import type { Modelo4D } from './contrato'
import { prepararModelo } from './preparar'
import { LeitorDeSecoes } from './secao'

const estacas = [0, 20, 40, 60]
// terreno natural plano na cota 98 (grade de 5 × 5 pontos a cada 30 m, em centímetros sobre 90)
const plano = btoa(String.fromCharCode(...Array.from({ length: 25 }, () => [32, 3]).flat()))
const modelo: Modelo4D = {
  formato: 'infrawork-4d',
  versao: 1,
  nome: 'Seção',
  origem: { e: 500000, n: 8000000, fuso: '22S' },
  eixos: [{ id: 'E1', nome: 'Eixo', pontos: estacas.map((s) => [s, s, 0, 100.12]) }],
  terreno: [{ nx: 5, ny: 5, res: 30, x0: -30, ytop: 60, zb: 90, atual: plano }],
  classes: [
    { id: 'ATE', nome: 'Aterro', disciplina: 'Terraplenagem', terreno: true },
    { id: 'BASE', nome: 'Base', disciplina: 'Pavimentação' },
    { id: 'IMP', nome: 'Imprimação', disciplina: 'Pavimentação' },
    { id: 'MFC', nome: 'Meio-fio', disciplina: 'Drenagem' }
  ],
  secoes: estacas.map((s) => ({
    s,
    perfil: [
      [-10, 98],
      [-6, 100],
      [0, 100.12],
      [6, 100],
      [10 + s / 20, 98]
    ]
  })),
  camadas: [
    { classe: 'ATE', s0: 0, s1: 60, faixas: [[-9999, 9999]] },
    { classe: 'BASE', s0: 0, s1: 60, faixas: [[-5, 5]], elevacao: -0.05, espessura: 0.2 },
    { classe: 'IMP', s0: 0, s1: 40, faixas: [[-5, 5]], elevacao: -0.046 }
  ],
  elementos: [
    {
      id: 'mfc',
      classe: 'MFC',
      s0: 0,
      s1: 60,
      geo: {
        t: 'linha',
        pts: [
          [0, -5.2, 100.02],
          [60, -5.2, 100.02]
        ],
        largura: 0.3,
        altura: 0.15
      }
    }
  ]
}

describe('seção transversal na estaca', () => {
  const pronto = prepararModelo(modelo)
  const leitor = new LeitorDeSecoes(pronto)

  it('interpola o perfil acabado entre as duas estacas vizinhas', () => {
    const sec = leitor.em(0, 30)!
    expect(sec.perfil[0]).toEqual([-10, 98])
    // o off-set direito anda 1 m por estaca
    expect(sec.perfil[sec.perfil.length - 1][0]).toBeCloseTo(11.5)
    expect(sec.perfil.find((p) => p[0] === 0)![1]).toBeCloseTo(100.12)
    expect(leitor.limites(0)).toEqual([0, 60])
    expect(leitor.em(0, 70)).toBeNull()
  })

  it('traz o terreno natural do levantamento', () => {
    const sec = leitor.em(0, 30)!
    expect(sec.natural.length).toBeGreaterThan(10)
    expect(sec.natural.every((p) => Math.abs(p[1] - 98) < 1e-6)).toBe(true)
  })

  it('corta cada camada: sólido com espessura, aterro contra o terreno e película em linha', () => {
    const sec = leitor.em(0, 30)!
    const de = (id: string): (typeof sec.formas)[number] =>
      sec.formas.find((x) => pronto.modelo.classes[x.classe].id === id)!
    const base = de('BASE')
    expect(base.fechada).toBe(true)
    expect(base.espessura).toBe(0.2)
    expect(base.pontos[0]).toEqual([-5, cotaEm(-5) - 0.05])
    expect(Math.min(...base.pontos.map((p) => p[1]))).toBeCloseTo(cotaEm(-5) - 0.25)
    const aterro = de('ATE')
    expect(aterro.fechada).toBe(true)
    expect(Math.min(...aterro.pontos.map((p) => p[1]))).toBeCloseTo(98)
    expect(de('IMP')).toMatchObject({ fechada: false, espessura: null })
    // cada forma aponta para a peça da cena naquela fatia
    expect(pronto.pecas[base.peca!]).toMatchObject({ s0: 20, s1: 40 })
    // a imprimação acaba na estaca 40: além dela não entra na seção
    expect(leitor.em(0, 50)!.formas.some((x) => pronto.modelo.classes[x.classe].id === 'IMP')).toBe(
      false
    )
  })

  it('marca os dispositivos que passam pela estaca', () => {
    const sec = leitor.em(0, 30)!
    expect(sec.marcas).toHaveLength(1)
    // n negativo é o lado direito neste eixo
    expect(sec.marcas[0].o).toBeCloseTo(5.2, 0)
    expect(sec.marcas[0].nome).toBe('Meio-fio')
  })
})

/** Cota do perfil de teste no afastamento `o` (entre o bordo e o eixo). */
function cotaEm(o: number): number {
  return 100 + (0.12 * (6 - Math.abs(o))) / 6
}
