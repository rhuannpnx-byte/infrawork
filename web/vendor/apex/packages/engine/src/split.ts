/**
 * Dividir e combinar tarefas (RF-032, RN-021). Evidência: analises/2026-10-11_dynaroad/evidencias/decompilado/{u10,
 * u10b}/: ScheduleManager::SplitWorkSiteByStation @0x97fb10, SplitWorkSiteByAmounts @0x97f450, CombineWorkSites
 * @0x97d270, anon::SplitAmount @0x97ef70, AutoName @0x97be60, MakeWSName @0x97dfc0, MakeCategory @0x97dde0,
 * GenerateMassMap @0x97da90, Merge @0x97e600, Place::Place @0x97aed0, GenerateLighWorkPlacesFromMassMap @0x97d6b0,
 * WorkSite::ReplaceWorkPlaces @0x9418e0, Project::Add* @0x90adc0…0x90cf70 e as cópias LandCut(const&) etc.,
 * DependencyManager::CloneDependencies @0x9a3630, Location::SetStations @0x9bb1d0, StationSpanHelpers::IsIntersecting.
 *
 * Decisões e inferências:
 * - [O] cópia da tarefa: nome, comentário, UIInfo/UILayOut/WorkSiteLook (cópias), calendário, equipes, prioridade, datas
 *   forçadas, ASAP, low, coeficiente, tipos e pilha local são copiados; recursos identificados vazios, preços unitários
 *   0, m_bDerivePredecessorsFromTypes = true; britagem com pilha local ligada e 0 dia; work places copiados com
 *   localização nova; dependências: só as do usuário (CloneDependencies). Entra no fim da lista do tipo no contêiner do
 *   projeto e no da sum task [I: fim].
 * - [I] tarefas que aceitam vários work places fazem antes WorkSite::SplitWorkPlace (não lido): aqui o work place
 *   atravessado é cortado pela regra do laço principal (r = (s − b)/(e − b), COG no meio de cada parte) nos dois casos,
 *   e os transportes dele são apagados como em SetSource/DestinationAmount (L-043).
 * - [O, U-54] realizados: dividir por estaca lança 14759 se o corte cai dentro de um realizado
 *   (`GetImplementationDegree` baixo/alto × `GetPortionAtStation`); os `ImplInfo` do sentido alto vão inteiros para a
 *   tarefa nova (`SplitImplementationsByStation@0x97efe0`); `OtherActual` é dividido (`NotifyWorkSiteSplit@0x95b910`,
 *   `OtherActual::Split@0x956fd0`). Combinar passa os realizados das absorvidas para a que fica
 *   (`CopyImplementations` [I detalhes, P-2]). Depois, `RecreateUtilizations` das tarefas [I]. Dividir por quantidades
 *   não mexe nos realizados (o original não chama nada de `ImplManager` ali) [I].
 * - Depois de cada operação: dependências automáticas refeitas e cronograma recalculado, no mesmo nível de undo.
 */
import type { Entity, Project, Ref } from "@apex/model";
import { encodeContainer } from "@apex/model";
import { ActualsContext, actualsOf, implementedAmount, implManager } from "./actuals.js";
import { recreateUtilizations } from "./implmanager.js";
import { namePred } from "./names.js";
import { applyAutoDependencies, workSitesInOrder } from "./autodeps.js";
import { destLandType, isDestination, isSource, sourceLandType } from "./costs.js";
import { isDestinationAmount, isDestinationConstraint, isSourceAmount } from "./plan.js";
import { addWachVector, areEqual, isLessThanOrEqual, readWach } from "./schedule.js";
import { Scheduler, setToEndOfDay } from "./timing.js";
import type { WachContainer } from "./wach.js";

export class SplitError extends Error {
  constructor(readonly code: "INVALID_SCHED_MOVE_DATES" | "WORK_SITE_CAN_NOT_BE_SPLIT_WHERE_THERE_IS_AN_IMPLEMENTATION" | "AMOUNT_OUT_OF_RANGE" | "CANT_COMBINE_TASKS_WITH_DIFFERENT_TYPES" | "CANT_COMBINE_TASKS_ON_DIFFERENT_LOCATIONS" | "NO_WORK_PLACES" | "NOT_IMPLEMENTED" | "EXPECTED_ONE_LOCATION", message: string) {
    super(message);
    this.name = "SplitError";
  }
}

const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);
const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
const setList = (e: Entity, member: string, items: bigint[]) => e.setRaw(member, encodeContainer(0x18, items));
const MULTI = new Set(["LandCut", "Embankment", "MassExchange", "OtherWorkSite"]);
const LIST: Record<string, string> = {
  LandCut: "m_vpLandCuts", Embankment: "m_vpEmbankments", MassExchange: "m_vpMassExchanges", BorrowPit: "m_vpBorrowPits",
  WasteLand: "m_vpWasteLands", StockPile: "m_vpStockPiles", CrushingPlant: "m_vpCrushingPlants", OtherWorkSite: "m_vpOtherWorkSites",
};

const wps = (p: Project, ws: Entity) => refs(ws.get("m_vpWorkPlaces")).map((o) => p.get(o)!);
const loc = (p: Project, wp: Entity) => p.resolve(wp.get("m_pLocation") as Ref)!;
const stB = (p: Project, wp: Entity) => num(loc(p, wp).get("m_dStationBegin"));
const stE = (p: Project, wp: Entity) => num(loc(p, wp).get("m_dStationEnd"));

/** cópia rasa de uma entidade (todos os campos), para subobjetos próprios */
function cloneEntity(p: Project, e: Entity): Entity {
  return p.create(e.classId, e.fields.map((f) => ({ ...f })));
}

// ---------- realizados na divisão e na combinação (U-54) ----------

const MOVABLE = new Set(["LandCut", "Embankment", "MassExchange", "BorrowPit", "WasteLand", "StockPile", "CrushingPlant"]);
const pairList = (v: unknown) => (Array.isArray(v) ? (v as [unknown, unknown][]) : []).map(([k, x]) => [k as bigint, x as bigint] as [bigint, bigint]);
const refMapValue = (entries: [bigint, bigint][]) =>
  (entries.length
    ? { kind: "map", type: 0x15, keyType: 0x18, valueType: 0x18, entries: entries.map(([k, v]) => [{ kind: "bigint", type: 0x18, value: k }, { kind: "bigint", type: 0x18, value: v }]) }
    : { kind: "map", type: 0x15, keyType: null, valueType: null, entries: [] }) as never;

/** `WorkSiteHelpers::GetPortionAtStation(ws, lado, x)` [I: inverso de GetStationAtPortion; massa do membro em ordem de estaca]. */
export function portionAtStation(p: Project, ws: Entity, member: string, x: number): number {
  const list = wps(p, ws).slice().sort((a, b) => stB(p, a) - stB(p, b));
  const M = list.reduce((t, w) => t + num(w.get(member)), 0);
  const weight = (w: Entity) => (M > 0 ? num(w.get(member)) : stE(p, w) - stB(p, w));
  const T = M > 0 ? M : list.reduce((t, w) => t + weight(w), 0);
  if (!(T > 0)) return 0;
  let cum = 0;
  for (const w of list) {
    const b = stB(p, w), e = stE(p, w);
    if (x <= b) break;
    cum += x >= e || e <= b ? weight(w) : (weight(w) * (x - b)) / (e - b);
    if (x < e) break;
  }
  return Math.min(1, Math.max(0, cum / T));
}

