/**
 * Eixo de tempo das visões (Gantt e tempo-caminho), copiado do ApeX (`views/gantt/axis.ts`, RN-040) e adaptado: em vez
 * da cena lógica 0…1000, a escala é em pixels por hora de trabalho do calendário de interface.
 *
 * - O eixo é comprimido pelo calendário de interface (`makeUICalendar`): horas fora do expediente não ocupam espaço;
 *   sem "mostrar fins de semana", sábado e domingo somem; com "mostrar feriados", os feriados ficam no eixo (sombreados
 *   pela visão) — sem, também somem.
 * - Cabeçalho em dois níveis escolhidos pelo que cabe (`DrawIntervals`): hora/dia, dia da semana/dia, …, ano/década.
 * - Snap do arraste por dia (por hora quando o cabeçalho mostra horas e a tarefa é redimensionada).
 */
import {
  beginOfCalendarDay,
  Calendar,
  isWorkDay,
  MAX_DATE,
  MIN_DATE,
  type CalendarSpec,
  type WeekSpec
} from '@apex/calendar'

export const DIA = 86400
export const HORA = 3600
export const SEMANA = 7 * DIA

/**
 * `DDL::MakeUICalendar(cal, showWeekEnds, showHolidays)` [O]: copia a semana; com fins de semana, sábado e domingo
 * recebem (menor início, maior duração) da semana. Com feriados no eixo, o calendário não herda geradores nem exceções.
 */
export function calendarioInterface(
  base: CalendarSpec,
  fimDeSemana: boolean,
  feriados: boolean,
  /**
   * tempo-caminho (`views/time/common.ts` `makeUICalendar` [O]): início e duração só dos dias com expediente; o
   * Gantt do ApeX usa os 7 dias (`gantt/axis.ts`), e os dois ficam como no original
   */
  soDiasUteis = false
): Calendar {
  const days = base.week.days.map((d) => ({ ...d })) as WeekSpec['days']
  if (fimDeSemana) {
    const fonte = soDiasUteis ? days.filter((d) => d.length > 0) : days
    if (fonte.length) {
      let begin = 0x7fffffff
      let length = -0x80000000
      for (const d of fonte) {
        begin = Math.min(begin, d.begin)
        length = Math.max(length, d.length)
      }
      days[5] = { begin, length }
      days[6] = { begin, length }
    }
  }
  const week: WeekSpec = { flag: base.week.flag, days }
  return new Calendar(feriados ? { ...base, week, generators: [], spans: [] } : { ...base, week })
}

/**
 * `GetPointAtDate` / `GetDateAtPoint` [O] com escala em pixels: `x = (AS2WS(d) − AS2WS(início)) / 3600 · pxPorHora`.
 * A data de um ponto que cai numa fronteira comprimida é o início do próximo expediente.
 */
export class EixoTempo {
  private readonly w0: number

  constructor(
    readonly calendario: Calendar,
    readonly inicio: number,
    readonly fim: number,
    readonly pxPorHora: number
  ) {
    this.w0 = calendario.AS2WS(inicio)
  }

  get largura(): number {
    return this.x(this.fim)
  }

  x(t: number): number {
    return ((this.calendario.AS2WS(t) - this.w0) / HORA) * this.pxPorHora
  }

  data(x: number): number {
    const ws = this.w0 + (x / this.pxPorHora) * HORA
    let t: number
    try {
      t = this.calendario.WS2AS(Math.round(ws), true)
    } catch {
      t = ws < this.w0 ? MIN_DATE : MAX_DATE
    }
    return Math.min(MAX_DATE, Math.max(MIN_DATE, t))
  }
}

export const inicioDaHora = (t: number): number => t - (((t % HORA) + HORA) % HORA)

/**
 * `DrawableMoveTargetInfo` [O]: tarefa por hora se o cabeçalho mostra horas e (redimensionando ou "a qualquer hora"),
 * senão por dia; no redimensionamento soma 1 h / 1 dia (fim exclusivo). Linhas de grupo: sempre por dia.
 */
