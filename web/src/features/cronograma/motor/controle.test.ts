import { describe, expect, it } from 'vitest'
import { repartirProducao } from './controle'
import type { PlanoEntrada, TarefaEntrada } from './tipos'

const tarefa = (
  id: string,
  qtd: number,
  locais: { trecho_id: string | null; ini: number | null; fim: number | null }[],
  equipes: string[] = []
): TarefaEntrada =>
  ({
    id,
    tipo_no: 'tarefa',
    parent_id: null,
    ordem: 0,
    nome: id,
    item_orcamentario_id: 'item',
    servico_id: 's',
    is_indireto: false,
    quantidade: qtd,
    equipes_ids: equipes,
    locais: locais.map((l, k) => ({
      id: `${id}-${k}`,
      ordem: k,
      trecho_id: l.trecho_id,
      inicio_m: l.ini,
      fim_m: l.fim,
      quantidade: qtd / locais.length,
      qtd_origem: 'manual' as const
    }))
  }) as unknown as TarefaEntrada

const e = {
  tarefas: [
    tarefa('a', 100, [{ trecho_id: 't1', ini: 0, fim: 1000 }]),
    tarefa('b', 100, [{ trecho_id: 't1', ini: 1000, fim: 2000 }]),
    tarefa('c', 50, [{ trecho_id: 'ar', ini: null, fim: null }])
  ]
} as unknown as PlanoEntrada
const inicio = (id: string): number => ({ a: 1, b: 2, c: 3 })[id] ?? 0

describe('repartirProducao por estaca', () => {
  it('lançamento com faixa vai para a tarefa cujo local a cobre', () => {
    const r = repartirProducao(
      e,
      {
        data: '2026-10-10',
        producoes: [
          {
            item_orcamentario_id: 'item',
            equipe_id: null,
            data: '2026-10-01',
            quantidade: 30,
            trecho_id: 't1',
            inicio_m: 1200,
            fim_m: 1500
          }
        ]
      },
      inicio
    )
    expect(r.get('a')).toBeUndefined()
    expect(r.get('b')).toEqual([{ data: '2026-10-01', quantidade: 30 }])
  })
  it('faixa que cruza duas tarefas: rateio pela sobreposição', () => {
    const r = repartirProducao(
      e,
      {
        data: '2026-10-10',
        producoes: [
          {
            item_orcamentario_id: 'item',
            equipe_id: null,
            data: '2026-10-01',
            quantidade: 40,
            trecho_id: 't1',
            inicio_m: 900,
            fim_m: 1300
          }
        ]
      },
      inicio
    )
    expect(r.get('a')![0]!.quantidade).toBeCloseTo(10, 6)
    expect(r.get('b')![0]!.quantidade).toBeCloseTo(30, 6)
  })
  it('estaca pontual (descarga de viagem): vai para a tarefa que contém o ponto', () => {
    const r = repartirProducao(
      e,
      {
        data: '2026-10-10',
        producoes: [
          {
            item_orcamentario_id: 'item',
            equipe_id: null,
            data: '2026-10-01',
            quantidade: 12,
            trecho_id: 't1',
            inicio_m: 1500,
            fim_m: 1500
          }
        ]
      },
      inicio
    )
    expect(r.get('a')).toBeUndefined()
    expect(r.get('b')).toEqual([{ data: '2026-10-01', quantidade: 12 }])
  })
  it('área: a tarefa na área; faixa sem tarefa que cubra: regra geral (ordem de início)', () => {
    const r = repartirProducao(
      e,
      {
        data: '2026-10-10',
        producoes: [
          {
            item_orcamentario_id: 'item',
            equipe_id: null,
            data: '2026-10-01',
            quantidade: 5,
            trecho_id: 'ar'
          },
          {
            item_orcamentario_id: 'item',
            equipe_id: null,
            data: '2026-10-02',
            quantidade: 7,
            trecho_id: 't9',
            inicio_m: 0,
            fim_m: 10
          }
        ]
      },
      inicio
    )
    expect(r.get('c')).toEqual([{ data: '2026-10-01', quantidade: 5 }])
    expect(r.get('a')).toEqual([{ data: '2026-10-02', quantidade: 7 }])
  })
})
