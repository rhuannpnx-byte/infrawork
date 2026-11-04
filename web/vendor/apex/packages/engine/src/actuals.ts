/**
 * Repartição dos apontamentos entre os work places (RF-023, L-045). Evidência: analises/2026-10-11_dynaroad/handoff/docs/
 * analise_realizados_l045_l048.md §1–§2 e evidencias/decompilado/{u20,u20_r1}/: `anon::TaskActuals` (ctors @0x9ca5e0,
 * @0x9ca7b0, @0x9ca8f0; Calculate @0x9caf00, conferido no ASM), GetActualIntervals @0x9cba30/@0x9cbb10, Merge
 * @0x9ccd70, GetActualIntervalQuantity @0x9cb900/@0x9cb980, GetSubtimespanPortion @0x9cc8d0, MapQuantityPosToDatePos
 * @0x9ccc10, GetPlannedQuantities @0x9cc520/@0x9cc670 e ActualHelpers::* @0x9cb580…0x9ccbb0.
 *
 * - [O] um TaskActuals por (tarefa, sentido, lado): work places enchidos em ordem do vetor a partir da ponta de início
 *   (invertido no sentido alto), apontamentos em ordem cronológica, capacidade q·T/P com T = A (encerrada) ou max(A, P).
 * - [O] datas lineares em segundos de trabalho dentro de cada trecho (início por floor, fim por ceil, WS2AS com o
 *   mesmo sinalizador).
 * - [I] comparações de Quantity sem tolerância e sem conversão de unidade (L-R3); ordem de m_vpWorkPlaces = estaca
 *   crescente (L-R9).
 * - O original recalcula a cada chamada; aqui um ActualsContext guarda o resultado enquanto o projeto não muda.
 */
import { MAX_DATE, MIN_DATE, type Calendar } from "@apex/calendar";
import type { Entity, Project, Ref } from "@apex/model";
import { isDestination, isSource } from "./costs.js";
import { Scheduler } from "./timing.js";

export class ActualsError extends Error {
  constructor(readonly code: "NOT_STARTED" | "UNKNOWN_ACTUAL_TYPE", message: string) {
    super(message);
    this.name = "ActualsError";
  }
}

const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
const date = (v: unknown) => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : 0);
const pairs = (v: unknown) => (Array.isArray(v) ? (v as [unknown, unknown][]) : []);
const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);
export const isOtherSite = (ws: Entity) => ws.className === "OtherWorkSite";

export const implManager = (p: Project) => p.resolve(p.root()!.get("m_pImplManager") as Ref)!;

/** ImplManager::GetActuals @0x95aa50: ImplInfo (movable, m_mpImplInfos) ou OtherActual (m_otherActuals) da tarefa. */
export function actualsOf(p: Project, ws: Entity): Entity[] {
  const im = implManager(p);
  const key = isOtherSite(ws) ? "m_otherActuals" : "m_mpImplInfos";
  return pairs(im.get(key)).filter(([k]) => k === ws.oid).map(([, v]) => p.get(v as bigint)).filter((e): e is Entity => !!e);
}

/** ImplManager::GetImplementedAmount @0x95abe0 (e a soma dos OtherActual): lado e sentidos aceitos. */
export function implementedAmount(p: Project, ws: Entity, bSource: boolean, bLow: boolean, bHigh: boolean): number {
  return actualsOf(p, ws)
    .filter((a) => (isOtherSite(ws) || actualIsSource(a) === bSource) && ((bLow && actualIsLow(a)) || (bHigh && !actualIsLow(a))))
    .reduce((s, a) => s + actualAmount(a), 0);
}

export const actualBegin = (a: Entity) => date(a.get("m_dateBegin"));
export const actualEnd = (a: Entity) => date(a.get("m_dateEnd"));
export const actualAmount = (a: Entity) => num(a.get("m_dAmount"));
export const actualIsLow = (a: Entity) => a.get("m_bLow") === true;
export const actualIsSource = (a: Entity) => a.get("m_bSource") !== false;
const workPlacesOf = (p: Project, ws: Entity) => refs(ws.get("m_vpWorkPlaces")).map((o) => p.get(o)).filter((w): w is Entity => !!w);
const siteOfWp = (p: Project, wp: Entity) => p.resolve(wp.get("m_pWorkSite") as Ref)!;
const finished = (ws: Entity) => ws.get("m_bFinished") === true;
/** MovableWorkPlaceHelpers::GetAmount(wp, lado) / OtherWorkPlace (quantidade principal, vt+0x24) */
export const wpAmount = (ws: Entity, wp: Entity, source: boolean) => num(wp.get(isOtherSite(ws) ? "m_dAmount" : source ? "m_dSourceAmount" : "m_dDestinationAmount"));