export function snapData(
  d: number,
  o: { horas: boolean; redimensionar: boolean; qualquerHora: boolean; tarefa: boolean }
): { data: number; porHora: boolean } {
  const porHora = o.tarefa && o.horas && (o.redimensionar || o.qualquerHora)
  let data = porHora ? inicioDaHora(d) : beginOfCalendarDay(d)
  if (o.redimensionar) data += porHora ? HORA : DIA
  return { data, porHora }
}

// ── níveis do cabeçalho (DrawIntervals) ─────────────────────────────────────────────────────────────────────────

export interface Intervalo {
  readonly nome: string
  /** primeira fronteira ≥ t */
  proximo(t: number): number
  /** fronteira ≤ t */
  anterior(t: number): number
  /** rótulo da célula que começa em t */
  rotulo(t: number): string
}

const utc = (t: number): Date => new Date(t * 1000)
const horaDe = (t: number): number => Math.floor((((t % DIA) + DIA) % DIA) / HORA)
const horaDeTrabalho = (cal: Calendar, t: number): boolean => cal.AS2WS(t + HORA) > cal.AS2WS(t)
/** dia da semana (segunda = 0) */
const diaDaSemana = (t: number): number => (((Math.floor(t / DIA) + 3) % 7) + 7) % 7
export const inicioDaSemana = (t: number): number => beginOfCalendarDay(t) - diaDaSemana(t) * DIA
const inicioDoMes = (t: number): number => {
  const d = utc(t)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000
}
const proximoMes = (t: number): number => {
  const d = utc(t)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000
}
const inicioDoAno = (t: number): number => Date.UTC(utc(t).getUTCFullYear(), 0, 1) / 1000
const anoIni = (y: number): number => Date.UTC(y, 0, 1) / 1000
const temTrabalho = (cal: Calendar, a: number, b: number): boolean => cal.AS2WS(b) > cal.AS2WS(a)

/** Semana ISO 8601 (a semana do InfraWork começa na segunda, como o perfil semanal). */
export function semanaIso(t: number): { semana: number; ano: number } {
  const d = utc(beginOfCalendarDay(t))
  // a quinta-feira da semana decide o ano
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const ano = d.getUTCFullYear()
  const semana = Math.ceil(((d.getTime() - Date.UTC(ano, 0, 1)) / 86400000 + 1) / 7)
  return { semana, ano }
}

function fmt(o: Intl.DateTimeFormatOptions): (t: number) => string {
  const f = new Intl.DateTimeFormat('pt-BR', { ...o, timeZone: 'UTC' })
  // só a primeira letra em maiúscula ("Out de 2026", "Seg"): `capitalize` no CSS subiria também o "de"
  return (t) => {
    const r = f.format(utc(t)).replace('.', '')
    return r.charAt(0).toUpperCase() + r.slice(1)
  }
}

/**
 * Os dez níveis na ordem de `DrawIntervals` [O]: 0 hora, 1 dia completo, 2 dia da semana, 3 dia do mês, 4 semana,
 * 5 semana/ano, 6 mês, 7 mês/ano, 8 ano, 9 década.
 */
