import { describe, expect, it } from 'vitest'
import type { Modelo4D } from './contrato'
import { geoParaUtm, lerFuso, utmParaGeo } from './geo'
import { prepararModelo } from './preparar'
import { RelevoRegional } from './relevo'

describe('UTM e geográficas', () => {
  const fuso = lerFuso('22S')!

  it('lê o fuso com hemisfério, com faixa de latitude ou só o número', () => {
    expect(lerFuso('22S')).toEqual({ zona: 22, sul: true })
    expect(lerFuso('23K')).toEqual({ zona: 23, sul: true })
    expect(lerFuso('18N')).toEqual({ zona: 18, sul: false })
    expect(lerFuso('22')).toEqual({ zona: 22, sul: true })
    expect(lerFuso('fuso')).toBeNull()
  })

  it('converte uma placa da GO-425 nos dois sentidos', () => {
    // placa R-1 do projeto: latitude e longitude e a mesma posição em UTM 22S
    const [e, n] = geoParaUtm(-48.289912, -15.959062, fuso)
    expect(e).toBeCloseTo(790107.99, 0)
    expect(n).toBeCloseTo(8233705.48, 0)
    const [lon, lat] = utmParaGeo(790107.99, 8233705.48, fuso)
    expect(lon).toBeCloseTo(-48.289912, 5)
    expect(lat).toBeCloseTo(-15.959062, 5)
  })
})

describe('relevo regional ajustado ao projeto', () => {
  // eixo de 200 m para leste; o levantamento do projeto (cota 100) cobre 30 m para cada lado
  const cotas = new Uint8Array(21 * 7 * 2)
  for (let i = 0; i < 21 * 7; i++) {
    cotas[2 * i] = 10000 & 255
    cotas[2 * i + 1] = 10000 >> 8
  }
  const modelo: Modelo4D = {
    formato: 'infrawork-4d',
    versao: 1,
    nome: 'Relevo',
    origem: { e: 500000, n: 8000000, fuso: '22S' },
    eixos: [{ id: 'E1', nome: 'Eixo', pontos: [0, 100, 200].map((x) => [x, x, 0, 100]) }],
    terreno: [
      { nx: 21, ny: 7, res: 10, x0: 0, ytop: 30, zb: 0, atual: btoa(String.fromCharCode(...cotas)) }
    ],
    classes: [{ id: 'A', nome: 'A', disciplina: 'x' }],
    elementos: [{ id: 'a', classe: 'A', geo: { t: 'caixa', p: [0, 0, 100], dim: [1, 1, 1] } }]
  }
  const pronto = prepararModelo(modelo)
  // o relevo regional diz 500 m em toda parte (em meios metros)
  const relevo = new RelevoRegional(pronto, async () => new Int16Array(65536).fill(1000))
  const fuso = pronto.fuso!
  const cota = async (x: number, n: number): Promise<number> => {
    const [lon, lat] = utmParaGeo(500000 + x, 8000000 + n, fuso)
    const d = 1e-5
    const h = await relevo.alturas(lon - d, lat - d, lon + d, lat + d, 3, 3, 18)
    return h[4]
  }

  it('na obra vale o levantamento do projeto', async () => {
    expect(await cota(100, 0)).toBeCloseTo(100, 0)
    expect(await cota(100, 25)).toBeCloseTo(100, 0)
  })

  it('em volta, o relevo regional encosta no do projeto e volta ao próprio valor longe da obra', async () => {
    // logo fora do levantamento: o regional deslocado de 500 para 100
    expect(await cota(100, 200)).toBeLessThan(140)
    const meio = await cota(100, 1300)
    expect(meio).toBeGreaterThan(150)
    expect(meio).toBeLessThan(450)
    expect(await cota(100, 6000)).toBeCloseTo(500, 0)
  })
})