const EPS = 8.881784197001252e-16;
const areEqual = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * EPS;

/** trecho do interval_map de datas: [b, e) com os apontamentos ativos */
interface Segment {
  b: number;
  e: number;
  set: Entity[];
}

/** GetActualIntervals + Merge @0x9ccd70: [b, e) por apontamento (instantâneo vira 1 s); trechos vizinhos iguais se unem (icl joining). */
export function actualIntervals(actuals: readonly Entity[]): Segment[] {
  const spans = actuals.map((a) => {
    const b = actualBegin(a);
    let e = actualEnd(a);
    if (e === b) e = b + 1;
    return { a, b, e };
  });
  const cuts = [...new Set(spans.flatMap((s) => [s.b, s.e]))].sort((x, y) => x - y);
  const out: Segment[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const b = cuts[i]!, e = cuts[i + 1]!;
    const set = spans.filter((s) => s.b <= b && e <= s.e).map((s) => s.a);
    if (!set.length) continue;
    const last = out[out.length - 1];
    if (last && last.e === b && last.set.length === set.length && last.set.every((x, k) => x === set[k])) last.e = e;
    else out.push({ b, e, set });
  }
  return out;
}

/** GetSubtimespanPortion @0x9cc8d0: fração de [ab, ae] contida em [b, e], em segundos de trabalho. */
export function subtimespanPortion(b: number, e: number, ab: number, ae: number, cal: Calendar): number {
  const wa = cal.AS2WS(ae) - cal.AS2WS(ab);
  if (wa !== 0) return (cal.AS2WS(e) - cal.AS2WS(b)) / wa;
  if (ae !== ab) return (e - b) / (ae - ab);
  return 1;
}

/** GetActualIntervalQuantity @0x9cb980: massa do apontamento dentro de [b, e) (uniforme nas horas de trabalho). */
const intervalQuantity = (a: Entity, b: number, e: number, cal: Calendar) => actualAmount(a) * subtimespanPortion(b, e, actualBegin(a), actualEnd(a), cal);

/** MapQuantityPosToDatePos @0x9ccc10 */
export function mapQuantityPosToDatePos(pos: number, total: number, b: number, e: number, cal: Calendar, isStart: boolean): number {
  const f = total <= 0 ? (isStart ? 0 : 1) : pos / total;
  const round = isStart ? Math.floor : Math.ceil;
  const dws = cal.AS2WS(e) - cal.AS2WS(b);
  let d = b;
  if (dws === 0) {
    if (e !== b) d = b + round((e - b) * f);
  } else {
    const x = round(dws * f);
    if (x !== 0) d = cal.WS2AS(cal.AS2WS(b) + x, isStart);
  }
  return Math.min(Math.max(d, b), e);
}

/** os cinco membros do TaskActuals (PDB, 160 B) */
export interface TaskActuals {
  /** m_actualLocationQuantities: apontamento → work place → massa */
  locationQuantities: Map<bigint, Map<bigint, number>>;
  /** m_actualTaskLocationTimings: work place → [min início, max fim] */
  locationTimings: Map<bigint, [number, number]>;
  /** m_actualTaskLocationQuantities: work place → massa (a chave significa "iniciado") */
  taskLocationQuantities: Map<bigint, number>;
  /** m_actualPortions: apontamento → [lo, hi] de porção medida da estaca baixa */
  portions: Map<bigint, [number, number]>;
  /** m_actualTaskLocationActualTimings: "wp:apontamento" → [início, fim] */
  actualTimings: Map<string, [number, number]>;
}

const envelope = (m: Map<string | bigint, [number, number]>, k: string | bigint, lo: number, hi: number) => {
  const cur = m.get(k);
  m.set(k, cur ? [Math.min(cur[0], lo), Math.max(cur[1], hi)] : [lo, hi]);
};

