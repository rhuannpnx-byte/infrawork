/**
 * WachContainer e RateTracker (RN-015; U-09). Evidência: analises/2026-10-11_dynaroad/evidencias/decompilado/{u09,
 * lacunas/rate}/ (WachContainer::* @0x9622f0…0x964680, WachContainerHelpers::MakeContainer @0x963210,
 * RateTracker::* @0xa000f0…0xa00c80, MovableWorkSiteHelpers::GetProductionRate @0x9b60c0, GetReceiveRate @0x9b6230,
 * WorkSite::GetProductionRate @0x93fb10, WorkSiteHelpers::GetUnitPriceFromResources @0x92a290).
 *
 * - [O] um span [b, e) guarda uma DENSIDADE por hora corrida; total = Σ q·(e − b)/3600.
 * - [O, U-55/L-040] AddSpan = `QuantitySpanContainer<Date,Quantity>::Merge@0x963880` + `MergeImpl@0x963910`: ignora
 *   span com densidade ≈ 0 (`AreEqual`) ou vazio; soma as densidades onde os spans se sobrepõem, partindo-os, e descarta a
 *   peça cuja soma é ≈ 0; vizinhos iguais não são fundidos. Os trechos 0 dos perfis salvos vêm da leitura direta
 *   (`ManageState`, `readWach`), que não passa pelo Merge.
 * - [O] Remove(q) escala todos os spans por 1 − q/total (não corta pontas).
 */
import type { Calendar } from "@apex/calendar";
import { MAX_DATE, MIN_DATE } from "@apex/calendar";
import type { Entity, Project, Ref } from "@apex/model";
import { implManager, type ActualsContext } from "./actuals.js";
import { convCoeff, destLandType, unitOfType } from "./costs.js";

export interface WSpan {
  b: number;
  e: number;
  q: number;
}

export class WachError extends Error {
  constructor(readonly code: "START_GE_FINISH" | "CANT_REMOVE" | "ZERO_RATE" | "NO_CREW" | "NO_DESTINATION_TYPE" | "POSITIVE_RATE_REQUIRED", message: string) {
    super(message);
    this.name = "WachError";
  }
}

const H = 1 / 3600;
/** Tools::AreEqual @0xa12ad0 */
const areEq = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * 8.881784197001252e-16;

/** `Tools::AreEqual(0, q)` (8,88e-16 relativo, mínimo 1) */
const zero = (q: number) => Math.abs(q) <= 8.881784197001252e-16;

export class WachContainer {
  spans: WSpan[] = [];
  constructor(public unit: bigint | null) {}

  clone(): WachContainer {
    const w = new WachContainer(this.unit);
    w.spans = this.spans.map((s) => ({ ...s }));
    return w;
  }

