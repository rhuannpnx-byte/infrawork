/**
 * Otimização de transportes, modo Schedule (RF-027, RN-012, RN-013, RN-015, RN-016; D-005). Evidência:
 * analises/2026-10-11_dynaroad/handoff/docs/analise_otimizacao_schedule.md e evidencias/decompilado/{otimizacao,
 * janelas, janelas_extra/reparado, candidatos, lacunas/rate, u09, u09b}/: ScheduleLom::Solve @0xa0da90,
 * MakeHaulChainCandidateStepsWithDates @0x9fe900/Impl @0x9febd0, HaulChainCandidateStepWithDates @0x9fddf0,
 * MakeHaulInfosWithDates @0x9d9c70, ExtractExpensiveSpans @0x9d8d90, SplitOverlappingSpans(ByRole) @0x9da480/@0x9da7b0,
 * BuildModel @0xa0bbb0 e Add* @0xa0a730…0xa0b760, SetObjective @0xa0d850, MakeUniqueHauls @0xa0c310,
 * MakeWachContainer @0xa0d010, Export @0xa0bd30, SchedMove::SchedMove @0x95f580, RemoveAllSchedMoves @0x94fb30.
 *
 * Decisões e inferências (além das de plan.ts):
 * - [P] HiGHS sem o warm start do CLP (x⁰ = limites superiores) nem a perturbação 50 / steepest exato (D-005).
 * - [O defeito, U-55/L-041] ExtractExpensiveSpans: `TryToExtractChain@0x9db0e0` usa `remove_if` + `insert(newEnd, end)`,
 *   que manda para V2 as últimas k colunas do vetor, não as da cadeia (`tryToExtractChain`). Imitado de propósito
 *   (D-030: resultado igual ao DynaRoad); só aparece com mais de `maxAlternatives` alternativas por par.
 * - [I] SplitOverlappingSpansByRole: o comparador da 1ª ordenação só precisa agrupar por work place (o resultado não
 *   depende do resto, porque a ordenação final é total).
 * - [O] transportador (m_pHaulResource) no passo: GetMaxDistance e IsSuitablePath (L-042, HaulChainCandidateStepWithDates
 *   @0x9fddf0); o Plan não filtra por transportador [O].
 * - Tolerâncias [O]: Tools::AreEqual/IsLessThanOrEqual com 8,88e-16 relativo (mínimo 1).
 */
import { MAX_DATE, MIN_DATE } from "@apex/calendar";
import { COIN_DBL_MAX, LomBuild, ModelRow, solveLp } from "@apex/lp";
import type { Field, FieldValue } from "@apex/dr5";
import { encodeContainer, type Entity, type Project, type Ref } from "@apex/model";
import { convertAmount, convertedPrice, destLandType, MASS_TYPE, massType, refinedTypeForMoveTo, sourceLandType, unitOfType, unitPrice } from "./costs.js";
import { DBL_MAX, DistanceCalculatorManager, type LightPath } from "./distances.js";
import {
  AmountTracker, addChainEqualityConstraints, addWorkPlaceAmountConstraints, haulChainCandidates, isChild, isDestinationConstraint,
  isUnplausible, massEconomyAreasPostOrder, MAX_MOVE_DISTANCE_INIT, PlanError, siteUnit, type Chain,
} from "./plan.js";
import { ActualsContext } from "./actuals.js";
import { lockActualsIn } from "./control.js";
import { isSuitablePath, maxDistance, transporterTable } from "./haulres.js";
import { HAUL_CALCULATION_ACTION, projectUndoText } from "./names.js";
import { Scheduler } from "./timing.js";
import { groupRateEntry, productionRate, RateTracker, SWGU_RECEIVE, SWGU_SEND, WachContainer, workSiteRate } from "./wach.js";

export const MAX_ALTERNATIVE_CHAINS_INIT = 10;

const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);
const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
const EPS = 8.881784197001252e-16;
/** Tools::AreEqual @0xa12ad0 */
export const areEqual = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * EPS;
/** Tools::IsLessThanOrEqual @0xa13770 */
export const isLessThanOrEqual = (a: number, b: number) => a < b || areEqual(a, b);

// ---------- contexto ----------

interface Ctx {
  p: Project;
  sched: Scheduler;
  at: AmountTracker;
  rt: RateTracker;
  dcm: DistanceCalculatorManager;
  maxDist: number;
  maxAlt: number;
  isRunning: () => boolean;
}

const siteOf = (p: Project, wp: Entity) => p.resolve(wp.get("m_pWorkSite") as Ref)!;
export function wpTimes(wp: Entity): { begin: number; end: number } {
  const bf = wp.fields.find((f) => f.id === 209 && f.value.kind === "bigint");
  const e = wp.get("m_endTime");
  return { begin: bf && bf.value.kind === "bigint" ? Number(bf.value.value) : 0, end: typeof e === "bigint" ? Number(e) : 0 };
}
const wpBegin = (wp: Entity) => wpTimes(wp).begin;
const wpEnd = (wp: Entity) => wpTimes(wp).end;
const firstWp = (p: Project, site: Entity) => p.get(refs(site.get("m_vpWorkPlaces"))[0]!)!;
const workPlaces = (p: Project, site: Entity) => refs(site.get("m_vpWorkPlaces")).map((o) => p.get(o)!).filter((e) => e.className === "MovableWorkPlace");

/** HasLocalStockPile: habilitada, recebe (britagem nunca), envia; dias extras. */
function lsp(site: Entity): { receiving: boolean; sending: boolean; extra: number } | undefined {
  if (site.get("m_bLocalStockPile") !== true) return undefined;
  return { receiving: site.className !== "CrushingPlant", sending: true, extra: num(site.get("m_nLocalStockPileExtraDays")) };
}

// ---------- preços (GetTotalPrice @0x9d9840, recursos @0x9b6680/@0x9b5d70/@0x92a290) ----------