/** grau de realização por sentido (`ImplManagerHelpers::GetImplementationDegree@0x987350`) */
function degree(p: Project, ws: Entity, source: boolean, low: boolean, high: boolean): number {
  const A = wps(p, ws).reduce((t, w) => t + num(w.get(source ? "m_dSourceAmount" : "m_dDestinationAmount")), 0);
  const q = implementedAmount(p, ws, source, low, high);
  if (A > 0) return q / A;
  return q > 0 ? 1 : 0;
}

/** `SplitWorkSiteByStation@0x97fb10`: o corte não pode cair dentro de um realizado (14759) [O]. */
function guardSplitAtStation(p: Project, ws: Entity, x: number): void {
  if (!MOVABLE.has(ws.className)) return;
  for (const source of [true, false]) {
    if (source ? !isSource(ws) : !isDestination(ws)) continue;
    const pr = portionAtStation(p, ws, source ? "m_dSourceAmount" : "m_dDestinationAmount", x);
    const gLow = degree(p, ws, source, true, false), gHigh = degree(p, ws, source, false, true);
    if (pr < gLow || 1 - gHigh < pr) throw new SplitError("WORK_SITE_CAN_NOT_BE_SPLIT_WHERE_THERE_IS_AN_IMPLEMENTATION", "The task cannot be split at the location where there is an actual."); // 14759
  }
}

/** `anon::SplitImplementationsByStation@0x97efe0` [O]: ImplInfo alto → tarefa nova, inteiro; utilizações remapeadas pelo índice. */
function splitImplementationsByStation(p: Project, ws: Entity, clone: Entity): void {
  const copy = wps(p, clone);
  const map = new Map<bigint, bigint>(wps(p, ws).map((w, i) => [w.oid, copy[i]!.oid]));
  const im = implManager(p);
  const list = pairList(im.get("m_mpImplInfos"));
  let changed = false;
  for (const info of actualsOf(p, ws)) {
    if (info.get("m_bLow") === true) continue;
    const k = info.get("m_bSource") !== false ? "m_pSrcWorkPlace" : "m_pDstWorkPlace";
    for (const o of refs(info.get("m_vpUtilizations"))) {
      const u = p.get(o);
      const to = u ? map.get(u.get(k) as bigint) : undefined;
      if (u && to !== undefined) u.set(k, to);
    }
    info.set("m_pWorkSite", clone.oid);
    for (const e of list) if (e[1] === info.oid) e[0] = clone.oid;
    changed = true;
  }
  if (changed) im.setRaw("m_mpImplInfos", refMapValue(list));
}

/** `anon::GetDateAtPortion(r, b, e, cal)@0x956970` [O; I no ramo sem horas de trabalho]. */
function dateAtPortion(r: number, b: number, e: number, cal: { AS2WS(t: number): number; WS2AS(t: number, s: boolean): number }): number {
  const dws = cal.AS2WS(e) - cal.AS2WS(b);
  return dws <= 0 ? b + Math.trunc(r * (e - b)) : cal.WS2AS(cal.AS2WS(b) + Math.trunc(r * dws), false);
}

/** `ImplManager::NotifyWorkSiteSplit(ws, nova, x)@0x95b910` + `OtherActual::Split(a, r)@0x956fd0` [O]. */
function notifyWorkSiteSplit(p: Project, ws: Entity, clone: Entity, x: number): void {
  const ac = new ActualsContext(p);
  const cal = new Scheduler(p).calendarOf(ws);
  const plan: [Entity, number][] = [];
  for (const a of actualsOf(p, ws)) {
    const [p0, p1] = ac.portionSpan(a);
    const len = p1 - p0, inside = Math.min(x, p1) - Math.min(x, p0);
    if (0 < len && inside < len && !areEqual(0, len) && !areEqual(inside, len)) plan.push([a, inside / len]);
  }
  if (!plan.length) return;
  const im = implManager(p);
  const list = pairList(im.get("m_otherActuals"));
  for (const [a, r] of plan) {
    const b = Number(a.get("m_dateBegin") ?? 0), e = Number(a.get("m_dateEnd") ?? 0), q = num(a.get("m_dAmount")), low = a.get("m_bLow") === true;
    if (r === 0) {
      // inteiro para a nova [O]
      a.set("m_pWorkSite", clone.oid);
      for (const x2 of list) if (x2[1] === a.oid) x2[0] = clone.oid;
      continue;
    }
    const dR = dateAtPortion(r, b, e, cal), d1R = dateAtPortion(1 - r, b, e, cal);
    const n = p.create(a.classId, a.fields.map((f) => ({ ...f })));
    n.set("m_pWorkSite", clone.oid);
    n.set("m_dateBegin", BigInt(low ? dR : b));
    n.set("m_dateEnd", BigInt(low ? e : d1R));
    n.set("m_dAmount", q * (1 - r));
    a.set("m_dAmount", q * r);
    if (low) a.set("m_dateEnd", BigInt(dR));
    else a.set("m_dateBegin", BigInt(d1R));
    list.push([clone.oid, n.oid]);
  }
  im.setRaw("m_otherActuals", refMapValue(list));
}

/** `ImplManagerHelpers::CopyImplementations(im, outras, fica)` [I, P-2]: os realizados das absorvidas passam à que fica. */
/**
 * `ImplManagerHelpers::CopyImplementations@0x984e50` → `CopyImplementationsImpl<MovableWorkSite>@0x984450` /
 * `<OtherWorkSite>@0x984530` (U-61f, P-2 fechada) [O]: num postponer, para cada tarefa absorvida (tipo diferente da que
 * fica → `logic_error("Task type mismatch")`): movível → `CopyImplementationsImpl@0x984f50`: cada `ImplInfo` do usuário é
 * recriado na que fica por `AddImplementation(kept, início, fim, quantidade, tipo, isSource, low)` e `CopyUtilizations
 * @0x9853c0` refaz cada utilização por `AddActualHaul(novo, quantidade, origem, lowO, destino, lowD)`; os automáticos são
 * refeitos pelo lado do usuário. Outra tarefa → `CopyImplementationsImpl@0x985330`: `AddOtherActual(kept, início, fim,
 * low, quantidade)`. [I] O ApeX move os mesmos objetos (OIDs mantidos) e refaz as utilizações no fim (recreator): o
 * estado final (apontamentos, quantidades, datas, sentidos, utilizações) é o mesmo; só a numeração dos OIDs difere.
 */
function copyImplementations(p: Project, others: readonly Entity[], kept: Entity): void {
  const im = implManager(p);
  const gone = new Set(others.map((o) => o.oid));
  for (const key of ["m_mpImplInfos", "m_otherActuals"]) {
    const list = pairList(im.get(key));
    if (!list.some(([k]) => gone.has(k))) continue;
    for (const e of list)
      if (gone.has(e[0])) {
        p.get(e[1])?.set("m_pWorkSite", kept.oid);
        e[0] = kept.oid;
      }
    im.setRaw(key, refMapValue(list));
  }
}