  /** soma de densidades (Merge [I]) */
  addSpan(s: WSpan): void {
    if (!(s.b < s.e) || zero(s.q)) return;
    const cuts = new Set<number>([s.b, s.e]);
    for (const x of this.spans) if (x.e > s.b && x.b < s.e) cuts.add(Math.max(x.b, s.b)).add(Math.min(x.e, s.e));
    const out: WSpan[] = [];
    for (const x of this.spans) {
      if (x.e <= s.b || x.b >= s.e) {
        out.push(x);
        continue;
      }
      if (x.b < s.b) out.push({ b: x.b, e: s.b, q: x.q });
      if (x.e > s.e) out.push({ b: s.e, e: x.e, q: x.q });
    }
    const pts = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i + 1 < pts.length; i++) {
      const b = pts[i]!, e = pts[i + 1]!;
      const old = this.spans.find((x) => x.b <= b && x.e >= e)?.q ?? 0;
      if (!zero(old + s.q)) out.push({ b, e, q: old + s.q }); // MergeImpl: soma ≈ 0 sai [O]
    }
    this.spans = out.sort((a, b) => a.b - b.b);
  }
  /** leitura direta de um perfil salvo (`KernelWachVector::ManageState`), sem o Merge */
  pushRaw(s: WSpan): void {
    this.spans.push({ ...s });
  }
  addSpans(o: WachContainer): void {
    for (const s of o.spans) this.addSpan(s);
  }
  removeSpan(s: WSpan): void {
    this.addSpan({ ...s, q: -s.q });
  }

  /** GetQuantityBetween @0x962ef0 */
  quantityBetween(b: number, e: number): number {
    let r = 0;
    for (const s of this.spans) {
      const nb = Math.max(s.b, b), ne = Math.min(s.e, e);
      if (nb < ne) r += s.q * (ne - nb) * H;
    }
    return r;
  }
  total(): number {
    return this.spans.reduce((t, s) => t + s.q * (s.e - s.b) * H, 0);
  }
  firstAvailable(): number {
    return this.spans.find((s) => s.q > 0)?.b ?? MAX_DATE;
  }
  lastAvailable(): number {
    for (let i = this.spans.length - 1; i >= 0; i--) if (this.spans[i]!.q > 0) return this.spans[i]!.e;
    return MIN_DATE;
  }
  /** Remove(q) @0x963c10: escala uniforme. */
  remove(q: number): void {
    const t = this.total();
    if (t < q) throw new WachError("CANT_REMOVE", "can't remove that much.");
    const f = 1 - q / t;
    this.spans = this.spans.map((s) => ({ ...s, q: s.q * f }));
  }
  /** CropDateSpan @0x962740: só o que está dentro de [b, e], com a mesma densidade. */
  cropDateSpan(b: number, e: number): void {
    this.spans = this.spans.flatMap((s) => {
      const nb = Math.max(s.b, b), ne = Math.min(s.e, e);
      return nb < ne ? [{ b: nb, e: ne, q: s.q }] : [];
    });
  }
  /** RemoveFromBack @0x963dc0: tira q do fim no tempo (fica com os primeiros total − q). */
  removeFromBack(q: number): void {
    this.removeFrom(q, true);
  }
  /** RemoveFromFront @0x964140: tira q do início no tempo (fica com os últimos total − q). */
  removeFromFront(q: number): void {
    this.removeFrom(q, false);
  }
  private removeFrom(q: number, back: boolean): void {
    const total = this.total();
    if (areEq(0, q)) return;
    if (areEq(total, q)) {
      this.spans = [];
      return;
    }
    if (total < q) throw new WachError("CANT_REMOVE", "Quantity to be removed exceeds total quantity");
    let keep = total - q;
    const order = back ? this.spans : [...this.spans].reverse();
    const out: WSpan[] = [];
    for (const s of order) {
      if (keep <= 0) break;
      const amt = s.q * (s.e - s.b) * H;
      if (amt <= keep) {
        out.push({ ...s });
        keep -= amt;
      } else {
        const h = ((s.e - s.b) * keep) / amt;
        out.push(back ? { b: s.b, e: s.b + h, q: s.q } : { b: s.e - h, e: s.e, q: s.q });
        keep = 0;
      }
    }
    this.spans = back ? out : out.reverse();
  }
  /** RemoveNegatives @0x9644d0: zera os negativos; true se havia algum. */
  removeNegatives(): boolean {
    const had = this.spans.some((s) => s.q < 0);
    for (const s of this.spans) if (s.q < 0) s.q = 0;
    return had;
  }
  /** WachContainer(unit, src, slt) @0x962360: densidades convertidas. */
  converted(unit: bigint | null, slt: Entity): WachContainer {
    const k = convCoeff(slt, this.unit, unit);
    const w = new WachContainer(unit);
    w.spans = this.spans.map((s) => ({ ...s, q: s.q * k }));
    return w;
  }
}

/** WachContainerHelpers::MakeContainer @0x963210: Q espalhado por igual nas horas de expediente de [b, e). */
export function makeContainer(q: number, unit: bigint | null, b: number, e: number, cal: Calendar): WachContainer {
  const w = new WachContainer(unit);
  if (e <= b) {
    if (b === e && q < 0.01) return w;
    throw new WachError("START_GE_FINISH", "start >= finish");
  }
  const hw = (cal.AS2WS(e) - cal.AS2WS(b)) * H;
  if (hw <= 0) {
    w.addSpan({ b, e, q: q / ((e - b) * H) });
    return w;
  }
  const dens = q / hw;
  for (const [s, f] of cal.workPeriods(b, e)) w.addSpan({ b: Math.max(s, b), e: Math.min(f, e), q: dens });
  return w;
}

// ---------- taxas e preços de recursos ----------

const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
export const SWGU_SEND = 1, SWGU_RECEIVE = 2;

export function selectedGroup(p: Project, ws: Entity, usage: number): Entity | undefined | null {
  const sel = (ws.get("m_cSelectedSubWorkGroups") as [unknown, unknown][] | undefined)?.find(([u]) => u === usage);
  return sel ? (p.resolve(sel[1] as Ref) ?? null) : undefined;
}

