/**
 * Adaptador InfraWork → motor do ApeX: casos calculados à mão.
 * Calendário seg–sex 07:00, 8 h; início numa segunda (2026-11-09); composição de 100/dia (12,5/h).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { calcularPlano, payloadGravacao } from './calculo'
import { aplicarComando, equipesParaTermino } from './edicao'
import { especificacaoCalendario, feriadosMoveis } from './calendario'
import { Calendar } from '@apex/calendar'
import { isoParaSeg } from './tempo'
import { segParaTimestamp } from './tempo'
import { conferirTempoCaminho } from '../visoes/conferir-tempo-caminho'
import { montarHistograma } from '../visoes/histograma'
import type { CalendarioEntrada, PlanoEntrada, TarefaEntrada } from './tipos'
import type { ProducaoLancada } from './controle'

const MODELO = new Uint8Array(
  readFileSync(resolve(__dirname, '../../../../vendor/apex/fixtures/default.dr5'))
)

const SEG_SEX: CalendarioEntrada = {
  id: 'cal-1',
  nome: 'Obra',
  padrao: true,
  semana: [8, 8, 8, 8, 8, 0, 0].map((h) => ({ inicio: '07:00', horas: h })),
  definicoes: []
}

function tarefa(id: string, o: Partial<TarefaEntrada> = {}): TarefaEntrada {
  return {
    id,
    tipo_no: 'tarefa',
    parent_id: null,
    ordem: 0,
    nome: id,
    item_orcamentario_id: 'item-' + (o.servico_id ?? 'A'),
    servico_id: 'A',
    is_indireto: false,
    quantidade: 1000,
    prioridade: 500,
    asap: true,
    inicio_dia: false,
    sentido: 'crescente',
    restricao_inicio: null,
    restricao_inicio_em: null,
    restricao_fim: null,
    restricao_fim_em: null,
    coef_producao: 1,
    qtd_equipes: 1,
    calendario_id: null,
    derivar_predecessoras: true,
    equipes_ids: [],
    locais: [
      {
        id: id + '-l1',
        ordem: 0,
        trecho_id: 'tr1',
        inicio_m: 0,
        fim_m: 1000,
        quantidade: o.quantidade ?? 1000,
        qtd_origem: 'manual'
      }
    ],
    inicio_em: null,
    venda_unitaria: 10,
    venda_total_item: null,
    quantidade_referencia: null,
    custo_unitario_item: null,
    indireto: null,
    ...o
  }
}

function plano(tarefas: TarefaEntrada[], o: Partial<PlanoEntrada> = {}): PlanoEntrada {
  return {
    plano: {
      id: 'p1',
      nome: 'Plano',
      inicio: '2026-11-09',
      prazo: '2027-12-31',
      calendario_id: null,
      modo: 'programacao',
      is_baseline: false,
      dados_rev: 3
    },
    calendarios: [SEG_SEX],
    fatoresMes: [],
    trechos: [
      { id: 'tr1', nome: 'Eixo', tipo: 'eixo', comprimento_m: 5000 },
      { id: 'ar1', nome: 'Pátio', tipo: 'area', comprimento_m: null }
    ],
    servicos: [
      { id: 'A', codigo: '01', nome: 'Base', unidade: 'm³' },
      { id: 'B', codigo: '02', nome: 'Revestimento', unidade: 'm²' }
    ],
    equipes: [
      {
        servico_id: 'A',
        producao_diaria: 100,
        recursos: [
          { recurso_id: 'esc', nome: 'Escavadeira', qtd: 1 },
          { recurso_id: 'aj', nome: 'Ajudante', qtd: 2.5 }
        ]
      },
      {
        servico_id: 'B',
        producao_diaria: 100,
        recursos: [{ recurso_id: 'rolo', nome: 'Rolo', qtd: 0.5 }]
      }
    ],
    tiposDependencias: [],
    equipesNomeadas: [],
    tarefas,
    dependencias: [],
    marcos: [],
    limites: [],
    templates: {},
    ...o
  }
}

const ts = (s: number): string => segParaTimestamp(s)

describe('adaptador do cronograma (motor do ApeX)', () => {
  it('duração = quantidade ÷ (produção/dia ÷ jornada) em horas de trabalho; perfil por dia', () => {
    const r = calcularPlano(plano([tarefa('T1')]), MODELO).resultado
    const t = r.tarefas.get('T1')!
    expect(ts(t.inicio)).toBe('2026-11-09T07:00:00')
    expect(ts(t.fim)).toBe('2026-11-20T15:00:00')
    expect(t.duracao_h).toBeCloseTo(80, 6)
    expect(t.duracao_dias_uteis).toBeCloseTo(10, 6)
    const dia = r.perfilDia.get('T1')!
    expect(dia.size).toBe(10)
    for (const q of dia.values()) expect(q).toBeCloseTo(100, 6)
    const sem = r.perfilSemana.get('T1')!
    expect([...sem]).toEqual([
      ['2026-11-09', expect.closeTo(500, 6)],
      ['2026-11-16', expect.closeTo(500, 6)]
    ])
  })

  it('término-início: a sucessora começa no expediente seguinte ao fim da predecessora', () => {
    const e = plano([tarefa('T1'), tarefa('T2', { quantidade: 500 })], {
      dependencias: [
        {
          id: 'd1',
          predecessora_id: 'T1',
          sucessora_id: 'T2',
          tipo: 'FS',
          atraso_min: 0,
          atraso_max: null,
          dias_uteis: false
        }
      ]
    })
    const r = calcularPlano(e, MODELO).resultado
    expect(ts(r.tarefas.get('T2')!.inicio)).toBe('2026-11-23T07:00:00')
    expect(ts(r.tarefas.get('T2')!.fim)).toBe('2026-11-27T15:00:00')
    expect(r.tarefas.get('T1')!.folga_total_h).toBeGreaterThan(0)
  })

  it('equipe nomeada (recurso identificado): duas tarefas não se sobrepõem; a de maior prioridade vai primeiro', () => {
    const e = plano(
      [
        tarefa('T1', { equipes_ids: ['eqA'], prioridade: 500 }),
        tarefa('T2', { quantidade: 500, equipes_ids: ['eqA'], prioridade: 600 })
      ],
      { equipesNomeadas: [{ id: 'eqA', nome: 'Equipe A' }] }
    )
    const r = calcularPlano(e, MODELO).resultado
    const t1 = r.tarefas.get('T1')!,
      t2 = r.tarefas.get('T2')!
    expect(ts(t2.inicio)).toBe('2026-11-09T07:00:00')
    expect(ts(t2.fim)).toBe('2026-11-13T15:00:00')
    expect(t1.inicio).toBeGreaterThanOrEqual(t2.fim)
    expect(ts(t1.inicio)).toBe('2026-11-16T07:00:00')
  })

  it('mesma prioridade na mesma equipe: vai antes quem vem antes no plano, qualquer que seja o id', () => {
    const calc = (a: string, b: string): [number, number] => {
      const e = plano(
        [
          tarefa(a, { ordem: 0, equipes_ids: ['eqA'] }),
          tarefa(b, { ordem: 1, quantidade: 500, equipes_ids: ['eqA'] })
        ],
        { equipesNomeadas: [{ id: 'eqA', nome: 'Equipe A' }] }
      )
      const r = calcularPlano(e, MODELO).resultado
      return [r.tarefas.get(a)!.inicio, r.tarefas.get(b)!.inicio]
    }
    // ids em ordem alfabética e invertida (uma cópia do plano gera ids novos): o resultado não muda
    const [a1, b1] = calc('zzz-primeira', 'aaa-segunda')
    const [a2, b2] = calc('aaa-primeira', 'zzz-segunda')
    expect(ts(a1)).toBe('2026-11-09T07:00:00')
    expect(b1).toBeGreaterThan(a1)
    expect([a2, b2]).toEqual([a1, b1])
  })

  it('área (local sem estacas): work place 0…1 numa Area do ApeX, fora dos eixos; dependência automática término-início', () => {
    const emArea = (id: string, o: Partial<TarefaEntrada> = {}): TarefaEntrada =>
      tarefa(id, {
        ...o,
        locais: [
          {
            id: id + '-a',
            ordem: 0,
            trecho_id: 'ar1',
            inicio_m: null,
            fim_m: null,
            quantidade: o.quantidade ?? 400,
            qtd_origem: 'manual'
          }
        ]
      })
    const e = plano(
      [emArea('T1', { quantidade: 400 }), emArea('T2', { servico_id: 'B', quantidade: 200 })],
      {
        tiposDependencias: [{ predecessor_id: 'A', sucessor_id: 'B', atraso_dias: 0 }]
      }
    )
    const { resultado: r, obra } = calcularPlano(e, MODELO)
    const doc = obra.doc
    const t1 = r.tarefas.get('T1')!
    expect(t1.wps).toHaveLength(1)
    expect(t1.wps[0]).toMatchObject({ trecho_id: 'ar1', inicio_m: 0, fim_m: 1, quantidade: 400 })
    // 400 a 100/dia = 4 dias de 8 h
    expect((t1.fim - t1.inicio) / 86400).toBeCloseTo(3.33, 1)
    const d = doc as { areas: { name: string }[]; road_lines: { name: string }[] }
    expect(d.areas.map((a) => a.name)).toContain('ar1')
    expect(d.road_lines.map((x) => x.name)).not.toContain('ar1')
    // em área o ApeX deriva término-início (não há estacas para "por estacas")
    expect(r.automaticas).toHaveLength(1)
    expect(r.automaticas[0]!.tipo).toBe(2)
    const p = payloadGravacao(e, r)
    const wp = p.wps.find((w) => w.tarefa_id === 'T1')!
    expect(wp).toMatchObject({ trecho_id: 'ar1', inicio_m: null, fim_m: null, quantidade: 400 })
  })

  it('limite de recurso: escavadeira com máximo 1 nivela duas tarefas', () => {
    const e = plano([tarefa('T1'), tarefa('T2', { quantidade: 500 })], {
      limites: [{ recurso_id: 'esc', grupo_id: null, maximo: 1 }]
    })
    const r = calcularPlano(e, MODELO).resultado
    const a = r.tarefas.get('T1')!,
      b = r.tarefas.get('T2')!
    expect(a.inicio < b.fim && b.inicio < a.fim).toBe(false)
  })

  it('dependência entre serviços (por estacas, automática): a sucessora acompanha a predecessora sem ultrapassar', () => {
    const e = plano(
      [tarefa('A1'), tarefa('B1', { servico_id: 'B', item_orcamentario_id: 'item-B' })],
      {
        tiposDependencias: [{ predecessor_id: 'A', sucessor_id: 'B', atraso_dias: 0 }]
      }
    )
    const calc = calcularPlano(e, MODELO)
    const r = calc.resultado
    expect(r.automaticas).toEqual([
      { predecessora_id: 'A1', sucessora_id: 'B1', tipo: 4, atraso: 0 }
    ])
    const a = r.tarefas.get('A1')!,
      b = r.tarefas.get('B1')!
    expect(b.inicio).toBeGreaterThanOrEqual(a.inicio)
    expect(b.inicio).toBeLessThan(a.fim)
    expect(b.fim).toBeGreaterThanOrEqual(a.fim)
  })

  it('fator mensal 0,5 em novembro: metade das horas nos dias úteis do mês', () => {
    const e = plano([tarefa('T1')], { fatoresMes: [{ ano_mes: '2026-11-01', fator: 0.5 }] })
    const t = calcularPlano(e, MODELO).resultado.tarefas.get('T1')!
    // novembro a partir de 9: 16 dias × 4 h = 64 h; faltam 16 h em dezembro (2 dias de 8 h)
    expect(ts(t.fim)).toBe('2026-12-02T15:00:00')
  })

  it('Páscoa no Brasil: sexta-feira santa 26/03/2027 parada, segunda 29/03 trabalhada; feriado do usuário', () => {
    const cal: CalendarioEntrada = {
      ...SEG_SEX,
      definicoes: [
        {
          tipo: 'pascoa',
          nome: 'Páscoa',
          data_inicio: null,
          data_fim: null,
          todo_ano: true,
          dia_semana: null,
          semana: null
        },
        {
          tipo: 'feriado',
          nome: 'Tiradentes',
          data_inicio: '2027-04-21',
          data_fim: '2027-04-21',
          todo_ano: true,
          dia_semana: null,
          semana: null
        }
      ]
    }
    const e = plano(
      [tarefa('T1', { quantidade: 500, asap: false, inicio_em: '2027-03-22T07:00:00' })],
      { calendarios: [cal] }
    )
    const t = calcularPlano(e, MODELO).resultado.tarefas.get('T1')!
    expect(ts(t.inicio)).toBe('2027-03-22T07:00:00')
    // 22, 23, 24, 25 e (pulando a sexta-feira santa) 29/03
    expect(ts(t.fim)).toBe('2027-03-29T15:00:00')
  })

  it('não ASAP mantém o início desejado; ASAP volta ao início do projeto', () => {
    const r1 = calcularPlano(
      plano([tarefa('T1', { asap: false, inicio_em: '2026-12-07T07:00:00' })]),
      MODELO
    ).resultado
    expect(ts(r1.tarefas.get('T1')!.inicio)).toBe('2026-12-07T07:00:00')
    const r2 = calcularPlano(
      plano([tarefa('T1', { asap: true, inicio_em: '2026-12-07T07:00:00' })]),
      MODELO
    ).resultado
    expect(ts(r2.tarefas.get('T1')!.inicio)).toBe('2026-11-09T07:00:00')
  })

  it('marco: terminar até 13/11 vira violação no fim e a folga fica negativa', () => {
    const e = plano([tarefa('T1')], {
      marcos: [
        {
          id: 'm1',
          nome: 'Liberação',
          inicio: null,
          fim: '2026-11-13T23:59:59',
          filtro_servicos: false,
          servicos: [],
          filtro_recursos: false,
          recursos: [],
          filtro_estacas: false,
          faixas: [],
          incluidas: ['T1'],
          excluidas: []
        }
      ]
    })
    const t = calcularPlano(e, MODELO).resultado.tarefas.get('T1')!
    expect(t.violacoes).toContainEqual({ tipo: 'marco', marco_id: 'm1', ponto: 'fim' })
    expect(t.restricao_limite).toBe('TC_MILESTONE')
  })

  it('quantidade do trecho: um trecho de tarefa por segmento do template, velocidade pela quantidade', () => {
    const t = tarefa('T1', {
      locais: [
        {
          id: 'l1',
          ordem: 0,
          trecho_id: 'tr1',
          inicio_m: 0,
          fim_m: 2000,
          quantidade: 1000,
          qtd_origem: 'trecho'
        }
      ]
    })
    const e = plano([t], {
      templates: {
        tr1: [
          { inicio_m: 0, fim_m: 1000, valores: { 'item-A': 300 } },
          { inicio_m: 1000, fim_m: 2000, valores: { 'item-A': 700 } }
        ]
      }
    })
    const r = calcularPlano(e, MODELO).resultado.tarefas.get('T1')!
    expect(r.wps.map((w) => [w.inicio_m, w.fim_m, w.quantidade])).toEqual([
      [0, 1000, 300],
      [1000, 2000, 700]
    ])
    // 300 → 24 h (3 dias); 700 → 56 h (7 dias)
    expect(ts(r.wps[0]!.fim)).toBe('2026-11-11T15:00:00')
    expect(ts(r.wps[1]!.inicio)).toBe('2026-11-12T07:00:00')
    expect(ts(r.wps[1]!.fim)).toBe('2026-11-20T15:00:00')
  })

  it('sentido decrescente: começa pela estaca maior', () => {
    const t = tarefa('T1', {
      sentido: 'decrescente',
      locais: [
        {
          id: 'l1',
          ordem: 0,
          trecho_id: 'tr1',
          inicio_m: 0,
          fim_m: 1000,
          quantidade: 300,
          qtd_origem: 'manual'
        },
        {
          id: 'l2',
          ordem: 1,
          trecho_id: 'tr1',
          inicio_m: 2000,
          fim_m: 3000,
          quantidade: 700,
          qtd_origem: 'manual'
        }
      ]
    })
    const r = calcularPlano(plano([t]), MODELO).resultado.tarefas.get('T1')!
    const l2 = r.wps.find((w) => w.local_id === 'l2')!,
      l1 = r.wps.find((w) => w.local_id === 'l1')!
    expect(ts(l2.inicio)).toBe('2026-11-09T07:00:00')
    expect(l1.inicio).toBeGreaterThanOrEqual(l2.fim)
  })

  it('serviço sem produção: equipe nula (duração nula) e aviso', () => {
    const e = plano([tarefa('T1')], {
      equipes: [{ servico_id: 'A', producao_diaria: 0, recursos: [] }]
    })
    const r = calcularPlano(e, MODELO).resultado
    expect(r.tarefas.get('T1')!.sem_producao).toBe(true)
    expect(r.tarefas.get('T1')!.duracao_h).toBeLessThan(1)
  })

  it('indireto mensal cobre a janela das diretas com as folgas em dias úteis', () => {
    const ind = tarefa('I1', {
      is_indireto: true,
      servico_id: null,
      locais: [],
      indireto: {
        custo_periodicidade: 'dia',
        custo_unitario: 100,
        receita_modo: 'percentual_dos_servicos',
        receita_unitaria: null,
        receita_percentual: 10,
        offset_dias_antes: 2,
        offset_dias_depois: 1,
        receita_extrapola: true,
        aplica_taxas: false,
        taxa_percentual: null
      }
    })
    const r = calcularPlano(plano([tarefa('T1'), ind]), MODELO).resultado
    const i = r.indiretos[0]!
    // diretas: 09/11 07:00 → 20/11 15:00; −2 dias úteis = 05/11 07:00; +1 dia útil = 23/11 15:00
    expect(ts(i.inicio)).toBe('2026-11-05T07:00:00')
    expect(ts(i.fim)).toBe('2026-11-23T15:00:00')
    expect(i.dias_uteis).toBeCloseTo(13, 6)
    expect(i.custo_total).toBeCloseTo(1300, 2)
    expect(i.receita_total).toBeCloseTo(1000 * 10 * 0.1, 2)
  })

  it('linha de base: as datas congeladas valem como estão; folgas e violações sobre elas', () => {
    const e = plano([tarefa('T1')], {
      wpsCongelados: [
        {
          tarefa_id: 'T1',
          local_id: 'T1-l1',
          ordem: 0,
          trecho_id: 'tr1',
          inicio_m: 0,
          fim_m: 1000,
          quantidade: 1000,
          inicio_em: '2026-11-16T07:00:00',
          fim_em: '2026-11-27T15:00:00'
        }
      ],
      marcos: [
        {
          id: 'm1',
          nome: 'M',
          inicio: null,
          fim: '2026-11-20T23:59:59',
          filtro_servicos: false,
          servicos: [],
          filtro_recursos: false,
          recursos: [],
          filtro_estacas: false,
          faixas: [],
          incluidas: ['T1'],
          excluidas: []
        }
      ]
    })
    const t = calcularPlano(e, MODELO).resultado.tarefas.get('T1')!
    expect(ts(t.inicio)).toBe('2026-11-16T07:00:00')
    expect(ts(t.fim)).toBe('2026-11-27T15:00:00')
    expect(t.violacoes).toContainEqual({ tipo: 'marco', marco_id: 'm1', ponto: 'fim' })
  })

  it('fator mensal não abre expediente em feriado', () => {
    const cal: CalendarioEntrada = {
      ...SEG_SEX,
      definicoes: [
        {
          tipo: 'feriado',
          nome: 'Feriado',
          data_inicio: '2026-11-11',
          data_fim: '2026-11-11',
          todo_ano: false,
          dia_semana: null,
          semana: null
        }
      ]
    }
    const e = plano([tarefa('T1', { quantidade: 200 })], {
      calendarios: [cal],
      fatoresMes: [{ ano_mes: '2026-11-01', fator: 0.5 }]
    })
    const r = calcularPlano(e, MODELO).resultado
    // 200 → 16 h; a 4 h/dia: 9, 10, (11 feriado), 12, 13
    expect(ts(r.tarefas.get('T1')!.fim)).toBe('2026-11-13T11:00:00')
    expect(r.perfilDia.get('T1')!.has('2026-11-11')).toBe(false)
  })

  it('payload de gravação: datas, locais, trechos e perfis', () => {
    const e = plano([tarefa('T1')])
    const p = payloadGravacao(e, calcularPlano(e, MODELO).resultado) as Record<string, unknown[]>
    expect(p.dados_rev).toBe(3)
    expect(p.tarefas).toContainEqual(
      expect.objectContaining({
        id: 'T1',
        inicio_em: '2026-11-09T07:00:00',
        fim_em: '2026-11-20T15:00:00',
        data_inicio: '2026-11-09',
        data_fim: '2026-11-20'
      })
    )
    expect(p.locais).toEqual([
      { id: 'T1-l1', inicio_em: '2026-11-09T07:00:00', fim_em: '2026-11-20T15:00:00' }
    ])
    expect(p.wps).toHaveLength(1)
    expect(
      (p.perfil_dia as { quantidade: number }[]).reduce((s, x) => s + x.quantidade, 0)
    ).toBeCloseTo(1000, 4)
  })
})

describe('comandos de edição das visões (ApeX → banco)', () => {
  const seg = (iso: string): number => isoParaSeg(iso)

  it('mover o início de tarefa não ASAP: prévia = recálculo a partir do banco', () => {
    const e = plano([tarefa('T1', { asap: false })])
    const calc = calcularPlano(e, MODELO)
    const m = aplicarComando(e, calc, {
      tipo: 'inicio',
      tarefaId: 'T1',
      em: seg('2026-11-16T00:00:00')
    })
    expect(m.tarefas).toEqual([{ id: 'T1', inicio_em: '2026-11-16T00:00:00' }])
    const previa = calc.resultado.tarefas.get('T1')!
    expect(ts(previa.inicio)).toBe('2026-11-16T07:00:00')
    const banco = calcularPlano(
      plano([tarefa('T1', { asap: false, inicio_em: '2026-11-16T00:00:00' })]),
      MODELO
    ).resultado.tarefas.get('T1')!
    expect([ts(banco.inicio), ts(banco.fim)]).toEqual([ts(previa.inicio), ts(previa.fim)])
  })

  it('mover o início de tarefa ASAP é recusado', () => {
    const e = plano([tarefa('T1')])
    const calc = calcularPlano(e, MODELO)
    expect(() =>
      aplicarComando(e, calc, { tipo: 'inicio', tarefaId: 'T1', em: seg('2026-11-16T00:00:00') })
    ).toThrow(/mais cedo possível/)
  })

  it('mover o fim muda o número de equipes (nunca a produtividade): metade da duração → o dobro de equipes', () => {
    const e = plano([tarefa('T1')])
    const calc = calcularPlano(e, MODELO)
    const t1 = calc.resultado.tarefas.get('T1')!
    // 80 h de trabalho com 1 equipe; pedir o término com 40 h → 2 equipes
    const cal = new Calendar(calc.resultado.calendarios[t1.calendario_id]!)
    const meio = cal.WS2AS(cal.AS2WS(t1.inicio) + 40 * 3600, false)
    expect(equipesParaTermino(calc.resultado, e, 'T1', meio)).toBe(2)
    // pedir mais tempo que o atual com 1 equipe não muda nada (mínimo 1)
    expect(equipesParaTermino(calc.resultado, e, 'T1', t1.fim + 30 * 86400)).toBe(1)
    // o comando de término não passa pelo setEndTime do ApeX (que reescreveria o coeficiente)
    expect(() => aplicarComando(e, calc, { tipo: 'fim', tarefaId: 'T1', em: meio })).toThrow()
    const dois = calcularPlano(
      plano([tarefa('T1', { qtd_equipes: 2 })]),
      MODELO
    ).resultado.tarefas.get('T1')!
    expect(dois.duracao_h).toBeCloseTo(t1.duracao_h / 2, 6)
    expect(ts(dois.fim)).toBe(ts(meio))
  })

  it('nova dependência término-início e recusa de ciclo', () => {
    const e = plano([tarefa('T1'), tarefa('T2', { quantidade: 500 })])
    const calc = calcularPlano(e, MODELO)
    const m = aplicarComando(e, calc, {
      tipo: 'dependencia',
      predecessora: 'T1',
      sucessora: 'T2',
      dep: 'FS',
      atraso_min: 0,
      atraso_max: null,
      dias_uteis: false
    })
    expect(m.dependencias).toEqual([
      {
        predecessora_id: 'T1',
        sucessora_id: 'T2',
        tipo: 'FS',
        atraso_min: 0,
        atraso_max: null,
        dias_uteis: false
      }
    ])
    expect(ts(calc.resultado.tarefas.get('T2')!.inicio)).toBe('2026-11-23T07:00:00')
    expect(() =>
      aplicarComando(e, calc, {
        tipo: 'dependencia',
        predecessora: 'T2',
        sucessora: 'T1',
        dep: 'FS',
        atraso_min: 0,
        atraso_max: null,
        dias_uteis: false
      })
    ).toThrow(/circular/)
  })

  it('compactar: prioridades de 10 em 10 e início desejado = início do projeto', () => {
    const e = plano([
      tarefa('T1', { asap: false, inicio_em: '2026-12-07T07:00:00' }),
      tarefa('T2', { quantidade: 500, asap: false, inicio_em: '2026-11-23T07:00:00' })
    ])
    const calc = calcularPlano(e, MODELO)
    expect(ts(calc.resultado.tarefas.get('T1')!.inicio)).toBe('2026-12-07T07:00:00')
    const m = aplicarComando(e, calc, { tipo: 'compactar' })
    expect(m.tarefas.map((x) => x.prioridade).sort()).toEqual([10, 20])
    for (const x of m.tarefas) expect(x.inicio_em).toBe('2026-11-09T00:00:00')
    expect(ts(calc.resultado.tarefas.get('T1')!.inicio)).toBe('2026-11-09T07:00:00')
    const prio = new Map(m.tarefas.map((x) => [x.id, x.prioridade!]))
    const banco = calcularPlano(
      plano([
        tarefa('T1', {
          asap: false,
          inicio_em: '2026-11-09T00:00:00',
          prioridade: prio.get('T1')!
        }),
        tarefa('T2', {
          quantidade: 500,
          asap: false,
          inicio_em: '2026-11-09T00:00:00',
          prioridade: prio.get('T2')!
        })
      ]),
      MODELO
    ).resultado
    for (const id of ['T1', 'T2'])
      expect(ts(banco.tarefas.get(id)!.inicio)).toBe(ts(calc.resultado.tarefas.get(id)!.inicio))
  })

  it('resultado traz calendários, calendário de cada tarefa e marcos com as tarefas incluídas', () => {
    const e = plano([tarefa('T1'), tarefa('T2', { servico_id: 'B', quantidade: 500 })], {
      marcos: [
        {
          id: 'm1',
          nome: 'Marco',
          inicio: null,
          fim: '2026-11-13T23:59:59',
          filtro_servicos: true,
          servicos: ['B'],
          filtro_recursos: false,
          recursos: [],
          filtro_estacas: false,
          faixas: [],
          incluidas: [],
          excluidas: []
        }
      ]
    })
    const r = calcularPlano(e, MODELO).resultado
    expect(r.calendarioPadraoId).toBe('cal-1')
    expect(Object.keys(r.calendarios)).toContain('cal-1')
    expect(r.tarefas.get('T1')!.calendario_id).toBe('cal-1')
    expect(r.marcos).toEqual([{ id: 'm1', tarefas: ['T2'] }])
  })
})

describe('uso dos recursos (ResourceCalculator)', () => {
  it('cada recurso da composição × equipes durante a tarefa; tarefas simultâneas somam', () => {
    // T1: 1000 a 200/dia = 5 dias; T2: 300 a 100/dia = 3 dias
    const e = plano([tarefa('T1', { qtd_equipes: 2 }), tarefa('T2', { quantidade: 300 })])
    const r = calcularPlano(e, MODELO).resultado
    const esc = r.recursos.find((x) => x.recurso_id === 'esc')!
    const aj = r.recursos.find((x) => x.recurso_id === 'aj')!
    const t1 = r.tarefas.get('T1')!,
      t2 = r.tarefas.get('T2')!
    // T1 com 2 equipes (1 escavadeira e 2,5 ajudantes cada) e T2 com 1 equipe começam juntas
    expect(t1.inicio).toBe(t2.inicio)
    const pico = (s: [number, number, number][]): number => Math.max(...s.map((x) => x[2]))
    expect(pico(esc.spans)).toBeCloseTo(3, 6)
    expect(pico(aj.spans)).toBeCloseTo(7.5, 6)
    // depois do fim de T2 só T1 segue (2 escavadeiras)
    const depois = esc.spans.find((s) => s[0] >= t2.fim)!
    expect(depois[2]).toBeCloseTo(2, 6)
    expect(Math.max(...esc.spans.map((s) => s[1]))).toBe(t1.fim)
  })
})

describe('calendário do InfraWork no motor', () => {
  it('Páscoa = feriados móveis brasileiros (Carnaval, Sexta-feira Santa, Corpus Christi)', () => {
    expect(feriadosMoveis(2027)).toEqual([
      ['Carnaval', '2027-02-08', '2027-02-09'],
      ['Sexta-feira Santa', '2027-03-26', '2027-03-26'],
      ['Corpus Christi', '2027-05-27', '2027-05-27']
    ])
    expect(feriadosMoveis(2026)[1]).toEqual(['Sexta-feira Santa', '2026-04-03', '2026-04-03'])
  })

  it('a especificação das telas é a mesma que o motor monta pelo documento', () => {
    const cal: CalendarioEntrada = {
      ...SEG_SEX,
      semana: [9, 9, 9, 9, 8, 4, 0].map((h, i) => ({
        inicio: i === 5 ? '08:00' : '07:00',
        horas: h
      })),
      definicoes: [
        {
          tipo: 'feriado',
          nome: 'Finados',
          data_inicio: '2026-11-02',
          data_fim: '2026-11-02',
          todo_ano: true,
          dia_semana: null,
          semana: null
        },
        {
          tipo: 'feriado',
          nome: 'Recesso',
          data_inicio: '2026-12-21',
          data_fim: '2027-01-03',
          todo_ano: false,
          dia_semana: null,
          semana: null
        },
        {
          tipo: 'pascoa',
          nome: 'Móveis',
          data_inicio: null,
          data_fim: null,
          todo_ano: false,
          dia_semana: null,
          semana: null
        },
        {
          tipo: 'folga_semana',
          nome: 'Aniversário',
          data_inicio: '2026-08-10',
          data_fim: null,
          todo_ano: false,
          dia_semana: 0,
          semana: null
        },
        {
          tipo: 'horario_excecao',
          nome: 'Mutirão',
          data_inicio: '2027-03-01',
          data_fim: '2027-03-14',
          todo_ano: false,
          dia_semana: null,
          semana: [10, 10, 10, 10, 10, 6, 0].map((h) => ({ inicio: '06:00', horas: h }))
        }
      ]
    }
    const fatores = [
      { ano_mes: '2027-01-01', fator: 0.6 },
      { ano_mes: '2027-03-01', fator: 0.85 }
    ]
    const r = calcularPlano(
      plano([tarefa('T1')], { calendarios: [cal], fatoresMes: fatores }),
      MODELO
    ).resultado
    const motor = new Calendar(r.calendarios['cal-1']!)
    const tela = new Calendar(especificacaoCalendario(cal, fatores))
    for (let t = isoParaSeg('2026-10-01'); t < isoParaSeg('2028-01-01'); t += 7 * 3600 + 13 * 60)
      expect(tela.AS2WS(t)).toBe(motor.AS2WS(t))
    // Sexta-feira Santa e Carnaval sem expediente; segunda de Páscoa trabalhada
    const horas = (d: string): number =>
      (tela.AS2WS(isoParaSeg(d) + 86400) - tela.AS2WS(isoParaSeg(d))) / 3600
    expect(horas('2027-03-26')).toBe(0)
    expect(horas('2027-02-09')).toBe(0)
    // segunda de Páscoa trabalhada, com o fator de março: 9 h × 0,85
    expect(horas('2027-03-29')).toBeCloseTo(7.65, 6)
    // fator de janeiro: 9 h × 0,6
    expect(horas('2027-01-11')).toBeCloseTo(5.4, 6)
    // mutirão em março com fator 0,85: 10 h × 0,85
    expect(horas('2027-03-02')).toBeCloseTo(8.5, 6)
  })
})

describe('controle (realizado e previsão do ApeX)', () => {
  const producao = (
    item: string,
    dias: string[],
    q: number,
    equipe: string | null = null
  ): ProducaoLancada[] =>
    dias.map((data) => ({ item_orcamentario_id: item, equipe_id: equipe, data, quantidade: q }))

  it('grau, taxa realizada e previsão do saldo na taxa da RN-007; o planejado não muda', () => {
    const base = plano([tarefa('T1')])
    const semControle = calcularPlano(base, MODELO).resultado
    const e = {
      ...base,
      controle: {
        data: '2026-11-13',
        producoes: producao(
          'item-A',
          ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'],
          60
        )
      }
    }
    const r = calcularPlano(e, MODELO).resultado
    // o cronograma planejado é o mesmo
    expect(ts(r.tarefas.get('T1')!.fim)).toBe(ts(semControle.tarefas.get('T1')!.fim))
    const c = r.controle!.tarefas['T1']!
    expect(c.realizado).toBe(300)
    expect(c.grau).toBeCloseTo(0.3, 9)
    expect(c.taxa_real).toBeCloseTo(60, 6)
    expect(ts(c.inicio_real!)).toBe('2026-11-09T07:00:00')
    expect(ts(c.fim_real!)).toBe('2026-11-13T15:00:00')
    // saldo de 700 a 0,3·7,5 + 0,7·12,5 = 11/h = 63,64 h a partir de 16/11 07:00 → 25/11 por volta das 14:38
    expect(ts(c.fim_previsto!).slice(0, 13)).toBe('2026-11-25T14')
    const fr = c.frentes[0]!
    expect(fr.crescente).toBe(true)
    expect(fr.lugares.filter((l) => l.realizado).reduce((s, l) => s + l.quantidade, 0)).toBeCloseTo(
      300,
      6
    )
    expect(
      fr.lugares.filter((l) => !l.realizado).reduce((s, l) => s + l.quantidade, 0)
    ).toBeCloseTo(700, 6)
    // a frente realizada vai de 0 a 300 m (a tarefa cobre 0–1000 m)
    expect(Math.max(...fr.lugares.filter((l) => l.realizado).map((l) => l.fim_m))).toBeCloseTo(
      300,
      6
    )
    expect(fr.lugares.every((l) => l.trecho_id === 'tr1')).toBe(true)
  })

  it('reparte a produção do serviço entre as tarefas: equipe nomeada e, depois, em ordem de início', () => {
    const e = plano(
      [
        tarefa('T1', {
          quantidade: 200,
          locais: [
            {
              id: 'l1',
              ordem: 0,
              trecho_id: 'tr1',
              inicio_m: 0,
              fim_m: 200,
              quantidade: 200,
              qtd_origem: 'manual'
            }
          ]
        }),
        tarefa('T2', {
          quantidade: 300,
          equipes_ids: ['eqB'],
          locais: [
            {
              id: 'l2',
              ordem: 0,
              trecho_id: 'tr1',
              inicio_m: 200,
              fim_m: 500,
              quantidade: 300,
              qtd_origem: 'manual'
            }
          ]
        })
      ],
      { equipesNomeadas: [{ id: 'eqB', nome: 'B' }] }
    )
    const c = {
      data: '2026-11-20',
      producoes: [
        ...producao('item-A', ['2026-11-09', '2026-11-10', '2026-11-11'], 100),
        ...producao('item-A', ['2026-11-12'], 50, 'eqB')
      ]
    }
    const r = calcularPlano({ ...e, controle: c }, MODELO).resultado
    // T1 enche primeiro (200), o resto vai para T2 (100); o lançamento da equipe B vai direto para T2
    expect(r.controle!.tarefas['T1']!.realizado).toBe(200)
    expect(r.controle!.tarefas['T1']!.concluida).toBe(true)
    expect(r.controle!.tarefas['T2']!.realizado).toBe(150)
    expect(r.controle!.tarefas['T2']!.grau).toBeCloseTo(0.5, 9)
  })
})

describe('tempo-caminho coerente com o cálculo (conferência numérica)', () => {
  const local = (
    id: string,
    trecho_id: string | null,
    inicio_m: number | null,
    fim_m: number | null,
    quantidade: number,
    qtd_origem: 'manual' | 'trecho' = 'manual'
  ): TarefaEntrada['locais'][number] => ({
    id,
    ordem: 0,
    trecho_id,
    inicio_m,
    fim_m,
    quantidade,
    qtd_origem
  })
  const conferir = (e: PlanoEntrada): void => {
    const r = calcularPlano(e, MODELO).resultado
    for (const fimDeSemana of [false, true]) {
      const c = conferirTempoCaminho(e, r, { fimDeSemana })
      expect(c.falhas, `fins de semana no eixo: ${fimDeSemana}`).toEqual([])
      expect(c.pedacos).toBeGreaterThan(0)
    }
  }
  const trechos: PlanoEntrada['trechos'] = [
    { id: 'tr1', nome: 'Eixo', tipo: 'eixo', comprimento_m: 5000 },
    { id: 'tr2', nome: 'Contorno', tipo: 'eixo', comprimento_m: 4000 },
    { id: 'ar1', nome: 'Pátio', tipo: 'area', comprimento_m: null }
  ]

  it('a conferência acusa desenho errado (wp adulterado e sentido trocado)', () => {
    const e = plano(
      [tarefa('C', { locais: [local('C1', 'tr1', 0, 2000, 1500)], quantidade: 1500 })],
      {
        trechos
      }
    )
    const r = calcularPlano(e, MODELO).resultado
    const t = r.tarefas.get('C')!
    const adulterado = {
      ...r,
      tarefas: new Map([
        ['C', { ...t, wps: t.wps.map((w, i) => (i === 0 ? { ...w, fim: w.fim + 86400 } : w)) }]
      ])
    }
    expect(conferirTempoCaminho(e, adulterado).falhas.length).toBeGreaterThan(0)
    // com vários wps (segmentos do template) a ordem no tempo revela o sentido executado pelo motor
    const templates: PlanoEntrada['templates'] = {
      tr1: [
        { inicio_m: 0, fim_m: 1000, valores: { 'item-A': 100 } },
        { inicio_m: 1000, fim_m: 2000, valores: { 'item-A': 200 } }
      ]
    }
    const e2 = plano(
      [tarefa('S', { locais: [local('S1', 'tr1', 0, 2000, 300, 'trecho')], quantidade: 300 })],
      {
        trechos,
        templates
      }
    )
    const r2 = calcularPlano(e2, MODELO).resultado
    expect(conferirTempoCaminho(e2, r2).falhas).toEqual([])
    const invertido = {
      ...e2,
      tarefas: e2.tarefas.map((x) => ({ ...x, sentido: 'decrescente' as const }))
    }
    expect(conferirTempoCaminho(invertido, r2).falhas.join(' ')).toMatch(/decrescente/)
  })

  it('crescente e decrescente, um local cada', () => {
    conferir(
      plano(
        [
          tarefa('C', { locais: [local('C1', 'tr1', 0, 5000, 3000)], quantidade: 3000 }),
          tarefa('D', {
            sentido: 'decrescente',
            locais: [local('D1', 'tr1', 0, 5000, 3000)],
            quantidade: 3000
          })
        ],
        { trechos }
      )
    )
  })

  it('locais com lacuna no mesmo eixo e em dois eixos, nos dois sentidos', () => {
    const locais = [
      local('L1', 'tr1', 0, 1000, 500),
      local('L2', 'tr1', 3000, 4000, 800),
      local('L3', 'tr2', 2000, 3000, 300)
    ]
    conferir(
      plano(
        [
          tarefa('G', { locais, quantidade: 1600 }),
          tarefa('H', {
            sentido: 'decrescente',
            locais: locais.map((l) => ({ ...l, id: l.id + 'h' })),
            quantidade: 1600
          })
        ],
        { trechos }
      )
    )
  })

  it('quantidade do template com densidades diferentes: inclinação muda por segmento', () => {
    const templates: PlanoEntrada['templates'] = {
      tr1: [
        { inicio_m: 0, fim_m: 1000, valores: { 'item-A': 100 } },
        { inicio_m: 1000, fim_m: 2000, valores: { 'item-A': 400 } },
        { inicio_m: 2000, fim_m: 3000, valores: { 'item-A': 50 } }
      ]
    }
    conferir(
      plano(
        [
          tarefa('T', {
            locais: [local('T1', 'tr1', 500, 2500, 475, 'trecho')],
            quantidade: 475
          })
        ],
        { trechos, templates }
      )
    )
  })

  it('área junto com eixo; calendário com sábado meio período e feriado', () => {
    const cal: CalendarioEntrada = {
      ...SEG_SEX,
      semana: [8, 8, 8, 8, 8, 4, 0].map((h) => ({ inicio: '07:00', horas: h })),
      definicoes: [
        {
          tipo: 'feriado',
          nome: 'Proclamação',
          data_inicio: '2026-11-16',
          data_fim: '2026-11-16',
          todo_ano: true,
          dia_semana: null,
          semana: null
        }
      ]
    } as CalendarioEntrada
    conferir(
      plano(
        [
          tarefa('A1', {
            locais: [local('A1a', 'ar1', null, null, 200), local('A1b', 'tr1', 0, 2000, 900)],
            quantidade: 1100
          })
        ],
        { trechos, calendarios: [cal] }
      )
    )
  })
})

describe('histograma de recursos (apresentação do desktop sobre o cálculo)', () => {
  // T1: 1000 m³ a 100 m³/dia (8 h) = 10 dias úteis, de seg 09/11 a sex 20/11
  const e = plano([tarefa('T1')])
  const r = calcularPlano(e, MODELO).resultado
  const cal = new Calendar(r.calendarios[r.calendarioPadraoId]!)
  const comp = new Map([
    [
      'A',
      [
        {
          fator: 1,
          operacao: 'dividir' as const,
          producao: 100,
          itens: [
            {
              grupo: 'MATERIAL' as const,
              recurso: { id: 'brita', nome: 'Brita', unidade: 'm³', grupo: 'MATERIAL' as const },
              quantidade: 0,
              horas_dia: 0,
              consumo_combustivel_lh: 0,
              indice_produtividade: 1,
              consumo_material_por_unid: 1.2
            },
            {
              grupo: 'EQUIPAMENTO' as const,
              recurso: { id: 'esc', nome: 'Escavadeira', unidade: 'h', grupo: 'MVE' as const },
              quantidade: 1,
              horas_dia: 8,
              consumo_combustivel_lh: 15,
              indice_produtividade: 1,
              consumo_material_por_unid: null
            },
            {
              grupo: 'COMBUSTIVEL' as const,
              recurso: {
                id: 'diesel',
                nome: 'Diesel',
                unidade: 'l',
                grupo: 'COMBUSTIVEL' as const
              },
              quantidade: 0,
              horas_dia: 0,
              consumo_combustivel_lh: 0,
              indice_produtividade: 1,
              consumo_material_por_unid: null
            }
          ]
        }
      ]
    ]
  ])
  const h = (u: 'recursos' | 'dias' | 'horas'): ReturnType<typeof montarHistograma> =>
    montarHistograma(e, r, comp, { unidadeTempo: u, calendario: cal, jornada: 8 })

  it('semanas, pico de equipamento e mão de obra, horas e dias', () => {
    const rec = h('recursos')
    expect(rec.semanas).toEqual(['2026-11-09', '2026-11-16'])
    const esc = rec.recursos.find((x) => x.recurso_id === 'esc')!
    expect(esc.grupo).toBe('MVE')
    expect(esc.porSemana).toEqual({ '2026-11-09': 1, '2026-11-16': 1 })
    expect(rec.recursos.find((x) => x.recurso_id === 'aj')!.pico).toBe(2.5)
    const horas = h('horas').recursos.find((x) => x.recurso_id === 'esc')!
    expect(horas.porSemana).toEqual({ '2026-11-09': 40, '2026-11-16': 40 })
    expect(h('dias').recursos.find((x) => x.recurso_id === 'esc')!.total).toBeCloseTo(10, 6)
  })

  it('material = quantidade × consumo por unidade; combustível = l/dia × dias com produção', () => {
    const rec = h('recursos')
    const brita = rec.recursos.find((x) => x.recurso_id === 'brita')!
    expect(brita.total).toBeCloseTo(1200, 6)
    expect(brita.porSemana['2026-11-09']).toBeCloseTo(600, 6)
    const diesel = rec.recursos.find((x) => x.recurso_id === 'diesel')!
    // 1 × 15 l/h × 8 h = 120 l/dia × 10 dias
    expect(diesel.total).toBeCloseTo(1200, 6)
    // grupos na ordem do desktop (mão de obra, equipamentos, combustível, material)
    const ordem = ['MO', 'MVE', 'COMBUSTIVEL', 'MATERIAL']
    const idx = rec.recursos.map((x) => ordem.indexOf(x.grupo))
    expect(idx).toEqual([...idx].sort((p, q) => p - q))
  })
})