/** Project::Add*(src, sumTask) com o construtor de cópia da classe. */
function copyWorkSite(p: Project, src: Entity): Entity {
  const ws = cloneEntity(p, src);
  for (const k of ["m_pUIInfo", "m_pLayOut", "m_pWorkSiteLook"]) {
    const o = p.resolve(src.get(k) as Ref);
    if (o) ws.set(k, cloneEntity(p, o).oid);
  }
  if (ws.has("m_mIdentifiedResources")) ws.setRaw("m_mIdentifiedResources", { kind: "map", type: 0x15, keyType: null, valueType: null, entries: [] } as never);
  if (ws.has("m_dSourceUnitPrice")) ws.set("m_dSourceUnitPrice", 0);
  if (ws.has("m_dDestinationUnitPrice")) ws.set("m_dDestinationUnitPrice", 0);
  if (ws.has("m_bDerivePredecessorsFromTypes")) ws.set("m_bDerivePredecessorsFromTypes", true);
  if (src.className === "CrushingPlant") {
    ws.set("m_bLocalStockPile", true);
    ws.set("m_nLocalStockPileExtraDays", 0);
  }
  // work places com localização nova
  const newWps = wps(p, src).map((w) => {
    const c = cloneEntity(p, w);
    c.set("m_pWorkSite", ws.oid);
    c.set("m_pLocation", cloneEntity(p, loc(p, w)).oid);
    return c.oid;
  });
  setList(ws, "m_vpWorkPlaces", newWps);
  setList(ws, "m_vpDependencies", []);
  // contêineres: projeto e sum task
  const key = LIST[src.className]!;
  const containers = [p.resolve(p.root()!.get("m_pWSContainer") as Ref), p.resolve(p.resolve(src.get("m_pSumTaskParent") as Ref)?.get("m_pWorkSiteContainer") as Ref)];
  for (const c of containers) if (c) setList(c, key, [...refs(c.get(key)), ws.oid]);
  cloneUserDependencies(p, src, ws);
  return ws;
}

/** DependencyManager::CloneDependencies @0x9a3630: só as do usuário, com a tarefa nova no lugar da de origem. */
function cloneUserDependencies(p: Project, src: Entity, dst: Entity): void {
  for (const o of refs(src.get("m_vpDependencies"))) {
    const d = p.get(o);
    if (!d || d.get("m_bUserGenerated") !== true) continue;
    const c = cloneEntity(p, d);
    for (const k of ["m_pUIInfo", "m_pUILayOut"]) {
      const sub = p.resolve(d.get(k) as Ref);
      if (sub) c.set(k, cloneEntity(p, sub).oid);
    }
    if (d.get("m_pPredecessor") === src.oid) c.set("m_pPredecessor", dst.oid);
    else c.set("m_pSuccessor", dst.oid);
    const mgr = p.resolve(dst.get("m_pDependencyManager") as Ref);
    if (mgr) setList(mgr, "m_vDependencies", [...refs(mgr.get("m_vDependencies")), c.oid]);
    for (const end of [c.get("m_pPredecessor"), c.get("m_pSuccessor")]) {
      const ws = p.resolve(end as Ref);
      if (ws) setList(ws, "m_vpDependencies", [...refs(ws.get("m_vpDependencies")), c.oid]);
    }
  }
}

// ---------- nome automático ----------

function typesOf(p: Project, ws: Entity): bigint[] {
  if (ws.className === "OtherWorkSite") return refs([ws.get("m_pWorkType")]);
  return [sourceLandType(p, ws)?.oid, destLandType(p, ws)?.oid].filter((x): x is bigint => typeof x === "bigint");
}
const roadLineOf = (p: Project, ws: Entity) => {
  const w = wps(p, ws)[0];
  return w ? (loc(p, w).get("m_pRoadLine") as bigint | null) : null;
};

/** anon::MakeCategory @0x97dde0: (1º tipo, road line) */
const categoryOf = (p: Project, w: Entity) => `${typesOf(p, w)[0] ?? ""}|${roadLineOf(p, w) ?? ""}`;

/** anon::MakeWSName @0x97dfc0: (nome, descrição) sem o número = tipo [+ road line, se não for a principal] */
export function makeWSName(p: Project, ws: Entity): [string, string] {
  const t = p.resolve(typesOf(p, ws)[0] ?? null);
  const rl = roadLineOf(p, ws), main = p.root()!.get("m_pMainRoadLine");
  let name = `${String(t?.get("m_strName") ?? "").trim()} `, long = `${String((t?.get("m_strLongName") as string) || t?.get("m_strName") || "").trim()} `;
  if (rl !== null && rl !== main) {
    const r = p.get(rl)!;
    name += `${String(r.get("m_strName") ?? "").trim()} `;
    long += `${String((r.get("m_strLongName") as string) || r.get("m_strName") || "").trim()} `;
  }
  return [name.trim(), long.trim()];
}

/** ScheduleManager::AutoName @0x97be60 + MakeWSName @0x97dfc0 */
export function autoName(p: Project, ws: Entity): void {
  if (ws.get("m_bAutoName") !== true) return;
  const mine = categoryOf(p, ws);
  const used = new Set<number>([0]);
  for (const cls of Object.keys(LIST))
    for (const o of p.byClass(cls))
      if (o.oid !== ws.oid && categoryOf(p, o) === mine) {
        const toks = String(o.get("m_strName") ?? "").split(/\s/);
        const n = parseInt(toks[toks.length - 1] ?? "", 10);
        used.add(Number.isFinite(n) ? n : 0);
      }
  const sorted = [...used].sort((a, b) => a - b);
  let n = 1;
  for (let i = 0; i < sorted.length; i++) if (sorted[i + 1] === undefined || sorted[i + 1]! - sorted[i]! > 1) {
    n = sorted[i]! + 1;
    break;
  }
  const [name, long] = makeWSName(p, ws);
  ws.set("m_strName", `${name} ${n}`);
  ws.set("m_strLongName", `${long} ${n}`);
}

/** WorkSite::GetStationBegin/End [I: menor início e maior fim das localizações] */
function siteStationSpan(p: Project, ws: Entity): [number, number] {
  const list = wps(p, ws).map((w) => [stB(p, w), stE(p, w)] as const);
  return list.length ? [Math.min(...list.map((x) => x[0])), Math.max(...list.map((x) => x[1]))] : [0, 0];
}

/**
 * U-52: ScheduleManager::AutoNameEverything @0x97c410 [O]: só as tarefas com "Name automatically" (`m_bAutoName`),
 * agrupadas por `MakeCategory` (1º tipo, road line); dentro do grupo, `WorkSiteNamePred@0x97bd80` (estaca inicial ↑ com
 * AreEqual, estaca final ↑, nome) e números de 1 a n: nome = `MakeWSName.first + " " + i`, descrição idem. Sem nível
 * de undo próprio (o chamador abre: `AutoNameEverythingCommand`, 14045).
 */