export function pricePerHour(p: Project, g: Entity): number {
  if ((num(g.get("m_nPriceCalculation")) & 1) === 0) return 0;
  let s = 0;
  for (const [r, n] of (g.get("m_resources") as [unknown, unknown][] | undefined) ?? []) s += num(p.resolve(r as Ref)?.get("m_dHourPrice")) * num(n);
  return s;
}
export function pricePerUnit(g: Entity, t: Entity): number {
  return (num(g.get("m_nPriceCalculation")) & 2) === 0 ? 0 : groupRateEntry(g, t)[1];
}
/** GetUnitPriceFromResources: preço/h ÷ taxa + preço por unidade, na unidade do tipo. */
function resourcePrice(p: Project, ws: Entity, type: Entity, usage: number): number {
  const sel = (ws.get("m_cSelectedSubWorkGroups") as [unknown, unknown][] | undefined)?.find(([u]) => u === usage);
  const g = sel ? p.resolve(sel[1] as Ref) : undefined;
  if (!g) throw new PlanError("NOT_IMPLEMENTED", "no crew for usage");
  const r = workSiteRate(p, ws, usage, type).q;
  if (!(r > 0) || areEqual(0, r)) throw new PlanError("NOT_IMPLEMENTED", "positive production rate required here");
  return pricePerHour(p, g) / r + pricePerUnit(g, type);
}
export function sourceResourcePrice(p: Project, ws: Entity, slt: Entity): number {
  return resourcePrice(p, ws, slt, SWGU_SEND);
}
export function destinationResourcePrice(p: Project, ws: Entity): { price: number; type: Entity } {
  const dt = destLandType(p, ws);
  if (!dt) throw new PlanError("NOT_IMPLEMENTED", "destination type missing");
  return { price: resourcePrice(p, ws, dt, SWGU_RECEIVE), type: dt };
}
/** HaulInfo::GetTotalPrice @0x9d9840: transporte + recursos da origem + do destino, na unidade do material. */
export function totalPrice(p: Project, src: Entity, slt: Entity, dst: Entity, distance: number): number {
  const u = unitOfType(slt);
  const t = unitPrice(p, src, slt, dst, distance, true, u, true);
  const s = sourceResourcePrice(p, src, slt);
  const d = destinationResourcePrice(p, dst);
  return s + t + convertedPrice(slt, d.price, unitOfType(d.type), u);
}

// ---------- janelas (RN-013) ----------

interface Step {
  src: Entity;
  dst: Entity;
  slt: Entity;
  b: number;
  e: number;
  dist: number;
  srcLSP: boolean;
  dstLSP: boolean;
}

/** HaulChainCandidateStepWithDates @0x9fddf0; `cur.next` é compartilhado pela alternativa. */
function makeStep(ctx: Ctx, src: Entity, dst: Entity, slt: Entity, from: number, cur: { next: number }): Step {
  const { p, rt } = ctx;
  let b = Math.max(rt.firstAvailable(dst, false), wpBegin(dst));
  let e = Math.min(rt.lastAvailable(src, true), wpEnd(src));
  let srcLSP = false, dstLSP = false;
  const dWs = siteOf(p, dst), sWs = siteOf(p, src);
  const dl = lsp(dWs);
  if (dl?.receiving) {
    dstLSP = true;
    try {
      b = ctx.sched.calendarOf(dWs).addWorkDays(wpBegin(dst), -dl.extra, true);
    } catch {
      b = MIN_DATE;
    }
  }
  const sl = lsp(sWs);
  if (sl?.sending) {
    srcLSP = true;
    try {
      e = ctx.sched.calendarOf(sWs).addWorkDays(wpEnd(src), sl.extra, false);
    } catch {
      e = MAX_DATE;
    }
  }
  b = Math.max(b, wpBegin(src), rt.firstAvailable(src, true));
  e = Math.min(e, wpEnd(dst), rt.lastAvailable(dst, false));
  b = Math.max(b, from);
  const step: Step = { src, dst, slt, b, e, dist: DBL_MAX, srcLSP, dstLSP };
  if (!(b < e)) {
    cur.next = MAX_DATE;
    return step;
  }
  const first = ctx.dcm.calculatorsFor(b, e)[0]!;
  if (first.end < e) {
    cur.next = Math.min(cur.next, first.end);
    step.e = first.end;
  }
  const groupSel = (sWs.get("m_cSelectedSubWorkGroups") as [unknown, unknown][] | undefined)?.find(([u]) => u === SWGU_SEND);
  const g = groupSel ? p.resolve(groupSel[1] as Ref) : undefined;
  step.dist = first.calculator.distanceNoThrow(src.oid, dst.oid);
  // ASM 0x9fe2b0–0x9fe363 [O] (L-042): transportador da equipe de envio da tarefa de origem do passo; distância acima do
  // máximo da tabela ou caminho mínimo inadequado → DBL_MAX (a alternativa é descartada). [P] sem equipe = sem transportador.
  const T = g ? p.resolve(g.get("m_pHaulResource") as Ref) : undefined;
  if (T && step.dist < DBL_MAX && (step.dist > maxDistance(transporterTable(T)) || !isSuitablePath(p, T, first.calculator.path(src.oid, dst.oid).nodes))) step.dist = DBL_MAX;
  const max = num(slt.get("m_dMaxHaulDistance"));
  if (max > 0 && max < step.dist) step.dist = DBL_MAX;
  return step;
}

/** acoplamento da britagem (CR) */
function couple(i: Step, o: Step, crushLSP: boolean): void {
  if (crushLSP) {
    o.b = Math.max(o.b, i.b);
    i.e = Math.min(i.e, o.e);
  } else {
    i.b = Math.max(i.b, o.b);
    o.b = i.b;
    i.e = Math.min(i.e, o.e);
    o.e = i.e;
  }
}

