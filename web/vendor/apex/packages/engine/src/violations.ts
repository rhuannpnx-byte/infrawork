/**
 * Violações do cronograma (RF-037; D-020/U-07b): as "bandeiras vermelhas" do gráfico. Evidência:
 * analises/2026-10-11_dynaroad/evidencias/decompilado/u07b/ ViolationHelper::AddViolations @0x6b31b0,
 * AddDependencyViolations @0x6b2a50, AddForcedPointViolations @0x6b2bd0, AddMilestoneViolations @0x6b2e20,
 * AddProjectViolations @0x6b2fc0; u07b_delay/ DependencyHelpers::GetRealDelay @0x9a2130; enums em
 * evidencias/visoes/decompilado/tempo_extra/enums_todos.txt (SCT_*, FCT_*).
 *
 * - [O] só tarefas estritas.
 * - [O] dependência (a tarefa é a sucessora) com atraso máximo: viola se o atraso real > máximo. Atraso real: FS/FF
 *   medem do fim do predecessor, SS/SF do início; FS/SS até o início do sucessor, FF/SF até o fim; dias corridos =
 *   segundos ÷ 86400; dias úteis = o maior GetWorkDaysBetween nos calendários do sucessor e do predecessor.
 * - [O, U-54/L-037] BY_STATIONS: `GetRealDelay(dep, &x, menor=false)` monta `BuildStationDateSpanVector@0x9ee990` dos
 *   dois lados e `GetDistanceInDays@0x9eeb90` devolve o máximo de data_suc(x) − data_pred(x) nas bordas das
 *   sobreposições (`stationDelay`). [I] spans em ordem de estaca e a comparação truncada do decompilado (`P.st0 < S.st1`).
 * - [O] data forçada, comparando só o dia: EXACT_START viola se o dia do início ≠ dia forçado; EARLIEST_START se o
 *   início é antes; EXACT_FINISH se o dia do fim ≠; LATEST_FINISH se o fim é depois.
 * - [O] marco que contém a tarefa: início antes do início do marco; fim depois do fim do marco.
 * - [O] projeto: início antes do início do projeto; fim depois do prazo.
 */
import { getWorkDaysBetween, type Calendar } from "@apex/calendar";
import type { Entity } from "@apex/model";
import { DEP, type Scheduler, type Site } from "./timing.js";

export type Violation =
  | { kind: "dependency"; site: bigint; dependency: bigint; realDelay: number; maxDelay: number }
  | { kind: "forced"; site: bigint; point: "START" | "FINISH" }
  | { kind: "milestone"; site: bigint; milestone: bigint; point: "START" | "FINISH" }
  | { kind: "project"; site: bigint; point: "START" | "FINISH" };

const SCT = { EARLIEST_START: 1, EXACT_START: 2 } as const;
const FCT = { LATEST_FINISH: 1, EXACT_FINISH: 2 } as const;
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const big = (v: unknown) => (typeof v === "bigint" ? Number(v) : undefined);
const day = (t: number) => Math.floor(t / 86400);
const beginOf = (s: Site) => Math.min(...s.wps.map((w) => w.begin));
const endOf = (s: Site) => Math.max(...s.wps.map((w) => w.end));

/** DependencyHelpers::GetRealDelay(dep, _, false) @0x9a2130; BY_STATIONS por `GetDistanceInDays` (U-54). */
export function realDelay(sched: Scheduler, d: Entity): number | undefined {
  const pred = sched.sites.get(d.get("m_pPredecessor") as bigint), succ = sched.sites.get(d.get("m_pSuccessor") as bigint);
  if (!pred || !succ || pred.wps.length === 0 || succ.wps.length === 0) return undefined;
  const type = num(d.get("m_nType"));
  if (type === DEP.BY_STATIONS) return stationDelay(stationSpans(pred), stationSpans(succ), d.get("m_bIsDelayWorkDays") === true, false);
  const a = type === DEP.FINISH_START || type === DEP.FINISH_FINISH ? endOf(pred) : beginOf(pred);
  const b = type === DEP.FINISH_START || type === DEP.START_START ? beginOf(succ) : endOf(succ);
  if (d.get("m_bIsDelayWorkDays") !== true) return (b - a) / 86400;
  return Math.max(getWorkDaysBetween(succ.calendar, a, b), getWorkDaysBetween(pred.calendar, a, b));
}

export interface StationDateSpan {
  st0: number;
  d0: number;
  st1: number;
  d1: number;
  cal: Calendar;
}

/** `StationSpanHelpers::BuildStationDateSpanVector@0x9ee990` [O]: por work place, low → (início, fim), high → (fim, início). */
export function stationSpans(s: Site): StationDateSpan[] {
  return s.wps
    .map((w) => ({ st0: w.stationBegin, d0: s.low ? w.begin : w.end, st1: w.stationEnd, d1: s.low ? w.end : w.begin, cal: s.calendar }))
    .sort((a, b) => a.st0 - b.st0);
}