export function autoNameEverything(p: Project): number {
  const groups = new Map<string, Entity[]>();
  for (const ws of workSitesInOrder(p)) {
    if (!LIST[ws.className] || ws.get("m_bAutoName") !== true) continue;
    const k = categoryOf(p, ws);
    const g = groups.get(k);
    if (g) g.push(ws);
    else groups.set(k, [ws]);
  }
  let n = 0;
  for (const list of groups.values()) {
    const span = new Map(list.map((w) => [w.oid, siteStationSpan(p, w)]));
    list.sort((a, b) => {
      const [ab, ae] = span.get(a.oid)!, [bb, be] = span.get(b.oid)!;
      if (!areEqual(ab, bb)) return ab - bb;
      if (!areEqual(ae, be)) return ae - be;
      return namePred(a, b); // KernelObjectHelpers::NamePred@0x930900 (P-7 fechada, names.ts) [O]
    });
    list.forEach((ws, i) => {
      const [name, long] = makeWSName(p, ws);
      const nn = `${name} ${i + 1}`, nl = `${long} ${i + 1}`;
      if (ws.get("m_strName") !== nn) ws.set("m_strName", nn);
      if (ws.get("m_strLongName") !== nl) ws.set("m_strLongName", nl);
      n++;
    });
  }
  return n;
}

// ---------- quantidades e transportes ----------

/** apaga os transportes que tocam o work place (MoveManager::RemoveAllMoves em Set*Amount) */
export function removeMovesAt(p: Project, wp: Entity): void {
  const mm = p.resolve(p.root()!.get("m_pMoveManager") as Ref)!;
  for (const list of ["m_vpLPMoves", "m_vpSchedMoves"]) {
    const keep: bigint[] = [];
    for (const o of refs(mm.get(list))) {
      const m = p.get(o)!;
      if (m.get("m_pSrcWorkPlace") === wp.oid || m.get("m_pDstWorkPlace") === wp.oid) {
        const path = p.resolve(m.get("m_pPath") as Ref);
        if (path) {
          for (const n of refs(path.get("m_vpNodes"))) if (p.get(n)) p.remove(p.get(n)!);
          p.remove(path);
        }
        for (const k of ["m_pSourceWachVector", "m_pDestinationWachVector"]) {
          const w = m.has(k) ? p.resolve(m.get(k) as Ref) : undefined;
          if (w) p.remove(w);
        }
        p.remove(m);
      } else keep.push(o);
    }
    setList(mm, list, keep);
  }
}
const AMOUNTS = ["m_dSourceAmount", "m_dDestinationAmount", "m_dAmount"];
export function setAmount(p: Project, wp: Entity, member: string, v: number): void {
  if (areEqual(num(wp.get(member)), v)) return;
  removeMovesAt(p, wp);
  wp.set(member, v);
}

function removeWorkPlace(p: Project, ws: Entity, wp: Entity): void {
  removeMovesAt(p, wp);
  setList(ws, "m_vpWorkPlaces", refs(ws.get("m_vpWorkPlaces")).filter((o) => o !== wp.oid));
  const l = p.resolve(wp.get("m_pLocation") as Ref);
  if (l) p.remove(l);
  p.remove(wp);
}

function finish(p: Project): void {
  applyAutoDependencies(p);
  const s = new Scheduler(p);
  s.write(s.calculate());
}

// ---------- RN-021 dividir por estaca ----------

/** ScheduleManager::SplitWorkSiteByStation @0x97fb10: devolve a tarefa nova, ou undefined se s está fora. */
export function splitWorkSiteByStation(p: Project, ws: Entity, s: number): Entity | undefined {
  const list = wps(p, ws);
  if (!list.length) return undefined;
  const b = Math.min(...list.map((w) => stB(p, w))), e = Math.max(...list.map((w) => stE(p, w)));
  if (isLessThanOrEqual(s, b) || isLessThanOrEqual(e, s)) return undefined;
  guardSplitAtStation(p, ws, s);
  let clone!: Entity;
  p.edit("Split task", () => {
    clone = copyWorkSite(p, ws);
    autoName(p, clone);
    // realizados antes do corte dos work places (índices ainda 1:1) [O]
    const hasActuals = actualsOf(p, ws).length > 0;
    if (hasActuals) {
      if (MOVABLE.has(ws.className)) splitImplementationsByStation(p, ws, clone);
      else notifyWorkSiteSplit(p, ws, clone, portionAtStation(p, ws, "m_dAmount", s));
    }
    const orig = wps(p, ws), copy = wps(p, clone);
    orig.forEach((wp, k) => {
      const cw = copy[k]!;
      const wb = stB(p, wp), we = stE(p, wp);
      const startsBefore = s > wb && !areEqual(wb, s);
      const endsAtOrBefore = isLessThanOrEqual(we, s);
      if (!startsBefore) {
        if (!endsAtOrBefore) removeWorkPlace(p, ws, wp);
      } else if (endsAtOrBefore) removeWorkPlace(p, clone, cw);
      else {
        const len = we - wb;
        if (areEqual(0, len)) return;
        const r = (s - wb) / len;
        for (const m of AMOUNTS)
          if (wp.has(m) && wp.get(m) !== undefined) {
            const A = num(wp.get(m));
            setAmount(p, wp, m, A * r);
            setAmount(p, cw, m, (1 - r) * A);
          }
        setStations(loc(p, wp), wb, wb + (s - wb) * 0.5, s);
        setStations(loc(p, cw), s, s + (we - s) * 0.5, we);
      }
    });
    if (hasActuals && MOVABLE.has(ws.className)) recreateUtilizations(p, [ws.oid, clone.oid]);
    finish(p);
  });
  return clone;
}

/** Location::SetStations @0x9bb1d0 (a checagem de faixa da road line fica com o chamador [I]) */
function setStations(l: Entity, b: number, cog: number, e: number): void {
  if (!(b <= cog && cog <= e)) return;
  l.set("m_dStationBegin", b);
  l.set("m_dStationCOG", cog);
  l.set("m_dStationEnd", e);
}

// ---------- dividir por quantidades ----------

/**
 * SplitWorkSiteByAmounts @0x97f450: `amounts[wp] = [origem (ou quantidade da outra tarefa), destino]` = quanto vai para a
 * tarefa nova. Fora de [0, atual] → AMOUNT_OUT_OF_RANGE. Work place que zera é apagado se a tarefa tem mais de um.
 */
export function splitWorkSiteByAmounts(p: Project, ws: Entity, amounts: Map<bigint, [number, number]>): Entity {
  if (!wps(p, ws).length) throw new SplitError("NO_WORK_PLACES", "Work site has no work places!");
  let clone!: Entity;
  p.edit("Split task", () => {
    clone = copyWorkSite(p, ws);
    autoName(p, clone);
    const zero: [Entity, Entity][] = [];
    const orig = wps(p, ws), copy = wps(p, clone);
    orig.forEach((wp, k) => {
      const cw = copy[k]!, v = amounts.get(wp.oid) ?? [0, 0];
      const sides: [string, number][] = ws.className === "OtherWorkSite" ? [["m_dAmount", v[0]]] : [
        ...(isSourceAmount(ws) ? [["m_dSourceAmount", v[0]] as [string, number]] : []),
        ...(isDestinationAmount(ws) ? [["m_dDestinationAmount", v[1]] as [string, number]] : []),
      ];
      for (const [m, x] of sides) {
        const A = num(wp.get(m));
        if (x < 0 || A < x) throw new SplitError("AMOUNT_OUT_OF_RANGE", "AMOUNT_OUT_OF_RANGE");
        setAmount(p, wp, m, A - x);
        setAmount(p, cw, m, x);
        if (areEqual(0, num(wp.get(m)))) zero.push([ws, wp]);
        if (areEqual(0, num(cw.get(m)))) zero.push([clone, cw]);
      }
    });
    for (const [owner, wp] of zero) if (p.get(wp.oid) && refs(owner.get("m_vpWorkPlaces")).length > 1) removeWorkPlace(p, owner, wp);
    if (MOVABLE.has(ws.className) && actualsOf(p, ws).length) recreateUtilizations(p, [ws.oid]);
    finish(p);
  });
  return clone;
}

