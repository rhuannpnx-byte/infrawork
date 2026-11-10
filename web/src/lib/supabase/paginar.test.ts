import { describe, expect, it } from 'vitest'
import { PAGINA_API, lerTodas } from './paginar'

/** Imita a API: devolve no máximo PAGINA_API linhas do intervalo pedido. */
type Pagina = { data: number[]; error: null }
const fonte = (
  total: number
): { consulta: (de: number, ate: number) => Promise<Pagina>; chamadas: [number, number][] } => {
  const chamadas: [number, number][] = []
  const consulta = async (de: number, ate: number): Promise<Pagina> => {
    chamadas.push([de, ate])
    const fim = Math.min(ate, de + PAGINA_API - 1, total - 1)
    return {
      data: Array.from({ length: Math.max(0, fim - de + 1) }, (_, i) => de + i),
      error: null
    }
  }
  return { consulta, chamadas }
}

describe('lerTodas', () => {
  it('junta as páginas até a última incompleta', async () => {
    const f = fonte(2500)
    const r = await lerTodas(f.consulta)
    expect(r).toHaveLength(2500)
    expect(r[2499]).toBe(2499)
    expect(f.chamadas).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999]
    ])
  })
  it('múltiplo exato de 1000 pede uma página vazia a mais', async () => {
    const f = fonte(2000)
    expect(await lerTodas(f.consulta)).toHaveLength(2000)
    expect(f.chamadas).toHaveLength(3)
  })
  it('respeita o limite', async () => {
    const f = fonte(5000)
    expect(await lerTodas(f.consulta, 1500)).toHaveLength(1500)
    expect(f.chamadas).toEqual([
      [0, 999],
      [1000, 1499]
    ])
  })
  it('repassa o erro', async () => {
    await expect(
      lerTodas(async () => ({ data: null, error: new Error('falhou') }))
    ).rejects.toThrow('falhou')
  })
})
