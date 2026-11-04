/**
 * Calendário de trabalho (RF-011, RD-019, RNF-007): conversão entre segundos absolutos (AS, DDL::Date, RD-022)
 * e segundos de trabalho (WS), e AddWorkDays. Evidência: analises/2026-10-11_dynaroad/handoff/funcoes/8_calendario/
 * e handoff/docs/formato_calendario.md.
 *
 * Como o original (DDL::Calendar):
 * - [O] FillVectors @008e9b40: jornada semanal, depois cada gerador de feriado (apaga), depois cada
 *   WorkTimeSpan (substitui a jornada nos dias dele, inclusive sobre feriados).
 * - [O] MakeVectorsFromIntervals @008ea400: vetores paralelos m_vAS/m_vWS começando por (−2^63+1, −2^63+1) e
 *   (0, 0); para cada período [a, b): (a, w) e (b, w + (b − a)). Sem período de trabalho → "No working time".
 * - [O] AS2WS @008e81a0, WS2AS @008eb210, AddWorkDays @008e8230 (busca por lower_bound nesses vetores).
 * - [O] faixa: GetMinDate @008e9ce0 = 1998-01-01 00:00; GetMaxDate @008e9c60 = 2999-12-31 23:59:59;
 *   UnSerialize preenche até 2020-12-31 23:59:59; Grow @008ea160 dobra (2·último − mínimo) até o máximo.
 * - [O] U-38 (`calendario_dialogos.md` §6, assembly dos reparos): `WeekDayGenerator::MakeIntervals@0x8ede80`
 *   (dia com duração −1 = não definido), `StaticHolidayGenerator@0x8efe50` ([início, fim); anual preserva a
 *   DURAÇÃO a partir do mesmo mês/dia/hora), `EasterGenerator@0x8ef9b0` (sexta-feira santa, domingo e segunda de
 *   Páscoa e a Ascensão), `StaticWeekDayGenerator@0x8f0090` (o dia da semana em dd/mm ou depois, todo ano); os
 *   laços de ano começam em 1998 (`FillVectors(GetMinDate, …)`); WorkTimeSpan só mexe nos dias definidos (L-036).
 * - [O] `UnSerialize` descarta os geradores cujo índice não está na lista de ordem.
 * Tempos em segundos como `number` (inteiros exatos até 2^53; o máximo usado é ~3,25·10^10).
 */
import { ddlDateFromParts } from "@apex/dr5";
import type { CalendarSpec, GeneratorSpec, WeekSpec } from "./blob.js";

export const DAY = 86400;
export const MIN_DATE = Number(ddlDateFromParts(1998, 1, 1));
export const MAX_DATE = Number(ddlDateFromParts(2999, 12, 31, 23, 59, 59));
export const INITIAL_FILL_END = Number(ddlDateFromParts(2020, 12, 31, 23, 59, 59));
/** Sentinela do original: −2^63+1 (aqui o menor inteiro exato do double). */
const SENTINEL = -Number.MAX_SAFE_INTEGER;
/** AddWorkDays: limiar de fração, 1/86400 (@008e8230). */
const DAY_EPS = 1 / DAY;

export class CalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarError";
  }
}

const weekDayOf = (dayStart: number) => (((Math.floor(dayStart / DAY) + 3) % 7) + 7) % 7;
const floorDay = (t: number) => Math.floor(t / DAY) * DAY;
const yearOf = (t: number) => new Date(t * 1000).getUTCFullYear();
/** `DDL::Date(a, m, d, h, mi, s)` (mês 1…12); 29/02 em ano comum vira 01/03, como a aritmética juliana do original. */
const dateOf = (y: number, m: number, d: number, h = 0, mi = 0, sec = 0) => Date.UTC(y, m - 1, d, h, mi, sec) / 1000;