// ---------- combinar ----------

interface Place {
  b: number;
  e: number;
  cog: number;
  dist: number;
  count: number;
  amount: (number | undefined)[]; // 0 origem, 1 destino, 2 outra
}
const mainAmount = (pl: Place) => pl.amount[2] ?? pl.amount[1] ?? pl.amount[0] ?? 0;
/** StationSpanHelpers::IsIntersecting: encostar não conta, salvo span de comprimento zero */
function intersecting(b1: number, e1: number, b2: number, e2: number): boolean {
  if (areEqual(b1, e1)) return isLessThanOrEqual(b2, b1) && isLessThanOrEqual(b1, e2);
  if (areEqual(b2, e2)) return isLessThanOrEqual(b1, b2) && isLessThanOrEqual(b2, e1);
  return b1 < e2 && b2 < e1;
}

/** anon::Merge @0x97e600 (conjunto ordenado pelo início) */
function merge(set: Place[], n: Place): void {
  const hits = set.map((p, i) => (intersecting(p.b, p.e, n.b, n.e) ? i : -1)).filter((i) => i >= 0);
  if (!hits.length) {
    set.push(n);
    set.sort((a, b) => a.b - b.b);
    return;
  }
  const first = hits[0]!, last = hits[hits.length - 1]! + 1;
  const r: Place = { ...n, amount: [...n.amount] };
  let wC = n.cog * mainAmount(n), wD = n.dist * mainAmount(n), tot = mainAmount(n), cnt = n.count, cC = n.count * n.cog, cD = n.count * n.dist;
  for (const q of set.slice(first, last)) {
    r.b = Math.min(r.b, q.b);
    r.e = Math.max(r.e, q.e);
    const m = mainAmount(q);
    wC += q.cog * m;
    wD += q.dist * m;
    tot += m;
    cnt += q.count;
    cC += q.count * q.cog;
    cD += q.count * q.dist;
    for (let k = 0; k < 3; k++) if (q.amount[k] !== undefined) r.amount[k] = (r.amount[k] ?? 0) + q.amount[k]!;
  }
  set.splice(first, last - first);
  if (areEqual(tot, 0)) {
    r.cog = cC / cnt;
    r.dist = cD / cnt;
  } else {
    r.cog = wC / tot;
    r.dist = wD / tot;
  }
  r.count = cnt;
  set.push(r);
  set.sort((a, b) => a.b - b.b);
}

/**
 * ScheduleManager::CombineWorkSites @0x97d270 (REPARADO): fica a primeira tarefa da lista; as outras precisam dos mesmos
 * tipos e da mesma road line; os work places da que fica são refeitos pelo mapa de massas; os realizados das absorvidas
 * passam para ela (`CopyImplementations`); dependências do usuário das outras passam para ela (CloneDependencies) e as
 * outras são apagadas; por fim `fica.SetBeginTime(início)` [O].
 * - U-61f (P-1) [O]: o `min_element` (lambda @0x979e50) compara `GetBeginTime()` das tarefas: `início` = o menor início
 *   entre as combinadas. `WorkSite::SetBeginTime@0x942c60` [O]: `SetWantedStart(início)` no calculador e, em cada work
 *   place, mantém a duração em segundos de trabalho a partir de `início` (`SetTiming(início, WS2AS(AS2WS(início) + Δws))`),
 *   depois `ResetTimings`. [I] os work places refeitos pelo mapa de massas começam sem duração; o ApeX lhes dá
 *   `[início, início + Δws da tarefa que fica]` e o recálculo decide as estritas (`finish`).
 */
export function combineWorkSites(p: Project, sites: Entity[]): Entity | undefined {
  if (sites.length < 2) return undefined;
  const [kept, ...others] = sites as [Entity, ...Entity[]];
  const wpBeginOf = (w: Entity) => Number(w.get("pDVar2") ?? 0), wpEndOf = (w: Entity) => Number(w.get("m_endTime") ?? 0);
  const siteBeginOf = (s: Entity) => Math.min(...wps(p, s).map(wpBeginOf));
  const inicio = Math.min(...sites.map(siteBeginOf)); // min_element(GetBeginTime) [O]
  const keptSpan = wps(p, kept).length ? [Math.min(...wps(p, kept).map(wpBeginOf)), Math.max(...wps(p, kept).map(wpEndOf))] : [inicio, inicio];
  const t0 = typesOf(p, kept).join(",");
  for (const o of others) {
    if (typesOf(p, o).join(",") !== t0) throw new SplitError("CANT_COMBINE_TASKS_WITH_DIFFERENT_TYPES", "CANT_COMBINE_TASKS_WITH_DIFFERENT_TYPES");
    if (roadLineOf(p, o) !== roadLineOf(p, kept)) throw new SplitError("CANT_COMBINE_TASKS_ON_DIFFERENT_LOCATIONS", "CANT_COMBINE_TASKS_ON_DIFFERENT_LOCATIONS");
  }
  p.edit("Combine tasks", () => {
    const set: Place[] = [];
    for (const s of sites)
      for (const wp of wps(p, s)) {
        const l = loc(p, wp);
        const amount: (number | undefined)[] = [undefined, undefined, undefined];
        if (s.className === "OtherWorkSite") amount[2] = num(wp.get("m_dAmount"));
        else {
          if (sourceLandType(p, s)) amount[0] = num(wp.get("m_dSourceAmount"));
          if (destLandType(p, s)) amount[1] = num(wp.get("m_dDestinationAmount"));
        }
        merge(set, { b: num(l.get("m_dStationBegin")), e: num(l.get("m_dStationEnd")), cog: num(l.get("m_dStationCOG")), dist: num(l.get("m_dDistance")), count: 1, amount });
      }
    if (!MULTI.has(kept.className) && set.length !== 1) throw new SplitError("EXPECTED_ONE_LOCATION", "Expected exactly one task location.");
    const rl = roadLineOf(p, kept);
    for (const wp of wps(p, kept)) {
      removeMovesAt(p, wp);
      const l = p.resolve(wp.get("m_pLocation") as Ref);
      if (l) p.remove(l);
      p.remove(wp);
    }
    const template = wps(p, sites[0]!)[0];
    const fresh = set.map((pl) => {
      const l = p.create("Location");
      l.set("m_strName", "");
      l.set("m_strLongName", "");
      l.set("m_pUIInfo", null);
      l.set("m_dDistance", pl.dist);
      l.set("m_pRoadLine", rl);
      l.set("m_dStationBegin", pl.b);
      l.set("m_dStationCOG", pl.cog);
      l.set("m_dStationEnd", pl.e);
      const w = p.create(kept.className === "OtherWorkSite" ? "OtherWorkPlace" : "MovableWorkPlace");
      w.set("m_strName", "");
      w.set("m_strLongName", "");
      w.set("m_pUIInfo", null);
      w.set("m_pLocation", l.oid);
      w.set("m_pWorkSite", kept.oid);
      if (kept.className === "OtherWorkSite") w.set("m_dAmount", pl.amount[2] ?? 0);
      else {
        w.set("m_bLockedAsActual", false);
        w.set("m_dSourceAmount", pl.amount[0] ?? 0);
        w.set("m_dDestinationAmount", pl.amount[1] ?? 0);
      }
      // WorkSite::SetBeginTime(início) [O]: começa em `início` e mantém a duração em segundos de trabalho [I: a da tarefa que fica]
      if (Number.isFinite(inicio)) {
        const cal = new Scheduler(p).calendarOf(kept);
        const dws = Math.max(0, cal.AS2WS(keptSpan[1]!) - cal.AS2WS(keptSpan[0]!));
        w.set("pDVar2", BigInt(inicio));
        w.set("m_endTime", BigInt(dws > 0 ? cal.WS2AS(cal.AS2WS(inicio) + dws, false) : inicio));
      }
      return w.oid;
    });
    void template;
    setList(kept, "m_vpWorkPlaces", fresh);
    copyImplementations(p, others, kept);
    for (const o of others) {
      cloneUserDependencies(p, o, kept);
      deleteWorkSite(p, o);
    }
    if (MOVABLE.has(kept.className) && actualsOf(p, kept).length) recreateUtilizations(p, [kept.oid]); // RAII ImplUtilizationRecreator [O]
    removeDuplicateDependencies(p, kept);
    finish(p);
  });
  return kept;
}