/** `StationSpanHelpers::GetDateAtStation(span, x)@0x9eeaa0` [O ASM]. */
export function spanDateAtStation(sp: StationDateSpan, x: number): number {
  const r = sp.st1 > sp.st0 ? (sp.cal.AS2WS(sp.d1) - sp.cal.AS2WS(sp.d0)) / (sp.st1 - sp.st0) : 0;
  const off = Math.floor(r * (x - sp.st0));
  return off !== 0 ? sp.cal.WS2AS(sp.cal.AS2WS(sp.d0) + off, false) : sp.d0;
}

/** `StationSpanHelpers::GetDistanceInDays(P, S, &d, &x, menor, diasÚteis)@0x9eeb90` [O]; undefined se não há sobreposição. */
export function stationDelay(P: readonly StationDateSpan[], S: readonly StationDateSpan[], workDays: boolean, smaller: boolean): number | undefined {
  const days = (a: number, b: number, cp: Calendar, cs: Calendar) => {
    if (!workDays) return (b - a) / 86400;
    const x = getWorkDaysBetween(cp, a, b), y = getWorkDaysBetween(cs, a, b);
    return smaller ? Math.min(x, y) : Math.max(x, y);
  };
  const eq = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * 8.881784197001252e-16;
  if (P.length === 1 && S.length === 1 && eq(P[0]!.st0, P[0]!.st1) && eq(S[0]!.st0, S[0]!.st1)) {
    return days(P[0]!.d1, S[0]!.d0, P[0]!.cal, S[0]!.cal); // GetZeroLengthDistanceInDays@0x9ef230
  }
  let best = smaller ? Number.MAX_VALUE : -Number.MAX_VALUE, found = false, i = 0, j = 0;
  while (i < P.length && j < S.length) {
    const p = P[i]!, s = S[j]!;
    if (p.st1 < s.st0) { i++; continue; }
    if (!(p.st0 < s.st1)) { j++; continue; }
    found = true;
    for (const x of [Math.max(p.st0, s.st0), Math.min(p.st1, s.st1)]) {
      const v = days(spanDateAtStation(p, x), spanDateAtStation(s, x), p.cal, s.cal);
      best = smaller ? Math.min(best, v) : Math.max(best, v);
    }
    if (p.st1 < s.st1) i++;
    else j++;
  }
  return found ? best : undefined;
}

/** ViolationHelper::AddViolations para todas as tarefas estritas, com as datas atuais do Scheduler. */
export function violations(sched: Scheduler): Violation[] {
  const p = sched.project;
  const out: Violation[] = [];
  for (const [oid, s] of sched.sites) {
    if (!s.strict || s.wps.length === 0) continue;
    const e = s.entity;
    const b = beginOf(s), en = endOf(s);
    for (const d of p.byClass("Dependency")) {
      if (d.get("m_pSuccessor") !== oid || d.get("m_pPredecessor") === oid || d.get("m_bHasMaxDelay") !== true) continue;
      const r = realDelay(sched, d);
      const max = num(d.get("m_nDelayMax"));
      if (r !== undefined && max < r) out.push({ kind: "dependency", site: oid, dependency: d.oid, realDelay: r, maxDelay: max });
    }
    for (const m of p.byClass("Milestone")) {
      if (!sched.isInMilestone(m, s)) continue;
      const mb = big(m.get("m_beginDate")), me = big(m.get("m_endDate"));
      if (mb !== undefined && b < mb) out.push({ kind: "milestone", site: oid, milestone: m.oid, point: "START" });
      if (me !== undefined && me < en) out.push({ kind: "milestone", site: oid, milestone: m.oid, point: "FINISH" });
    }
    const sc = num(e.get("m_forcedBeginConstraint")), fc = num(e.get("m_forcedEndConstraint"));
    const fb = big(e.get("m_forcedBeginDate")), fe = big(e.get("m_forcedEndDate"));
    if (fb !== undefined && ((sc === SCT.EXACT_START && day(b) !== day(fb)) || (sc === SCT.EARLIEST_START && day(b) < day(fb))))
      out.push({ kind: "forced", site: oid, point: "START" });
    if (fe !== undefined && ((fc === FCT.EXACT_FINISH && day(en) !== day(fe)) || (fc === FCT.LATEST_FINISH && day(fe) < day(en))))
      out.push({ kind: "forced", site: oid, point: "FINISH" });
    if (b < sched.projectStart) out.push({ kind: "project", site: oid, point: "START" });
    if (sched.projectEnd < en) out.push({ kind: "project", site: oid, point: "FINISH" });
  }
  return out;
}