/** TaskActuals::Calculate @0x9caf00 (ASM conferido) */
export function calculateTaskActuals(ws: Entity, planned: readonly [Entity, number][], low: boolean, intervals: readonly Segment[], cal: Calendar): TaskActuals {
  const r: TaskActuals = { locationQuantities: new Map(), locationTimings: new Map(), taskLocationQuantities: new Map(), portions: new Map(), actualTimings: new Map() };
  if (!intervals.length) return r;
  const order = low ? [...planned] : [...planned].reverse();
  const P = order.reduce((s, [, q]) => s + q, 0);
  const segQty = (seg: Segment) => seg.set.reduce((s, a) => s + intervalQuantity(a, seg.b, seg.e, cal), 0);
  const A = intervals.reduce((s, seg) => s + segQty(seg), 0);
  const T = finished(ws) ? A : A < P ? P : A;
  const scale = P > 0 ? T / P : 1;
  let i = 0, filled = 0, cum = 0;
  for (const seg of intervals) {
    const ivQty = segQty(seg);
    let rem = ivQty;
    while (rem > 0) {
      if (i === order.length) return r;
      const [wp, q] = order[i]!;
      const cap = q * scale;
      const start = mapQuantityPosToDatePos(ivQty - rem, ivQty, seg.b, seg.e, cal, true);
      const p0 = cum / T;
      let take: number;
      if (rem + filled < cap) {
        take = rem;
        rem = 0;
        filled += take;
      } else {
        take = cap - filled;
        rem -= take;
        filled = 0;
        i++;
      }
      cum += take;
      const end = Math.max(start, mapQuantityPosToDatePos(ivQty - rem, ivQty, seg.b, seg.e, cal, false));
      const p1 = cum / T;
      envelope(r.locationTimings, wp.oid, start, end);
      for (const a of seg.set) {
        const qa = take * (intervalQuantity(a, seg.b, seg.e, cal) / ivQty);
        let m = r.locationQuantities.get(a.oid);
        if (!m) r.locationQuantities.set(a.oid, (m = new Map()));
        m.set(wp.oid, (m.get(wp.oid) ?? 0) + qa);
        r.taskLocationQuantities.set(wp.oid, (r.taskLocationQuantities.get(wp.oid) ?? 0) + qa);
        const [lo, hi] = low ? [p0, p1] : [1 - p1, 1 - p0];
        envelope(r.portions, a.oid, lo, hi);
        envelope(r.actualTimings, `${wp.oid}:${a.oid}`, start, end);
      }
    }
    if (i === order.length) break;
  }
  return r;
}

/**
 * ActualHelpers sobre um projeto. O TaskActuals de cada (tarefa, sentido, lado) é calculado uma vez por contexto; crie
 * um contexto novo depois de mudar o projeto.
 */
export class ActualsContext {
  private readonly cache = new Map<string, TaskActuals>();
  private sched?: Scheduler;
  constructor(
    readonly p: Project,
    private readonly calendar?: (ws: Entity) => Calendar,
  ) {}
  private calendarOf(ws: Entity): Calendar {
    return this.calendar ? this.calendar(ws) : (this.sched ??= new Scheduler(this.p)).calendarOf(ws);
  }

  /** TaskActuals(im, ws, low, source) @0x9ca7b0 / (im, otherWs, low) @0x9ca8f0 */
  taskActuals(ws: Entity, low: boolean, source: boolean): TaskActuals {
    const other = isOtherSite(ws);
    const key = `${ws.oid}:${low}:${other || source}`;
    let r = this.cache.get(key);
    if (!r) {
      const list = actualsOf(this.p, ws).filter((a) => actualIsLow(a) === low && (other || actualIsSource(a) === source));
      const planned = workPlacesOf(this.p, ws).map((wp) => [wp, wpAmount(ws, wp, source)] as [Entity, number]);
      r = calculateTaskActuals(ws, planned, low, actualIntervals(list), this.calendarOf(ws));
      this.cache.set(key, r);
    }
    return r;
  }
  /** TaskActuals(im, actual) @0x9ca5e0 */
  ofActual(a: Entity): TaskActuals {
    const ws = this.p.resolve(a.get("m_pWorkSite") as Ref);
    if (!ws || (a.className !== "ImplInfo" && a.className !== "OtherActual")) throw new ActualsError("UNKNOWN_ACTUAL_TYPE", "Unknown actual type");
    return this.taskActuals(ws, actualIsLow(a), a.className === "OtherActual" || actualIsSource(a));
  }

  /** GetActualQuantities @0x9cbbe0: tarefa com 1 work place → tudo nele; senão a repartição do TaskActuals. */
  actualQuantities(a: Entity): Map<bigint, number> {
    const ws = this.p.resolve(a.get("m_pWorkSite") as Ref)!;
    const wps = workPlacesOf(this.p, ws);
    if (wps.length === 1) return new Map([[wps[0]!.oid, actualAmount(a)]]);
    return new Map(this.ofActual(a).locationQuantities.get(a.oid) ?? []);
  }
  /** GetActualQuantity(wp, low, source) @0x9cbdd0 (sem atalho de 1 work place) */
  actualQuantity(wp: Entity, low: boolean, source: boolean): number {
    return this.taskActuals(siteOfWp(this.p, wp), low, source).taskLocationQuantities.get(wp.oid) ?? 0;
  }
  /** GetActualQuantity(wp, source) @0x9cbee0: baixo + alto */
  actualQuantityBoth(wp: Entity, source: boolean): number {
    return this.actualQuantity(wp, true, source) + this.actualQuantity(wp, false, source);
  }

