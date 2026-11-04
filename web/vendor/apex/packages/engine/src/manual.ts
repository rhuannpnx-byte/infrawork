/**
 * Transporte manual (RF-028, RN-020). Evidência: analises/2026-10-11_dynaroad/evidencias/visoes/lacunas_fechadas.md §1 e
 * evidencias/decompilado/u10/: MoveManager::CreateManualMove @0x94e5b0, ManualMoveHelpers::GenerateKernelLPMoves
 * @0x9f9540, GenerateKernelMoves @0x9f9a40, anon::CreateMove @0x9f8fc0, MovableWorkPlaceHelpers::GetUnmoved*
 * @0x961490/@0x961560, WachContainerHelpers::GetMin @0x962b90.
 *
 * - [O] modo do projeto (m_nMode) 0 = PLAN → LPMoves manuais; senão SchedMoves manuais com perfil.
 * - [O] origem precisa de quantidade de origem e destino de quantidade de destino ("manual moves to or from
 *   intermedate work sites are not supported", grafia do original); mesma tarefa → "can not create move inside the
 *   same work site"; q ≤ 0 → AMOUNT_LESS_THAN_OR_EQUAL_ZERO; no Schedule, fim ≤ início → BEGIN_TIME_GREATER_THAN_END_TIME.
 * - [O] work places na ordem do kernel, invertidos se a tarefa não é "low"; no Schedule os travados como realizados
 *   ficam de fora. Tools::DoubleToInt trunca [I]: restos abaixo de 1 unidade encerram o laço.
 * - [I] "movido" de um work place = Σ dos LPMoves (Plan) ou SchedMoves (Schedule) que saem/chegam nele, convertido pelo
 *   material de cada transporte (Get{Src,Dst}AmountBy{LP,Sched}Moves não foram lidos).
 * - [O] Schedule: perfil = mínimo, ponto a ponto, das capacidades livres de origem e destino na janela (RateTracker novo
 *   com todos os SchedMoves descontados), escalado até min(pedido, não movido na origem, não movido no destino); o mesmo
 *   perfil vai para os dois lados.
 */
import type { Entity, Project, Ref } from "@apex/model";
import { convertAmount, isDestination, isSource, sourceLandType, unitOfType } from "./costs.js";
import { DistanceCalculator } from "./distances.js";
import { addLPMove, isDestinationAmount, isSourceAmount, siteUnit } from "./plan.js";
import { addSchedMove, isLessThanOrEqual, readWach, wpTimes } from "./schedule.js";
import { Scheduler } from "./timing.js";
import { RateTracker, WachContainer } from "./wach.js";

export class ManualMoveError extends Error {
  constructor(readonly code: "INTERMEDIATE_SITE" | "SAME_SITE" | "AMOUNT_LESS_THAN_OR_EQUAL_ZERO" | "BEGIN_TIME_GREATER_THAN_END_TIME", message: string) {
    super(message);
    this.name = "ManualMoveError";
  }
}

const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);
const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
const trunc = (x: number) => Math.trunc(x);

export interface ManualMoveRequest {
  source: Entity; // tarefa
  destination: Entity;
  amount: number;
  /** unidade da quantidade pedida (padrão: unidade de destino no Plan, do material no Schedule) */
  unit?: bigint | null;
  begin?: number;
  end?: number;
}

function workPlacesOf(p: Project, site: Entity): Entity[] {
  const wps = refs(site.get("m_vpWorkPlaces")).map((o) => p.get(o)!).filter((e) => e.className === "MovableWorkPlace");
  return site.get("m_bLow") === false ? wps.reverse() : wps;
}

/** quantidade movida num work place pelos transportes do modo (0 = LPMoves, 1 = SchedMoves) [I] */
function moved(p: Project, wp: Entity, source: boolean, mode: number, unit: bigint | null): number {
  const mm = p.resolve(p.root()!.get("m_pMoveManager") as Ref)!;
  const list = refs(mm.get(mode === 0 ? "m_vpLPMoves" : "m_vpSchedMoves")).map((o) => p.get(o)!);
  let s = 0;
  for (const m of list)
    if (m.get(source ? "m_pSrcWorkPlace" : "m_pDstWorkPlace") === wp.oid) {
      const slt = p.resolve(m.get("m_pSourceLandType") as Ref)!;
      s += convertAmount(slt, num(m.get("m_dAmount")), unitOfType(slt), unit);
    }
  return s;
}

