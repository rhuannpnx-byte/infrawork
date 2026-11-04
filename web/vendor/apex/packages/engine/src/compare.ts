/**
 * Comparação resultado recalculado × resultado salvo num `.dr5` (U-12, D-007, critérios da D-005). Os resultados
 * salvos pelo original são o oráculo: datas dos work places estritos (CA-RN-004/005), `LPMove` (CA-RN-010) e
 * `SchedMove` (CA-RN-012). Extraído dos validadores `validacao/U-07b`, `U-08` e `U-09` do projeto.
 */
import type { Entity, Project } from "@apex/model";
import { convertAmount, dstUnit, haulPrice, srcUnit } from "./costs.js";
import { DistanceCalculatorManager } from "./distances.js";
import { planOptimize } from "./plan.js";
import { readWach, scheduleOptimize, totalPrice, wpTimes } from "./schedule.js";
import { STRICT_CLASSES, Scheduler } from "./timing.js";
import { productionRate, WachContainer } from "./wach.js";

const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const siteOf = (p: Project, wp: bigint) => p.get(p.get(wp)!.get("m_pWorkSite") as bigint)!;
const mm = (p: Project) => p.get(p.root()!.get("m_pMoveManager") as bigint)!;
const moves = (p: Project, list: "m_vpLPMoves" | "m_vpSchedMoves") => refs(mm(p).get(list)).map((o) => p.get(o)!);
/**
 * Chaves para comparar o resultado salvo num projeto com o recalculado em outro (U-24: projeto remontado a partir dos
 * dados da obra, com outros OIDs). No mesmo projeto, as chaves são os próprios OIDs (`OID_KEYS`).
 */
export interface CompareKeys {
  wp(p: Project, oid: bigint): string;
  type(p: Project, oid: bigint): string;
}
export const OID_KEYS: CompareKeys = { wp: (_p, o) => String(o), type: (_p, o) => String(o) };
const moveKey = (p: Project, m: Entity, k: CompareKeys = OID_KEYS) => `${k.wp(p, m.get("m_pSrcWorkPlace") as bigint)}>${k.wp(p, m.get("m_pDstWorkPlace") as bigint)}:${k.type(p, m.get("m_pSourceLandType") as bigint)}`;

export interface PairDiff {
  key: string;
  saved?: number | undefined;
  recalculated?: number | undefined;
}

export interface TimingComparison {
  kind: "timing";
  workPlaces: number;
  equal: number;
  diffs: { wp: bigint; saved: [number, number]; recalculated: [number, number] }[];
  ok: boolean;
}

export interface MoveComparison {
  kind: "plan" | "schedule";
  saved: number;
  recalculated: number;
  savedCost: number;
  recalculatedCost: number;
  relativeCostDiff: number;
  violations: string[];
  pairs: PairDiff[];
  equalPairs: number;
  /** D-005: mesmo custo (1e-6 relativo) e restrições satisfeitas; Plan: mesma massa obrigatória não movida; Schedule: mesmas quantidades */
  ok: boolean;
  canceled: boolean;
}

/** CA-RN-004/005: cronograma com nivelamento × datas salvas dos work places das tarefas estritas. */
export function compareTiming(p: Project): TimingComparison {
  return compareTimingWith(p, p, OID_KEYS);
}

/**
 * U-24: recalcula o cronograma de `rebuilt` e compara as datas de cada work place estrito com as salvas no work place
 * de mesma chave em `saved` (mesmo critério de `compareTiming`: datas iguais em segundos, D-005).
 */
export function compareTimingWith(saved: Project, rebuilt: Project, keys: CompareKeys): TimingComparison {
  const r = new Scheduler(rebuilt).calculate(true);
  const savedWp = new Map<string, Entity>();
  for (const st of saved.entities()) {
    if (!STRICT_CLASSES.has(st.className)) continue;
    for (const w of refs(st.get("m_vpWorkPlaces"))) savedWp.set(keys.wp(saved, w), saved.get(w)!);
  }
  const diffs: TimingComparison["diffs"] = [];
  let n = 0;
  for (const st of rebuilt.entities()) {
    if (!STRICT_CLASSES.has(st.className)) continue;
    for (const w of refs(st.get("m_vpWorkPlaces"))) {
      n++;
      const c = r.workPlaces.get(w), sw = savedWp.get(keys.wp(rebuilt, w));
      const t = sw ? wpTimes(sw) : { begin: NaN, end: NaN };
      if (!c || c.begin !== t.begin || c.end !== t.end) diffs.push({ wp: w, saved: [t.begin, t.end], recalculated: [c?.begin ?? NaN, c?.end ?? NaN] });
    }
  }
  return { kind: "timing", workPlaces: n, equal: n - diffs.length, diffs, ok: diffs.length === 0 && n === savedWp.size };
}

const SRC = new Set(["LandCut", "BorrowPit", "MassExchange"]), DST = new Set(["Embankment", "WasteLand", "MassExchange"]);
const mustSrc = (w: Entity) => w.className === "LandCut" || w.className === "MassExchange" || (w.className === "BorrowPit" && w.get("m_bMustUse") === true);
const mustDst = (w: Entity) => w.className === "Embankment" || w.className === "MassExchange" || (w.className === "WasteLand" && w.get("m_bMustFill") === true);