  /** GetActualTiming(wp, low, source) @0x9cc0f0 */
  actualTimingSide(wp: Entity, low: boolean, source: boolean): [number, number] {
    const ws = siteOfWp(this.p, wp);
    if (workPlacesOf(this.p, ws).length === 1) {
      let b = MAX_DATE, e = MIN_DATE;
      for (const a of actualsOf(this.p, ws)) {
        if (actualIsLow(a) !== low || (!isOtherSite(ws) && actualIsSource(a) !== source)) continue;
        b = Math.min(b, actualBegin(a));
        e = Math.max(e, actualEnd(a));
      }
      if (b <= e) return [b, e];
    } else {
      const t = this.taskActuals(ws, low, source).locationTimings.get(wp.oid);
      if (t) return [t[0], t[1]];
    }
    if (finished(ws)) return [date(wp.get("pDVar2")), date(wp.get("m_endTime"))];
    throw new ActualsError("NOT_STARTED", "Task location is not started");
  }
  /** GetActualTiming(wp) @0x9cbf40: as combinações dos lados que a tarefa tem, cada uma em try/catch. */
  actualTiming(wp: Entity): [number, number] {
    const ws = siteOfWp(this.p, wp);
    let b = MAX_DATE, e = MIN_DATE;
    for (let k = 0; k < 4; k++) {
      const low = (k & 1) === 1, source = (k & 2) === 2;
      if (!isOtherSite(ws) && (source ? !isSource(ws) : !isDestination(ws))) continue;
      try {
        const [x, y] = this.actualTimingSide(wp, low, source);
        b = Math.min(b, x);
        e = Math.max(e, y);
      } catch {
        // o original engole a exceção e passa à próxima combinação [O]
      }
    }
    if (e < b) throw new ActualsError("NOT_STARTED", "Task location is not started");
    return [b, e];
  }
  /** GetActualTiming(wp, actual) @0x9cc3f0 */
  actualTimingOf(wp: Entity, a: Entity): [number, number] {
    const ws = siteOfWp(this.p, wp);
    if (workPlacesOf(this.p, ws).length === 1) return [actualBegin(a), actualEnd(a)];
    return this.ofActual(a).actualTimings.get(`${wp.oid}:${a.oid}`) ?? [0, 0];
  }
  /** GetPortionSpan @0x9cc780 */
  portionSpan(a: Entity): [number, number] {
    return this.ofActual(a).portions.get(a.oid) ?? [0, 0];
  }

  /** IsStarted(wp, low, source) @0x9ccae0 */
  isStarted(wp: Entity, low: boolean, source: boolean): boolean {
    const ws = siteOfWp(this.p, wp);
    return finished(ws) || this.taskActuals(ws, low, source).taskLocationQuantities.has(wp.oid);
  }
  /** IsStarted(wp, source) @0x9ccbb0 */
  isStartedSide(wp: Entity, source: boolean): boolean {
    return this.isStarted(wp, true, source) || this.isStarted(wp, false, source);
  }
  /** IsFinished(wp, source) @0x9cca30: apontado ≥ planejado (com AreEqual) */
  isFinishedSide(wp: Entity, source: boolean): boolean {
    const ws = siteOfWp(this.p, wp);
    if (finished(ws)) return true;
    if (!this.isStartedSide(wp, source)) return false;
    const act = this.actualQuantityBoth(wp, source), plan = wpAmount(ws, wp, source);
    return !(act < plan && !areEqual(act, plan));
  }
  /** IsFinished(wp) @0x9cc9c0: na substituição basta um lado */
  isFinished(wp: Entity): boolean {
    const ws = siteOfWp(this.p, wp);
    return finished(ws) || (isSource(ws) && this.isFinishedSide(wp, true)) || (isDestination(ws) && this.isFinishedSide(wp, false));
  }

  /** GetActualDegree(wp, low, source) @0x9cb580 */
  actualDegree(wp: Entity, low: boolean, source: boolean): number {
    const ws = siteOfWp(this.p, wp);
    const plan = wpAmount(ws, wp, source);
    const q = this.taskActuals(ws, low, source).taskLocationQuantities.get(wp.oid);
    if (plan < 0 || areEqual(plan, 0)) return q !== undefined ? 1 : 0;
    return q !== undefined ? q / plan : 0;
  }
  /** GetActualDegree(wp, source) @0x9cb6a0: baixo + alto; com planejado ≤ 0, arredonda em 0,5 */
  actualDegreeSide(wp: Entity, source: boolean): number {
    const ws = siteOfWp(this.p, wp);
    const s = this.actualDegree(wp, true, source) + this.actualDegree(wp, false, source);
    const plan = wpAmount(ws, wp, source);
    return plan > 0 && !areEqual(plan, 0) ? s : s > 0.5 ? 1 : 0;
  }
}