function deleteWorkSite(p: Project, ws: Entity): void {
  for (const wp of wps(p, ws)) removeWorkPlace(p, ws, wp);
  for (const o of refs(ws.get("m_vpDependencies"))) {
    const d = p.get(o);
    if (!d) continue;
    for (const end of [d.get("m_pPredecessor"), d.get("m_pSuccessor")]) {
      const w = p.resolve(end as Ref);
      if (w && w.oid !== ws.oid) setList(w, "m_vpDependencies", refs(w.get("m_vpDependencies")).filter((x) => x !== o));
    }
    const mgr = p.resolve(ws.get("m_pDependencyManager") as Ref);
    if (mgr) setList(mgr, "m_vDependencies", refs(mgr.get("m_vDependencies")).filter((x) => x !== o));
    for (const k of ["m_pUIInfo", "m_pUILayOut"]) {
      const sub = p.resolve(d.get(k) as Ref);
      if (sub) p.remove(sub);
    }
    p.remove(d);
  }
  // HasVariantTiming::OnDependentBegin/EndWorkSiteDeleted @0x973410/@0x973450 [O]: TASK vira STATIC e a referência é zerada
  for (const e of [...p.byClass("UsageBreak"), ...p.byClass("RoadConnection")]) {
    for (const [member, type] of [["m_pBeginWorkSite", "m_beginTimingType"], ["m_pEndWorkSite", "m_endTimingType"]] as const) {
      if (e.get(member) !== ws.oid) continue;
      if (num(e.get(type)) === 2) e.set(type, 1);
      e.set(member, null);
    }
  }
  const key = LIST[ws.className]!;
  for (const c of p.byClass("WorkSiteContainer")) if (refs(c.get(key)).includes(ws.oid)) setList(c, key, refs(c.get(key)).filter((x) => x !== ws.oid));
  for (const k of ["m_pUIInfo", "m_pLayOut", "m_pWorkSiteLook"]) {
    const sub = p.resolve(ws.get(k) as Ref);
    if (sub) p.remove(sub);
  }
  p.remove(ws);
}

/** DependencyManager::GetDuplicates + RemoveDependencies [I: IsEqual = mesmo par, tipo e atrasos] */
function removeDuplicateDependencies(p: Project, ws: Entity): void {
  const seen = new Set<string>();
  for (const o of refs(ws.get("m_vpDependencies"))) {
    const d = p.get(o)!;
    const k = ["m_pPredecessor", "m_pSuccessor", "m_nType", "m_nDelayMin", "m_nDelayMax", "m_bHasMinDelay", "m_bHasMaxDelay", "m_bIsDelayWorkDays"].map((m) => String(d.get(m))).join("|");
    if (!seen.has(k)) {
      seen.add(k);
      continue;
    }
    for (const end of [d.get("m_pPredecessor"), d.get("m_pSuccessor")]) {
      const w = p.resolve(end as Ref);
      if (w) setList(w, "m_vpDependencies", refs(w.get("m_vpDependencies")).filter((x) => x !== o));
    }
    const mgr = p.resolve(ws.get("m_pDependencyManager") as Ref);
    if (mgr) setList(mgr, "m_vDependencies", refs(mgr.get("m_vDependencies")).filter((x) => x !== o));
    p.remove(d);
  }
}


// ---------- L-048: corte na fronteira de conclusão (analise_realizados_l045_l048.md §4) ----------

const MULTI_MOVABLE = new Set(["LandCut", "Embankment", "MassExchange"]);
/** MovableWorkPlace::GetMainAmount @0x960da0 [O]: destino se IsDestinationAmount ou IsDestinationConstraint, senão origem */
function mainAmountOf(ws: Entity, wp: Entity): number {
  if (ws.className === "OtherWorkSite") return num(wp.get("m_dAmount"));
  return num(wp.get(isDestinationAmount(ws) || isDestinationConstraint(ws) ? "m_dDestinationAmount" : "m_dSourceAmount"));
}

/** WorkPlaceHelpers::GetWorkPlacePortionsBasedOnStation @0x9361c0 */
function portionsByStation(p: Project, ws: Entity, wp: Entity): [number, number] {
  const list = wps(p, ws);
  const len = (w: Entity) => stE(p, w) - stB(p, w);
  const L = list.reduce((s, w) => s + len(w), 0);
  const k = list.findIndex((w) => w.oid === wp.oid);
  if (L <= 0) return [k / list.length, (k + 1) / list.length];
  const cum = list.slice(0, k).reduce((s, w) => s + len(w), 0);
  return [cum / L, (cum + len(wp)) / L];
}

/** WorkPlaceHelpers::GetWorkPlacePortionsBasedOnMass(wp) @0x936040: porções da quantidade principal, da estaca baixa. */
export function portionsByMass(p: Project, ws: Entity, wp: Entity): [number, number] {
  const list = wps(p, ws);
  const M = list.reduce((s, w) => s + mainAmountOf(ws, w), 0);
  if (isLessThanOrEqual(M, 0)) return portionsByStation(p, ws, wp);
  const k = list.findIndex((w) => w.oid === wp.oid);
  if (k < 0) throw new SplitError("NO_WORK_PLACES", "wp not in its ws.");
  const cum = list.slice(0, k).reduce((s, w) => s + mainAmountOf(ws, w), 0);
  return [cum / M, (cum + mainAmountOf(ws, wp)) / M];
}