/** anon::MakeHaulChainCandidateStepsWithDatesImpl @0x9febd0 */
function alternative(ctx: Ctx, c: Chain, wpS: Entity, wpD: Entity, cursor: { from: number }): Step[] {
  const { p } = ctx;
  const cur = { next: MAX_DATE };
  const slt = sourceLandType(p, c.source)!;
  const mk = (a: Entity, b: Entity, t: Entity) => makeStep(ctx, a, b, t, cursor.from, cur);
  let s: Step[];
  if (!c.crush) {
    if (!c.pile) s = [mk(wpS, wpD, slt)];
    else {
      const pw = firstWp(p, c.pile);
      s = [mk(wpS, pw, slt), mk(pw, wpD, slt)];
      s[1]!.b = Math.max(s[1]!.b, s[0]!.e);
      s[0]!.e = Math.min(s[0]!.e, s[1]!.e);
    }
  } else {
    const cw = firstWp(p, c.crush), refined = refinedTypeForMoveTo(p, c.crush, c.destination)!;
    const L = c.crush.get("m_bLocalStockPile") === true;
    if (!c.pile && !c.pile2) {
      s = [mk(wpS, cw, slt), mk(cw, wpD, refined)];
      couple(s[0]!, s[1]!, L);
    } else if (!c.pile2) {
      const pw = firstWp(p, c.pile!);
      s = [mk(wpS, pw, slt), mk(pw, cw, slt), mk(cw, wpD, refined)];
      s[1]!.b = Math.max(s[1]!.b, s[0]!.e);
      couple(s[1]!, s[2]!, L);
      s[0]!.e = Math.min(s[0]!.e, s[1]!.e);
    } else if (!c.pile) {
      const p2 = firstWp(p, c.pile2);
      s = [mk(wpS, cw, slt), mk(cw, p2, refined), mk(p2, wpD, refined)];
      s[1]!.e = Math.min(s[1]!.e, s[2]!.e);
      couple(s[0]!, s[1]!, L);
      s[2]!.b = Math.max(s[2]!.b, s[1]!.e);
    } else {
      const pw = firstWp(p, c.pile), p2 = firstWp(p, c.pile2);
      s = [mk(wpS, pw, slt), mk(pw, cw, slt), mk(cw, p2, refined), mk(p2, wpD, refined)];
      s[1]!.b = Math.max(s[1]!.b, s[0]!.e);
      s[2]!.e = Math.min(s[2]!.e, s[3]!.e);
      couple(s[1]!, s[2]!, L);
      s[0]!.e = Math.min(s[0]!.e, s[1]!.e);
      s[3]!.b = Math.max(s[3]!.b, s[2]!.e);
    }
  }
  const valid = (() => {
    for (const x of s) if (x.e <= x.b || areEqual(x.dist, DBL_MAX) || x.dist > ctx.maxDist) return false;
    for (const x of s) if (ctx.at.free(x.src, true).amount <= 0.01 || ctx.at.free(x.dst, false).amount <= 0.01) return false;
    let prev = MIN_DATE;
    for (const x of s) {
      const sb = x.srcLSP ? Math.max(prev, wpBegin(x.src)) : x.b;
      if (ctx.rt.isCompletelyUsedBetween(x.src, true, sb, x.e, 0.001)) return false;
      const de = x.dstLSP ? wpEnd(x.dst) : x.e;
      if (ctx.rt.isCompletelyUsedBetween(x.dst, false, x.b, de, 0.001)) return false;
      prev = x.b;
    }
    return true;
  })();
  cursor.from = cur.next;
  return valid ? s : [];
}

/** MakeHaulChainCandidateStepsWithDates @0x9fe900 */
function alternatives(ctx: Ctx, c: Chain): Step[][] {
  const out: Step[][] = [];
  for (const wpS of workPlaces(ctx.p, c.source))
    for (const wpD of workPlaces(ctx.p, c.destination)) {
      const cursor = { from: MIN_DATE };
      do {
        const a = alternative(ctx, c, wpS, wpD, cursor);
        if (a.length) out.push(a);
      } while (cursor.from !== MAX_DATE);
    }
  return out;
}

// ---------- colunas ----------

export interface Col {
  b: number;
  e: number;
  source: Entity;
  destination: Entity;
  slt: Entity;
  distance: number;
  prevStart: number;
  chain: number;
  step: number;
  col: number;
  srcLSP: boolean;
  dstLSP: boolean;
}

const srcBegin = (h: Col) => (h.srcLSP ? Math.max(h.prevStart, wpBegin(h.source)) : h.b);
const srcEnd = (h: Col) => Math.min(h.e, wpEnd(h.source));
const dstBegin = (h: Col) => Math.max(h.b, wpBegin(h.destination));
const dstEnd = (h: Col) => (h.dstLSP ? wpEnd(h.destination) : h.e);

/** operator< @0x9d2d10: (início, fim, cadeia, passo) */
const pairCmp = (a: Col, b: Col) => a.b - b.b || a.e - b.e || a.chain - b.chain || a.step - b.step;
const oidCmp = (a: Entity, b: Entity) => (a.oid < b.oid ? -1 : a.oid > b.oid ? 1 : 0);

/** MakeHaulInfosWithDates @0x9d9c70: V1 (plausíveis baratas), V2 (caras), V3 (implausíveis). */
function makeHaulInfosWithDates(ctx: Ctx, chains: Chain[]): [Col[], Col[], Col[]] {
  const { p } = ctx;
  const V1: Col[] = [], V2: Col[] = [], V3: Col[] = [];
  const cost = new Map<number, number>();
  let k = 0;
  for (const c of chains) {
    if (!ctx.isRunning()) break;
    const V = isUnplausible(c) ? V3 : V1;
    for (const a of alternatives(ctx, c)) {
      let acc = 0, f = 1, prevSLT = a[0]!.slt, prev = MIN_DATE;
      a.forEach((s, i) => {
        const h: Col = { b: s.b, e: s.e, source: s.src, destination: s.dst, slt: s.slt, distance: s.dist, prevStart: prev, chain: k, step: i, col: -1, srcLSP: s.srcLSP, dstLSP: s.dstLSP };
        V.push(h);
        if (s.slt.oid !== prevSLT.oid) {
          const before = V[V.length - 2]!;
          const uMid = unitOfType(destLandType(p, siteOf(p, before.destination))!);
          f = convertAmount(s.slt, 1, uMid, unitOfType(s.slt)) * convertAmount(prevSLT, 1, unitOfType(prevSLT), uMid) * f;
          prevSLT = s.slt;
        }
        acc = totalPrice(p, siteOf(p, s.src), s.slt, siteOf(p, s.dst), s.dist) / f + acc;
        prev = s.b;
      });
      cost.set(k++, acc);
    }
  }
  extractExpensiveSpans(V1, V2, cost, ctx.maxAlt);
  for (const V of [V1, V2, V3]) splitOverlappingSpans(ctx, V);
  return [V1, V2, V3];
}

/**
 * U-61h: `GetAverageUnitPriceAndDistance@0x9d8fd0` no Schedule (grade "Suitable hauls" do 13017). [O] com o 6.º argumento
 * verdadeiro chama `MakeHaulInfosWithDates(cadeia, …, DBL_MAX, INT_MAX, …)` (no Plan, `MakeHaulInfos`): só entram as
 * alternativas datadas (pares de work places com janela no tempo). [O DynaRoad em execução, ES] média simples, entre as
 * alternativas, da soma das distâncias dos passos e da soma dos preços totais dos passos (com recursos), cada um
 * convertido para `unit` pelo material do passo; sem alternativa → "?". [I] rastreadores novos (sem os transportes).
 */