/** MovableWorkPlaceHelpers::GetUnmovedSourceAmount @0x961560 / GetUnmovedAmount(…, false) @0x961490 */
export function unmoved(p: Project, wp: Entity, source: boolean, mode: number, unit?: bigint | null): number {
  const site = p.resolve(wp.get("m_pWorkSite") as Ref)!;
  const u = unit === undefined ? siteUnit(p, site, source) : unit;
  if (mode === 2 && site.get("m_bFinished") === true) return 0;
  if (source ? !isSourceAmount(site) : !isDestinationAmount(site)) return 0;
  const total = num(wp.get(source ? "m_dSourceAmount" : "m_dDestinationAmount"));
  const slt = sourceLandType(p, site);
  const amount = slt ? convertAmount(slt, total, siteUnit(p, site, source), u) : total;
  const mv = moved(p, wp, source, mode, u);
  return mv < amount ? amount - mv : 0;
}

function validate(p: Project, r: ManualMoveRequest): void {
  if (!isSource(r.source) || !isSourceAmount(r.source) || !isDestination(r.destination) || !isDestinationAmount(r.destination))
    throw new ManualMoveError("INTERMEDIATE_SITE", "manual moves to or from intermedate work sites are not supported");
  if (r.source.oid === r.destination.oid) throw new ManualMoveError("SAME_SITE", "can not create move inside the same work site");
}

/** WachContainerHelpers::GetMin @0x962b90: mínimo das densidades onde os perfis se sobrepõem. */
function wachMin(a: WachContainer, b: WachContainer): WachContainer {
  const out = new WachContainer(a.unit);
  for (const x of a.spans)
    for (const y of b.spans) {
      const s = Math.max(x.b, y.b), e = Math.min(x.e, y.e);
      if (s < e) out.addSpan({ b: s, e, q: Math.min(x.q, y.q) });
    }
  return out;
}

/** MoveManager::CreateManualMove @0x94e5b0 (comando "Create hauls"); devolve os OIDs criados. */
export function createManualMove(p: Project, r: ManualMoveRequest): bigint[] {
  validate(p, r);
  const mode = num(p.root()!.get("m_nMode"));
  if (mode !== 0) {
    if (r.begin === undefined || r.end === undefined || r.end <= r.begin) throw new ManualMoveError("BEGIN_TIME_GREATER_THAN_END_TIME", "BEGIN_TIME_GREATER_THAN_END_TIME");
  }
  if (isLessThanOrEqual(r.amount, 0)) throw new ManualMoveError("AMOUNT_LESS_THAN_OR_EQUAL_ZERO", "AMOUNT_LESS_THAN_OR_EQUAL_ZERO");
  const mm = p.resolve(p.root()!.get("m_pMoveManager") as Ref)!;
  const before = new Set([...refs(mm.get("m_vpLPMoves")), ...refs(mm.get("m_vpSchedMoves"))]);
  p.edit("Create hauls", () => (mode === 0 ? generateLPMoves(p, mm, r) : generateMoves(p, mm, r)));
  return [...refs(mm.get("m_vpLPMoves")), ...refs(mm.get("m_vpSchedMoves"))].filter((o) => !before.has(o));
}

/** GenerateKernelLPMoves @0x9f9540 */
function generateLPMoves(p: Project, mm: Entity, r: ManualMoveRequest): void {
  const slt = sourceLandType(p, r.source)!;
  const dc = new DistanceCalculator(p, {}); // [I] UpdateGraph(…, false): grafo completo, como no Plan
  const unit = siteUnit(p, r.destination, false);
  let remaining = convertAmount(slt, r.amount, r.unit === undefined ? unit : r.unit, unit);
  const srcs = workPlacesOf(p, r.source), dsts = workPlacesOf(p, r.destination);
  let i = 0, j = 0;
  while (i < srcs.length && j < dsts.length && trunc(remaining) !== 0) {
    const s = srcs[i]!, d = dsts[j]!;
    const su = unmoved(p, s, true, 0, unit);
    if (trunc(su) === 0) {
      i++;
      continue;
    }
    const du = unmoved(p, d, false, 0);
    if (trunc(du) === 0) {
      j++;
      continue;
    }
    const q = Math.min(remaining, Math.min(du, su));
    if (trunc(q) > 0) {
      const path = dc.path(s.oid, d.oid);
      // q está na unidade de destino; addLPMove recebe na unidade de origem da tarefa de origem
      addLPMove(p, mm, { source: s, destination: d, slt, path, amount: convertAmount(slt, q, unit, siteUnit(p, r.source, true)) }, true);
      remaining -= q;
    } else break; // [I] evita laço infinito (o original não tem saída explícita aqui)
  }
}