/** anon::DetermineNewCOGs @0x935800 [O, ASM]: busca em grade 3×3 (passos r e 1 − r em estaca) para r·a + (1 − r)·b ≈ C. */
export function determineNewCOGs(B: number, C: number, E: number, s: number, r: number): [number, number] {
  const w = 1 - r;
  const clampA = (x: number) => Math.min(Math.max(B, x), s), clampB = (x: number) => Math.min(Math.max(s, x), E);
  let a = s - (s - B) * 0.5, b = (E - s) * 0.5 + s;
  for (;;) {
    let err = (w * b + r * a - C) ** 2, bi = 0, bj = 0;
    for (let k = 0; k < 9; k++) {
      const i = (k % 3) - 1, j = (Math.floor(k / 3) % 3) - 1;
      const d = clampA(a + i * r) * r + clampB(b + j * w) * w - C;
      if (d * d < err) {
        err = d * d;
        bi = i;
        bj = j;
      }
    }
    if (bi === 0 && bj === 0) return [a, b];
    a = clampA(a + bi * r);
    b = clampB(b + bj * w);
  }
}

/** Location::SetStations @0x9bb1d0: comprimento zero lança; fora de b ≤ c ≤ e não grava. */
function setStationsChecked(l: Entity, b: number, c: number, e: number): void {
  if (areEqual(b, e)) throw new SplitError("AMOUNT_OUT_OF_RANGE", "ZERO_LENGTH_LOCATION");
  setStations(l, b, c, e);
}

const begin = (w: Entity) => Number(w.get("pDVar2") ?? 0);
const end = (w: Entity) => Number(w.get("m_endTime") ?? 0);
const pathOf = (p: Project, m: Entity) => p.resolve(m.get("m_pPath") as Ref);

/** cópia do Path com nós novos (Path(const&) @0x99b180) */
function clonePath(p: Project, path: Entity | undefined): bigint | null {
  if (!path) return null;
  const c = cloneEntity(p, path);
  setList(c, "m_vpNodes", refs(path.get("m_vpNodes")).map((o) => cloneEntity(p, p.get(o)!).oid));
  return c.oid;
}
/**
 * Path::SetSource/SetDestination @0x99ba70/@0x99ba20 + Node::SetWorkPlace @0x99a6c0 (U-61j, L-R13) [O]: se o work place do
 * 1º (origem) ou do último nó (destino) for outro, `NotifyChange` e troca; nada recalcula rota nem `m_dLength`. O original
 * lança `runtime_error("Logic error")` se o nó não tem work place; aqui o nó fica como está [P].
 */
function setPathEnd(p: Project, pathOid: bigint | null, wp: bigint, destination: boolean): void {
  const path = pathOid === null ? undefined : p.get(pathOid);
  const nodes = refs(path?.get("m_vpNodes"));
  const n = p.get(nodes[destination ? nodes.length - 1 : 0] ?? -1n);
  if (n && n.get("m_pWorkPlace")) n.set("m_pWorkPlace", wp);
}
function removeMove(p: Project, mm: Entity, list: string, m: Entity): void {
  setList(mm, list, refs(mm.get(list)).filter((o) => o !== m.oid));
  const path = pathOf(p, m);
  if (path) {
    for (const n of refs(path.get("m_vpNodes"))) if (p.get(n)) p.remove(p.get(n)!);
    p.remove(path);
  }
  for (const k of ["m_pSourceWachVector", "m_pDestinationWachVector"]) {
    const w = m.has(k) ? p.resolve(m.get(k) as Ref) : undefined;
    if (w) p.remove(w);
  }
  p.remove(m);
}

/**
 * `SchedMove::CheckDates@0x95f880` (U-61j, L-R12) [O, ASM `u61j_controle/consts_lote1b.txt`]: só valida. Com o total do
 * perfil de origem (convertido ao tipo de origem) ≥ 0,5 (`IsGreaterThanOrEqual`), lança `invalid_argument` quando um perfil
 * começa mais de 1 dia antes do work place da sua ponta (`(início do wp − início do perfil)/86400 > 1`) ou termina mais de
 * 1 dia depois (`(fim do perfil − fim do wp)/86400 > 1`), origem e depois destino. `LPMove::CheckObject@0x953030` =
 * `KernelObject::CheckObject` + `GetCost` com o resultado descartado (só exceções; não reproduzido [P]).
 */
function checkDates(p: Project, m: Entity, src: WachContainer, dst: WachContainer): void {
  if (!(src.total() >= 0.5 || areEqual(src.total(), 0.5))) return;
  const span = (w: WachContainer) => [Math.min(...w.spans.map((x) => x.b)), Math.max(...w.spans.map((x) => x.e))] as const;
  for (const [k, w, side] of [["m_pSrcWorkPlace", src, "source"], ["m_pDstWorkPlace", dst, "destination"]] as const) {
    const wp = p.resolve(m.get(k) as Ref);
    if (!wp || !w.spans.length) continue;
    const [b, e] = span(w);
    if ((begin(wp) - b) / 86400 > 1) throw new SplitError("INVALID_SCHED_MOVE_DATES", `${side} wach vector starts before ${side}`);
    if ((e - end(wp)) / 86400 > 1) throw new SplitError("INVALID_SCHED_MOVE_DATES", `${side} wach vector ends after ${side}`);
  }
}

/** anon::Split @0x9600f0 [O]: recorta A às datas do pedaço e corta B na mesma proporção, pelo fim ou pelo início. */
function splitWach(wp: Entity, A: WachContainer, B: WachContainer, fromBack: boolean): void {
  if (!(A.total() > 0)) return;
  A.cropDateSpan(begin(wp), end(wp));
  const qb = B.total();
  if (areEqual(0, qb)) throw new SplitError("AMOUNT_OUT_OF_RANGE", "attempt to divide by zero.");
  const excess = qb - qb * (A.total() / qb);
  if (fromBack) B.removeFromBack(excess);
  else B.removeFromFront(excess);
}

/**
 * MoveManager::OnSplit @0x94f660 → SplitLPMove @0x9502e0 / SplitSchedMove @0x950520: cada transporte com ponta em wp ganha
 * uma cópia para o pedaço novo (left), inserida antes; partes com quantidade < 0,5 são removidas.
 */