export function chainAverageWithDates(p: Project, ch: Chain, unit: bigint | null): { price: number | null; distance: number | null; alternatives: number } {
  const sched = new Scheduler(p);
  const at = new AmountTracker(p);
  const rt = new RateTracker(p, (ws) => sched.calendarOf(ws), wpTimes, (ws, src) => siteUnit(p, ws, src));
  const ctx: Ctx = { p, sched, at, rt, dcm: new DistanceCalculatorManager(p), maxDist: DBL_MAX, maxAlt: 0x7fffffff, isRunning: () => true };
  let n = 0, sumD = 0, sumP = 0;
  for (const a of alternatives(ctx, ch)) {
    let price = 0, d = 0;
    // [O ES RockCut → Crushing → Base: 12,42/ccm = 5,49/bcm ÷ 1,6 + 8,93/ccm] cada passo no preço do seu material,
    // convertido para a unidade da grade pelo próprio material, e somado
    for (const s of a) {
      price += convertedPrice(s.slt, totalPrice(p, siteOf(p, s.src), s.slt, siteOf(p, s.dst), s.dist), unitOfType(s.slt), unit);
      d += s.dist;
    }
    n++;
    sumD += d;
    sumP += price;
  }
  return n ? { price: sumP / n, distance: sumD / n, alternatives: n } : { price: null, distance: null, alternatives: 0 };
}

/** soma +1 em [b, e) num mapa de contagens por intervalo */
class Counts {
  private pts: { t: number; d: number }[] = [];
  add(b: number, e: number, d: number): void {
    if (b < e) this.pts.push({ t: b, d }, { t: e, d: -d });
  }
  /** mínimo da contagem em [b, e) (GetMin sobre a interseção [I]) */
  min(b: number, e: number): number {
    const ts = [...new Set([b, ...this.pts.map((x) => x.t).filter((t) => t > b && t < e)])].sort((x, y) => x - y);
    let m = Infinity;
    for (const t of ts) m = Math.min(m, this.pts.filter((x) => x.t <= t).reduce((s, x) => s + x.d, 0));
    return m === Infinity ? 0 : m;
  }
}

/**
 * [O defeito] `anon::MwpMwpInfo::TryToExtractChain@0x9db0e0` + `std::_Remove_if<ChainMatcher>@0x9d5b80` (ASM): o
 * `remove_if` compacta para a frente as colunas de outras cadeias e não toca no fim; `V2.insert(end, newEnd, v.end())`
 * leva as últimas k colunas ORIGINAIS do vetor (k = colunas da cadeia) e `erase` as tira de v. Resultado: colunas da
 * cadeia fora do fim somem; colunas de outras cadeias no fim ficam nos dois vetores. O correto seria mover as da cadeia.
 */
export function tryToExtractChain<T extends { chain: number }>(v: readonly T[], chain: number): { kept: T[]; extracted: T[] } {
  const kept = v.filter((h) => h.chain !== chain); // [begin, newEnd)
  return { kept, extracted: v.slice(kept.length) }; // [newEnd, end): o fim intocado
}

/** ExtractExpensiveSpans @0x9d8d90 + MwpMwpInfo (@0x9da1e0, @0x9d8c00, @0x9db0e0). */
function extractExpensiveSpans(V1: Col[], V2: Col[], cost: Map<number, number>, maxAlt: number): void {
  const maxStep = new Map<number, Col>(), first = new Map<number, Col>();
  for (const h of V1) {
    if (h.step === 0) first.set(h.chain, h);
    const m = maxStep.get(h.chain);
    if (!m || h.step > m.step) maxStep.set(h.chain, h);
  }
  const infos = new Map<string, { src: Entity; dst: Entity; spans: Col[]; srcC: Counts; dstC: Counts }>();
  for (const h of V1) {
    const src = first.get(h.chain)!.source, dst = maxStep.get(h.chain)!.destination;
    const key = `${src.oid}|${dst.oid}`;
    let info = infos.get(key);
    if (!info) infos.set(key, (info = { src, dst, spans: [], srcC: new Counts(), dstC: new Counts() }));
    info.spans.push(h);
    if (h.source.oid === src.oid) info.srcC.add(srcBegin(h), srcEnd(h), 1);
    if (h.destination.oid === dst.oid) info.dstC.add(dstBegin(h), dstEnd(h), 1);
  }
  V1.length = 0;
  const keys = [...infos.keys()].sort();
  for (const key of keys) {
    const info = infos.get(key)!;
    const chains = [...new Set(info.spans.map((h) => h.chain))].sort((a, b) => a - b);
    if (maxAlt >= 0 && maxAlt < chains.length) {
      const byCost = [...chains].sort((a, b) => cost.get(a)! - cost.get(b)! || a - b);
      let n = chains.length - maxAlt;
      for (let i = byCost.length - 1; i >= 0 && n > 0; i--, n--) {
        const k = byCost[i]!;
        const mine = info.spans.filter((h) => h.chain === k);
        const s = mine.filter((h) => h.source.oid === info.src.oid), d = mine.filter((h) => h.destination.oid === info.dst.oid);
        if (s.length > 1 || d.length > 1) throw new PlanError("NOT_IMPLEMENTED", "Split haul unexpected.");
        if (!s.length) throw new PlanError("NOT_IMPLEMENTED", "Haul source not found.");
        if (!d.length) throw new PlanError("NOT_IMPLEMENTED", "Haul destination not found.");
        const [sb, se, db, de] = [srcBegin(s[0]!), srcEnd(s[0]!), dstBegin(d[0]!), dstEnd(d[0]!)];
        if (info.srcC.min(sb, se) >= 2 && info.dstC.min(db, de) >= 2) {
          info.srcC.add(sb, se, -1);
          info.dstC.add(db, de, -1);
          const r = tryToExtractChain(info.spans, k);
          V2.push(...r.extracted);
          info.spans = r.kept;
        }
      }
    }
    V1.push(...info.spans);
  }
}

/** SplitOverlappingSpans @0x9da480 */
function splitOverlappingSpans(ctx: Ctx, V: Col[]): void {
  const noCap = (h: Col) =>
    ctx.rt.isCompletelyUsedBetween(h.source, true, srcBegin(h), srcEnd(h), 0.001) || ctx.rt.isCompletelyUsedBetween(h.destination, false, dstBegin(h), dstEnd(h), 0.001);
  const prune = () => {
    const keep = V.filter((h) => !noCap(h));
    V.length = 0;
    V.push(...keep);
  };
  while (ctx.isRunning()) {
    if (byRole(V, true)) prune();
    if (!byRole(V, false)) break;
    prune();
  }
  V.sort(pairCmp);
  V.forEach((h, i) => (h.col = i));
}

