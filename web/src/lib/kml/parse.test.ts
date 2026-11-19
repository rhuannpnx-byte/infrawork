import { describe, expect, it } from 'vitest'
import { areaDaColecao } from './parse'

const fc = (...geoms: GeoJSON.Geometry[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: geoms.map((geometry) => ({ type: 'Feature', properties: {}, geometry }))
})
const anel = [
  [-49, -16, 120],
  [-48.99, -16, 120],
  [-48.99, -15.99, 120],
  [-49, -16, 120]
]

describe('areaDaColecao', () => {
  it('pega o primeiro polígono, sem altitude, e calcula os limites', () => {
    const r = areaDaColecao(
      fc({ type: 'Point', coordinates: [0, 0] }, { type: 'Polygon', coordinates: [anel] })
    )
    expect(r.geometry.coordinates[0]).toEqual([
      [-49, -16],
      [-48.99, -16],
      [-48.99, -15.99],
      [-49, -16]
    ])
    expect(r.bounds).toEqual({ south: -16, west: -49, north: -15.99, east: -48.99 })
    expect(r.totalPoligonos).toBe(1)
  })

  it('conta os polígonos de um MultiPolygon e usa o primeiro', () => {
    const r = areaDaColecao(fc({ type: 'MultiPolygon', coordinates: [[anel], [anel]] }))
    expect(r.totalPoligonos).toBe(2)
  })

  it('polilinha fechada vira contorno; aberta não', () => {
    expect(areaDaColecao(fc({ type: 'LineString', coordinates: anel })).geometry.type).toBe(
      'Polygon'
    )
    expect(() => areaDaColecao(fc({ type: 'LineString', coordinates: anel.slice(0, 3) }))).toThrow(
      /Nenhum polígono/
    )
  })

  it('fecha o anel que veio aberto', () => {
    const aberto = anel.slice(0, 3)
    const r = areaDaColecao(fc({ type: 'Polygon', coordinates: [[...aberto, [-49, -15.99]]] }))
    const a = r.geometry.coordinates[0]
    expect(a[0]).toEqual(a[a.length - 1])
  })
})
