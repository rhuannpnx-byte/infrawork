import { describe, expect, it } from 'vitest'
import {
  desenhoDoFormato,
  desenhoDoFundo,
  desenhoDoTampo,
  desenhoNoMapa,
  type DesenhoArame,
  type ModeloNoMapa
} from './arame3d'

/** Todos os números dos caminhos, para conferir que o desenho cabe na caixa e não tem conta quebrada. */
const numeros = (d: DesenhoArame): number[] =>
  d.tracos.flatMap((t) => (t.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number))

const confere = (d: DesenhoArame, minimoDeCamadas = 3): void => {
  expect(d.tracos.length).toBeGreaterThanOrEqual(minimoDeCamadas)
  expect(d.tracos.some((t) => t.tipo === 'corpo')).toBe(true)
  expect(d.tracos.every((t) => !/NaN|Infinity/.test(t.d))).toBe(true)
  const ns = numeros(d)
  expect(Math.min(...ns)).toBeGreaterThanOrEqual(0)
  expect(Math.max(...ns)).toBeLessThanOrEqual(Math.max(d.largura, d.altura))
}

describe('desenhos em vista de arame', () => {
  it('cada formato tem o seu desenho, dentro da caixa', () => {
    for (const f of [
      'cilindrico_horizontal',
      'cilindrico_vertical',
      'eliptico_horizontal',
      'oval_horizontal',
      'retangular'
    ] as const)
      confere(desenhoDoFormato(f))
  })
  it('cada tampo e cada fundo tem o seu desenho', () => {
    for (const t of ['plano', 'abaulado', 'semieliptico', 'hemisferico', 'torisferico'] as const)
      confere(desenhoDoTampo(t))
    for (const f of ['plano', 'conico', 'abaulado'] as const) confere(desenhoDoFundo(f))
  })
  it('os tampos saem diferentes entre si (é o contorno que os distingue)', () => {
    const contornos = (
      ['plano', 'abaulado', 'semieliptico', 'hemisferico', 'torisferico'] as const
    ).map((t) => desenhoDoTampo(t).tracos.find((x) => x.tipo === 'corpo' && x.d.length > 400)?.d)
    expect(new Set(contornos).size).toBe(5)
  })
  it('o mesmo pedido devolve o mesmo desenho (fica em memória)', () => {
    expect(desenhoDoTampo('hemisferico')).toBe(desenhoDoTampo('hemisferico'))
  })
})

describe('desenho do ativo no mapa', () => {
  const tanque = (
    forma: ModeloNoMapa['forma'],
    tampo: ModeloNoMapa['tampo'] = 'plano',
    fundo: ModeloNoMapa['fundo'] = 'plano'
  ): ModeloNoMapa => ({ tipo: 'tanque', forma, tampo, fundo })
  const monte: ModeloNoMapa = { tipo: 'deposito', forma: null, tampo: 'plano', fundo: 'plano' }
  const modelos: ModeloNoMapa[] = [
    tanque('cilindrico_horizontal', 'torisferico'),
    tanque('cilindrico_horizontal', 'plano'),
    tanque('eliptico_horizontal', 'abaulado'),
    tanque('oval_horizontal'),
    tanque('cilindrico_vertical', 'plano', 'conico'),
    tanque('cilindrico_vertical'),
    tanque('retangular'),
    tanque('tabela'),
    monte
  ]
  /** Altura (em pixels) que o material ocupa no desenho. */
  const alturaDoMaterial = (d: DesenhoArame): number => {
    const nivel = d.tracos.find((t) => t.tipo === 'nivel')
    if (!nivel) return 0
    const ys = (nivel.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 1)
    return Math.max(...ys) - Math.min(...ys)
  }

  it('todo formato cabe na caixa, vazio ou com material', () => {
    for (const m of modelos)
      for (const n of [null, 0, 0.12, 0.5, 1, 1.4, -0.2]) confere(desenhoNoMapa(m, n), 2)
  })
  it('sem saldo ou zerado não pinta material; com saldo, pinta', () => {
    for (const m of modelos) {
      expect(desenhoNoMapa(m, null).tracos.some((t) => t.tipo === 'nivel')).toBe(false)
      expect(desenhoNoMapa(m, 0).tracos.some((t) => t.tipo === 'nivel')).toBe(false)
      expect(desenhoNoMapa(m, 0.4).tracos.some((t) => t.tipo === 'nivel')).toBe(true)
    }
  })
  it('quanto mais estoque, mais alto o material no desenho', () => {
    for (const m of modelos) {
      const alturas = [0.1, 0.3, 0.6, 0.9, 1].map((n) => alturaDoMaterial(desenhoNoMapa(m, n)))
      for (let i = 1; i < alturas.length; i++) expect(alturas[i]).toBeGreaterThan(alturas[i - 1])
    }
  })
  it('o que passa da capacidade aparece como cheio', () => {
    for (const m of modelos) expect(desenhoNoMapa(m, 1.3)).toBe(desenhoNoMapa(m, 1))
  })
  it('o tampo do cadastro muda o desenho do tanque deitado', () => {
    const contorno = (t: ModeloNoMapa['tampo']): string | undefined =>
      desenhoNoMapa(tanque('cilindrico_horizontal', t), null).tracos.find(
        (x) => x.tipo === 'corpo' && x.d.length > 300
      )?.d
    expect(contorno('plano')).not.toBe(contorno('hemisferico'))
  })
  it('o monte é opaco: o que fica acima do material volta a ser folha', () => {
    expect(desenhoNoMapa(monte, 0.5).tracos.some((t) => t.tipo === 'vazio')).toBe(true)
    expect(desenhoNoMapa(monte, 0.5).tracos.some((t) => t.tipo === 'espelho')).toBe(false)
  })
})