function byRole(V: Col[], bySource: boolean): boolean {
  const W = (h: Col) => (bySource ? h.source : h.destination);
  const win = (h: Col): [number, number] => (bySource ? [srcBegin(h), srcEnd(h)] : [dstBegin(h), dstEnd(h)]);
  const sorted = V.map((h, i) => ({ h, i })).sort((a, b) => oidCmp(W(a.h), W(b.h)) || a.i - b.i).map((x) => x.h);
  V.length = 0;
  V.push(...sorted);
  const n = V.length;
  let changed = false;
  for (let i = 0; i < n; ) {
    const w = W(V[i]!), wb = wpBegin(w), we = wpEnd(w);
    const cuts = new Set<number>();
    let j = i;
    for (; j < n && W(V[j]!).oid === w.oid; j++) {
      const [rb, re] = win(V[j]!);
      if (wb < rb && rb < we) cuts.add(rb);
      if (wb < re && re < we) cuts.add(re);
    }
    const sortedCuts = [...cuts].sort((a, b) => a - b);
    for (let q = i; q < j; q++) {
      const h = V[q]!;
      const [rb, re] = win(h);
      for (const c of sortedCuts)
        if (rb < c && c < re && h.b < c && c < h.e) {
          V.push({ ...h, e: c });
          h.b = c;
          changed = true;
        }
    }
    i = j;
  }
  return changed;
}

// ---------- modelo (RN-012) ----------

/** HaulInfoWithDateSrcCmp @0xa0a650 */
function srcCmp(a: Col, b: Col): number {
  if (a.source.oid !== b.source.oid) return oidCmp(a.source, b.source);
  const aE = srcEnd(a), bE = srcEnd(b), aB = srcBegin(a), bB = srcBegin(b);
  if (aE === bE && aB === bB) return pairCmp(a, b);
  if (aE !== bE) return aE - bE;
  return bB - aB;
}
/** HaulInfoWithDateDstCmp @0xa0a560 */
function dstCmp(a: Col, b: Col): number {
  if (a.destination.oid !== b.destination.oid) return oidCmp(a.destination, b.destination);
  const aB = dstBegin(a), bB = dstBegin(b), aE = dstEnd(a), bE = dstEnd(b);
  if (aB === bB && aE === bE) return pairCmp(b, a);
  if (aB !== bB) return bB - aB;
  return bE - aE;
}

const capacityPile = (p: Project, wp: Entity) => {
  const ws = siteOf(p, wp);
  return isDestinationConstraint(ws) && (massType(ws, "destination") & MASS_TYPE.SIMULTANEOUSLY) === 0 && num(wp.get("m_dDestinationAmount")) > 0;
};
const capUnit = (p: Project, wp: Entity) => siteUnit(p, siteOf(p, wp), false);

/** AddInitialBounds @0xa0b4a0 */
function addInitialBounds(ctx: Ctx, b: LomBuild, cols: Col[]): void {
  const { p, at, rt } = ctx;
  for (const h of cols) {
    const u = unitOfType(h.slt);
    const fs = at.free(h.source, true), fd = at.free(h.destination, false);
    let U = b.columnUppers[h.col]!;
    U = Math.min(U, convertAmount(h.slt, fs.amount, fs.unit, u));
    U = Math.min(U, convertAmount(h.slt, fd.amount, fd.unit, u));
    U = Math.min(U, rt.freeAmountBetween(h.source, true, srcBegin(h), srcEnd(h), h.slt, u));
    U = Math.min(U, rt.freeAmountBetween(h.destination, false, dstBegin(h), dstEnd(h), h.slt, u));
    for (const P of [h.source, h.destination]) if (capacityPile(p, P)) U = Math.min(U, convertAmount(h.slt, num(P.get("m_dDestinationAmount")), capUnit(p, P), u));
    b.columnUppers[h.col] = U;
  }
}

/** Add{Source,Destination}WorkAchievementConstraints @0xa0b760/@0xa0b200 */
function addWorkAchievement(ctx: Ctx, b: LomBuild, cols: Col[], source: boolean): void {
  const { p, rt } = ctx;
  const v = [...cols].sort(source ? srcCmp : dstCmp);
  const W = (h: Col) => (source ? h.source : h.destination);
  const win = (h: Col): [number, number] => (source ? [srcBegin(h), srcEnd(h)] : [dstBegin(h), dstEnd(h)]);
  const isLSP = (h: Col) => (source ? h.srcLSP : h.dstLSP);
  let it = 0;
  while (it < v.length) {
    const S = W(v[it]!), ws = siteOf(p, S);
    const isCrush = source && v[it]!.srcLSP && ws.className === "CrushingPlant";
    let row = new ModelRow();
    const crush = new ModelRow();
    let lastK = 0;
    while (it < v.length && W(v[it]!).oid === S.oid) {
      const [sb, se] = win(v[it]!);
      const H = rt.freeHoursBetween(S, source, sb, se);
      if (!isLSP(v[it]!)) {
        row.addTo(b);
        row = new ModelRow();
      } else {
        let done = false;
        if (isCrush) {
          let k = crush.indices.findIndex((col) => sb < srcEnd(cols[col]!));
          if (k < 0) k = crush.indices.length;
          if (k !== lastK) {
            lastK = k;
            row.addTo(b);
            const upper = row.upper;
            row = new ModelRow();
            row.upper = upper;
            row.indices = crush.indices.slice(k);
            row.coeffs = crush.coeffs.slice(k);
            done = true;
          }
        }
        if (!done && !isLessThanOrEqual(H, row.upper)) row.sparsifyAndAddTo(b);
      }
      row.upper = H;
      while (it < v.length && W(v[it]!).oid === S.oid && win(v[it]!)[0] === sb && win(v[it]!)[1] === se) {
        const h = v[it]!;
        const a = 1 / productionRate(p, ws, source, unitOfType(h.slt), h.slt);
        row.addEntry(h.col, a);
        if (isCrush) crush.addEntry(h.col, a);
        it++;
      }
    }
    row.addTo(b);
  }
}