/** m_rates[tipo] = [taxa por hora, preço por unidade] [I] */
export function groupRateEntry(g: Entity, type: Entity): [number, number] {
  const r = (g.get("m_rates") as [unknown, unknown][] | undefined)?.find(([t]) => t === type.oid);
  const v = Array.isArray(r?.[1]) ? (r![1] as unknown[]) : [];
  return [num(v[0]), num(v[1])];
}

/** taxa da equipe para o tipo, na unidade do tipo [I: SubWorkGroup +0x18 = m_rates[tipo][0]] */
function groupRate(g: Entity, type: Entity): { q: number; unit: bigint | null } {
  if (g.className === "NullWorkGroup") return { q: 0, unit: unitOfType(type) };
  return { q: groupRateEntry(g, type)[0], unit: unitOfType(type) };
}

/** WorkSite::GetProductionRate(uso, tipo) @0x93fb10: taxa da equipe selecionada × m_dWachCoeff. */
export function workSiteRate(p: Project, ws: Entity, usage: number, type: Entity): { q: number; unit: bigint | null } {
  const g = selectedGroup(p, ws, usage);
  if (g === undefined) throw new WachError("NO_CREW", "no crew for usage");
  const r = g ? groupRate(g, type) : { q: 0, unit: unitOfType(type) };
  return { q: r.q * num(ws.get("m_dWachCoeff"), 1), unit: r.unit };
}

/** tipos de origem da tarefa (+0x44 GetSourceLandTypes) [I]: o próprio, ou os aceitos pelo tipo de destino (pilha/britagem) */
function sourceTypes(p: Project, ws: Entity): Entity[] {
  const own = p.resolve(ws.get("m_pSourceLandType") as Ref);
  if (own) return [own];
  const dlt = destLandType(p, ws);
  const v = dlt?.get("m_vpSuitableTypes");
  return (Array.isArray(v) ? (v as unknown[]) : []).map((o) => p.resolve(o as Ref)).filter((e): e is Entity => !!e);
}

/** MovableWorkSiteHelpers::GetProductionRate @0x9b60c0: quantidade/h na unidade pedida, convertida pelo material. */
export function productionRate(p: Project, ws: Entity, source: boolean, unit: bigint | null, slt: Entity): number {
  let r: number;
  if (source) {
    const q = workSiteRate(p, ws, SWGU_SEND, slt);
    r = q.q * convCoeff(slt, q.unit, unit);
    if (r === 0) for (const t of sourceTypes(p, ws)) {
      const qt = workSiteRate(p, ws, SWGU_SEND, t);
      r = Math.max(r, qt.q * convCoeff(t, qt.unit, unit));
    }
  } else {
    const dt = destLandType(p, ws);
    if (!dt) throw new WachError("NO_DESTINATION_TYPE", "no destination type");
    const q = workSiteRate(p, ws, SWGU_RECEIVE, dt);
    r = q.q * convCoeff(slt, q.unit, unit);
  }
  return r;
}

/** WorkSiteHelpers::GetUnitPriceFromResources @0x92a290: preço/h ÷ taxa + preço por unidade, na unidade do tipo. */
export function unitPriceFromResources(p: Project, ws: Entity, type: Entity, usage: number, pricePerHour: (g: Entity) => number, pricePerUnit: (g: Entity, t: Entity) => number): number {
  const g = selectedGroup(p, ws, usage);
  if (!g) throw new WachError("NO_CREW", "no crew for usage");
  const r = workSiteRate(p, ws, usage, type).q;
  if (!(r > 0)) throw new WachError("POSITIVE_RATE_REQUIRED", "positive production rate required here");
  return pricePerHour(g) / r + pricePerUnit(g, type);
}

// ---------- RateTracker ----------

export class RateTracker {
  readonly src = new Map<bigint, WachContainer>();
  readonly dst = new Map<bigint, WachContainer>();
  constructor(
    private readonly p: Project,
    private readonly calendarOf: (ws: Entity) => Calendar,
    private readonly wpTimes: (wp: Entity) => { begin: number; end: number },
    private readonly unitOf: (ws: Entity, source: boolean) => bigint | null,
  ) {}

  private site(wp: Entity): Entity {
    return this.p.resolve(wp.get("m_pWorkSite") as Ref)!;
  }

