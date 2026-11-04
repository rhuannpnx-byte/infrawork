import { describe, expect, it } from 'vitest'
import {
  estacaPorFracao,
  faixasDeDivisao,
  faixasDosPontos,
  fundirSegmentos,
  faixasLivresDoServico,
  gerarSegmentos,
  quantidadeNaFaixa,
  reamostrarSegmentos,
  sequenciasContiguas,
  type SegmentoValores
} from './segmentos'
import type { TrechoUnidadeConfig } from './grade'

const km: TrechoUnidadeConfig = {
  geometry_comprimento_m: 2500,
  unidade_espaco_padrao: 'km',
  unidade_custom_label: null,
  unidade_custom_divisor_m: null,
  marcador_valor_inicial: 100,
  geometry_sentido: 'natural'
}

describe('gerarSegmentos', () => {
  it('por unidade: um km por linha, a última parcial, rótulos com o marcador inicial', () => {
    const g = gerarSegmentos(km, { tipo: 'unidade' })
    expect(g.map((s) => [s.posicao_inicio_m, s.posicao_fim_m])).toEqual([
      [0, 1000],
      [1000, 2000],
      [2000, 2500]
    ])
    expect(g[0]!.unidade_inicio_label).toBe('km 100')
    expect(g[2]!.unidade_fim_label).toBe('km 102.5')
  })
  it('a cada N metros e a cada N unidades', () => {
    expect(gerarSegmentos(km, { tipo: 'metros', m: 500 })).toHaveLength(5)
    expect(gerarSegmentos(km, { tipo: 'unidades', n: 2 }).map((s) => s.posicao_fim_m)).toEqual([
      2000, 2500
    ])
  })
  it('numeração invertida', () => {
    const g = gerarSegmentos({ ...km, geometry_sentido: 'invertido' }, { tipo: 'unidade' })
    expect(g[0]!.unidade_inicio_label).toBe('km 100')
    expect(g[0]!.unidade_fim_label).toBe('km 99')
  })
})

describe('reamostrarSegmentos', () => {
  it('conserva a soma ao trocar de passo', () => {
    const origem: SegmentoValores[] = [
      { ini: 0, fim: 1000, label_ini: '', label_fim: '', valores: { A: 100 } },
      { ini: 1000, fim: 2500, label_ini: '', label_fim: '', valores: { A: 300, B: 30 } }
    ]
    const r = reamostrarSegmentos(origem, gerarSegmentos(km, { tipo: 'metros', m: 500 }))
    expect(r).toHaveLength(5)
    expect(r.reduce((s, x) => s + (x.valores.A ?? 0), 0)).toBeCloseTo(400, 6)
    expect(r.reduce((s, x) => s + (x.valores.B ?? 0), 0)).toBeCloseTo(30, 6)
    expect(r[0]!.valores.A).toBeCloseTo(50, 6)
    expect(r[2]!.valores.A).toBeCloseTo(100, 6)
  })
})

describe('fundirSegmentos', () => {
  it('substitui só os serviços importados e conserva as somas dos demais, mesmo com grades diferentes', () => {
    const existentes: SegmentoValores[] = [
      { ini: 0, fim: 1000, label_ini: '', label_fim: '', valores: { A: 100, B: 10 } },
      { ini: 1000, fim: 2500, label_ini: '', label_fim: '', valores: { A: 300, B: 30 } }
    ]
    const importados: SegmentoValores[] = [
      { ini: 0, fim: 500, label_ini: '', label_fim: '', valores: { A: 5, C: 1 } },
      { ini: 500, fim: 1500, label_ini: '', label_fim: '', valores: { A: 10, C: 2 } },
      { ini: 1500, fim: 2500, label_ini: '', label_fim: '', valores: { A: 15, C: 3 } }
    ]
    const r = fundirSegmentos(km, existentes, importados, new Set(['A', 'C']))
    expect(r.map((s) => [s.ini, s.fim])).toEqual([
      [0, 500],
      [500, 1000],
      [1000, 1500],
      [1500, 2500]
    ])
    const soma = (id: string): number => r.reduce((t, s) => t + (s.valores[id] ?? 0), 0)
    expect(soma('A')).toBeCloseTo(30, 6)
    expect(soma('B')).toBeCloseTo(40, 6)
    expect(soma('C')).toBeCloseTo(6, 6)
    expect(r[0]!.valores.B).toBeCloseTo(5, 6)
    expect(r[0]!.unidade_inicio_label).toBeUndefined()
    expect(r[0]!.label_ini).toBe('km 100')
  })
  it('sem nada a preservar, devolve o importado como veio', () => {
    const imp: SegmentoValores[] = [
      { ini: 0, fim: 20, label_ini: 'x', label_fim: 'y', valores: { A: 1 } }
    ]
    expect(fundirSegmentos(km, [], imp, new Set(['A']))).toEqual(imp)
  })
})

