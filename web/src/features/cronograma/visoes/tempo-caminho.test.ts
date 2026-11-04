/**
 * Escada do tempo-caminho (RN-042 do ApeX): avanço linear nos segundos de trabalho do calendário da tarefa; trechos
 * verticais onde a tarefa para e o eixo do tempo mostra o período.
 */
import { describe, expect, it } from 'vitest'
import { Calendar, type CalendarSpec } from '@apex/calendar'
import { calendarioInterface, EixoTempo } from './eixo'
import { pontoViolacaoDependencia } from './dependencias'
import {
  distanciaLinhas,
  ESTADIO,
  EixoEstacas,
  juntarLinhas,
  linhaDoPedaco,
  pedacosDaFrente,
  pedacosPlanejados,
  zonaDaLinha
} from './tempo-caminho'
import type { TarefaResultado } from '../motor/calculo'
import type { FrentePrevisao } from '../motor/controle'

const H = 3600
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
const seg = (iso: string): number => Date.parse(iso + 'Z') / 1000

describe('escada do tempo-caminho', () => {
  const tarefa = new Calendar(segSex)
  // segunda 07:00 → terça da semana seguinte 15:00 = 7 dias de 8 h, de 0 a 700 m
  const pc = {
    trecho: 't',
    stA: 0,
    stB: 700,
    tA: seg('2026-11-09T07:00:00'),
    tB: seg('2026-11-17T15:00:00')
  }
  const eixoEst = new EixoEstacas([{ id: 't', ini: 0, fim: 700, x0: 0, x1: 700 }])

  it('sem fins de semana no eixo: uma reta (o fim de semana não ocupa espaço nem estaca)', () => {
    const tempo = new EixoTempo(
      calendarioInterface(segSex, false, true),
      seg('2026-11-09T00:00:00'),
      seg('2026-11-20T00:00:00'),
      1
    )
    const l = juntarLinhas(linhaDoPedaco(tarefa, tempo, eixoEst, pc))
    expect(l).toHaveLength(1)
    // colineares: só o primeiro e o último ponto ficam
    expect(l[0]!.length).toBe(2)
    expect(l[0]![0]).toEqual({ x: 0, y: 0 })
    expect(l[0]![1]!.x).toBeCloseTo(700, 6)
    expect(l[0]![1]!.y).toBeCloseTo(56, 6) // 7 dias × 8 h × 1 px/h
  })

  it('com fins de semana no eixo: degrau vertical no sábado e domingo, na estaca de sexta 15:00', () => {
    const tempo = new EixoTempo(
      calendarioInterface(segSex, true, true),
      seg('2026-11-09T00:00:00'),
      seg('2026-11-20T00:00:00'),
      1
    )
    const pts = juntarLinhas(linhaDoPedaco(tarefa, tempo, eixoEst, pc))[0]!
    // 5 dias até sexta 15:00 → 500 m; o trecho vertical cobre os 16 h de sábado e domingo do eixo de interface
    const vert = pts.findIndex(
      (p, i) => i > 0 && Math.abs(p.x - pts[i - 1]!.x) < 1e-9 && p.y > pts[i - 1]!.y
    )
    expect(vert).toBeGreaterThan(0)
    expect(pts[vert]!.x).toBeCloseTo(500, 6)
    expect(pts[vert]!.y - pts[vert - 1]!.y).toBeCloseTo(16, 6)
    expect(pts[pts.length - 1]!.x).toBeCloseTo(700, 6)
  })

  it('sentido decrescente começa pela estaca alta; zonas de mover e esticar nas pontas', () => {
    const r = {
      wps: [
        { trecho_id: 't', inicio_m: 0, fim_m: 300, inicio: pc.tA, fim: seg('2026-11-11T15:00:00') },
        {
          trecho_id: 't',
          inicio_m: 300,
          fim_m: 700,
          inicio: seg('2026-11-11T15:00:00'),
          fim: pc.tB
        }
      ]
    } as unknown as TarefaResultado
    const dec = pedacosPlanejados(r, false)
    expect(dec.map((p) => [p.stA, p.stB])).toEqual([
      [700, 300],
      [300, 0]
    ])
    const tempo = new EixoTempo(
      calendarioInterface(segSex, false, true),
      seg('2026-11-09T00:00:00'),
      seg('2026-11-20T00:00:00'),
      4
    )
    const linhas = juntarLinhas(
      pedacosPlanejados(r, true).flatMap((p) => linhaDoPedaco(tarefa, tempo, eixoEst, p))
    )
    expect(linhas).toHaveLength(1)
    expect(zonaDaLinha({ x: 5, y: 0.4 }, linhas)).toEqual({ inicio: true, fim: false })
    const ult = linhas[0]![linhas[0]!.length - 1]!
    expect(zonaDaLinha({ x: ult.x - 2, y: ult.y - 0.4 }, linhas)).toEqual({
      inicio: false,
      fim: true
    })
    expect(zonaDaLinha({ x: 350, y: 500 }, linhas)).toBeNull()
  })
})

