/**
 * Edição do calendário como os comandos `CalendarCommands::*` do original (U-38). Evidência:
 * analises/2026-10-11_dynaroad/handoff/docs/calendario_dialogos.md §1.3, §2–§5 e §7; funções em
 * handoff/funcoes/18_calendario_dialogos/. Todas operam sobre um `CalendarSpec` (o blob do .dr5) e o deixam pronto
 * para `serializeCalendarBlob`: os geradores entram no fim do vetor e a lista de ordem volta a 0…n−1.
 */
import type { CalendarSpec, GeneratorSpec, SpanSpec, WeekSpec, WorkDay } from "./blob.js";

const DAY = 86400;
const floorDay = (t: number) => Math.floor(t / DAY) * DAY;
const big = (n: number) => BigInt(n);

/** `WorkTimeGeneratorHelpers::ValidateWorkDay@0x8f10f0` [O]: −1 fica; duração em [0, 86399]; início em [0, 86399 − duração]. */
export function validateWorkDay(begin: number, length: number): WorkDay {
  if (length === -1) return { begin: 0, length: -1 }; // par (−1, 0) = (duração, início) [O]
  const len = Math.min(Math.max(length, 0), 86399);
  return { begin: Math.min(Math.max(begin, 0), 86399 - len), length: len };
}

/** Algum dia com expediente (> 0). */
export const hasWorkHours = (days: readonly WorkDay[]): boolean => days.some((d) => d.length > 0);

/**
 * `UnSerialize` descarta os geradores fora da lista de ordem e `Serialize` grava 0…n−1 [O §5]: depois de editar, o
 * blob fica só com os efetivos, na ordem do vetor.
 */
export function normalizeOrder(spec: CalendarSpec): CalendarSpec {
  const keep = new Set(spec.order);
  const generators = spec.generators.filter((_, i) => keep.has(i));
  return { ...spec, generators, order: generators.map((_, i) => i) };
}

/** `SetDefaultWeekDayGenerator@0x8eaa70` [O]: só aplica se algum dia tem duração > 0; senão nada muda (sem mensagem). */
export function setDefaultWeek(spec: CalendarSpec, days: readonly WorkDay[]): boolean {
  if (days.length !== 7 || !hasWorkHours(days)) return false;
  spec.week = { flag: spec.week.flag, days: days.map((d) => ({ ...d })) as WeekSpec["days"] };
  return true;
}

/** `StaticHolidayGenerator(início, fim, anual, nome)@0x8eeb80` [O]: dias inteiros (00:00:00 … 23:59:59), trocados se invertidos. */
export function holidayGenerator(name: string, begin: number, end: number, yearly: boolean): GeneratorSpec {
  const [b, e] = begin <= end ? [begin, end] : [end, begin];
  return { type: "StaticHoliday", name, begin: big(floorDay(b)), end: big(floorDay(e) + DAY - 1), yearly: yearly ? 1 : 0 };
}
/** `StaticWeekDayGenerator(data, dia, nome)@0x8eede0` [O]: a data é guardada como veio. */
export function weekDayGenerator(name: string, date: number, weekday: number): GeneratorSpec {
  return { type: "StaticWeekDay", name, date: big(date), weekday };
}
/** `WorkTimeSpan` com `SetDateSpan@0x8f06a0` [O]: primeiro dia 00:00:00, último 23:59:59, trocados se invertidos. */
export function calendarSpan(name: string, first: number, last: number, days: readonly WorkDay[], flag = 1): SpanSpec {
  const [a, b] = first <= last ? [first, last] : [last, first];
  return { name, first: big(floorDay(a)), last: big(floorDay(b) + DAY - 1), week: { flag, days: days.map((d) => ({ ...d })) as WeekSpec["days"] } };
}

/** `AddWorkTimeGenerator@0x8e8500` [O]: no fim do vetor (spans vão para `AddWorkTimeSpan`). */
export function addCalendarGenerator(spec: CalendarSpec, g: GeneratorSpec): void {
  Object.assign(spec, normalizeOrder(spec));
  spec.generators.push({ ...g });
  spec.order = spec.generators.map((_, i) => i);
}
/** `RemoveWorkTimeGenerator@0x8ea710` [O]. */
export function removeCalendarGenerator(spec: CalendarSpec, index: number): void {
  Object.assign(spec, normalizeOrder(spec));
  spec.generators.splice(index, 1);
  spec.order = spec.generators.map((_, i) => i);
}
/** `RemoveWorkTimeSpan@0x8ea7d0` [O]. */
export function removeWorkTimeSpan(spec: CalendarSpec, index: number): void {
  spec.spans.splice(index, 1);
}

// ---------- `DDL::Calendar::AddWorkTimeSpan@0x8e85a0` (§7) ----------

/** Span com as datas em dias (índice do dia de `first` e de `last`). */
interface S { week: WeekSpec; name: string; f: number; l: number; existing: boolean }
const dayIdx = (t: bigint) => Math.floor(Number(t) / DAY);
const toSpec = (s: S): SpanSpec => ({ week: s.week, name: s.name, first: big(s.f * DAY), last: big(s.l * DAY + DAY - 1) });
const sameDays = (a: S, b: S) => a.week.days.every((d, i) => d.begin === b.week.days[i]!.begin && d.length === b.week.days[i]!.length);
const sameAll = (a: S, b: S) => sameDays(a, b) && a.f === b.f && a.l === b.l;
const clone = (s: S, f: number, l: number): S => ({ week: { flag: s.week.flag, days: s.week.days.map((d) => ({ ...d })) as WeekSpec["days"] }, name: s.name, f, l, existing: false });
/** `UpdateWorkDayLengths@0x8f0fa0` [O]: os dias definidos de Q passam para E; o nome junta os dois. */
function merge(e: S, q: S): void {
  q.week.days.forEach((d, i) => { if (d.length !== -1) e.week.days[i] = { ...d }; });
  if (!e.name) e.name = q.name;
  else if (q.name) e.name = `${e.name} ${q.name}`;
}