export function intervalos(cal: Calendar): Intervalo[] {
  const dmy = fmt({ day: '2-digit', month: '2-digit', year: 'numeric' })
  const sem = fmt({ weekday: 'short' })
  const mes = fmt({ month: 'short' })
  const mesAno = fmt({ month: 'short', year: 'numeric' })
  const ano = (t: number): string => String(utc(t).getUTCFullYear())

  const hora: Omit<Intervalo, 'rotulo' | 'nome'> = {
    proximo(t) {
      for (let i = 0; i < 24 * 400; i++) {
        if (((t % HORA) + HORA) % HORA === 0 && horaDeTrabalho(cal, t)) return t
        t += HORA - (((t % HORA) + HORA) % HORA)
      }
      return t
    },
    anterior(t) {
      for (let i = 0; i < 24 * 400; i++) {
        const r = ((t % HORA) + HORA) % HORA
        if (r === 0 && horaDeTrabalho(cal, t)) return t
        t += -r - HORA
      }
      return t
    }
  }
  const inicioDoExpediente = (t: number): number =>
    cal.WS2AS(cal.AS2WS(beginOfCalendarDay(t)), true)
  const dia: Omit<Intervalo, 'rotulo' | 'nome'> = {
    proximo(t) {
      if (isWorkDay(cal, t) && inicioDoExpediente(t) === t) return t
      const p = cal.workPeriods(t, t + 400 * DIA).find(([a]) => a > t)
      return p ? p[0] : MAX_DATE
    },
    anterior(t) {
      if (isWorkDay(cal, t) && inicioDoExpediente(t) === t) return t
      const p = cal
        .workPeriods(Math.max(MIN_DATE, t - 400 * DIA), t + 1)
        .filter(([a]) => a <= t)
        .pop()
      return p ? p[0] : MIN_DATE
    }
  }
  const diaUtil: Omit<Intervalo, 'rotulo' | 'nome'> = {
    proximo(t) {
      for (let i = 0; i < 400; i++) {
        const r = ((t % DIA) + DIA) % DIA
        if (r === 0 && isWorkDay(cal, t)) return t
        t += DIA - r
      }
      return t
    },
    anterior(t) {
      for (let i = 0; i < 400; i++) {
        const r = ((t % DIA) + DIA) % DIA
        if (r === 0 && isWorkDay(cal, t)) return t
        t += -r - (r === 0 ? DIA : 0)
      }
      return t
    }
  }
  const semana: Omit<Intervalo, 'rotulo' | 'nome'> = {
    proximo(t) {
      let w = inicioDaSemana(t)
      if (w === t && temTrabalho(cal, w, w + SEMANA)) return t
      for (let i = 0; i < 600; i++) {
        w += SEMANA
        if (temTrabalho(cal, w, w + SEMANA)) return w
      }
      return w
    },
    anterior(t) {
      let w = inicioDaSemana(t)
      for (let i = 0; i < 600 && !temTrabalho(cal, w, w + SEMANA); i++) w -= SEMANA
      return w
    }
  }
  const mesI: Omit<Intervalo, 'rotulo' | 'nome'> = {
    proximo(t) {
      let m = inicioDoMes(t)
      if (m === t && temTrabalho(cal, m, proximoMes(m))) return t
      for (let i = 0; i < 1200; i++) {
        m = proximoMes(m)
        if (temTrabalho(cal, m, proximoMes(m))) return m
      }
      return m
    },
    anterior(t) {
      let m = inicioDoMes(t)
      for (let i = 0; i < 1200 && !temTrabalho(cal, m, proximoMes(m)); i++) m = inicioDoMes(m - 1)
      return m
    }
  }
  const anoI: Omit<Intervalo, 'rotulo' | 'nome'> = {
    proximo(t) {
      let y = inicioDoAno(t)
      if (y === t && temTrabalho(cal, y, anoIni(utc(y).getUTCFullYear() + 1))) return t
      for (let i = 0; i < 1000; i++) {
        y = anoIni(utc(y).getUTCFullYear() + 1)
        if (temTrabalho(cal, y, anoIni(utc(y).getUTCFullYear() + 1))) return y
      }
      return y
    },
    anterior(t) {
      return inicioDoAno(t)
    }
  }
  const decada: Omit<Intervalo, 'rotulo' | 'nome'> = {
    proximo(t) {
      let y = anoI.proximo(t)
      for (let i = 0; i < 20 && utc(y).getUTCFullYear() % 10 !== 0; i++)
        y = anoI.proximo(anoIni(utc(y).getUTCFullYear() + 1))
      return y
    },
    anterior(t) {
      const yy = utc(t).getUTCFullYear()
      return anoIni(yy - (((yy % 10) + 10) % 10))
    }
  }
  return [
    { nome: 'hora', ...hora, rotulo: (t) => String(horaDe(t)) },
    { nome: 'dia-completo', ...dia, rotulo: dmy },
    { nome: 'dia-semana', ...diaUtil, rotulo: sem },
    { nome: 'dia', ...dia, rotulo: (t) => String(utc(t).getUTCDate()) },
    { nome: 'semana', ...semana, rotulo: (t) => `S${semanaIso(t).semana}` },
    {
      nome: 'semana-ano',
      ...semana,
      rotulo: (t) => {
        const w = semanaIso(t)
        return `S${w.semana}/${w.ano}`
      }
    },
    { nome: 'mes', ...mesI, rotulo: mes },
    { nome: 'mes-ano', ...mesI, rotulo: mesAno },
    { nome: 'ano', ...anoI, rotulo: ano },
    { nome: 'decada', ...decada, rotulo: ano }
  ]
}