function splitMoves(p: Project, ws: Entity, wp: Entity, left: Entity, r: number): void {
  const mm = p.resolve(p.root()!.get("m_pMoveManager") as Ref)!;
  const low = ws.get("m_bLow") !== false; // WorkSiteHelpers::IsLow
  for (const list of ["m_vpLPMoves", "m_vpSchedMoves"] as const) {
    for (const m of refs(mm.get(list)).map((o) => p.get(o)!)) {
      const isSrc = m.get("m_pSrcWorkPlace") === wp.oid, isDst = m.get("m_pDstWorkPlace") === wp.oid;
      if (!isSrc && !isDst) continue;
      // LPMove(m, wp, r) @0x9528a0: pontas em wp passam ao pedaço novo; caminho copiado; flags copiadas
      const novo = cloneEntity(p, m);
      if (isSrc) novo.set("m_pSrcWorkPlace", left.oid);
      if (isDst) novo.set("m_pDstWorkPlace", left.oid);
      const np = clonePath(p, pathOf(p, m));
      novo.set("m_pPath", np);
      setPathEnd(p, np, left.oid, isDst);
      if (list === "m_vpLPMoves") {
        const amount = Number(m.get("m_dAmount") ?? 0);
        novo.set("m_dAmount", amount * r);
        m.set("m_dAmount", amount - amount * r);
      } else {
        // SchedMove(m, wp) @0x95f2f0: sem r; quantidades pelos perfis recortados às datas de cada pedaço
        const ms = readWach(p.resolve(m.get("m_pSourceWachVector") as Ref)!), md = readWach(p.resolve(m.get("m_pDestinationWachVector") as Ref)!);
        const ns = ms.clone(), nd = md.clone();
        if (isSrc) {
          splitWach(wp, ms, md, !low);
          splitWach(left, ns, nd, low);
        } else {
          splitWach(wp, md, ms, !low);
          splitWach(left, nd, ns, low);
        }
        for (const [e, k, w] of [[novo, "m_pSourceWachVector", ns], [novo, "m_pDestinationWachVector", nd], [m, "m_pSourceWachVector", ms], [m, "m_pDestinationWachVector", md]] as const) {
          if (e === m) p.remove(p.resolve(m.get(k) as Ref)!);
          e.set(k, addWachVector(p, w));
        }
        novo.set("m_dAmount", ns.total());
        m.set("m_dAmount", ms.total());
        // CheckObject(novo), CheckObject(m), CheckDates(novo), CheckDates(m) no fim do ctor @0x95f2f0 [O]
        checkDates(p, novo, ns, nd);
        checkDates(p, m, ms, md);
      }
      const ids = refs(mm.get(list));
      const k = ids.indexOf(m.oid);
      setList(mm, list, [...ids.slice(0, k), novo.oid, ...ids.slice(k)]);
      if (Number(novo.get("m_dAmount") ?? 0) < 0.5) removeMove(p, mm, list, novo);
      if (Number(m.get("m_dAmount") ?? 0) < 0.5) removeMove(p, mm, list, m);
    }
  }
}

/**
 * WorkSite::SplitWorkPlace @0x943910 com WorkPlace(orig, r) @0x933ab0 e Movable/OtherWorkPlace(orig, r) @0x960240/@0x9a8770
 * (analise_realizados_l045_l048.md §9.1–§9.2): o pedaço novo é o trecho baixo [B, s], s = B + (E − B)·r, entra antes do
 * original e recebe r das quantidades e a fração r do tempo de trabalho (primeiro se a tarefa vai do baixo para o alto,
 * por último no outro sentido); COGs por DetermineNewCOGs; m_bLockedAsActual copiado; transportes divididos.
 * [I] Round64 = arredondamento ao inteiro mais próximo (L-R11); as datas são refeitas pelo recálculo do cronograma.
 */
export function splitWorkPlace(p: Project, ws: Entity, wp: Entity, r: number): Entity | undefined {
  if (!MULTI_MOVABLE.has(ws.className) && ws.className !== "OtherWorkSite") throw new SplitError("NOT_IMPLEMENTED", "unable to contain multiple work places");
  const list = refs(ws.get("m_vpWorkPlaces"));
  const k = list.indexOf(wp.oid);
  if (k < 0) throw new SplitError("NO_WORK_PLACES", "no such work place");
  if (areEqual(r, 0) || areEqual(r, 1)) return undefined;
  if (r < 0 || r > 1) throw new SplitError("AMOUNT_OUT_OF_RANGE", "PERCENT_MUST_BE_BETWEEN_0_AND_100");
  const novo = cloneEntity(p, wp);
  novo.set("m_strName", "");
  novo.set("m_strLongName", "");
  const l = loc(p, wp), nl = cloneEntity(p, l);
  novo.set("m_pLocation", nl.oid);
  const B = stB(p, wp), E = stE(p, wp), C = num(l.get("m_dStationCOG"));
  const s = B + (E - B) * Math.min(1, Math.max(0, r));
  const [cogLow, cogHigh] = determineNewCOGs(B, C, E, s, r);
  setStationsChecked(nl, B, cogLow, s);
  setStationsChecked(l, s, cogHigh, E);
  const cal = new Scheduler(p).calendarOf(ws);
  const d = Math.round((cal.AS2WS(end(wp)) - cal.AS2WS(begin(wp))) * r);
  if (ws.get("m_bLow") !== false) {
    if (d !== 0) wp.set("pDVar2", BigInt(cal.WS2AS(cal.AS2WS(begin(wp)) + d, true)));
    novo.set("m_endTime", BigInt(setToEndOfDay(cal, begin(wp))));
  } else {
    let nb = end(novo);
    if (d !== 0) nb = cal.WS2AS(cal.AS2WS(nb) - d, true);
    novo.set("pDVar2", BigInt(nb));
    wp.set("m_endTime", BigInt(setToEndOfDay(cal, nb)));
  }
  if (ws.className === "OtherWorkSite") {
    const a = num(wp.get("m_dAmount"));
    novo.set("m_dAmount", r * a);
    wp.set("m_dAmount", (1 - r) * a);
  } else
    for (const m of ["m_dSourceAmount", "m_dDestinationAmount"]) {
      const a = num(wp.get(m)), x = r * a;
      novo.set(m, x);
      wp.set(m, a - x);
    }
  setList(ws, "m_vpWorkPlaces", [...list.slice(0, k), novo.oid, ...list.slice(k)]);
  splitMoves(p, ws, wp, novo, r);
  return novo;
}

/** WorkSiteHelpers::SplitWorkPlaceAtWorkSitePortion @0x92a560 */
export function splitWorkPlaceAtWorkSitePortion(p: Project, ws: Entity, portion: number): void {
  if (!MULTI_MOVABLE.has(ws.className) && ws.className !== "OtherWorkSite") throw new SplitError("NOT_IMPLEMENTED", "work site does not support multiple work places");
  if (portion < 0 || portion > 1) throw new SplitError("AMOUNT_OUT_OF_RANGE", "PERCENT_MUST_BE_BETWEEN_0_AND_100");
  if (areEqual(portion, 0) || areEqual(portion, 1)) return;
  for (const wp of wps(p, ws)) {
    const [p0, p1] = portionsByMass(p, ws, wp);
    if (areEqual(p0, portion) || areEqual(p1, portion)) return;
    if (isLessThanOrEqual(p0, portion) && isLessThanOrEqual(portion, p1)) {
      splitWorkPlace(p, ws, wp, areEqual(p0, p1) ? 0.5 : (portion - p0) / (p1 - p0));
      return;
    }
  }
  throw new SplitError("NO_WORK_PLACES", "SplitWorkPlaceAtWorkSitePortion");
}

/**
 * ImplManagerHelpers::SplitAtCompletionBoundaries @0x988be0/@0x988ce0: para (origem, baixo), (destino, baixo),
 * (origem, alto), (destino, alto), corta onde termina o executado (alto: em 1 − p). Deve rodar dentro de `Project.edit`.
 */
export function splitAtCompletionBoundaries(p: Project): void {
  for (const ws of workSitesInOrder(p).filter((e) => MULTI_MOVABLE.has(e.className)))
    for (const [source, low] of [[true, true], [false, true], [true, false], [false, false]] as const) {
      if (source ? !isSource(ws) : !isDestination(ws)) continue;
      const impl = implementedAmount(p, ws, source, low, !low);
      const total = wps(p, ws).reduce((s, w) => s + num(w.get(source ? "m_dSourceAmount" : "m_dDestinationAmount")), 0);
      if (!(impl < total) || !(total > 0) || !(impl > 0)) continue;
      const q = Math.min(1, Math.max(0, impl / total));
      splitWorkPlaceAtWorkSitePortion(p, ws, low ? q : 1 - q);
    }
}