/** `FindEaster@0x8ef6f0` [O]: dias do domingo de Páscoa depois de 21/03, transcrição com o truncamento do C. */
export function findEaster(y: number): number {
  const t = Math.trunc;
  const mod = (a: number, m: number) => { const r = a % m; return r < 0 ? r + m : r; };
  const D = mod(y + t(y / 4) + t(y / 400) - t(y / 100), 7);
  const G = (y % 19) + 1;
  let E = mod(-t((y - 1600) / 400) - t((t((y - 1400) / 100) * 8) / 25) + t((y - 1600) / 100) - 11 * G + 3, 30);
  if (E === 29 || (E === 28 && G > 11)) E -= 1;
  const W = mod(4 - E - D, 7);
  return E + 1 + W;
}

type Iv = [number, number];
/** Ordena e une (o `interval_set` do boost junta intervalos que se encostam). */
function normalize(list: Iv[]): Iv[] {
  const out: Iv[] = [];
  for (const r of list.filter(([x, y]) => x < y).sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}
/** `erase(conjunto, intervalos)`; os dois normalizados. */
function subtract(a: readonly Iv[], b: readonly Iv[]): Iv[] {
  const out: Iv[] = [];
  let j = 0;
  for (const [x0, y] of a) {
    let x = x0;
    while (j < b.length && b[j]![1] <= x) j++;
    for (let k = j; k < b.length && b[k]![0] < y; k++) {
      if (b[k]![0] > x) out.push([x, b[k]![0]]);
      x = Math.max(x, b[k]![1]);
    }
    if (x < y) out.push([x, y]);
  }
  return out;
}

/** `WeekDayGenerator::MakeIntervals@0x8ede80` [O]: expediente e "dias definidos" (duração ≠ −1), sem recorte no fim. */
function weekIntervals(week: WeekSpec, from: number, to: number): { work: Iv[]; defined: Iv[] } {
  const work: Iv[] = [], defined: Iv[] = [];
  for (let d = floorDay(from); d <= to; d += DAY) {
    const wd = week.days[weekDayOf(d)]!;
    if (wd.length === -1) continue;
    if (wd.length > 0) work.push([d + wd.begin, d + wd.begin + wd.length]);
    defined.push([d, d + DAY]);
  }
  return { work: normalize(work), defined: normalize(defined) };
}

/** Intervalos [a, b) que um gerador apaga em [from, to) (`*Generator::MakeIntervals`, §6) [O]. */
function generatorIntervals(g: GeneratorSpec, from: number, to: number): Iv[] {
  const out: Iv[] = [];
  const add = (a: number, b: number) => { a = Math.max(a, from); b = Math.min(b, to); if (a < b) out.push([a, b]); };
  const y0 = yearOf(from), y1 = yearOf(to);
  if (g.type === "StaticHoliday") {
    let b = Number(g.begin), e = Number(g.end);
    if (e < b) [b, e] = [e, b]; // a leitura troca os dois (`@0x8ee990`)
    if (!g.yearly) { add(b, e); return out; }
    const d = new Date(b * 1000);
    for (let y = y0; y <= y1; y++) {
      // `MoveDateSpanToYear@0x8f02f0`: mesmo mês/dia/hora no ano; o fim = início + duração (não a data final)
      const nb = dateOf(y, d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
      add(nb, Math.min(nb + (e - b), MAX_DATE));
    }
  } else if (g.type === "Easter") {
    for (let y = y0; y <= y1; y++) {
      const P = dateOf(y, 3, 21) + findEaster(y) * DAY; // domingo de Páscoa 00:00
      add(P - 2 * DAY, P - DAY); // sexta-feira santa
      add(P, P + 2 * DAY); // domingo e segunda
      add(P + 39 * DAY, P + 40 * DAY); // quinta da Ascensão
    }
  } else if (g.weekday >= 0 && g.weekday <= 6) {
    const d = new Date(Number(g.date) * 1000); // a hora gravada é ignorada
    for (let y = y0; y <= y1; y++) {
      let day = dateOf(y, d.getUTCMonth() + 1, d.getUTCDate());
      while (weekDayOf(day) !== g.weekday) day += DAY;
      add(day, day + DAY);
    }
  }
  return out;
}

/** Geradores efetivos: `UnSerialize` descarta os que não aparecem na lista de ordem [O]. */
export function activeGenerators(spec: CalendarSpec): GeneratorSpec[] {
  const order = new Set(spec.order);
  return spec.generators.filter((_, i) => order.has(i));
}

/**
 * `FillVectors@0x8e9b40` [O]: semana padrão; cada gerador apaga; cada WorkTimeSpan (ordem do vetor) apaga os seus
 * dias definidos e põe o próprio expediente (dias −1 ficam como estavam).
 */
function workIntervals(spec: CalendarSpec, lo: number, hi: number): Iv[] {
  let set = weekIntervals(spec.week, lo, hi).work;
  set = subtract(set, normalize(activeGenerators(spec).flatMap((g) => generatorIntervals(g, lo, hi))));
  for (const s of spec.spans) {
    const a = Math.max(Number(s.first), lo), b = Math.min(Number(s.last), hi);
    if (a > b) continue;
    const w = weekIntervals(s.week, a, b);
    set = normalize([...subtract(set, w.defined), ...w.work]);
  }
  return set;
}

export class Calendar {
  /** Geradores do blob que este calendário não aplica: nenhum desde a U-38 (L-036 fechada). */
  readonly ignoredGenerators: string[] = [];
  private vAS: number[] = [];
  private vWS: number[] = [];
  private lastAS = 0;

  constructor(readonly spec: CalendarSpec) {
    this.fill(MIN_DATE, INITIAL_FILL_END);
  }

  /** FillVectors + MakeVectorsFromIntervals. */
  private fill(lo: number, hi: number): void {
    const parts = workIntervals(this.spec, lo, hi);
    if (parts.length === 0) throw new CalendarError("No working time");
    const vAS = [SENTINEL, 0], vWS = [SENTINEL, 0];
    let ws = 0;
    const push = (as: number, w: number) => {
      if (vAS[vAS.length - 1] !== as) {
        vAS.push(as);
        vWS.push(w);
      }
    };
    for (const [a, b] of parts) {
      push(a, ws);
      ws += b - a;
      push(b, ws);
    }
    this.vAS = vAS;
    this.vWS = vWS;
    this.lastAS = hi;
  }

  /** Grow @008ea160: dobra a faixa até GetMaxDate; além dele, CalendarException. */
  private grow(): void {
    if (this.lastAS >= MAX_DATE) throw new CalendarError("data além de 2999-12-31 (CalendarException)");
    this.fill(MIN_DATE, Math.min(MAX_DATE, 2 * this.lastAS - MIN_DATE));
  }
  private ensureAS(t: number): void {
    while (this.lastAS < t) this.grow();
  }
  private ensureWS(w: number): void {
    while (this.vWS[this.vWS.length - 1]! < w) this.grow();
  }

  private static lowerBound(v: number[], x: number): number {
    let lo = 0, hi = v.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (v[m]! < x) lo = m + 1;
      else hi = m;
    }
    return lo;
  }

  /** Segundos absolutos → segundos de trabalho (AS2WS @008e81a0). Fora do expediente o WS fica constante. */
  AS2WS(t: number): number {
    this.ensureAS(t);
    const k = Calendar.lowerBound(this.vAS, t) - 1;
    const ws = this.vWS[k]!;
    return ws !== this.vWS[k + 1] ? t - this.vAS[k]! + ws : ws;
  }

  /**
   * Segundos de trabalho → absolutos (WS2AS @008eb210). Um WS que cai numa folga vira o início do próximo
   * expediente se `atWorkBegin`, senão o fim do anterior.
   */
  WS2AS(w: number, atWorkBegin: boolean): number {
    this.ensureWS(w);
    const idx = Calendar.lowerBound(this.vWS, w);
    let k = idx - 1;
    if (w === this.vWS[idx]) k = idx + 1;
    if (!atWorkBegin && w === this.vWS[k]) k -= 1;
    return w + this.vAS[k]! - this.vWS[k]!;
  }

  /**
   * AddWorkDays @008e8230: cada período de trabalho conta como um dia; a fração do dia corrente entra na conta.
   * Fração ≈ 0 devolve o início do período (`atWorkBegin`) ou o fim do anterior. [I] os operandos dos
   * `_ltod3` (comprimento do período) vêm do contexto, não do pseudocódigo.
   */
  addWorkDays(t: number, days: number, atWorkBegin: boolean): number {
    this.ensureAS(t + DAY);
    const idx = Calendar.lowerBound(this.vAS, t);
    let base = idx;
    const k = idx - 1;
    if (this.vWS[k] !== this.vWS[k + 1]) {
      days += (t - this.vAS[k]!) / (this.vAS[k + 1]! - this.vAS[k]!);
      base = k;
    }
    const n = Math.trunc(days);
    const u = base + n * 2;
    while (this.vAS.length <= u + 1 && this.lastAS < MAX_DATE) this.grow();
    if (u < 2 || this.vAS.length <= u + 1) throw new CalendarError("out of bounds");
    const frac = days - n;
    if (frac > DAY_EPS) return this.vAS[u]! + Math.floor((this.vAS[u + 1]! - this.vAS[u]!) * frac + 0.5);
    if (frac >= -DAY_EPS) return atWorkBegin ? this.vAS[u]! : this.vAS[u - 1]!;
    return this.vAS[u - 1]! - Math.floor((this.vAS[u - 1]! - this.vAS[u - 2]!) * -frac + 0.5);
  }

  /**
   * Núcleo do GetWorkDaysBetween @008e9df0 para lo < hi: índices dos períodos que contêm cada ponta (ponto
   * exato conta como o seguinte), pares inteiros entre eles e as frações das pontas [I].
   */
  workDaysSpan(lo: number, hi: number): number {
    this.ensureAS(hi);
    const idxOf = (t: number) => {
      let i = Calendar.lowerBound(this.vAS, t) - 1;
      if (t === this.vAS[i + 1]) i += 1;
      return i;
    };
    let i = idxOf(lo), j = idxOf(hi);
    const working = (k: number) => this.vWS[k] !== this.vWS[k + 1];
    const len = (k: number) => this.vAS[k + 1]! - this.vAS[k]!;
    if (i === j) return working(i) ? (hi - lo) / len(i) : 0;
    let frac = 0;
    if (working(i)) {
      frac += (this.vAS[i + 1]! - lo) / len(i);
      i += 2;
    } else i += 1;
    if (working(j)) frac += (hi - this.vAS[j]!) / len(j);
    else j += 1;
    return Math.floor((j - i) / 2) + frac;
  }

  /** Se o instante está dentro de um expediente (início incluído, fim excluído). */
  isWorkTime(t: number): boolean {
    this.ensureAS(t + 1);
    const k = Calendar.lowerBound(this.vAS, t + 1) - 1;
    return this.vWS[k] !== this.vWS[k + 1] && t >= this.vAS[k]!;
  }

  /** Períodos de trabalho [início, fim) que tocam [lo, hi) — base do iterador de expediente (CalendarIterator). */
  workPeriods(lo: number, hi: number): [number, number][] {
    this.ensureAS(hi);
    const out: [number, number][] = [];
    for (let k = Calendar.lowerBound(this.vAS, lo) - 1; k < this.vAS.length - 1 && this.vAS[k]! < hi; k++) {
      if (k >= 0 && this.vWS[k] !== this.vWS[k + 1] && this.vAS[k + 1]! > lo && this.vAS[k]! >= 0) out.push([this.vAS[k]!, this.vAS[k + 1]!]);
    }
    return out;
  }
}