/** Pares (fino, grosso) na ordem de `DrawIntervals` [O]; 10 = nenhum. */
export const PARES_NIVEIS: readonly (readonly [number, number])[] = [
  [0, 1],
  [2, 1],
  [2, 5],
  [3, 7],
  [4, 7],
  [6, 8],
  [10, 8],
  [10, 9]
]

export interface Celula {
  readonly de: number
  readonly ate: number
  readonly x0: number
  readonly x1: number
  readonly rotulo: string
}

/**
 * `DrawIntervalsImpl` [O]: células de `anterior(b)` até `proximo(e)`; o nível "cabe" se todo rótulo é mais estreito
 * que a célula. Na passada de teste a primeira célula que não cabe encerra.
 */
export function celulas(
  iv: Intervalo,
  b: number,
  e: number,
  px: (t: number) => number,
  medir: (s: string) => number,
  teste: boolean
): { cabe: boolean; celulas: Celula[] } {
  const out: Celula[] = []
  let cur = Math.min(MAX_DATE, Math.max(MIN_DATE, iv.anterior(b)))
  let prox = iv.proximo(cur + 1)
  const ultimo = iv.proximo(e)
  let cabe = true
  for (let guarda = 0; prox <= ultimo && guarda < 20000; guarda++) {
    const x0 = px(cur),
      x1 = px(prox)
    const rotulo = iv.rotulo(cur)
    if (!(x1 - x0 > medir(rotulo))) {
      cabe = false
      if (teste) return { cabe, celulas: out }
    }
    out.push({ de: cur, ate: prox, x0, x1, rotulo })
    cur = prox
    prox = iv.proximo(prox + 1)
  }
  return { cabe, celulas: out }
}

/** Escolha do par: o primeiro em que os dois níveis cabem; `horas` = o nível fino é a hora. */
export function escolherNiveis(cabem: readonly boolean[]): {
  fino: number | null
  grosso: number | null
  horas: boolean
} {
  for (const [f, g] of PARES_NIVEIS) {
    if ((f === 10 || cabem[f]) && (g === 10 || cabem[g]))
      return { fino: f === 10 ? null : f, grosso: g === 10 ? null : g, horas: f === 0 }
  }
  return { fino: null, grosso: null, horas: false }
}

/**
 * `DrawHolidays` [O]: períodos não úteis do calendário do plano que ocupam espaço no eixo (feriados, e fins de semana
 * quando mostrados), para sombrear.
 */
export function periodosNaoUteis(
  global: Calendar,
  eixo: EixoTempo,
  b: number,
  e: number
): [number, number][] {
  let periodos: [number, number][]
  try {
    periodos = global.workPeriods(b - 7 * DIA, e + 7 * DIA)
  } catch {
    return []
  }
  const out: [number, number][] = []
  for (let i = 0; i + 1 < periodos.length; i++) {
    const g0 = periodos[i]![1],
      g1 = periodos[i + 1]![0]
    if (g1 <= g0 || eixo.calendario.AS2WS(g1) - eixo.calendario.AS2WS(g0) <= 0) continue
    out.push([g0, g1])
  }
  return out
}

/** Níveis do cabeçalho horizontal na faixa [b, e] (`DrawIntervals`): rótulos que cabem na largura das células. */
export function niveisCabecalho(
  eixo: EixoTempo,
  b: number,
  e: number
): { fino: Celula[]; grosso: Celula[]; horas: boolean; temFino: boolean } {
  const ivs = intervalos(eixo.calendario)
  const px = (t: number): number => eixo.x(t)
  const medir = (s: string): number => s.length * 6.2 + 6
  const cabem = ivs.map((iv) => celulas(iv, b, e, px, medir, true).cabe)
  const { fino, grosso, horas } = escolherNiveis(cabem)
  return {
    horas,
    fino: fino === null ? [] : celulas(ivs[fino]!, b, e, px, medir, false).celulas,
    grosso: grosso === null ? [] : celulas(ivs[grosso]!, b, e, px, medir, false).celulas,
    temFino: fino !== null
  }
}
