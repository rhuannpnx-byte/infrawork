import { describe, expect, it } from 'vitest'
import length from '@turf/length'
import { lineString } from '@turf/helpers'
import { marcadoresDoTrecho, posicionarMarcadores } from './marcadores-mapa'
import type { ObraTrecho } from '@/types/gerencial'

const linha: number[][] = [
  [-49.3, -16.7],
  [-49.29, -16.7],
  [-49.29, -16.69]
]
const comprimento = length(lineString(linha), { units: 'meters' })

function trecho(over: Partial<ObraTrecho>): ObraTrecho {
  return {
    unidade_espaco_padrao: 'km',
    unidade_custom_label: null,
    unidade_custom_divisor_m: null,
    marcador_valor_inicial: 0,
    geometry_sentido: 'natural',
    geometry_geojson: { type: 'LineString', coordinates: linha },
    geometry_comprimento_m: comprimento,
    ...over
  } as ObraTrecho
}

describe('marcadores do trecho no mapa', () => {
  it('um marcador por unidade, numerado a partir do valor inicial', () => {
    const ms = marcadoresDoTrecho(
      trecho({ unidade_espaco_padrao: 'km', marcador_valor_inicial: 5 })
    )
    expect(ms.map((m) => m.label)).toEqual(['km 5', 'km 6', 'km 7'])
    expect(marcadoresDoTrecho(trecho({ unidade_espaco_padrao: 'estaca' }))).toHaveLength(
      Math.floor(comprimento / 20) + 1
    )
  })

  it('trecho sem linha não tem marcador', () => {
    expect(marcadoresDoTrecho(trecho({ geometry_geojson: null }))).toEqual([])
  })

  it('coloca cada marcador sobre a linha, inclusive depois da curva', () => {
    const tam1 = length(lineString(linha.slice(0, 2)), { units: 'meters' })
    const [ini, meio, curva, fim] = posicionarMarcadores(linha, [
      { posicaoM: 0, label: 'a' },
      { posicaoM: tam1 / 2, label: 'b' },
      { posicaoM: tam1 + 100, label: 'c' },
      { posicaoM: comprimento, label: 'd' }
    ])
    expect(ini.lng).toBeCloseTo(-49.3, 6)
    expect(meio.lng).toBeCloseTo(-49.295, 5)
    expect(meio.lat).toBeCloseTo(-16.7, 6)
    expect(curva.lng).toBeCloseTo(-49.29, 6)
    expect(curva.lat).toBeGreaterThan(-16.7)
    expect(fim.lat).toBeCloseTo(-16.69, 5)
  })
})