describe('pedacosDaFrente (séries do controle)', () => {
  const f = (crescente: boolean): FrentePrevisao => ({
    crescente,
    lugares: [
      {
        trecho_id: 'T1',
        inicio_m: 0,
        fim_m: 100,
        inicio: 10,
        fim: 20,
        quantidade: 1,
        realizado: true
      },
      {
        trecho_id: 'T1',
        inicio_m: 100,
        fim_m: 250,
        inicio: 20,
        fim: 40,
        quantidade: 1,
        realizado: true
      },
      {
        trecho_id: null,
        inicio_m: 0,
        fim_m: 50,
        inicio: 40,
        fim: 45,
        quantidade: 1,
        realizado: false
      },
      {
        trecho_id: 'T1',
        inicio_m: 250,
        fim_m: 400,
        inicio: 45,
        fim: 60,
        quantidade: 1,
        realizado: false
      }
    ]
  })

  it('separa realizado e previsão, sem lugares de área, na direção da frente', () => {
    expect(pedacosDaFrente(f(true), true).map((p) => [p.stA, p.stB, p.tA, p.tB])).toEqual([
      [0, 100, 10, 20],
      [100, 250, 20, 40]
    ])
    expect(pedacosDaFrente(f(true), false).map((p) => [p.stA, p.stB])).toEqual([[250, 400]])
    // decrescente: estacas invertidas e a ordem de execução do fim para o começo
    expect(pedacosDaFrente(f(false), true).map((p) => [p.stA, p.stB])).toEqual([
      [250, 100],
      [100, 0]
    ])
  })
})

describe('conformidade com a RoadTimeView do ApeX', () => {
  const wp = (
    trecho: string,
    ini: number,
    fim: number,
    tA: number,
    tB: number
  ): TarefaResultado['wps'][number] => ({
    tarefa_id: 'T',
    local_id: null,
    trecho_id: trecho,
    inicio_m: ini,
    fim_m: fim,
    quantidade: 1,
    ordem: 0,
    inicio: tA,
    fim: tB
  })
  const res = (wps: TarefaResultado['wps']): TarefaResultado =>
    ({ id: 'T', inicio: 0, fim: 0, wps }) as unknown as TarefaResultado

  it('vários trechos: pedaços na ordem do tempo (num eixo só, a ordem do ApeX pela estaca)', () => {
    // trabalho no tr2 (estacas baixas) depois do tr1 (estacas altas)
    const r = res([wp('tr2', 0, 100, 3000, 4000), wp('tr1', 900, 1000, 1000, 2000)])
    expect(pedacosPlanejados(r, true).map((p) => p.trecho)).toEqual(['tr1', 'tr2'])
    expect(pedacosPlanejados(r, false).map((p) => p.trecho)).toEqual(['tr1', 'tr2'])
    const um = res([wp('tr1', 500, 600, 2000, 3000), wp('tr1', 0, 100, 1000, 2000)])
    expect(pedacosPlanejados(um, true).map((p) => p.stA)).toEqual([0, 500])
    expect(pedacosPlanejados(um, false).map((p) => p.stA)).toEqual([600, 100])
  })

  it('bandeira de violação de dependência: FF/SF no fim, as demais no início (do usuário ou derivada)', () => {
    const usuario = [{ predecessora_id: 'A', sucessora_id: 'B', tipo: 'FF' as const }]
    const auto = [{ predecessora_id: 'C', sucessora_id: 'B', tipo: 1 }]
    expect(pontoViolacaoDependencia('A', 'B', usuario, [])).toBe('fim')
    expect(pontoViolacaoDependencia('C', 'B', usuario, auto)).toBe('fim')
    expect(pontoViolacaoDependencia('D', 'B', usuario, auto)).toBe('inicio')
    expect(pontoViolacaoDependencia('A', 'B', [{ ...usuario[0]!, tipo: 'FS' as const }], [])).toBe(
      'inicio'
    )
  })

  it('calendário da interface com fins de semana: início e duração só dos dias úteis (makeUICalendar)', () => {
    // dias sem expediente com início 00:00 não podem puxar o sábado/domingo da interface para a meia-noite
    const spec: CalendarSpec = {
      ...segSex,
      week: {
        flag: 1,
        days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
          begin: d < 5 ? 7 * H : 0,
          length: d < 5 ? 8 * H : 0
        })) as CalendarSpec['week']['days']
      }
    }
    const sab = Date.UTC(2026, 10, 14) / 1000 // sábado
    const tc = calendarioInterface(spec, true, true, true)
    expect(tc.workPeriods(sab, sab + 86400)).toEqual([[sab + 7 * H, sab + 15 * H]])
    // o Gantt do ApeX usa os 7 dias (fica como no original)
    const gantt = calendarioInterface(spec, true, true)
    expect(gantt.workPeriods(sab, sab + 86400)).toEqual([[sab, sab + 8 * H]])
  })

  it('zonas (IsWithinStadium) e acerto: só o 1.º/último segmento; a lacuna entre pedaços não é linha', () => {
    const linhas = [
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 }
      ],
      [
        { x: 300, y: 200 },
        { x: 400, y: 300 }
      ]
    ]
    expect(zonaDaLinha({ x: 10, y: 10 }, linhas)).toEqual({ inicio: true, fim: false })
    expect(zonaDaLinha({ x: 390, y: 290 }, linhas)).toEqual({ inicio: false, fim: true })
    // meio do 1.º segmento, a mais de 50 px do início: nem mover nem esticar
    expect(zonaDaLinha({ x: 60, y: 60 }, linhas)).toBeNull()
    // na lacuna entre os pedaços (o segmento fantasma 100,100 → 300,200)
    expect(distanciaLinhas({ x: 200, y: 150 }, linhas)).toBeGreaterThan(ESTADIO.raio)
  })
})
