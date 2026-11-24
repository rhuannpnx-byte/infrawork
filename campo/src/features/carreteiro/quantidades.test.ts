import { describe, expect, it } from 'vitest'
import { aplicarQuantidade, quantidadeInicial, servicoPorPeso } from './quantidades'
import type { ViagemLocal } from '@/core/db/entities'
import type { CatalogoDto } from '@/types/dtos'

const catalogo = {
  servicos: [
    { id: 'vol', medicao_viagem: 'volume' },
    { id: 'peso', medicao_viagem: 'peso' },
  ],
} as unknown as CatalogoDto
const v = (id: string, servicoId: string, quantidade: number) =>
  ({ id, servicoId, quantidade }) as ViagemLocal

describe('quantidade da viagem nova', () => {
  it('vem com a capacidade do cadastro do caminhão', () => {
    expect(quantidadeInicial({ capacidade: 16, porPeso: false, anterior: 12 })).toBe(16)
    expect(quantidadeInicial({ capacidade: 16, porPeso: false, anterior: null })).toBe(16)
  })
  it('sem capacidade no cadastro repete a da viagem anterior', () => {
    expect(quantidadeInicial({ capacidade: null, porPeso: false, anterior: 12 })).toBe(12)
    expect(quantidadeInicial({ capacidade: 0, porPeso: false, anterior: 12 })).toBe(12)
    expect(quantidadeInicial({ capacidade: null, porPeso: false, anterior: undefined })).toBe(0)
  })
  it('em serviço por peso a capacidade em m³ não entra', () => {
    expect(quantidadeInicial({ capacidade: 16, porPeso: true, anterior: 21.4 })).toBe(21.4)
  })
})

describe('valor único nas viagens já lançadas', () => {
  const porPeso = (x: ViagemLocal) => servicoPorPeso(catalogo, x.servicoId)
  it('troca a quantidade das viagens por volume e mantém as de peso', () => {
    const r = aplicarQuantidade(
      [v('a', 'vol', 12), v('b', 'peso', 21.4), v('c', 'vol', 14)],
      16,
      porPeso,
    )
    expect(r.map((x) => x.quantidade)).toEqual([16, 21.4, 16])
  })
  it('não altera a lista original', () => {
    const viagens = [v('a', 'vol', 12)]
    aplicarQuantidade(viagens, 16, porPeso)
    expect(viagens[0]!.quantidade).toBe(12)
  })
  it('serviço fora do catálogo conta como volume', () => {
    expect(servicoPorPeso(catalogo, 'outro')).toBe(false)
    expect(servicoPorPeso(null, 'peso')).toBe(false)
  })
})