  /** GetFreeHours @0xa002f0: 1 hora de equipe por hora de expediente entre início e fim do work place. */
  freeHours(wp: Entity, source: boolean): WachContainer {
    const m = source ? this.src : this.dst;
    let w = m.get(wp.oid);
    if (w) return w;
    const ws = this.site(wp), cal = this.calendarOf(ws), { begin, end } = this.wpTimes(wp);
    const h = (cal.AS2WS(end) - cal.AS2WS(begin)) * H;
    w = makeContainer(h, this.unitOf(ws, source), begin, end, cal);
    m.set(wp.oid, w);
    return w;
  }
  rate(wp: Entity, source: boolean, unit: bigint | null, slt: Entity): number {
    return productionRate(this.p, this.site(wp), source, unit, slt);
  }
  freeHoursBetween(wp: Entity, source: boolean, b: number, e: number): number {
    return this.freeHours(wp, source).quantityBetween(b, e);
  }
  freeAmountBetween(wp: Entity, source: boolean, b: number, e: number, slt: Entity, unit: bigint | null): number {
    return this.rate(wp, source, unit, slt) * this.freeHoursBetween(wp, source, b, e);
  }
  /** GetFreeWachBetween @0xa00500: perfil livre recortado × taxa (massa/h). */
  freeWachBetween(wp: Entity, source: boolean, b: number, e: number, slt: Entity, unit: bigint | null): WachContainer {
    const r = this.rate(wp, source, unit, slt);
    const out = new WachContainer(unit);
    for (const s of this.freeHours(wp, source).spans) {
      const nb = Math.max(s.b, b), ne = Math.min(s.e, e);
      if (nb < ne) out.addSpan({ b: nb, e: ne, q: r * s.q });
    }
    return out;
  }
  /** GetDoneBetween @0xa000f0: produção possível no período menos a livre. */
  doneBetween(wp: Entity, source: boolean, b: number, e: number, slt: Entity, unit: bigint | null): number {
    const ws = this.site(wp), cal = this.calendarOf(ws), t = this.wpTimes(wp);
    const tb = Math.max(b, t.begin), te = Math.min(e, t.end);
    const possible = this.rate(wp, source, unit, slt) * (cal.AS2WS(te) - cal.AS2WS(tb)) * H;
    return possible - this.freeAmountBetween(wp, source, b, e, slt, unit);
  }
  firstAvailable(wp: Entity, source: boolean): number {
    return this.freeHours(wp, source).firstAvailable();
  }
  lastAvailable(wp: Entity, source: boolean): number {
    return this.freeHours(wp, source).lastAvailable();
  }
  /** IsCompletelyUsedBetween @0xa00700 */
  isCompletelyUsedBetween(wp: Entity, source: boolean, b: number, e: number, tol: number): boolean {
    for (const s of this.freeHours(wp, source).spans) if (Math.max(s.b, b) < Math.min(s.e, e) && s.q > tol) return false;
    return true;
  }
  /** SubtractWach @0xa00af0: massa/h ÷ taxa = horas de equipe consumidas. */
  subtractWach(wp: Entity, source: boolean, slt: Entity, wach: WachContainer): void {
    const free = this.freeHours(wp, source);
    const r = this.rate(wp, source, wach.unit, slt);
    if (r === 0) throw new WachError("ZERO_RATE", "zero production rate unexpected at this time");
    for (const s of wach.spans) free.removeSpan({ b: s.b, e: s.e, q: s.q / r });
  }
  /**
   * SubtractActuals @0xa00850: para cada apontamento (ImplInfo) e cada work place com massa dele (GetActualQuantities),
   * tira as horas de equipe consumidas nas datas em que ele executou aquele work place (GetActualTiming(wp, info)).
   */
  subtractActuals(ac: ActualsContext): void {
    const pairs = implManager(this.p).get("m_mpImplInfos");
    for (const [, o] of Array.isArray(pairs) ? (pairs as [unknown, unknown][]) : []) {
      const info = this.p.get(o as bigint);
      if (!info) continue;
      const ws = this.p.resolve(info.get("m_pWorkSite") as Ref)!;
      const source = info.get("m_bSource") !== false;
      const slt = this.p.resolve(info.get("m_pSourceLandType") as Ref);
      const qmap = ac.actualQuantities(info);
      for (const wp of ((ws.get("m_vpWorkPlaces") as unknown[] | undefined) ?? []).map((w) => this.p.get(w as bigint)!)) {
        const q = qmap.get(wp.oid);
        if (q === undefined || !(q > 0) || !slt) continue;
        const [t0, t1] = ac.actualTimingOf(wp, info);
        this.subtractWach(wp, source, slt, makeContainer(q, this.unitOf(ws, source), t0, t1, this.calendarOf(ws)));
      }
    }
  }
  removeNegatives(): boolean {
    let any = false;
    for (const m of [this.src, this.dst]) for (const w of m.values()) if (w.removeNegatives()) any = true;
    return any;
  }
}