/** AddCapacityConstraints @0xa0a730 (RN-016) */
function addCapacityConstraints(ctx: Ctx, b: LomBuild, cols: Col[]): void {
  const { p, rt } = ctx;
  const inMap = new Map<bigint, number[]>(), outMap = new Map<bigint, number[]>();
  for (const h of cols) {
    if (capacityPile(p, h.destination)) inMap.set(h.destination.oid, [...(inMap.get(h.destination.oid) ?? []), h.col]);
    if (capacityPile(p, h.source)) outMap.set(h.source.oid, [...(outMap.get(h.source.oid) ?? []), h.col]);
  }
  for (const [P, ins] of inMap) {
    const pw = p.get(P)!, f = cols[ins[0]!]!;
    let cursor = f.b;
    const slt = f.slt, cap = num(pw.get("m_dDestinationAmount")), cu = capUnit(p, pw);
    let doneIn = rt.doneBetween(pw, false, wpBegin(pw), cursor, slt, cu);
    let doneOut = rt.doneBetween(pw, true, wpBegin(pw), cursor, slt, cu);
    const outs = outMap.get(P) ?? [];
    let oi = 0, ii = 0;
    const row = new ModelRow();
    while (ii < ins.length) {
      const bb = cols[ins[ii]!]!.b, ee = cols[ins[ii]!]!.e;
      doneIn += rt.doneBetween(pw, false, cursor, ee, slt, cu);
      doneOut += rt.doneBetween(pw, true, cursor, bb, slt, cu);
      const tmp = cap - (doneIn - doneOut);
      const rhs = tmp < cap ? tmp : cap;
      const willAddOuts = oi < outs.length && !(bb < cols[outs[oi]!]!.e);
      if (willAddOuts || !isLessThanOrEqual(rhs, row.upper)) row.sparsifyAndAddTo(b);
      row.upper = rhs <= 0 ? 0 : rhs;
      while (ii < ins.length && cols[ins[ii]!]!.b === bb && cols[ins[ii]!]!.e === ee) {
        const g = cols[ins[ii]!]!;
        row.addEntry(g.col, convertAmount(g.slt, 1, unitOfType(g.slt), cu));
        ii++;
      }
      while (oi < outs.length && !(bb < cols[outs[oi]!]!.e)) {
        const o = cols[outs[oi]!]!;
        row.addEntry(o.col, -convertAmount(o.slt, 1, unitOfType(o.slt), cu));
        oi++;
      }
      cursor = ee;
    }
    row.addTo(b);
  }
}

/** BuildModel @0xa0bbb0 + SetObjective @0xa0d850 */
function buildModel(ctx: Ctx, cols: Col[]): { build: LomBuild; cost: number[] } {
  const { p } = ctx;
  const b = new LomBuild(cols.length);
  addInitialBounds(ctx, b, cols);
  addWorkPlaceAmountConstraints(p, b, ctx.at, cols);
  addChainEqualityConstraints(p, cols, b);
  addWorkAchievement(ctx, b, cols, true);
  addWorkAchievement(ctx, b, cols, false);
  addCapacityConstraints(ctx, b, cols);
  const fill = p.root()!.get("m_pFillUnit") as bigint | null;
  const cost = Array<number>(b.numCols).fill(0);
  let M = 0;
  for (const h of cols) {
    const u = unitOfType(h.slt);
    const c = totalPrice(p, siteOf(p, h.source), h.slt, siteOf(p, h.destination), h.distance);
    cost[h.col] = c;
    M = Math.max(M, convertedPrice(h.slt, c, u, fill));
  }
  const P = 5 * M + 1;
  for (let k = b.superHaulBeginCol; k < b.superHaulEndCol; k++) {
    const fromDst = b.superHaulsFromSource.get(k);
    const h = cols[fromDst ?? b.superHaulsToDestination.get(k)!]!;
    let price: number, u: bigint | null;
    if (fromDst !== undefined) {
      const d = destinationResourcePrice(p, siteOf(p, h.destination));
      u = unitOfType(d.type);
      price = d.price;
    } else {
      u = unitOfType(h.slt);
      price = sourceResourcePrice(p, siteOf(p, h.source), h.slt);
    }
    cost[k] = convertedPrice(h.slt, price, u, u) + convertedPrice(h.slt, P, fill, u);
  }
  return { build: b, cost };
}

// ---------- da solução aos SchedMove ----------

export interface SchedHaul {
  source: Entity;
  destination: Entity;
  slt: Entity;
  path: LightPath;
  srcLSP: boolean;
  dstLSP: boolean;
  /** perfis na unidade de origem da tarefa de origem (massa/h) */
  srcWach: WachContainer;
  dstWach: WachContainer;
}

/** MakeWachContainer @0xa0d010 */
function makeWach(ctx: Ctx, x: number, b: number, e: number, wp: Entity, source: boolean, slt: Entity, unit: bigint | null): WachContainer {
  const { p, at, rt } = ctx;
  const fa = at.free(wp, source);
  fa.amount -= convertAmount(slt, x, unitOfType(slt), fa.unit);
  if (fa.amount < -0.1) {
    const un = fa.unit !== null ? String(p.get(fa.unit)?.get("m_strName") ?? "") : "";
    throw new PlanError("TASK_QUANTITY_EXCEEDED", `Task quantity exceeded, needed ${-fa.amount} ${un} more for ${source ? "sending" : "receiving"}.`);
  }
  const w = rt.freeWachBetween(wp, source, b, e, slt, unit);
  const surplus = w.total() - convertAmount(slt, x, unitOfType(slt), unit);
  if (surplus < -0.1) {
    const un = unit !== null ? String(p.get(unit)?.get("m_strName") ?? "") : "";
    throw new PlanError("TASK_QUANTITY_EXCEEDED", `Production rate exceeded, needed ${-surplus} ${un} more for ${source ? "sending" : "receiving"}.`);
  }
  if (surplus > 0) w.remove(surplus);
  rt.subtractWach(wp, source, slt, w);
  return w;
}