function planCost(p: Project, ms: Entity[]): number {
  const dc = new DistanceCalculatorManager(p).plan();
  return ms.reduce((c, m) => {
    const slt = p.get(m.get("m_pSourceLandType") as bigint)!, s = m.get("m_pSrcWorkPlace") as bigint, d = m.get("m_pDstWorkPlace") as bigint;
    return c + num(m.get("m_dAmount")) * haulPrice(p, siteOf(p, s), slt, siteOf(p, d), dc.distance(s, d), slt.get("m_pUnit") as bigint | null);
  }, 0);
}

/** origem não manda mais que tem, destino não recebe mais, britagem conserva massa; massa obrigatória não movida */
function planCheck(p: Project, ms: Entity[], keys: CompareKeys = OID_KEYS): { bad: string[]; unmet: Map<string, number> } {
  const out = new Map<bigint, number>(), inn = new Map<bigint, number>(), bad: string[] = [];
  for (const m of ms) {
    const slt = p.get(m.get("m_pSourceLandType") as bigint)!, s = m.get("m_pSrcWorkPlace") as bigint, d = m.get("m_pDstWorkPlace") as bigint;
    const a = num(m.get("m_dAmount")), u = slt.get("m_pUnit") as bigint | null;
    out.set(s, (out.get(s) ?? 0) + convertAmount(slt, a, u, srcUnit(p, siteOf(p, s))));
    inn.set(d, (inn.get(d) ?? 0) + convertAmount(slt, a, u, dstUnit(p, siteOf(p, d))));
  }
  const unmet = new Map<string, number>();
  for (const wp of p.byClass("MovableWorkPlace")) {
    const w = siteOf(p, wp.oid), o = out.get(wp.oid) ?? 0, i = inn.get(wp.oid) ?? 0;
    if (SRC.has(w.className)) {
      const free = num(wp.get("m_dSourceAmount"));
      if (o > free + 1e-6) bad.push(`origem ${wp.oid} ${o} > ${free}`);
      if (mustSrc(w)) unmet.set(`s${keys.wp(p, wp.oid)}`, free - o);
    }
    if (DST.has(w.className)) {
      const free = num(wp.get("m_dDestinationAmount"));
      if (i > free + 1e-6) bad.push(`destino ${wp.oid} ${i} > ${free}`);
      if (mustDst(w)) unmet.set(`d${keys.wp(p, wp.oid)}`, free - i);
    }
    if (w.className === "CrushingPlant" && Math.abs(i - o) > 1e-6 * Math.max(1, i)) bad.push(`britagem ${wp.oid} ${i} ≠ ${o}`);
  }
  return { bad, unmet };
}

function scheduleCost(p: Project, ms: Entity[]): number {
  const dc = new DistanceCalculatorManager(p).plan();
  return ms.reduce((c, m) => {
    const slt = p.get(m.get("m_pSourceLandType") as bigint)!, s = m.get("m_pSrcWorkPlace") as bigint, d = m.get("m_pDstWorkPlace") as bigint;
    return c + num(m.get("m_dAmount")) * totalPrice(p, siteOf(p, s), slt, siteOf(p, d), dc.distance(s, d));
  }, 0);
}

/** perfis dentro do período do work place; horas de equipe ≤ 1 por hora; estoque das pilhas com capacidade > 0 */
function scheduleCheck(p: Project, ms: Entity[]): string[] {
  const bad: string[] = [], load = new Map<string, WachContainer>(), piles = new Map<bigint, WachContainer>();
  for (const m of ms) {
    const slt = p.get(m.get("m_pSourceLandType") as bigint)!;
    for (const [wk, vk, src] of [["m_pSrcWorkPlace", "m_pSourceWachVector", true], ["m_pDstWorkPlace", "m_pDestinationWachVector", false]] as const) {
      const wp = p.get(m.get(wk) as bigint)!, w = readWach(p.get(m.get(vk) as bigint)!), t = wpTimes(wp);
      for (const s of w.spans) if (s.q > 1e-9 && (s.b < t.begin || s.e > t.end)) bad.push(`fora do período ${moveKey(p, m)}`);
      const r = productionRate(p, siteOf(p, wp.oid), src, w.unit, slt);
      const k = `${wp.oid}:${src}`;
      if (!load.has(k)) load.set(k, new WachContainer(null));
      for (const s of w.spans) load.get(k)!.addSpan({ b: s.b, e: s.e, q: s.q / r });
      if (siteOf(p, wp.oid).className === "StockPile" && num(wp.get("m_dDestinationAmount")) > 0) {
        if (!piles.has(wp.oid)) piles.set(wp.oid, new WachContainer(null));
        for (const s of w.spans) piles.get(wp.oid)!.addSpan({ b: s.b, e: s.e, q: src ? -s.q : s.q });
      }
    }
  }
  for (const [k, w] of load) for (const s of w.spans) if (s.q > 1 + 1e-6) bad.push(`horas de equipe ${k}`);
  for (const [o, w] of piles) {
    const cap = num(p.get(o)!.get("m_dDestinationAmount"));
    let st = 0;
    for (const s of w.spans) {
      st += (s.q * (s.e - s.b)) / 3600;
      if (st > cap + 1e-6 || st < -1e-6) bad.push(`pilha ${o}`);
    }
  }
  return bad;
}