/** GenerateKernelMoves @0x9f9a40 + anon::CreateMove @0x9f8fc0 */
function generateMoves(p: Project, mm: Entity, r: ManualMoveRequest): void {
  const sched = new Scheduler(p);
  const dc = new DistanceCalculator(p, {});
  const slt = sourceLandType(p, r.source)!;
  const U = unitOfType(slt);
  const reqUnit = r.unit === undefined ? U : r.unit;
  let remaining = r.amount;
  const live = (w: Entity) => w.get("m_bLockedAsActual") !== true;
  const srcs = workPlacesOf(p, r.source).filter(live), dsts = workPlacesOf(p, r.destination).filter(live);
  const begin = r.begin!, end = r.end!;
  let i = 0, j = 0;
  while (i < srcs.length && j < dsts.length && trunc(remaining) !== 0) {
    const s = srcs[i]!, d = dsts[j]!;
    const ts = wpTimes(s), td = wpTimes(d);
    if (ts.end < begin) {
      i++;
      continue;
    }
    if (td.end < begin) {
      j++;
      continue;
    }
    const mb = Math.max(begin, Math.max(ts.begin, td.begin));
    let me: number;
    if (ts.end <= td.end) {
      me = ts.end;
      i++;
    } else {
      me = td.end;
      j++;
    }
    me = Math.min(me, end);
    remaining -= createMove(p, mm, sched, dc, s, d, mb, me, remaining, reqUnit, slt, U);
  }
}

function createMove(p: Project, mm: Entity, sched: Scheduler, dc: DistanceCalculator, s: Entity, d: Entity, b: number, e: number, req: number, reqUnit: bigint | null, slt: Entity, U: bigint | null): number {
  if (isLessThanOrEqual(req, 0) || !(b < e)) return 0;
  const reqU = convertAmount(slt, req, reqUnit, U);
  const su = unmoved(p, s, true, 1, U);
  const dSite = p.resolve(d.get("m_pWorkSite") as Ref)!;
  const du = convertAmount(slt, unmoved(p, d, false, 1), siteUnit(p, dSite, false), U);
  const rt = new RateTracker(p, (ws) => sched.calendarOf(ws), wpTimes, (ws, src) => siteUnit(p, ws, src));
  for (const o of refs(mm.get("m_vpSchedMoves"))) {
    const m = p.get(o)!;
    const mslt = p.resolve(m.get("m_pSourceLandType") as Ref)!;
    for (const [k, src, wk] of [["m_pSrcWorkPlace", true, "m_pSourceWachVector"], ["m_pDstWorkPlace", false, "m_pDestinationWachVector"]] as const) {
      const wp = p.resolve(m.get(k) as Ref), kv = p.resolve(m.get(wk) as Ref);
      if (wp && kv) rt.subtractWach(wp, src, mslt, readWach(kv));
    }
  }
  rt.removeNegatives();
  const target = Math.min(Math.min(du, su), reqU);
  const w = wachMin(rt.freeWachBetween(s, true, b, e, slt, U), rt.freeWachBetween(d, false, b, e, slt, U));
  const excess = w.total() - target;
  if (excess > 0) w.remove(excess);
  if (w.total() > 0) {
    const path = dc.path(s.oid, d.oid);
    addSchedMove(p, mm, { source: s, destination: d, slt, path, srcLSP: false, dstLSP: false, srcWach: w, dstWach: w.clone() }, true);
  }
  return convertAmount(slt, w.total(), U, reqUnit);
}
