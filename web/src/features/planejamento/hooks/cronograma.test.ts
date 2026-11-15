import { describe, expect, it } from 'vitest'
import type { PlanejamentoTarefaCompleta } from '@/types/planejamento'
import { calcularCurvaSemanal } from './cronograma'

const direta = (semanas: [string, number][]): PlanejamentoTarefaCompleta =>
  ({
    id: 'd',
    is_indireto: false,
    custo_unit_snapshot: 0,
    venda_unitaria_item: 10,
    perfil_semanas: semanas.map(([semana_segunda, quantidade_planejada]) => ({
      semana_segunda,
      quantidade_planejada
    }))
  }) as unknown as PlanejamentoTarefaCompleta

const indireta = (modo: string): PlanejamentoTarefaCompleta =>
  ({
    id: 'i',
    is_indireto: true,
    data_inicio: '2026-11-02',
    data_fim: '2026-11-20',
    custo_total_calc: 300,
    custo_taxas_calc: 0,
    receita_total_calc: 1200,
    indireto_config: { receita_modo: modo }
  }) as unknown as PlanejamentoTarefaCompleta

describe('curva S com indireto', () => {
  // diretas: 100 + 300 de faturamento em duas das três semanas
  const d = direta([
    ['2026-11-02', 10],
    ['2026-11-16', 30]
  ])

  it('receita no ritmo dos serviços diretos', () => {
    const c = calcularCurvaSemanal([d, indireta('percentual_dos_servicos')])
    expect(c.map((b) => b.receita_periodo)).toEqual([100 + 300, 0, 300 + 900])
    expect(c.map((b) => b.custo_periodo)).toEqual([100, 100, 100])
  })

  it('receita por tempo, igual em cada semana', () => {
    const c = calcularCurvaSemanal([d, indireta('mesma_logica_custo')])
    expect(c.map((b) => b.receita_periodo)).toEqual([100 + 400, 400, 300 + 400])
  })
})
