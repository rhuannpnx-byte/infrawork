import { describe, expect, it } from 'vitest'
import { fechoConvexo } from './tempo-caminho'

describe('fechoConvexo', () => {
  it('quadrado com ponto interno: fecho com os 4 cantos', () => {
    const h = fechoConvexo([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 }
    ])
    expect(h).toHaveLength(4)
    expect(h).toEqual(
      expect.arrayContaining([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 }
      ])
    )
  })
  it('menos de 3 pontos distintos: devolve o que há', () => {
    expect(
      fechoConvexo([
        { x: 1, y: 1 },
        { x: 1, y: 1 }
      ])
    ).toEqual([{ x: 1, y: 1 }])
  })
})