/**
 * Inclusão de uma exceção de jornada [O §7]: não empilha spans sobrepostos; parte os existentes e funde os dias
 * (a jornada efetiva é a de "aplicar N por último"). Divergências [P] (registradas no LACUNAS e no V-060): no caso
 * Qf < Ef, El = Ql com N cobrindo E o original grava [Ef, Ql] e perde [Qf, Ef−1] de N — aqui fica [Qf, Ql]; um span
 * existente descartado sai do vetor (no original fica um ponteiro solto).
 */
export function addWorkTimeSpan(spec: CalendarSpec, n: SpanSpec): void {
  if (n.week.days.every((d) => d.length === -1)) return;
  const spans: S[] = spec.spans.map((x) => ({ week: x.week, name: x.name, f: dayIdx(x.first), l: dayIdx(x.last), existing: true }));
  const N: S = { week: n.week, name: n.name, f: dayIdx(n.first), l: dayIdx(n.last), existing: false };
  const twin = spans.find((e) => sameAll(e, N));
  if (twin) {
    twin.name = N.name;
    spec.spans = spans.map(toSpec);
    return;
  }
  const p = clone(N, N.f, N.l);
  p.week = { flag: N.week.flag, days: N.week.days.map((d) => ({ ...d })) as WeekSpec["days"] };
  p.name = N.name;
  let toAdd: S[] = [p];
  const novos: S[] = [p];
  const dropped = new Set<S>();
  const drop = (q: S) => {
    toAdd = toAdd.filter((x) => x !== q);
    const k = novos.indexOf(q);
    if (k >= 0) novos.splice(k, 1);
    if (q.existing) dropped.add(q);
  };
  for (const E of [...spans]) {
    if (!toAdd.length) break;
    if (dropped.has(E)) continue;
    const head = toAdd[0]!;
    const same7 = sameDays(head, E);
    // `AreEqualDefinedDays`: todo dia indefinido em N também é indefinido em E (N cobre os dias de E)
    const ovr = head.week.days.every((d, i) => d.length !== -1 || E.week.days[i]!.length === -1);
    for (let i = 0; i < toAdd.length; i++) {
      const Q = toAdd[i]!;
      if (Q === E || sameAll(E, Q)) continue;
      if (Q.l < E.f || E.l < Q.f) continue;
      const before = toAdd.length;
      if (same7) { E.f = Math.min(E.f, Q.f); E.l = Math.max(E.l, Q.l); drop(Q); }
      else if (E.f === Q.f && E.l === Q.l) { merge(E, Q); drop(Q); }
      else if (E.f === Q.f && E.l > Q.l) {
        if (ovr) E.f = Q.l + 1;
        else { novos.push(clone(E, Q.l + 1, E.l)); merge(E, Q); E.l = Q.l; drop(Q); }
      } else if (E.f === Q.f && E.l < Q.l) {
        if (ovr) { merge(E, Q); E.l = Q.l; drop(Q); toAdd.push(E); }
        else { merge(E, Q); Q.f = E.l + 1; }
      } else if (Q.f < E.f && E.l === Q.l) {
        if (ovr) { merge(E, Q); E.f = Q.f; drop(Q); toAdd.push(E); } // [P] o original grava [Ef, Ql]
        else { merge(E, Q); Q.l = E.f - 1; }
      } else if (E.f < Q.f && E.l === Q.l) {
        if (ovr) E.l = Q.f - 1;
        else { novos.push(clone(E, E.f, Q.f - 1)); merge(E, Q); E.f = Q.f; drop(Q); }
      } else if (E.f < Q.f && E.l < Q.l) {
        if (ovr) E.l = Q.f - 1;
        else { const c = clone(E, Q.f, E.l); merge(c, Q); novos.push(c); E.l = Q.f - 1; Q.f = c.l + 1; }
      } else if (E.f < Q.f && E.l > Q.l) {
        const c1 = clone(E, Q.f, Q.l); merge(c1, Q); novos.push(c1); novos.push(clone(E, Q.l + 1, E.l)); E.l = Q.f - 1; drop(Q);
      } else if (Q.f < E.f && Q.l < E.l) {
        if (ovr) E.f = Q.l + 1;
        else { const c = clone(E, E.f, Q.l); merge(c, Q); novos.push(c); E.f = Q.l + 1; Q.l = c.f - 1; }
      } else if (Q.f < E.f && Q.l > E.l) {
        if (ovr) { merge(E, Q); E.f = Q.f; E.l = Q.l; drop(Q); toAdd.push(E); }
        else { const c = clone(Q, Q.f, E.f - 1); toAdd.push(c); novos.push(c); merge(E, Q); Q.f = E.l + 1; }
      }
      if (toAdd.length < before && toAdd.indexOf(Q) < 0) i--;
    }
  }
  spec.spans = [...spans.filter((s) => !dropped.has(s)), ...novos].map(toSpec);
}