/** MakeUniqueHauls @0xa0c310 (MakeUniqueHaul @0xa0c120) */
function makeUniqueHauls(ctx: Ctx, cols: Col[], x: number[]): SchedHaul[] {
  const { p } = ctx;
  if (!x.length) return [];
  const map = new Map<string, SchedHaul>();
  const keyOf = (h: Col) => {
    if (h.e <= h.b) throw new PlanError("NOT_IMPLEMENTED", "Expected positive haul duration.");
    const calcs = ctx.dcm.calculatorsFor(h.b, h.e);
    if (calcs.length !== 1) throw new PlanError("NOT_IMPLEMENTED", "Haul would need more than one distance calculator.");
    const path = calcs[0]!.calculator.path(h.source.oid, h.destination.oid);
    const k = [h.source.oid, h.srcLSP, h.destination.oid, h.dstLSP, h.slt.oid, path.nodes.map((n) => `${n.workPlace ?? ""}:${n.roadConnection ?? ""}:${n.from ?? ""}`).join(",")].join("|");
    return { k, path };
  };
  for (const h of [...cols].sort(srcCmp)) {
    const xv = x[h.col]!;
    if (!(xv > 0)) continue;
    const { k, path } = keyOf(h);
    const u = siteUnit(p, siteOf(p, h.source), true);
    let e = map.get(k);
    if (!e) map.set(k, (e = { source: h.source, destination: h.destination, slt: h.slt, path, srcLSP: h.srcLSP, dstLSP: h.dstLSP, srcWach: new WachContainer(u), dstWach: new WachContainer(u) }));
    e.srcWach.addSpans(makeWach(ctx, xv, srcBegin(h), srcEnd(h), h.source, true, h.slt, u));
  }
  for (const h of [...cols].sort(dstCmp)) {
    const xv = x[h.col]!;
    if (!(xv > 0)) continue;
    const { k } = keyOf(h);
    const u = siteUnit(p, siteOf(p, h.source), true);
    map.get(k)!.dstWach.addSpans(makeWach(ctx, xv, dstBegin(h), dstEnd(h), h.destination, false, h.slt, u));
  }
  return [...map.values()]
    .filter((e) => !(e.srcWach.total() < 0.1 || e.dstWach.total() < 0.1))
    .sort((a, b) => oidCmp(a.source, b.source) || Number(a.srcLSP) - Number(b.srcLSP) || oidCmp(a.destination, b.destination) || Number(a.dstLSP) - Number(b.dstLSP) || oidCmp(a.slt, b.slt));
}

// ---------- RN-012: o laço ----------

export interface ScheduleOptions {
  maxMoveDistance?: number;
  maxAlternativeChains?: number;
  /** U-52: "Lock actual quantities" do 13031 (`MoveManager::SetActualsLockedInLP`), gravado no mesmo nível [O] */
  lockActualQuantities?: boolean;
  isRunning?: () => boolean;
  /** diagnóstico: colunas e solução de cada passe */
  onPass?: (info: { zone: bigint; pass: number; cols: Col[]; x: number[] }) => void;
}
export interface SchedulePassResult {
  zone: bigint;
  pass: number;
  columns: number;
  objective: number;
}
export interface ScheduleResult {
  canceled: boolean;
  passes: SchedulePassResult[];
  moves: SchedHaul[];
  removed: number;
}

/** KernelWachVector → WachContainer (ManageState: f204 unidade, f206/207/208 inícios, fins, densidades) */
export function readWach(e: Entity): WachContainer {
  const w = new WachContainer(e.get("m_data") as bigint | null);
  const get = (id: number) => {
    const f = e.fields.find((x) => x.id === id);
    return f && f.value.kind === "container" ? f.value.items : [];
  };
  const bs = get(206), es = get(207), qs = get(208);
  const val = (v: FieldValue | undefined) => (v && (v.kind === "bigint" ? Number(v.value) : v.kind === "float" ? v.value : v.kind === "int" ? Number(v.value) : 0));
  for (let i = 0; i < bs.length; i++) w.pushRaw({ b: val(bs[i])!, e: val(es[i])!, q: val(qs[i])! }); // ManageState: sem Merge [O]
  return w;
}

/**
 * ScheduleLom::Solve @0xa0da90 (RF-027) num nível de undo "Haul calculation" (a transação do 13031, U-52) [O]:
 * `SetActualsLockedInLP` (opção), `RemoveAllSchedMoves(false, true)` no início (sai todo SchedMove não manual, também
 * os realizados, travado ou não), `LockActuals` se travado (recria os realizados), otimização e exportação.
 */
export async function scheduleOptimize(p: Project, opts: ScheduleOptions = {}): Promise<ScheduleResult> {
  const isRunning = opts.isRunning ?? (() => true);
  const mm = p.resolve(p.root()!.get("m_pMoveManager") as Ref)!;
  // U-61f (AL-MOT-70): nível "<projeto>: haul calculation" (MakeUndoText da transação do 13031) [O]
  return inOneLevel(p, projectUndoText(p, HAUL_CALCULATION_ACTION), async (step) => {
    let removed = 0;
    step(() => {
      if (opts.lockActualQuantities !== undefined && (mm.get("m_bActualsLockedInLP") === true) !== opts.lockActualQuantities) mm.set("m_bActualsLockedInLP", opts.lockActualQuantities);
      for (const m of refs(mm.get("m_vpSchedMoves")).map((o) => p.get(o)!))
        if (m.get("m_bManual") !== true) {
          removeSchedMove(p, mm, m);
          removed++;
        }
      if (mm.get("m_bActualsLockedInLP") === true) lockActualsIn(p); // L-048 (analise_realizados_l045_l048.md §5.2) [O]
    });
    const locked = mm.get("m_bActualsLockedInLP") === true;
    const sched = new Scheduler(p);
    const at = new AmountTracker(p);
    const rt = new RateTracker(p, (ws) => sched.calendarOf(ws), wpTimes, (ws, src) => siteUnit(p, ws, src));
    const ctx: Ctx = { p, sched, at, rt, dcm: new DistanceCalculatorManager(p), maxDist: opts.maxMoveDistance ?? MAX_MOVE_DISTANCE_INIT, maxAlt: opts.maxAlternativeChains ?? MAX_ALTERNATIVE_CHAINS_INIT, isRunning };
    const kept = refs(mm.get("m_vpSchedMoves")).map((o) => p.get(o)!).filter((m) => m.get("m_bManual") === true);
    for (const m of kept) {
      if (m.get("m_bActual") === true) continue;
      at.subtractMove(m);
      const slt = p.resolve(m.get("m_pSourceLandType") as Ref)!;
      for (const [k, src, wk] of [["m_pSrcWorkPlace", true, "m_pSourceWachVector"], ["m_pDstWorkPlace", false, "m_pDestinationWachVector"]] as const) {
        const wp = p.resolve(m.get(k) as Ref), kv = p.resolve(m.get(wk) as Ref);
        if (wp && kv) rt.subtractWach(wp, src, slt, readWach(kv));
      }
    }
    if (locked) {
      const ac = new ActualsContext(p, (ws) => sched.calendarOf(ws));
      at.subtractActuals(ac);
      rt.subtractActuals(ac);
    }
    at.removeNegatives();
    rt.removeNegatives();
    let chains = haulChainCandidates(p, { piles: true, excludeFinished: locked });
    const passes: SchedulePassResult[] = [];
    const moves: SchedHaul[] = [];
    let canceled = false;
    for (const zone of massEconomyAreasPostOrder(p)) {
      if (!isRunning()) break;
      const inZone = (e?: Entity) => !e || isChild(p, e, zone);
      const mine = chains.filter((c) => inZone(c.source) && inZone(c.destination) && inZone(c.crush) && inZone(c.pile) && inZone(c.pile2));
      chains = chains.filter((c) => !mine.includes(c));
      let n = 3;
      for (let k = 0; isRunning() && k < n; k++) {
        const V = makeHaulInfosWithDates(ctx, mine);
        if (V[2].length === 0 && n === 3) n = 2;
        if (V[1].length === 0 && n === 2) n = 1;
        const cols = V[k]!;
        if (!cols.length) continue;
        const { build, cost } = buildModel(ctx, cols);
        if (!isRunning()) break;
        const out = await solveLp({ colCost: cost, colLower: build.columnLowers, colUpper: build.columnUppers, rows: build.rows }, isRunning);
        if (out.status === "canceled") break;
        passes.push({ zone: zone.oid, pass: k + 1, columns: cols.length, objective: out.objective });
        const x = out.x.slice(0, cols.length);
        opts.onPass?.({ zone: zone.oid, pass: k + 1, cols, x });
        moves.push(...makeUniqueHauls(ctx, cols, x));
        if (at.removeNegatives() || rt.removeNegatives()) throw new PlanError("NEGATIVE_AMOUNT", "Task quantity exceeded.");
      }
    }
    if (!isRunning()) canceled = true;
    // cancelado: `RemoveAllSchedMoves(false, false)` não acha mais nada (o início já apagou) e nada novo entra [O]
    if (!canceled) step(() => { for (const u of moves) addSchedMove(p, mm, u); });
    return { canceled, passes, moves: canceled ? [] : moves, removed };
  });
}