describe('faixasDosPontos (regra do DynaRoad)', () => {
  it('pontos médios no meio, a própria estaca nas pontas', () => {
    expect(faixasDosPontos([0, 20, 40, 60, 80], 20)).toEqual([
      [0, 10],
      [10, 30],
      [30, 50],
      [50, 70],
      [70, 80]
    ])
  })
  it('um ponto só vale uma unidade; fora de ordem é erro', () => {
    expect(faixasDosPontos([100], 20)).toEqual([[100, 120]])
    expect(() => faixasDosPontos([0, 20, 20], 20)).toThrow(/fora de ordem/)
  })
})

describe('sequências, janelas, quantidade e estaca por fração', () => {
  const segs: SegmentoValores[] = [
    { ini: 0, fim: 10, label_ini: '', label_fim: '', valores: { A: 100 } },
    { ini: 10, fim: 30, label_ini: '', label_fim: '', valores: { A: 200 } },
    { ini: 30, fim: 50, label_ini: '', label_fim: '', valores: { B: 300 } },
    { ini: 50, fim: 70, label_ini: '', label_fim: '', valores: { A: 150, B: 400 } },
    { ini: 70, fim: 80, label_ini: '', label_fim: '', valores: { A: 50, B: 100 } }
  ]
  it('o zero fecha a sequência: A tem duas, B uma', () => {
    expect(sequenciasContiguas(segs, 'A')).toEqual([
      { ini: 0, fim: 30, total: 300 },
      { ini: 50, fim: 80, total: 200 }
    ])
    expect(sequenciasContiguas(segs, 'B')).toEqual([{ ini: 30, fim: 80, total: 800 }])
  })
  it('janelas alinhadas a múltiplos de N', () => {
    expect(faixasDeDivisao(290, 640, 300)).toEqual([
      [290, 300],
      [300, 600],
      [600, 640]
    ])
    expect(faixasDeDivisao(0, 2500, 1000)).toEqual([
      [0, 1000],
      [1000, 2000],
      [2000, 2500]
    ])
  })
  it('quantidade numa faixa por sobreposição e a estaca em que a massa atinge a fração', () => {
    expect(quantidadeNaFaixa(segs, 'A', 5, 20)).toBeCloseTo(50 + 100, 6)
    expect(quantidadeNaFaixa(segs, 'B', 0, 10)).toBe(0)
    // A em [0, 30] = 300; metade (150) fica em 10 + 50/200·20 = 15
    expect(estacaPorFracao(segs, 'A', 0, 30, 0.5)).toBeCloseTo(15, 6)
    expect(quantidadeNaFaixa(segs, 'A', 0, estacaPorFracao(segs, 'A', 0, 30, 0.5))).toBeCloseTo(
      150,
      6
    )
    // sem quantidade: linear
    expect(estacaPorFracao(segs, 'B', 0, 10, 0.25)).toBeCloseTo(2.5, 6)
  })
})

describe('faixasLivresDoServico', () => {
  const segs: SegmentoValores[] = [
    { ini: 0, fim: 1000, label_ini: '', label_fim: '', valores: { A: 100 } },
    { ini: 1000, fim: 2000, label_ini: '', label_fim: '', valores: { A: 200 } },
    { ini: 2000, fim: 3000, label_ini: '', label_fim: '', valores: {} },
    { ini: 3000, fim: 4000, label_ini: '', label_fim: '', valores: { A: 50 } }
  ]
  it('sem cobertura: as sequências contíguas', () => {
    expect(faixasLivresDoServico(segs, 'A', [])).toEqual([
      { ini: 0, fim: 2000, total: 300 },
      { ini: 3000, fim: 4000, total: 50 }
    ])
  })
  it('local do template cobrindo 500–1500 deixa 0–500 e 1500–2000 (proporcional) e 3000–4000', () => {
    const r = faixasLivresDoServico(segs, 'A', [[500, 1500]])
    expect(r.map((x) => [x.ini, x.fim])).toEqual([
      [0, 500],
      [1500, 2000],
      [3000, 4000]
    ])
    expect(r[0]!.total).toBeCloseTo(50, 6)
    expect(r[1]!.total).toBeCloseTo(100, 6)
  })
  it('tudo coberto → nada', () => {
    expect(faixasLivresDoServico(segs, 'A', [[0, 4000]])).toEqual([])
  })
})
