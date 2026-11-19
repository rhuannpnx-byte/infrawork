import { describe, expect, it } from 'vitest'
import { Calendar, type CalendarSpec } from '@apex/calendar'
import { calcularIndiretos } from './indiretos'
import type { IndiretoConfig, PlanoEntrada, TarefaEntrada } from './tipos'

const H = 3600
// segunda a sexta, 07:00–15:00
const segSex: CalendarSpec = {
  version: 12,
  week: {
    flag: 1,
    days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      begin: 7 * H,
      length: d < 5 ? 8 * H : 0
    })) as CalendarSpec['week']['days']
  },
  generators: [],
  order: [],
  spans: []
}
const cal = new Calendar(segSex)
const seg = (iso: string): number => Date.parse(iso + 'Z') / 1000

const BASE: IndiretoConfig = {
  custo_periodicidade: 'mes',
  custo_unitario: null,
  receita_modo: 'mesma_logica_custo',
  receita_unitaria: null,
  receita_percentual: null,
  offset_dias_antes: 0,
  offset_dias_depois: 0,
  receita_extrapola: true,
  aplica_taxas: false,
  taxa_percentual: null
}

const indireta = (id: string, cfg: Partial<IndiretoConfig>): TarefaEntrada =>
  ({
    id,
    tipo_no: 'tarefa',
    is_indireto: true,
    indireto: { ...BASE, ...cfg },
    // mobilização orçada: 1 un × R$ 100.000 de custo, R$ 120.000 de venda
    custo_unitario_item: 100_000,
    quantidade_referencia: 1,
    venda_total_item: 120_000,
    quantidade: 1
  }) as TarefaEntrada

// diretas: segunda 02/11/2026 07:00 até sexta 26/03/2027 15:00 (21 semanas)
const diretas = new Map([
  ['d1', { inicio: seg('2026-11-02T07:00:00'), fim: seg('2027-03-26T15:00:00') }]
])
const plano = (tarefas: TarefaEntrada[]): PlanoEntrada =>
  ({
    tarefas: [{ id: 'd1', tipo_no: 'tarefa', quantidade: 1, venda_unitaria: 1000 }, ...tarefas]
  }) as PlanoEntrada

describe('indireto em parcelas', () => {
  const [mob, desmob] = calcularIndiretos(
    plano([
      indireta('mob', {
        distribuicao: 'parcela',
        parcela_percentual: 0.5,
        parcela_ancora: 'inicio',
        parcela_dias: 10
      }),
      indireta('desmob', {
        distribuicao: 'parcela',
        parcela_percentual: 0.5,
        parcela_ancora: 'fim',
        parcela_dias: 5
      })
    ]),
    diretas,
    cal
  )

  it('a parcela do início ocupa os primeiros N dias úteis das diretas', () => {
    expect(mob.inicio).toBe(seg('2026-11-02T07:00:00'))
    expect(mob.fim).toBe(seg('2026-11-13T15:00:00'))
    expect(mob.dias_uteis).toBe(10)
  })

  it('a parcela do fim ocupa os últimos N dias úteis', () => {
    expect(desmob.fim).toBe(seg('2027-03-26T15:00:00'))
    expect(desmob.inicio).toBe(seg('2027-03-22T07:00:00'))
    expect(desmob.dias_uteis).toBe(5)
  })

  it('custo e receita são o percentual do valor total orçado do item', () => {
    expect([mob.custo_total, mob.receita_total]).toEqual([50_000, 60_000])
    expect([desmob.custo_total, desmob.receita_total]).toEqual([50_000, 60_000])
  })

  it('pontual: uma parcela de 100%; mais dias que a obra = a obra inteira', () => {
    const [canteiro] = calcularIndiretos(
      plano([
        indireta('c', {
          distribuicao: 'parcela',
          parcela_percentual: 1,
          parcela_ancora: 'inicio',
          parcela_dias: 9999
        })
      ]),
      diretas,
      cal
    )
    expect(canteiro.fim).toBe(seg('2027-03-26T15:00:00'))
    expect(canteiro.custo_total).toBe(100_000)
  })

  it('contínuo continua igual: custo unitário × meses na janela', () => {
    const [adm] = calcularIndiretos(plano([indireta('adm', {})]), diretas, cal)
    expect(adm.inicio).toBe(seg('2026-11-02T07:00:00'))
    expect(adm.custo_total).toBeGreaterThan(400_000)
  })
})
