/**
 * Calendário do InfraWork → calendário do documento apex-obra/1 (`calendars[]`).
 *
 * - Semana padrão, feriados (com "todo ano"), Páscoa, folga anual em dia da semana e horários excepcionais: um para
 *   um com o calendário do ApeX.
 * - Feriados móveis: o gerador "Easter" do ApeX segue o calendário finlandês do DynaRoad (sexta-feira santa, domingo e
 *   segunda de Páscoa e a Ascensão). No Brasil a segunda de Páscoa e a Ascensão não são feriados e Carnaval e Corpus
 *   Christi param a obra: a definição "Páscoa" do InfraWork vira feriados fixos de cada ano (segunda e terça de
 *   Carnaval, Sexta-feira Santa e Corpus Christi), calculados pela data da Páscoa.
 * - Fator de produtividade mensal (InfraWork): o ApeX não tem; vira horário excepcional com as horas × fator nos
 *   dias do mês que não são feriado. Os feriados são detectados pelo próprio motor de calendário do ApeX (uma semana
 *   de 24 h só com os geradores de feriado), então a regra é a mesma do cálculo. Os horários excepcionais do usuário
 *   que cobrem o dia valem como base (as horas dele × fator).
 */
import {
  Calendar,
  findEaster,
  type CalendarSpec,
  type GeneratorSpec,
  type WorkDay
} from '@apex/calendar'
import { DIA, isoParaSeg, segParaData } from './tempo'
import type { CalendarioEntrada, DiaSemana, FatorMes } from './tipos'

export interface CalendarioObra {
  name: string
  week: { start: string; hours: number }[]
  holidays: { name: string; from: string; to: string; yearly: boolean }[]
  easter: string[]
  weekday_holidays: { name: string; date: string; weekday: number }[]
  exceptions: { name: string; from: string; to: string; week: { start: string; hours: number }[] }[]
}

const semanaDoc = (s: DiaSemana[]): { start: string; hours: number }[] =>
  s.map((d) => ({ start: d.inicio, hours: Math.max(0, Math.min(24, Number(d.horas) || 0)) }))

/** Jornada de referência: o maior expediente de um dia da semana padrão (a "produção por dia" é a de um dia cheio). */
export function jornadaReferencia(c: Pick<CalendarioEntrada, 'semana'>): number {
  return Math.max(0, ...c.semana.map((d) => Number(d.horas) || 0))
}

/** Anos cobertos pelos feriados móveis (o calendário do ApeX começa em 1998). */
const ANO_MIN = 1998
const ANO_MAX = 2100

/** Feriados móveis brasileiros de um ano, pela Páscoa (`FindEaster` do ApeX): [nome, primeiro dia, último dia]. */
export function feriadosMoveis(ano: number): [string, string, string][] {
  const pascoa = Date.UTC(ano, 2, 21) / 1000 + findEaster(ano) * DIA
  const d = (k: number): string => segParaData(pascoa + k * DIA)
  return [
    ['Carnaval', d(-48), d(-47)],
    ['Sexta-feira Santa', d(-2), d(-2)],
    ['Corpus Christi', d(60), d(60)]
  ]
}

function feriadosMoveisDoc(nome: string): CalendarioObra['holidays'] {
  const out: CalendarioObra['holidays'] = []
  for (let a = ANO_MIN; a <= ANO_MAX; a++)
    for (const [n, de, ate] of feriadosMoveis(a))
      out.push({ name: `${nome}: ${n}`, from: de, to: ate, yearly: false })
  return out
}

/** Geradores de feriado como o construtor do documento os grava (calendarFromDoc). */
function geradores(c: CalendarioEntrada): GeneratorSpec[] {
  const out: GeneratorSpec[] = []
  for (const d of c.definicoes) {
    if (d.tipo === 'feriado' && d.data_inicio && d.data_fim) {
      out.push({
        type: 'StaticHoliday',
        name: d.nome,
        begin: BigInt(isoParaSeg(d.data_inicio)),
        end: BigInt(isoParaSeg(d.data_fim) + 86399),
        yearly: d.todo_ano ? 1 : 0
      })
    } else if (d.tipo === 'pascoa') {
      for (const h of feriadosMoveisDoc(d.nome || 'Páscoa'))
        out.push({
          type: 'StaticHoliday',
          name: h.name,
          begin: BigInt(isoParaSeg(h.from)),
          end: BigInt(isoParaSeg(h.to) + 86399),
          yearly: 0
        })
    } else if (d.tipo === 'folga_semana' && d.data_inicio && d.dia_semana !== null) {
      out.push({
        type: 'StaticWeekDay',
        name: d.nome,
        date: BigInt(isoParaSeg(d.data_inicio)),
        weekday: d.dia_semana
      })
    }
  }
  return out
}

/** Detector de feriado: calendário de 24 h por dia com só os geradores (o motor do ApeX aplica as regras). */
function detectorFeriados(c: CalendarioEntrada): (dia: number) => boolean {
  const gens = geradores(c)
  if (gens.length === 0) return () => false
  const cheio: WorkDay = { begin: 0, length: DIA }
  const spec: CalendarSpec = {
    version: 12,
    week: { flag: 1, days: [cheio, cheio, cheio, cheio, cheio, cheio, cheio] },
    generators: gens,
    order: gens.map((_, i) => i),
    spans: []
  }
  let cal: Calendar
  try {
    cal = new Calendar(spec)
  } catch {
    // feriados cobrindo tudo: nada é dia de trabalho
    return () => true
  }
  return (dia) => cal.AS2WS(dia + DIA - 400) - cal.AS2WS(dia) === 0
}

const horasMax = (h: number): number => Math.max(0, Math.min(24, h))