function pairs(saved: Entity[], now: Entity[], ps: Project, pn: Project, keys: CompareKeys): { list: PairDiff[]; equal: number } {
  const S = new Map<string, number>(), N = new Map<string, number>();
  for (const m of saved) S.set(moveKey(ps, m, keys), (S.get(moveKey(ps, m, keys)) ?? 0) + num(m.get("m_dAmount")));
  for (const m of now) N.set(moveKey(pn, m, keys), (N.get(moveKey(pn, m, keys)) ?? 0) + num(m.get("m_dAmount")));
  const list: PairDiff[] = [];
  let equal = 0;
  for (const k of new Set([...S.keys(), ...N.keys()])) {
    const a = S.get(k), b = N.get(k);
    if (a !== undefined && b !== undefined && Math.abs(a - b) < 1e-6) equal++;
    else list.push({ key: k, saved: a, recalculated: b });
  }
  return { list, equal };
}

export interface CompareOptions {
  isRunning?: () => boolean;
}

/** CA-RN-010: recalcula o Plan e compara com os LPMoves salvos. Deixa o projeto recalculado (undo devolve). */
export function comparePlan(p: Project, opts: CompareOptions = {}): Promise<MoveComparison> {
  return comparePlanWith(p, p, OID_KEYS, opts);
}

/**
 * U-24: otimiza o Plan em `rebuilt` e compara com os LPMoves salvos em `saved` (mesmos critérios de `comparePlan`:
 * custo igual com tolerância relativa 1e-6, restrições satisfeitas, mesma massa obrigatória não movida por chave).
 */
export async function comparePlanWith(saved: Project, rebuilt: Project, keys: CompareKeys, opts: CompareOptions = {}): Promise<MoveComparison> {
  const old = moves(saved, "m_vpLPMoves");
  const c0 = planCost(saved, old), k0 = planCheck(saved, old, keys);
  const r = await planOptimize(rebuilt, opts.isRunning ? { isRunning: opts.isRunning } : {});
  const now = moves(rebuilt, "m_vpLPMoves");
  const c1 = planCost(rebuilt, now), k1 = planCheck(rebuilt, now, keys);
  const rel = Math.abs(c1 - c0) / Math.max(1, c0);
  const unmetSame = [...k0.unmet].every(([k, v]) => Math.abs(v - (k1.unmet.get(k) ?? 0)) < 1e-6);
  const pr = pairs(old, now, saved, rebuilt, keys);
  const violations = [...k0.bad.map((b) => `salvo: ${b}`), ...k1.bad.map((b) => `recalculado: ${b}`)];
  return { kind: "plan", saved: old.length, recalculated: now.length, savedCost: c0, recalculatedCost: c1, relativeCostDiff: rel, violations, pairs: pr.list, equalPairs: pr.equal, ok: !r.canceled && rel < 1e-6 && unmetSame && violations.length === 0, canceled: r.canceled };
}

/** CA-RN-012: recalcula o Schedule e compara com os SchedMoves salvos. Deixa o projeto recalculado (undo devolve). */
export function compareSchedule(p: Project, opts: CompareOptions = {}): Promise<MoveComparison> {
  return compareScheduleWith(p, p, OID_KEYS, opts);
}

/** U-24: otimiza o Schedule em `rebuilt` e compara com os SchedMoves salvos em `saved` (critérios de `compareSchedule`). */
export async function compareScheduleWith(saved: Project, rebuilt: Project, keys: CompareKeys, opts: CompareOptions = {}): Promise<MoveComparison> {
  const old = moves(saved, "m_vpSchedMoves");
  const c0 = scheduleCost(saved, old), b0 = scheduleCheck(saved, old);
  const r = await scheduleOptimize(rebuilt, opts.isRunning ? { isRunning: opts.isRunning } : {});
  const now = moves(rebuilt, "m_vpSchedMoves");
  const c1 = scheduleCost(rebuilt, now), b1 = scheduleCheck(rebuilt, now);
  const rel = Math.abs(c1 - c0) / Math.max(1, c0);
  const pr = pairs(old, now, saved, rebuilt, keys);
  const violations = [...b0.map((b) => `salvo: ${b}`), ...b1.map((b) => `recalculado: ${b}`)];
  return { kind: "schedule", saved: old.length, recalculated: now.length, savedCost: c0, recalculatedCost: c1, relativeCostDiff: rel, violations, pairs: pr.list, equalPairs: pr.equal, ok: !r.canceled && rel < 1e-6 && pr.list.length === 0 && violations.length === 0, canceled: r.canceled };
}

export const hasSavedMoves = (p: Project, kind: "plan" | "schedule") => moves(p, kind === "plan" ? "m_vpLPMoves" : "m_vpSchedMoves").length > 0;
