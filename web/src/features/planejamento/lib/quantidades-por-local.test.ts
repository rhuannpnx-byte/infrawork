import { describe, expect, it } from 'vitest'
import type { SegmentoValores } from '@/lib/quantidades/segmentos'
import { quantidadesPorLocal, type ServicoQuantidade } from './quantidades-por-local'

const sv = (id: string, quantidade: number): ServicoQuantidade => ({
  id,
  codigo: id,
  descricao: `Serviço ${id}`,
  unidade: 'm³',
  quantidade
})
const seg = (valores: Record<string, number>): SegmentoValores => ({
  ini: 0,
  fim: 1,
  label_ini: '',
  label_fim: '',
  valores
})

describe('quantidadesPorLocal', () => {
  const r = quantidadesPorLocal(
    [sv('A', 1000), sv('B', 100), sv('C', 50), sv('Z', 0)],
    new Map([
      ['eixo1', [seg({ A: 300, B: 40 }), seg({ A: 200 })]],
      ['area1', [seg({ A: 100, B: 70 })]]
    ])
  )

  it('soma as faixas de cada local por serviço', () => {
    const a = r.find((l) => l.servico.id === 'A')!
    expect(Object.fromEntries(a.porLocal)).toEqual({ eixo1: 500, area1: 100 })
    expect(a.nosLocais).toBe(600)
    expect(a.semLocal).toBe(400)
  })

  it('mostra o que passa do orçado e o serviço ainda sem local', () => {
    expect(r.find((l) => l.servico.id === 'B')!.semLocal).toBe(-10)
    const c = r.find((l) => l.servico.id === 'C')!
    expect(c.porLocal.size).toBe(0)
    expect(c.semLocal).toBe(50)
  })

  it('serviço sem quantidade e sem local fica de fora', () => {
    expect(r.map((l) => l.servico.id)).toEqual(['A', 'B', 'C'])
  })
})