/** Horários excepcionais gerados pelos fatores mensais (≠ 1). */
function excecoesDosFatores(
  c: CalendarioEntrada,
  fatores: FatorMes[]
): CalendarioObra['exceptions'] {
  const ativos = fatores.filter((f) => Number.isFinite(f.fator) && Math.abs(f.fator - 1) > 1e-9)
  if (ativos.length === 0) return []
  const feriado = detectorFeriados(c)
  const excUsuario = c.definicoes
    .filter((d) => d.tipo === 'horario_excecao' && d.data_inicio && d.data_fim && d.semana)
    .map((d) => ({ a: isoParaSeg(d.data_inicio!), b: isoParaSeg(d.data_fim!), semana: d.semana! }))
  const out: CalendarioObra['exceptions'] = []
  for (const f of ativos) {
    const ini = isoParaSeg(f.ano_mes.slice(0, 7) + '-01')
    const d0 = new Date(ini * 1000)
    const fimMes = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1) / 1000
    let run: { de: number; ate: number; fonte: number } | null = null
    const fecha = (): void => {
      if (!run) return
      const base = run.fonte < 0 ? c.semana : excUsuario[run.fonte]!.semana
      out.push({
        name: `Fator ${f.ano_mes.slice(0, 7)} × ${f.fator}`,
        from: segParaData(run.de),
        to: segParaData(run.ate),
        week: base.map((d) => ({
          start: d.inicio,
          hours: horasMax((Number(d.horas) || 0) * f.fator)
        }))
      })
      run = null
    }
    for (let dia = ini; dia < fimMes; dia += DIA) {
      if (feriado(dia)) {
        fecha()
        continue
      }
      // a última exceção do usuário que cobre o dia é a que vale (as exceções se aplicam em ordem)
      let fonte = -1
      excUsuario.forEach((e, k) => {
        if (e.a <= dia && dia <= e.b) fonte = k
      })
      if (run && run.fonte === fonte) run.ate = dia
      else {
        fecha()
        run = { de: dia, ate: dia, fonte }
      }
    }
    fecha()
  }
  return out
}

/** Calendário do InfraWork no formato do documento apex-obra/1, com o nome dado. */
export function calendarioParaObra(
  c: CalendarioEntrada,
  fatores: FatorMes[],
  nome: string
): CalendarioObra {
  const holidays: CalendarioObra['holidays'] = []
  const easter: string[] = []
  const weekday: CalendarioObra['weekday_holidays'] = []
  const exceptions: CalendarioObra['exceptions'] = []
  for (const d of c.definicoes) {
    if (d.tipo === 'feriado' && d.data_inicio && d.data_fim) {
      holidays.push({
        name: d.nome || 'Feriado',
        from: d.data_inicio,
        to: d.data_fim,
        yearly: d.todo_ano
      })
    } else if (d.tipo === 'pascoa') {
      holidays.push(...feriadosMoveisDoc(d.nome || 'Páscoa'))
    } else if (d.tipo === 'folga_semana' && d.data_inicio && d.dia_semana !== null) {
      weekday.push({ name: d.nome || 'Folga', date: d.data_inicio, weekday: d.dia_semana })
    } else if (d.tipo === 'horario_excecao' && d.data_inicio && d.data_fim && d.semana) {
      exceptions.push({
        name: d.nome || 'Horário excepcional',
        from: d.data_inicio,
        to: d.data_fim,
        week: semanaDoc(d.semana)
      })
    }
  }
  return {
    name: nome,
    week: semanaDoc(c.semana),
    holidays,
    easter,
    weekday_holidays: weekday,
    exceptions: [...exceptions, ...excecoesDosFatores(c, fatores)]
  }
}

/**
 * O calendário do ApeX (`CalendarSpec`) direto das definições, pelas mesmas regras da montagem do documento
 * (`calendarFromDoc` com a base inteira): semana, feriados (o fim inclui o último dia), feriados móveis, folgas anuais
 * e horários excepcionais (os do usuário e os dos fatores mensais). Usado pelas telas para mostrar o calendário como o
 * motor o vê.
 */
export function especificacaoCalendario(c: CalendarioEntrada, fatores: FatorMes[]): CalendarSpec {
  const o = calendarioParaObra(c, fatores, c.id)
  const dia = (x: { start: string; hours: number }): WorkDay => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(x.start)
    return {
      begin: m ? Number(m[1]) * 3600 + Number(m[2]) * 60 : 7 * 3600,
      length: Math.round(x.hours * 3600)
    }
  }
  const semana = (w: { start: string; hours: number }[]): CalendarSpec['week'] => ({
    flag: 1,
    days: w.map(dia) as CalendarSpec['week']['days']
  })
  const generators: GeneratorSpec[] = [
    ...o.holidays.map((h): GeneratorSpec => ({
      type: 'StaticHoliday',
      name: h.name,
      begin: BigInt(isoParaSeg(h.from)),
      end: BigInt(isoParaSeg(h.to) + 86399),
      yearly: h.yearly ? 1 : 0
    })),
    ...o.easter.map((n): GeneratorSpec => ({ type: 'Easter', name: n })),
    ...o.weekday_holidays.map((h): GeneratorSpec => ({
      type: 'StaticWeekDay',
      name: h.name,
      date: BigInt(isoParaSeg(h.date)),
      weekday: h.weekday
    }))
  ]
  return {
    version: 12,
    week: semana(o.week),
    generators,
    order: generators.map((_, k) => k),
    spans: o.exceptions.map((x) => ({
      name: x.name,
      first: BigInt(isoParaSeg(x.from)),
      last: BigInt(isoParaSeg(x.to)),
      week: semana(x.week)
    }))
  }
}