/**
 * Um nível de undo para um cálculo assíncrono (U-52, a transação do diálogo 13031 [O]): cada `step` grava nele; erro
 * desfaz tudo. Dentro de uma transação já aberta (diálogo do chamador), grava nela e não fecha.
 */
export async function inOneLevel<T>(p: Project, name: string, fn: (step: (f: () => void) => void) => Promise<T>): Promise<T> {
  if (p.inTransaction) return fn((f) => p.transact(() => p.edit(name, f)));
  p.beginLevel(name);
  try {
    const r = await fn((f) => p.transact(f));
    p.commitLevel(name);
    return r;
  } catch (e) {
    p.abortLevel();
    throw e;
  }
}

const setList = (e: Entity, member: string, items: bigint[]) => e.setRaw(member, encodeContainer(0x18, items));

/** MoveManager::RemoveSchedMove: o SchedMove, o caminho (com os nós) e os dois KernelWachVector. */
export function removeSchedMove(p: Project, mm: Entity, m: Entity): void {
  setList(mm, "m_vpSchedMoves", refs(mm.get("m_vpSchedMoves")).filter((o) => o !== m.oid));
  const path = p.resolve(m.get("m_pPath") as Ref);
  if (path) {
    for (const o of refs(path.get("m_vpNodes"))) {
      const n = p.get(o);
      if (n) p.remove(n);
    }
    p.remove(path);
  }
  for (const k of ["m_pSourceWachVector", "m_pDestinationWachVector"]) {
    const w = p.resolve(m.get(k) as Ref);
    if (w) p.remove(w);
  }
  p.remove(m);
}

/** KernelWachVector com os campos do formato 80006 (ManageState @0x965690): 204 unidade, 206/207 inícios e fins
 * (int64), 208 densidades. Os três últimos dividem o nome de membro m_data, então os campos entram crus. */
export function addWachVector(p: Project, w: WachContainer): bigint {
  const str = (id: number): Field => ({ id, type: 15, value: { kind: "bytes", type: 15, value: new Uint8Array([0]) } as unknown as FieldValue });
  const ref = (id: number, v: bigint | null): Field => ({ id, type: 24, value: { kind: "bigint", type: 24, value: v ?? 0n } as unknown as FieldValue });
  const list = (id: number, t: number, xs: number[]): Field => ({
    id,
    type: 20,
    value: { kind: "container", type: 20, elemType: t, items: xs.map((v) => (t === 13 ? { kind: "float", type: 13, value: v, raw: new Uint8Array(0) } : { kind: "bigint", type: t, value: BigInt(v) })) } as unknown as FieldValue,
  });
  const e = p.create("KernelWachVector", [str(100), str(101), ref(104, null), ref(204, w.unit), list(206, 11, w.spans.map((x) => x.b)), list(207, 11, w.spans.map((x) => x.e)), list(208, 13, w.spans.map((x) => x.q))]);
  return e.oid;
}

/** MoveManager::AddSchedMove @0x94e140 + SchedMove::SchedMove @0x95f580 + Export @0xa0bd30 */
export function addSchedMove(p: Project, mm: Entity, u: SchedHaul, manual = false, actual = false): void {
  const unit = unitOfType(u.slt);
  const sw = u.srcWach.converted(unit, u.slt), dw = u.dstWach.converted(unit, u.slt);
  const m = p.create("SchedMove");
  m.set("m_strName", "");
  m.set("m_strLongName", "");
  m.set("m_pUIInfo", null);
  m.set("m_pSrcWorkPlace", u.source.oid);
  m.set("m_pDstWorkPlace", u.destination.oid);
  m.set("m_pSourceLandType", u.slt.oid);
  const path = p.create("Path");
  m.set("m_pPath", path.oid);
  m.set("m_bManual", manual);
  m.set("m_bActual", actual);
  m.set("m_dAmount", sw.total());
  path.set("m_strName", "");
  path.set("m_strLongName", "");
  path.set("m_pUIInfo", null);
  path.setRaw("m_vpPlaces_OLD", encodeContainer(0x18, []));
  path.set("m_dLength", u.path.length);
  const nodes = u.path.nodes.map((n) => {
    const e = p.create("Node");
    e.set("m_strName", "");
    e.set("m_strLongName", "");
    e.set("m_pUIInfo", null);
    e.set("m_pRoadConnection", n.roadConnection ?? null);
    e.set("m_bRoadConnectionFrom", n.from ?? false);
    e.set("m_pWorkPlace", n.workPlace ?? null);
    return e.oid;
  });
  setList(path, "m_vpNodes", nodes);
  m.set("m_pSourceWachVector", addWachVector(p, sw));
  m.set("m_pDestinationWachVector", addWachVector(p, dw));
  setList(mm, "m_vpSchedMoves", [...refs(mm.get("m_vpSchedMoves")), m.oid]);
}

