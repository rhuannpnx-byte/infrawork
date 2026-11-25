import { describe, expect, it } from 'vitest'
import { desenhoDoFormato, desenhoDoFundo, desenhoDoTampo, type DesenhoArame } from './arame3d'

/** Todos os números dos caminhos, para conferir que o desenho cabe na caixa e não tem conta quebrada. */
const numeros = (d: DesenhoArame): number[] =>
  d.tracos.flatMap((t) => (t.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number))

const confere = (d: DesenhoArame): void => {
  expect(d.tracos.length).toBeGreaterThan(2)
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
