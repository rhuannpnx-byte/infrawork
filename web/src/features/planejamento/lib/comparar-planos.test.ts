import { describe, expect, it } from 'vitest'
import { compararPlanos, type LinhaPlano } from './comparar-planos'

const l = (id: string, o: Partial<LinhaPlano> & { nome?: string } = {}): LinhaPlano => ({
  id,
  parent_id: null,
  tipo_no: 'tarefa',
  ordem: 0,
  item_orcamentario_id: null,
  nome_custom: o.nome ?? id,
  data_inicio: null,
  data_fim: null,
  ...o
})

describe('compararPlanos', () => {
  const base = [
    l('g', { tipo_no: 'grupo', nome: 'Terraplenagem' }),
    l('a', {
      parent_id: 'g',
      ordem: 0,
      nome: 'Escavação T1',
      item_orcamentario_id: 'esc',
      data_inicio: '2026-06-01',
      data_fim: '2026-09-21'
    }),
    l('b', {
      parent_id: 'g',
      ordem: 1,
      nome: 'Escavação Contorno',
      item_orcamentario_id: 'esc',
      data_inicio: '2026-09-22',
      data_fim: '2027-03-10'
    })
  ]

  it('pareia tarefas do mesmo serviço pela posição (ids novos numa cópia) e o grupo pelo período das filhas', () => {
    const copia = [
      l('g2', { tipo_no: 'grupo', nome: 'Terraplenagem' }),
      l('a2', {
        parent_id: 'g2',
        ordem: 0,
        nome: 'Escavação T1',
        item_orcamentario_id: 'esc',
        data_inicio: '2026-06-03',
        data_fim: '2026-09-21'
      }),
      l('b2', {
        parent_id: 'g2',
        ordem: 1,
        nome: 'Escavação Contorno',
        item_orcamentario_id: 'esc',
        data_inicio: '2026-09-22',
        data_fim: '2027-03-15'
      })
    ]
    const r = compararPlanos(base, copia)
    expect(r.map((x) => [x.numero, x.nome, x.dInicio, x.dFim])).toEqual([
      ['1', 'Terraplenagem', 2, 5],
      ['1.1', 'Escavação T1', 2, 0],
      ['1.2', 'Escavação Contorno', 0, 5]
    ])
    expect(r[0]!.esq).toEqual({ inicio: '2026-06-01', fim: '2027-03-10' })
  })

  it('o que só existe de um lado aparece sozinho, no lugar do seu plano', () => {
    const outro = [
      l('g2', { tipo_no: 'grupo', nome: 'Terraplenagem' }),
      l('a2', { parent_id: 'g2', ordem: 0, nome: 'Escavação T1', item_orcamentario_id: 'esc' }),
      l('n2', { parent_id: 'g2', ordem: 1, nome: 'Bota-fora', item_orcamentario_id: 'bf' })
    ]
    const r = compararPlanos(base, outro)
    expect(r.map((x) => [x.nome, !!x.esq, !!x.dir])).toEqual([
      ['Terraplenagem', true, true],
      ['Escavação T1', true, true],
      ['Bota-fora', false, true],
      ['Escavação Contorno', true, false]
    ])
  })
})
