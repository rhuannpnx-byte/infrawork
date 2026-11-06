import { describe, expect, it } from 'vitest'
import type { PainelProducaoDto } from '@/types/dtos'
import {
  SEM,
  detalheDoDia,
  diaDaSemana,
  eixoDias,
  encarregadosDoServico,
  equipesDoFiltro,
  nivelCalor,
  producaoPorDia,
  qtdCurta,
  resumoProducao,
  servicosComProducao,
} from './producao'

const prod: PainelProducaoDto = {
  desde: '2026-10-01',
  dias: [
    { d: '2026-11-01', s: 'esc', e: 'eq1', n: 'joao', q: 100 },
    { d: '2026-11-01', s: 'esc', e: 'eq2', n: 'joao', q: 50 },
    { d: '2026-11-02', s: 'esc', e: 'eq3', n: 'maria', q: 80 },
    { d: '2026-11-03', s: 'esc', e: null, n: null, q: 10 },
    { d: '2026-10-20', s: 'sub', e: 'eq1', n: 'joao', q: 300 },
  ],
  servicos: {
    esc: { codigo: '2.1', descricao: 'Escavação', unidade: 'm³' },
    sub: { codigo: '3.1', descricao: 'Sub-base', unidade: 'm³' },
  },
  equipes: { eq1: 'Escavação 01', eq2: 'Escavação 02', eq3: 'Escavação 03' },
  encarregados: { joao: 'João', maria: 'Maria' },
}

describe('filtros da produção diária', () => {
  it('serviço com produção mais recente vem primeiro; filtro de equipe restringe a lista', () => {
    expect(servicosComProducao(prod).map((s) => s.id)).toEqual(['esc', 'sub'])
    expect(servicosComProducao(prod, { encarregado: null, equipe: 'eq1' })[0]?.id).toBe('esc')
    expect(
      servicosComProducao(prod, { encarregado: 'maria', equipe: null }).map((s) => s.id),
    ).toEqual(['esc'])
  })

  it('encarregados e equipes do serviço, "sem" no fim', () => {
    expect(encarregadosDoServico(prod, 'esc').map((o) => [o.nome, o.total])).toEqual([
      ['João', 150],
      ['Maria', 80],
      ['Sem encarregado', 10],
    ])
    expect(equipesDoFiltro(prod, 'esc', 'joao').map((o) => o.id)).toEqual(['eq1', 'eq2'])
    expect(equipesDoFiltro(prod, 'esc', null).at(-1)?.id).toBe(SEM)
  })

  it('soma por dia dentro do filtro', () => {
    const todos = producaoPorDia(prod, { servico: 'esc', encarregado: null, equipe: null })
    expect(Object.fromEntries(todos)).toEqual({
      '2026-11-01': 150,
      '2026-11-02': 80,
      '2026-11-03': 10,
    })
    const joao = producaoPorDia(prod, { servico: 'esc', encarregado: 'joao', equipe: 'eq2' })
    expect(Object.fromEntries(joao)).toEqual({ '2026-11-01': 50 })
    const sem = producaoPorDia(prod, { servico: 'esc', encarregado: null, equipe: SEM })
    expect(Object.fromEntries(sem)).toEqual({ '2026-11-03': 10 })
  })

  it('detalhe do dia por equipe (ou por encarregado quando a equipe está filtrada)', () => {
    const f = { servico: 'esc', encarregado: null, equipe: null }
    expect(detalheDoDia(prod, f, '2026-11-01').map((o) => [o.nome, o.total])).toEqual([
      ['Escavação 01', 100],
      ['Escavação 02', 50],
    ])
    expect(detalheDoDia(prod, { ...f, equipe: 'eq1' }, '2026-11-01').map((o) => o.nome)).toEqual([
      'João',
    ])
  })
})

describe('eixo e resumo', () => {
  it('dias corridos e dia da semana sem depender do fuso', () => {
    expect(eixoDias('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ])
    expect(diaDaSemana('2026-11-01')).toBe(0)
  })

  it('total, dias com produção, média e melhor dia', () => {
    const m = new Map([
      ['2026-11-01', 150],
      ['2026-11-02', 80],
    ])
    const r = resumoProducao(m, eixoDias('2026-10-31', '2026-11-03'))
    expect(r).toEqual({ total: 230, diasCom: 2, media: 115, melhor: { d: '2026-11-01', q: 150 } })
  })

  it('faixa de cor e número curto', () => {
    expect([0, 10, 30, 60, 100].map((q) => nivelCalor(q, 100))).toEqual([0, 1, 2, 3, 4])
    expect([7.25, 640, 6200, 18_400].map(qtdCurta)).toEqual(['7,3', '640', '6,2k', '18k'])
  })
})
