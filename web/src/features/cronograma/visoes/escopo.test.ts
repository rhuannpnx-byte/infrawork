import { describe, expect, it } from 'vitest'
import type { TarefaEntrada } from '../motor/tipos'
import { estadoDoEscopo, resumoDoEscopo, type ItemEscopo } from './escopo'

const item = (
  id: string,
  qtd: number,
  venda: number | null,
  extra: Partial<ItemEscopo> = {}
): ItemEscopo => ({
  id,
  codigo: id,
  descricao: `Serviço ${id}`,
  unidade: 'm³',
  quantidade_referencia: qtd,
  venda_total: venda,
  indireto_id: null,
  ...extra
})

const tarefa = (
  id: string,
  itemId: string | null,
  qtd: number,
  extra: Partial<TarefaEntrada> = {}
): TarefaEntrada =>
  ({
    id,
    tipo_no: 'tarefa',
    nome: `Tarefa ${id}`,
    item_orcamentario_id: itemId,
    is_indireto: false,
    quantidade: qtd,
    ...extra
  }) as TarefaEntrada

describe('estadoDoEscopo', () => {
  it('classifica pelo que falta', () => {
    expect(estadoDoEscopo(100, 0)).toBe('sem')
    expect(estadoDoEscopo(100, 40)).toBe('parcial')
    expect(estadoDoEscopo(100, 100)).toBe('completo')
    expect(estadoDoEscopo(100, 100.5)).toBe('acima')
  })
  it('diferença de arredondamento não vira saldo', () => {
    expect(estadoDoEscopo(1000, 999.99998)).toBe('completo')
    expect(estadoDoEscopo(1000, 1000.00003)).toBe('completo')
  })
})

describe('resumoDoEscopo', () => {
  const itens = [
    item('A', 1000, 50_000),
    item('B', 200, 30_000),
    item('C', 10, 20_000),
    item('IND', 12, 99_000, { indireto_id: 'x' })
  ]
  const tarefas = [
    tarefa('1', 'A', 400),
    tarefa('2', 'A', 350, { parent_id: 'g' }),
    tarefa('3', 'B', 200),
    tarefa('4', null, 5),
    tarefa('5', 'IND', 12, { is_indireto: true }),
    tarefa('g', 'A', 999, { tipo_no: 'grupo', nome: 'Ano 1' })
  ]
  const r = resumoDoEscopo(itens, tarefas)

  it('soma as tarefas de cada serviço e deixa de fora grupo e indireto', () => {
    expect(r.linhas.map((l) => [l.id, l.distribuido, l.saldo, l.estado])).toEqual([
      ['A', 750, 250, 'parcial'],
      ['B', 200, 0, 'completo'],
      ['C', 0, 10, 'sem']
    ])
    expect(r.linhas[0].tarefas.map((t) => [t.id, t.grupo])).toEqual([
      ['1', null],
      ['2', 'Ano 1']
    ])
    expect(r.contagem).toEqual({ sem: 1, parcial: 1, completo: 1, acima: 0 })
    expect(r.tarefasSemItem).toBe(1)
  })

  it('o total da obra sai em valor, pela venda de cada serviço', () => {
    expect(r.valorOrcado).toBe(100_000)
    expect(r.valorDistribuido).toBe(50_000 * 0.75 + 30_000)
    expect(r.fracaoValor).toBeCloseTo(0.675)
  })

  it('o que passa do orçado aparece, mas não infla o valor distribuído', () => {
    const x = resumoDoEscopo([item('A', 100, 10_000)], [tarefa('1', 'A', 130)])
    expect(x.linhas[0]).toMatchObject({ estado: 'acima', saldo: -30 })
    expect(x.valorDistribuido).toBe(10_000)
  })

  it('agrupador sem quantidade e sem tarefa não entra; orçamento sem venda não tem percentual', () => {
    const x = resumoDoEscopo([item('Z', 0, null), item('A', 10, null)], [])
    expect(x.linhas.map((l) => l.id)).toEqual(['A'])
    expect(x.fracaoValor).toBeNull()
  })
})
