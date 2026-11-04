/**
 * Controle (U-11): apontamentos e travamento (RF-023), forecast (RF-033, RN-007), caminhões (RF-034, RN-008), uso de
 * recursos e custos (RF-035), curva de massa do projeto (RF-036, RN-019). Evidência: analises/2026-10-11_dynaroad/
 * handoff/docs/analise_controle_u11.md (seções citadas por função) e evidencias/decompilado/u11/.
 *
 * Inferências e lacunas (registradas na ESPECIFICACAO, L-045…L-049):
 * - [O] travamento por work place com a repartição do `TaskActuals` (actuals.ts, L-045 fechada em 2026-10-14) e corte na
 *   fronteira de conclusão antes de travar (SplitAtCompletionBoundaries, L-048; analise_realizados_l045_l048.md §3–§4).
 * - [I] trechos realizados do forecast (`GetStationTiming`, L2): massa acumulada dos apontamentos do sentido, em
 *   ordem de data, convertida em estaca pela massa dos work places.
 * - [O U-61j] encontro das frentes (`GetForecastIntersectionStation@0x9f80e0`, L3/L-047): interseção das retas estaca ×
 *   tempo de trabalho, com os operandos lidos no ASM (frente baixa = s1, alta = s2; ver `meet`).
 * - [I] a 2ª frente é posta em sequência a partir do início dela, sem nivelamento de recursos.
 * - [O] rota inadequada do transportador = local ou intersection de algum nó do caminho em `m_unsuitableRoutes`
 *   (IsSuitablePath @0x99d020, L-042); [I] sum task do uso de caminhões = a da tarefa de origem (L6); distância do
 *   transporte = comprimento do `Path`.
 */
import { Calendar, MAX_DATE, MIN_DATE, parseCalendarBlob } from "@apex/calendar";
import type { Entity, Project, Ref } from "@apex/model";
import { encode, encodeContainer } from "@apex/model";
import type { FieldValue } from "@apex/dr5";
import { ActualsContext, actualsOf, implementedAmount, implManager } from "./actuals.js";
import { recreateUtilizations, removeActualLPAndSchedMoves, removeImplementation, removeOtherActual } from "./implmanager.js";
import { convertAmount, destLandType, isDestination, isSource, sourceLandType, unitOfType } from "./costs.js";
import { DistanceCalculator } from "./distances.js";
import { HAUL_CLASS, isSuitablePath, maxDistance, storedNode, vehiclesNeeded, wachAtDistance } from "./haulres.js";
import { ResourceUsage, type Span } from "./leveling.js";
import { addWorkPlaceMass, DensityMap, integral } from "./masscurve.js";
import { isDestinationAmount, isSourceAmount, siteUnit } from "./plan.js";
import { addSchedMove, areEqual, isLessThanOrEqual, pricePerHour, pricePerUnit, readWach } from "./schedule.js";
import { splitAtCompletionBoundaries } from "./split.js";
import { workSitesInOrder } from "./autodeps.js";
import { NULL_WORK_GROUP_RATE, Scheduler, STRICT_CLASSES, SWGU, type Site, type WP } from "./timing.js";
import { groupRateEntry, makeContainer, productionRate, selectedGroup, WachContainer } from "./wach.js";

export class ControlError extends Error {
  constructor(
    readonly code: "NOT_IMPLEMENTED" | "ONLY_ONE_WORK_PLACE" | "UNKNOWN_TASK_TYPE" | "UNEXPECTED_TIMING" | "NOT_STARTED" | "BEGIN_TIME_GREATER_THAN_END_TIME" | "FORECAST_PLACE" | "ZERO_PRODUCTION",
    message: string,
  ) {
    super(message);
    this.name = "ControlError";
  }
}

const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);
const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
const date = (v: unknown) => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : 0);
const MODE = { PLAN: 0, SCHEDULE: 1, CONTROL: 2 } as const;
export { MODE };
export { actualsOf, implementedAmount, implManager };

// ---------- dados (RF-023) ----------

const moveManager = (p: Project) => p.resolve(p.root()!.get("m_pMoveManager") as Ref)!;
const pairs = (v: unknown) => (Array.isArray(v) ? (v as [unknown, unknown][]) : []);
const refMap = (entries: [bigint, bigint][]): FieldValue =>
  entries.length
    ? { kind: "map", type: 0x15, keyType: 0x18, valueType: 0x18, entries: entries.map(([k, v]) => [encode(0x18, k), encode(0x18, v)]) }
    : { kind: "map", type: 0x15, keyType: null, valueType: null, entries: [] };
const isOther = (ws: Entity) => ws.className === "OtherWorkSite";


export interface ActualInput {
  workSite: Entity;
  begin: number;
  end: number;
  amount: number;
  /** sentido da execução: true = da estaca baixa para a alta */
  low: boolean;
  /** só tarefas de movimento: lado do apontamento (origem/corte = true) */
  source?: boolean;
  userMade?: boolean;
}

/** Apontamento novo (ImplInfo ou OtherActual), desfazível. */
export function addActual(p: Project, a: ActualInput): Entity {
  if (a.end < a.begin) throw new ControlError("BEGIN_TIME_GREATER_THAN_END_TIME", "BEGIN_TIME_GREATER_THAN_END_TIME");
  let e!: Entity;
  p.edit("Add actual", () => {
    const im = implManager(p);
    const other = isOther(a.workSite);
    e = p.create(other ? "OtherActual" : "ImplInfo");
    e.set("m_strName", "");
    e.set("m_strLongName", "");
    e.set("m_pUIInfo", null);
    e.set("m_pImplManager", im.oid);
    e.set("m_pWorkSite", a.workSite.oid);
    e.set("m_dateBegin", BigInt(a.begin));
    e.set("m_dateEnd", BigInt(a.end));
    e.set("m_bLow", a.low);
    e.set("m_dAmount", a.amount);
    if (!other) {
      const src = a.source ?? isSource(a.workSite);
      e.set("m_pSourceLandType", (src ? sourceLandType(p, a.workSite) : destLandType(p, a.workSite))?.oid ?? null);
      e.setRaw("m_vpUtilizations", encodeContainer(0x18, []));
      e.set("m_bUserMade", a.userMade ?? true);
      e.set("m_bSource", src);
    }
    const key = other ? "m_otherActuals" : "m_mpImplInfos";
    im.setRaw(key, refMap([...pairs(im.get(key)).map(([k, v]) => [k as bigint, v as bigint] as [bigint, bigint]), [a.workSite.oid, e.oid]]));
    // U-53 (D4): AddImplementationImpl@0x959fc0 refaz as utilizações da tarefa e os realizados travados saem [O]
    if (!other) {
      removeActualLPAndSchedMoves(p, a.workSite);
      recreateUtilizations(p, [a.workSite.oid]);
    }
  });
  return e;
}

/**
 * Remove um apontamento (U-53, D4) [O]: `ImplInfo` → `RemoveImplementation(dc, info, reabrir)@0x95c910` (realizados
 * travados da tarefa saem e as utilizações são refeitas); `OtherActual` → `RemoveOtherActual(a, reabrir)`.
 * `RemoveActualsCommand` passa reabrir = false; `RemoveOtherActualCommand`, true.
 */
export function removeActual(p: Project, actual: Entity, reopen = actual.className === "OtherActual"): void {
  p.edit("Remove actual", () => {
    if (actual.className === "ImplInfo") removeImplementation(p, actual, reopen);
    else removeOtherActual(p, actual, reopen);
  });
}

export const controlDate = (p: Project) => date(implManager(p).get("m_dateControl"));

/** ImplManager::SetControlDate @0x95da20: clamp no intervalo do calendário; só marca mudança se mudou. */
export function setControlDate(p: Project, d: number): void {
  const v = Math.min(Math.max(d, MIN_DATE), MAX_DATE);
  if (v === controlDate(p)) return;
  p.edit("Set report and control time", () => implManager(p).set("m_dateControl", BigInt(v))); // 14143 [O U-30]
}

/** WorkSite::SetFinished @0x9432f0: só grava a flag. */
export function setFinished(p: Project, ws: Entity, b: boolean): void {
  if ((ws.get("m_bFinished") === true) === b) return;
  p.edit("Set finished", () => ws.set("m_bFinished", b));
}

// ---------- consultas (RN-007) ----------

const infoIsSource = (a: Entity) => a.get("m_bSource") !== false;
const accepts = (a: Entity, bLow: boolean, bHigh: boolean) => (bLow && a.get("m_bLow") === true) || (bHigh && a.get("m_bLow") !== true);


/** ImplManagerHelpers::IsStarted @0x9887e0: tarefa finished conta como iniciada. */
export function isStarted(p: Project, ws: Entity, wantSrc = true, wantDst = true, wantLow = true, wantHigh = true): boolean {
  if (ws.get("m_bFinished") === true) return true;
  return actualsOf(p, ws).some((a) => (isOther(ws) || (wantSrc && infoIsSource(a)) || (wantDst && !infoIsSource(a))) && accepts(a, wantLow, wantHigh));
}

/** quantidade principal do lado (MovableWorkSiteHelpers::GetAmount) ou MainAmount da outra tarefa */
function sideAmount(p: Project, ws: Entity, bSource: boolean): number {
  const wps = refs(ws.get("m_vpWorkPlaces")).map((o) => p.get(o)!);
  if (isOther(ws)) return wps.reduce((s, w) => s + num(w.get("m_dAmount")), 0);
  return wps.reduce((s, w) => s + num(w.get(bSource ? "m_dSourceAmount" : "m_dDestinationAmount")), 0);
}

/** ImplManagerHelpers::GetImplementationDegree @0x987350 (movable) / @0x987430 (outra, L4: soma/A [I]). */
export function implementationDegree(p: Project, ws: Entity, bSource: boolean, bLow = true, bHigh = true): number {
  if (!isOther(ws) && (bSource ? !isSource(ws) : !isDestination(ws))) return 0;
  const A = sideAmount(p, ws, bSource);
  if (A > 0) return implementedAmount(p, ws, bSource, bLow, bHigh) / A;
  return isStarted(p, ws, bSource, !bSource, bLow, bHigh) ? 1 : 0;
}

/** ImplManagerHelpers::GetImplementedTiming @0x987760: (min início, max fim), inicial (MAX, MIN). */
export function implementedTiming(p: Project, ws: Entity): [number, number] {
  let b = MAX_DATE, e = MIN_DATE;
  for (const a of actualsOf(p, ws)) {
    b = Math.min(b, date(a.get("m_dateBegin")));
    e = Math.max(e, date(a.get("m_dateEnd")));
  }
  return [b, e];
}

/** lado de referência: origem, salvo tarefa só-destino (ForecastCalculator::AddSite) */
const refSide = (ws: Entity) => (isOther(ws) ? true : !isDestination(ws));

/**
 * GetActualProductionRate @0x985f10 (movível, `bSource` explícito) / @0x9863c0 (outra tarefa) / @0x986890 (despacho:
 * `bSource = !IsDestination`): Σ quantidades / Σ horas úteis (sem horas úteis: horas corridas). U-61j [O, ASM
 * `u61j_controle/consts_lote1.txt`]: as horas são `(AS2WS(fim) − AS2WS(início)) / 3600` no calendário da TAREFA
 * (`WorkSite::m_pCalendar` +0x110, lido pelo getter dobrado `UIManager::GetPolygonOrderHelper@0x93f6c0` + 0xc8); sem
 * horas, `Q(0, unidade do lado)` (movível: `MovableWorkSiteHelpers::GetUnit(ws, bSource)`; outra: unidade do MainAmount).
 */
export function actualProductionRate(p: Project, ws: Entity, cal: Calendar, acceptLow: boolean, acceptHigh: boolean, bSource?: boolean): number {
  const side = bSource ?? refSide(ws);
  let amount = 0, hours = 0;
  for (const a of actualsOf(p, ws)) {
    if ((!isOther(ws) && infoIsSource(a) !== side) || !accepts(a, acceptLow, acceptHigh)) continue;
    amount += num(a.get("m_dAmount"));
    const b = date(a.get("m_dateBegin")), e = date(a.get("m_dateEnd"));
    let h = (cal.AS2WS(e) - cal.AS2WS(b)) / 3600;
    if (areEqual(h, 0)) h = (e - b) / 3600;
    hours += h;
  }
  return hours > 0 ? amount / hours : 0;
}

/** RN-007 GetForecastedProductionRate @0x986c20: d·real + (1 − d)·planejada, d = clamp(grau do sentido, 0, 1). */
export function forecastedProductionRate(p: Project, ws: Entity, sched: Scheduler, acceptLow: boolean, acceptHigh: boolean): number {
  const site = sched.sites.get(ws.oid);
  if (!site) throw new ControlError("UNKNOWN_TASK_TYPE", "Unknown task type");
  const real = actualProductionRate(p, ws, site.calendar, acceptLow, acceptHigh);
  const d = Math.min(1, Math.max(0, implementationDegree(p, ws, refSide(ws), acceptLow, acceptHigh)));
  return real * d + site.rate * (1 - d);
}

// ---------- rótulo de recursos (AL-VIS-42, U-61j) ----------

const calendarCache = new WeakMap<object, Calendar>();

/**
 * Calendário da tarefa pela regra de `Scheduler.calendarOf` (o próprio ou o padrão, `m_bUseDefaultCalendar`) [I], sem
 * montar o Scheduler (o rótulo é pedido por work place). `undefined` sem calendário legível.
 */
export function siteCalendar(p: Project, ws: Entity): Calendar | undefined {
  const root = p.root();
  if (!root) return undefined;
  const def = p.resolve(root.get("m_pCalendarManager") as Ref)?.get("m_pDefaultCalendar");
  const own = ws.get("m_bUseDefaultCalendar") === false ? ws.get("m_pCalendar") : (def ?? ws.get("m_pCalendar"));
  const ref = typeof own === "bigint" ? own : def;
  if (typeof ref !== "bigint") return undefined;
  const blob = p.get(ref)?.fields.find((f) => f.id === 100 && f.type === 0x10);
  if (!blob || blob.value.kind !== "bytes") return undefined;
  let c = calendarCache.get(blob.value.value);
  if (!c) calendarCache.set(blob.value.value, (c = new Calendar(parseCalendarBlob(blob.value.value))));
  return c;
}

export interface RateQuantity {
  /** quantidade por hora */
  q: number;
  unit: bigint | null;
}
/** Uma linha de `GetResourceString`: equipe selecionada de um uso, com a taxa planejada e (no CONTROL) a realizada. */
export interface ResourceLine {
  /** `WorkSite::SubWorkGroupUsage` (1 envio, 2 recebimento, 8 outras) */
  usage: number;
  group: Entity;
  /** `boost::optional<Quantity>` planejado (tupla +0x20); `null` = não atribuído ("?") */
  planned: RateQuantity | null;
  /** `boost::optional<Quantity>` realizado (tupla +0x40); `null` = não atribuído ("?") */
  actual: RateQuantity | null;
}

/** `WorkSite::GetProductionRate(uso, tipo)@0x93fb10`: taxa da equipe para o tipo × `m_dWachCoeff`; `NullWorkGroup` = 1e7 (AL-MOT-26). */
function crewRate(ws: Entity, g: Entity, type: Entity | undefined): RateQuantity | null {
  if (!type) return null;
  const base = g.className === "NullWorkGroup" ? NULL_WORK_GROUP_RATE : groupRateEntry(g, type)[0];
  return { q: base * num(ws.get("m_dWachCoeff"), 1), unit: unitOfType(type) };
}

/**
 * `anonymous::GetResourceString@0x6e6340` (U-61j, `u61j_controle/lote1` + `consts_lote1.txt`) [O]: um mapa ordenado
 * `uso → (texto, optional planejado, optional realizado)` montado a partir de `m_cSelectedSubWorkGroups` (todas as
 * entradas, inclusive a `NullWorkGroup`). Depois, só para os usos da classe:
 * - movível, uso 1: planejado = `MovableWorkSite::GetSendRate(GetSourceLandType())@0x9b6440` se a tarefa tem tipo de
 *   origem (vt+0x58); CONTROL e `IsStarted(im, ws, src, !dst, baixo, alto)@0x988710` → realizado =
 *   `GetActualProductionRate(im, ws, true, true, bSource = true)@0x985f10`;
 * - movível, uso 2: planejado = `GetReceiveRate@0x9b6230` (tipo de destino, vt+0x54); CONTROL e `IsStarted(…, !src, dst, …)`
 *   → realizado com `bSource = false`;
 * - outra tarefa, uso 8: planejado = `OtherWorkSite::GetMainWach@0x9b7dd0` (uso 8, `m_pWorkType`); CONTROL e
 *   `IsStarted(im, ws, true, true)@0x9887e0` → realizado = `GetActualProductionRate(im, ws, true, false)@0x9863c0`
 *   (só os apontamentos "baixos", como o original pede).
 * [P] sem tipo de destino o original lança `logic_error("no destination type")`; aqui o planejado fica sem valor ("?").
 */
export function resourceLines(p: Project, ws: Entity, control: boolean): ResourceLine[] {
  const lines: ResourceLine[] = [];
  for (const [u, g] of pairs(ws.get("m_cSelectedSubWorkGroups"))) {
    const group = p.resolve(g as Ref);
    if (group) lines.push({ usage: num(u), group, planned: null, actual: null });
  }
  lines.sort((a, b) => a.usage - b.usage);
  const at = (k: number) => lines.find((l) => l.usage === k);
  let cal: Calendar | undefined | null = null;
  const calendar = () => (cal === null ? (cal = siteCalendar(p, ws)) : cal);
  const unitOr = (f: () => bigint | null): bigint | null => {
    try {
      return f();
    } catch {
      return null;
    }
  };
  if (isOther(ws)) {
    const l = at(SWGU.OTHER);
    const type = p.resolve(ws.get("m_pWorkType") as Ref);
    if (l) {
      l.planned = crewRate(ws, l.group, type);
      if (control && isStarted(p, ws, true, true, true, true)) {
        const c = calendar();
        l.actual = { q: c ? actualProductionRate(p, ws, c, true, false) : 0, unit: type ? unitOfType(type) : null };
      }
    }
    return lines;
  }
  for (const [usage, bSource] of [[SWGU.SEND, true], [SWGU.RECEIVE, false]] as const) {
    const l = at(usage);
    if (!l) continue;
    l.planned = crewRate(ws, l.group, bSource ? sourceLandType(p, ws) : destLandType(p, ws));
    if (control && isStarted(p, ws, bSource, !bSource, true, true)) {
      const c = calendar();
      l.actual = { q: c ? actualProductionRate(p, ws, c, true, true, bSource) : 0, unit: unitOr(() => siteUnit(p, ws, bSource)) };
    }
  }
  return lines;
}

// ---------- travamento (RF-023) ----------

/** WorkPlace::LockAsActual @0x936440 (+ MovableWorkPlace @0x961720: apaga os SchedMoves do work place). */
export function lockAsActual(p: Project, wp: Entity, b: number, e: number): void {
  if (e < b) throw new ControlError("BEGIN_TIME_GREATER_THAN_END_TIME", "BEGIN_TIME_GREATER_THAN_END_TIME");
  const mm = moveManager(p);
  const keep = refs(mm.get("m_vpSchedMoves")).filter((o) => {
    const m = p.get(o)!;
    return m.get("m_pSrcWorkPlace") !== wp.oid && m.get("m_pDstWorkPlace") !== wp.oid;
  });
  mm.setRaw("m_vpSchedMoves", encodeContainer(0x18, keep));
  wp.set("m_bLockedAsActual", true);
  wp.set("pDVar2", BigInt(b));
  wp.set("m_endTime", BigInt(e));
}

/** WorkPlace::UnlockAsActual @0x9370d0: volta às datas planejadas da tarefa (recalculadas pelo cronograma) e limpa os ActualsLocking vazios. */
export function unlockAsActual(p: Project, wp: Entity): void {
  if (wp.get("m_bLockedAsActual") !== true) return;
  p.edit("Unlock as actual", () => {
    wp.set("m_bLockedAsActual", false);
    removeUnlockedActualsLockings(p);
    const s = new Scheduler(p);
    s.write(s.calculate(true));
  });
}

/** ImplManager::RemoveUnlockedActualsLockings @0x95ceb0 */
function removeUnlockedActualsLockings(p: Project): void {
  const im = implManager(p);
  const keep: bigint[] = [];
  for (const o of refs(im.get("m_spActualsLockings"))) {
    const L = p.get(o);
    if (!L) continue;
    const still = refs(L.get("m_spLockedAsActual")).filter((w) => p.get(w)?.get("m_bLockedAsActual") === true);
    if (still.length) {
      L.setRaw("m_spLockedAsActual", encodeContainer(0x18, still));
      keep.push(o);
    } else p.remove(L);
  }
  im.setRaw("m_spActualsLockings", encodeContainer(0x18, keep));
}

/** tarefas estritas e com vários work places (IsStrictTiming vt+0x40 e IsSupportingMultipleWorkPlaces vt+0x20) [O] */
const LOCK_PER_PLACE = new Set(["LandCut", "Embankment", "MassExchange"]);
const MOVABLE = new Set(["LandCut", "Embankment", "MassExchange", "BorrowPit", "WasteLand", "StockPile", "CrushingPlant"]);

/** ImplManager::LockActuals @0x95b130 (reparado) num nível de undo, com o recálculo do cronograma no fim. */
export function lockActuals(p: Project): { locked: bigint[] } {
  let r!: { locked: bigint[] };
  p.edit("Lock actuals", () => (r = lockActualsIn(p)));
  return r;
}

/**
 * ImplManager::LockActuals @0x95b130 dentro de uma edição aberta (analise_realizados_l045_l048.md §3): corta os work
 * places na fronteira de conclusão; nas tarefas estritas trava, por work place, os concluídos (ActualHelpers::IsFinished)
 * com as datas do TaskActuals; nas não estritas exige um work place e só estende o período da tarefa; cria os SchedMoves
 * realizados e registra um ActualsLocking; o recálculo adiado (TimingCalculationPostponer) roda no fim.
 */
export function lockActualsIn(p: Project): { locked: bigint[] } {
  const locked: bigint[] = [];
  splitAtCompletionBoundaries(p);
  const sched = new Scheduler(p);
  const ac = new ActualsContext(p, (ws) => sched.calendarOf(ws));
  for (const ws of workSitesInOrder(p)) {
    if (!MOVABLE.has(ws.className) || !isStarted(p, ws)) continue;
    const wps = refs(ws.get("m_vpWorkPlaces")).map((o) => p.get(o)!);
    if (LOCK_PER_PLACE.has(ws.className)) {
      for (const wp of wps) {
        if (!ac.isFinished(wp)) continue;
        const [b, e] = ac.actualTiming(wp);
        if (b > e) throw new ControlError("UNEXPECTED_TIMING", "Unexpected timing");
        if (!(wp.get("m_bLockedAsActual") === true && date(wp.get("pDVar2")) === b && date(wp.get("m_endTime")) === e)) locked.push(wp.oid);
        lockAsActual(p, wp, b, e);
        ws.set("m_bLow", isMostlyLow(p, ws));
      }
    } else {
      if (wps.length !== 1) throw new ControlError("ONLY_ONE_WORK_PLACE", "only one work place expected");
      // HasSettableTiming::SetTiming [I]: nas não estritas o período é o do único work place
      const [ib, ie] = implementedTiming(p, ws);
      const wp = wps[0]!;
      wp.set("pDVar2", BigInt(Math.min(date(wp.get("pDVar2")), ib)));
      wp.set("m_endTime", BigInt(Math.max(date(wp.get("m_endTime")), ie)));
    }
  }
  createSchedMovesFromImplMoves(p, new ActualsContext(p, (ws) => sched.calendarOf(ws)));
  if (locked.length) {
    const L = p.create("ActualsLocking");
    L.set("m_strName", "");
    L.set("m_strLongName", "");
    L.set("m_pUIInfo", null);
    L.set("m_date", BigInt(controlDate(p)));
    L.setRaw("m_spLockedAsActual", encodeContainer(0x18, locked));
    const im = implManager(p);
    im.setRaw("m_spActualsLockings", encodeContainer(0x18, [...refs(im.get("m_spActualsLockings")), L.oid]));
  }
  const s = new Scheduler(p);
  s.write(s.calculate(true));
  return { locked };
}

/** ImplManagerHelpers::IsMostlyLow @0x988690 */
function isMostlyLow(p: Project, ws: Entity): boolean {
  const side = !isDestination(ws) || isOther(ws);
  const lo = implementedAmount(p, ws, side, true, false), hi = implementedAmount(p, ws, side, false, true);
  if (lo === hi) return ws.get("m_bLow") !== false;
  return hi < lo;
}

/**
 * ImplInfo::GetTiming @0x9558e0: envoltória do work place na combinação (sentido do apontamento, lado) recortada ao
 * período do apontamento; fim < início → "Actual haul timing is out of date".
 */
function implInfoTiming(ac: ActualsContext, info: Entity, wp: Entity, source: boolean): [number, number] {
  const [b, e] = ac.actualTimingSide(wp, info.get("m_bLow") === true, source);
  const r: [number, number] = [Math.max(b, date(info.get("m_dateBegin"))), Math.min(e, date(info.get("m_dateEnd")))];
  if (r[1] < r[0]) throw new ControlError("UNEXPECTED_TIMING", "Actual haul timing is out of date");
  return r;
}

/** MoveManagerHelpers::CreateSchedMovesFromImplMovesToLockedAsActualWorkPlaces @0x94e600 */
function createSchedMovesFromImplMoves(p: Project, ac: ActualsContext): void {
  const mm = moveManager(p);
  const sched = new Scheduler(p);
  const dc = new DistanceCalculator(p, {});
  for (const o of refs(mm.get("m_utilizations"))) {
    const u = p.get(o);
    if (!u) continue;
    const src = p.resolve(u.get("m_pSrcWorkPlace") as Ref), dst = p.resolve(u.get("m_pDstWorkPlace") as Ref);
    if (!src || !dst || src.get("m_bLockedAsActual") !== true || dst.get("m_bLockedAsActual") !== true) continue;
    const si = p.resolve(u.get("m_pSourceInfo") as Ref), di = p.resolve(u.get("m_pDestinationInfo") as Ref);
    if (!si || !di) continue;
    const sws = p.resolve(src.get("m_pWorkSite") as Ref)!, dws = p.resolve(dst.get("m_pWorkSite") as Ref)!;
    const slt = p.resolve(u.get("m_pSourceLandType") as Ref) ?? p.resolve(si.get("m_pSourceLandType") as Ref) ?? sourceLandType(p, sws);
    if (!slt) continue;
    const amount = num(u.get("m_dAmount"));
    const unit = siteUnit(p, sws, true);
    const [sb, se] = implInfoTiming(ac, si, src, true), [db, de] = implInfoTiming(ac, di, dst, false);
    const srcWach = makeContainer(amount, unit, sb, se, sched.calendarOf(sws));
    const dstWach = makeContainer(amount, unit, db, de, sched.calendarOf(dws));
    addSchedMove(p, mm, { source: src, destination: dst, slt, path: dc.path(src.oid, dst.oid), srcLSP: false, dstLSP: false, srcWach, dstWach }, false, true);
  }
}

// ---------- forecast (RF-033) ----------

export interface ForecastPlace {
  stationBegin: number;
  stationEnd: number;
  begin: number;
  end: number;
  amount: number;
  /** trecho realizado (datas dos apontamentos) */
  actual: boolean;
}
export interface ForecastFront {
  low: boolean;
  start: number;
  rate: number;
  places: ForecastPlace[];
}

interface Portion {
  wp: Entity;
  sb: number;
  se: number;
  amount: number;
  p0: number;
  p1: number;
}

/** WorkPlaceHelpers::GetWorkPlacePortionsBasedOnMass: fração da massa da tarefa por work place, em ordem de estaca. */
function portions(p: Project, site: Site): Portion[] {
  const list = site.wps.map((w) => ({ wp: w.entity, sb: w.stationBegin, se: w.stationEnd, amount: w.amount })).sort((a, b) => a.sb - b.sb);
  const total = list.reduce((s, x) => s + x.amount, 0);
  let acc = 0;
  return list.map((x) => {
    const p0 = total > 0 ? acc / total : 0;
    acc += x.amount;
    return { ...x, p0, p1: total > 0 ? acc / total : 1 };
  });
}

/** estaca na fração F da massa (medida a partir da estaca baixa) */
function stationAt(ps: Portion[], F: number): number {
  for (const x of ps) if (F <= x.p1 || x === ps[ps.length - 1]) return x.p1 > x.p0 ? x.sb + ((Math.min(Math.max(F, x.p0), x.p1) - x.p0) / (x.p1 - x.p0)) * (x.se - x.sb) : x.sb;
  return ps.length ? ps[0]!.sb : 0;
}

/** CreateForecast @0x98ccb0: pedaços da massa [from, to] por work place, com a quantidade proporcional. */
function forecastPieces(ps: Portion[], from: number, to: number): { wp: Entity; sb: number; se: number; amount: number }[] {
  const out: { wp: Entity; sb: number; se: number; amount: number }[] = [];
  for (const x of ps) {
    if (!(x.p1 > x.p0)) continue;
    const a = (Math.max(from, x.p0) - x.p0) / (x.p1 - x.p0), b = (Math.min(to, x.p1) - x.p0) / (x.p1 - x.p0);
    if (!(b > a)) continue;
    const s0 = x.sb + (x.se - x.sb) * a, s1 = x.sb + (x.se - x.sb) * b;
    if (!areEqual(s0, s1)) out.push({ wp: x.wp, sb: s0, se: s1, amount: x.amount * (b - a) });
  }
  return out;
}

/**
 * `anon::GetImplSpanContainer@0x986fa0` + `DoMerge` (U-61f, L-046) [O filtro por lado e sentido; I densidade = quantidade ÷
 * segundos corridos]: os apontamentos viram spans de um `QuantitySpanContainer<Date, double>` (Merge: ignora b ≥ e e
 * densidade ≈ 0; sobreposições somam).
 */
function implSpans(p: Project, ws: Entity, low: boolean, side: boolean): { b: number; e: number; q: number }[] {
  const c = new WachContainer(null);
  for (const a of actualsOf(p, ws)) {
    if ((!isOther(ws) && infoIsSource(a) !== side) || (a.get("m_bLow") === true) !== low) continue;
    const b = date(a.get("m_dateBegin")), e = date(a.get("m_dateEnd")), q = num(a.get("m_dAmount"));
    if (!(b < e) || !(q > 0)) continue;
    c.addSpan({ b, e, q: q / (e - b) });
  }
  return c.spans;
}

/**
 * `ImplManagerHelpers::GetPortionMap@0x987b80` [O]: T = encerrada ? apontado : max(planejado, apontado);
 * `GetPortionMapImpl@0x987dd0` [O]: acumulado dos spans em ordem de data, p0 = max(0, acc/T), p1 = min(1, acc'/T), só
 * entra se p0 < p1; sentido alto espelha (1 − p). Frações medidas a partir da estaca baixa.
 */
function portionMap(p: Project, ws: Entity, low: boolean, side: boolean, planned: number, implemented: number): { b: number; e: number; f0: number; f1: number }[] {
  const T = ws.get("m_bFinished") === true ? implemented : Math.max(planned, implemented);
  if (areEqual(T, 0) || !(T > 0)) return [];
  const out: { b: number; e: number; f0: number; f1: number }[] = [];
  let acc = 0;
  for (const s of implSpans(p, ws, low, side)) {
    const p0 = Math.max(0, acc / T);
    acc += s.q * (s.e - s.b);
    const p1 = Math.min(1, acc / T);
    if (p0 < p1) out.push({ b: s.b, e: s.e, f0: low ? p0 : 1 - p0, f1: low ? p1 : 1 - p1 });
  }
  return out;
}

/**
 * `CreateActuals@0x98c9e0` + `GetStationTiming@0x9882d0` + `anon::DoAmount@0x9855d0` (U-61f, L-046) [O]: cada entrada do
 * mapa de porções é percorrida nos work places a partir da ponta baixa (sentido baixo) ou alta, cortada nas fronteiras
 * dos work places (estaca por `LocationHelpers::GetStationAtPortion`, linear na massa do lado) e com as datas repartidas
 * pela massa (`MapDoublePosToDatePos` com o calendário da tarefa [I: linear em segundos de trabalho]); quantidade do
 * pedaço = |Δp| × quantidade planejada do lado.
 */
function actualPieces(p: Project, ws: Entity, ps: Portion[], low: boolean, side: boolean, total: number, cal: Calendar): ForecastPlace[] {
  const out: ForecastPlace[] = [];
  const implemented = implementedAmount(p, ws, side, low, !low);
  for (const m of portionMap(p, ws, low, side, total, implemented)) {
    const lo = Math.min(m.f0, m.f1), hi = Math.max(m.f0, m.f1);
    const ws0 = cal.AS2WS(m.b), dws = cal.AS2WS(m.e) - ws0;
    // extremos exatos do apontamento; fronteiras internas interpoladas em segundos de trabalho [I]
    const dateAt = (f: number) => {
      const first = low ? f <= lo : f >= hi, last = low ? f >= hi : f <= lo;
      if (first) return m.b;
      if (last || !(hi > lo) || !(dws > 0)) return m.e;
      return cal.WS2AS(ws0 + ((low ? f - lo : hi - f) / (hi - lo)) * dws, false);
    };
    const pieces = ps.filter((x) => x.p1 > x.p0 && Math.min(hi, x.p1) > Math.max(lo, x.p0));
    for (const x of low ? pieces : pieces.slice().reverse()) {
      const a = Math.max(lo, x.p0), b = Math.min(hi, x.p1);
      const s0 = stationAt(ps, a), s1 = stationAt(ps, b);
      if (areEqual(s0, s1)) continue;
      const [t0, t1] = low ? [dateAt(a), dateAt(b)] : [dateAt(b), dateAt(a)];
      out.push({ stationBegin: Math.min(s0, s1), stationEnd: Math.max(s0, s1), begin: t0, end: t1, amount: (b - a) * total, actual: true });
    }
  }
  return out;
}

/**
 * ForecastCalculator @0x989090 (somente leitura): para cada tarefa estrita, frentes de previsão a partir da data de
 * controle, com os trechos realizados travados e o saldo na taxa de RN-007; cronograma com nivelamento; frentes
 * opostas cortadas na estaca de encontro (AdjustForecast @0x98c1a0).
 */
export function forecast(p: Project): Map<bigint, ForecastFront[]> {
  const wanted = new Map<bigint, number>();
  const sched = new Scheduler(p, { wanted });
  const cd = controlDate(p);
  const plan = new Scheduler(p);
  const out = new Map<bigint, ForecastFront[]>();
  const second: { ws: Entity; site: Site; front: ForecastFront }[] = [];
  const firstFront = new Map<bigint, ForecastFront>();
  for (const site of sched.sites.values()) {
    if (!site.strict) continue;
    const ws = site.entity;
    const finished = ws.get("m_bFinished") === true;
    const side = refSide(ws);
    let has = false, lowF = false, highF = false;
    for (const a of actualsOf(p, ws)) {
      if (num(a.get("m_dAmount")) === 0) continue;
      has = true;
      if (!isOther(ws) && infoIsSource(a) !== side) continue;
      if (a.get("m_bLow") === true) lowF = true;
      else highF = true;
    }
    if (finished && !has) {
      for (const w of site.wps) w.locked = true; // sem previsão: fica nas datas planejadas
      continue;
    }
    if (!lowF && !highF) (ws.get("m_bLow") !== false ? (lowF = true) : (highF = true));
    const planned = plan.sites.get(ws.oid)!;
    const start = Math.max(cd, has ? implementedTiming(p, ws)[1] : Math.min(...planned.wps.map((w) => w.begin)));
    const ps = portions(p, site);
    const total = sideAmount(p, ws, side);
    const dTotal = implementationDegree(p, ws, side, true, true);
    const fronts: ForecastFront[] = [];
    for (const low of [true, false]) {
      if (low ? !lowF : !highF) continue;
      const acts = actualPieces(p, ws, ps, low, side, total, site.calendar);
      const front: ForecastFront = { low, start, rate: site.rate, places: [...acts] };
      if (!finished) {
        const dSide = implementationDegree(p, ws, side, low, !low);
        let f = acts.length ? dSide / Math.max(1, dTotal) : low ? 0 : 1;
        if (acts.length && !low) f = 1 - f;
        if (!areEqual(f, low ? 1 : 0)) {
          for (const x of forecastPieces(ps, low ? f : 0, low ? 1 : f)) front.places.push({ stationBegin: x.sb, stationEnd: x.se, begin: 0, end: 0, amount: x.amount, actual: false });
          front.rate = forecastedProductionRate(p, ws, plan, low, !low);
        }
      }
      front.places.sort((a, b) => a.stationBegin - b.stationBegin);
      fronts.push(front);
    }
    // a frente com o realizado mais antigo é agendada primeiro (GetLastActualEnd @0x9f8420; empate: a baixa)
    fronts.sort((a, b) => lastActualEnd(a) - lastActualEnd(b));
    out.set(ws.oid, fronts);
    const [f1, f2] = fronts;
    if (!f1) continue;
    firstFront.set(ws.oid, f1);
    site.low = f1.low;
    site.rate = f1.rate;
    site.wps = f1.places.map((x): WP => ({ entity: ws, begin: x.begin, end: x.end, stationBegin: x.stationBegin, stationEnd: x.stationEnd, amount: x.amount, locked: x.actual }));
    wanted.set(ws.oid, start);
    if (f2) second.push({ ws, site, front: f2 });
  }
  sched.calculate(true);
  for (const [oid, f] of firstFront) {
    const site = sched.sites.get(oid)!;
    f.places = site.wps.map((w) => ({ stationBegin: w.stationBegin, stationEnd: w.stationEnd, begin: w.begin, end: w.end, amount: w.amount, actual: w.locked }));
  }
  for (const { site, front } of second) {
    layout(site.calendar, front, Math.max(front.start, sched.earliestStart(site.entity.oid)));
    const f1 = firstFront.get(site.entity.oid)!;
    const [lowF, highF] = f1.low ? [f1, front] : [front, f1];
    meet(site.calendar, lowF, highF, lastActualEnd(highF) >= lastActualEnd(lowF));
  }
  return out;
}

/** posição sequencial dos trechos de previsão de uma frente (UpdateTiming sem nivelamento [I]) */
function layout(cal: Calendar, f: ForecastFront, start: number): void {
  const order = f.low ? f.places : f.places.slice().reverse();
  let t = start;
  for (const x of order) {
    if (x.actual) continue;
    const dur = f.rate > 0 ? Math.round((x.amount / f.rate) * 3600) : 0;
    x.begin = t;
    x.end = dur ? cal.WS2AS(cal.AS2WS(t) + dur, false) : t;
    t = x.end;
  }
}

/** `StationSpanHelpers::IsIntersecting(begin, end, x)@0x9ef3b0` [O]: `IsGreaterThanOrEqual(x, begin) && IsLessThanOrEqual(x, end)` (tolerantes). */
const isIntersecting = (b: number, e: number, x: number) => isLessThanOrEqual(b, x) && isLessThanOrEqual(x, e);

/**
 * `TC::anon::GetForecastIntersectionStation(p1, p2)@0x9f80e0` (U-61j, L-047) [O, ASM `u61j_controle/consts_lote1.txt`
 * 0x9f80e0…0x9f82f6; getters lidos em `consts_lote2.txt`: `TC::WorkPlace` +0x0 `m_beginDate`, +0x8 `m_endDate`, +0x38
 * calendário, +0x40 `m_dBeginStation`, +0x48 `m_dEndStation`]. Com `A`/`S` = estaca inicial/final, `T0`/`T1` = início/fim
 * em segundos de trabalho do calendário de `p1`:
 * `d1 = T0(p1) − T0(p2)`, `d2 = T1(p2) − T0(p2)`, `d4 = T1(p1) − T0(p1)`, `e1 = A(p2) − S(p2)`;
 * `x = A(p1) + (S(p1) − A(p1)) · (d1·e1 − (A(p1) − S(p2))·d2) / ((S(p1) − A(p1))·d2 − d4·e1)` — a interseção da reta de `p1`
 * (de A a S, sentido baixo) com a de `p2` (de S a A, sentido alto). Retas paralelas dão ±∞/NaN e nenhum trecho contém x.
 */
export function forecastIntersectionStation(cal: Calendar, p1: ForecastPlace, p2: ForecastPlace): number {
  const ws = (t: number) => cal.AS2WS(t);
  const d1 = ws(p1.begin) - ws(p2.begin), d2 = ws(p2.end) - ws(p2.begin), d4 = ws(p1.end) - ws(p1.begin);
  const e1 = p2.stationBegin - p2.stationEnd, da = p1.stationEnd - p1.stationBegin;
  return p1.stationBegin + da * ((d1 * e1 - (p1.stationBegin - p2.stationEnd) * d2) / (da * d2 - d4 * e1));
}

/**
 * `TC::anon::GetForecastBeginStation(site)@0x9f7fa0` [O]: lista do sítio (invertida no sentido alto); `v` = estaca inicial
 * (baixo) ou final (alto) do primeiro; enquanto o work place está travado, `v = max(v, fim)` (baixo) ou `min(v, início)` (alto).
 */
function forecastBeginStation(f: ForecastFront): number {
  const order = f.low ? f.places : f.places.slice().reverse();
  let v = f.low ? order[0]?.stationBegin ?? 0 : order[0]?.stationEnd ?? 0;
  for (const q of order) {
    if (!q.actual) break;
    v = f.low ? Math.max(v, q.stationEnd) : Math.min(v, q.stationBegin);
  }
  return v;
}

/** `TC::anon::GetForecastPlaceAtStation(site, x)@0x9f8300` [O]: 1º work place não travado com `IsIntersecting(início, fim, x)`. */
function forecastPlaceAtStation(f: ForecastFront, x: number): ForecastPlace {
  const q = f.places.find((w) => !w.actual && isIntersecting(w.stationBegin, w.stationEnd, x));
  if (!q) throw new ControlError("FORECAST_PLACE", "GetForecastPlaceAtStation failed");
  return q;
}

/** `TC::anon::GetLastActualEnd(site)@0x9f8420` [O]: maior fim dos work places travados; inicial `Calendar::GetMinDate`. */
const lastActualEnd = (f: ForecastFront) => Math.max(MIN_DATE, ...f.places.filter((x) => x.actual).map((x) => x.end));

/**
 * `TC::anon::HandleIntersectingForecasts(s1, s2, usage, flag)@0x9f87c0` (U-61j) [O]: `TimingCalculator::CalculateTimings
 * @0x9f7990` passa sempre `s1 = m_sites[ws][0]` (frente baixa), `s2 = [1]` (alta) e `flag = GetLastActualEnd(s2) ≥
 * GetLastActualEnd(s1)`. Percorre os work places não travados de s1 (fora) e de s2 (dentro); o 1º par em que a estaca de
 * encontro está nos dois trechos vence. Sem par: `x = flag ? GetForecastBeginStation(s2) : GetForecastBeginStation(s1)` e
 * os trechos de cada frente que contêm x. Depois `AdjustForecast` nas duas.
 */
function meet(cal: Calendar, low: ForecastFront, high: ForecastFront, flag: boolean): void {
  let hit: { pa: ForecastPlace; pb: ForecastPlace; x: number } | undefined;
  outer: for (const pa of low.places) {
    if (pa.actual) continue;
    for (const pb of high.places) {
      if (pb.actual) continue;
      const x = forecastIntersectionStation(cal, pa, pb);
      if (isIntersecting(pa.stationBegin, pa.stationEnd, x) && isIntersecting(pb.stationBegin, pb.stationEnd, x)) {
        hit = { pa, pb, x };
        break outer;
      }
    }
  }
  if (!hit) {
    const x = flag ? forecastBeginStation(high) : forecastBeginStation(low);
    hit = { pa: forecastPlaceAtStation(low, x), pb: forecastPlaceAtStation(high, x), x };
  }
  adjust(cal, low, hit.pa, hit.x);
  adjust(cal, high, hit.pb, hit.x);
}

/** TC::WorkSite::AdjustForecast @0x98c1a0 */
function adjust(cal: Calendar, f: ForecastFront, place: ForecastPlace, x: number): void {
  const order = f.low ? f.places : f.places.slice().reverse();
  const i = order.indexOf(place);
  const len = place.stationEnd - place.stationBegin;
  const kept = f.low ? x - place.stationBegin : place.stationEnd - x;
  const r = kept > 0 && len > 0 ? kept / len : 0;
  const drop = new Set(order.slice(r === 0 ? i : i + 1).filter((q) => !q.actual));
  if (r > 0) {
    if (f.low) place.stationEnd = x;
    else place.stationBegin = x;
    place.amount *= r;
    const dur = f.rate > 0 ? Math.round((place.amount / f.rate) * 3600) : 0;
    place.end = dur ? cal.WS2AS(cal.AS2WS(place.begin) + dur, false) : place.begin;
  }
  f.places = f.places.filter((q) => !drop.has(q));
}

// ---------- caminhões (RF-034, RN-008) ----------

const transporterOf = (p: Project, ws: Entity) => {
  const g = selectedGroup(p, ws, SWGU.SEND);
  return g ? p.resolve(g.get("m_pHaulResource") as Ref) : undefined;
};
const table = (t: Entity) => pairs(t.get("m_mDistanceWorkAchievement")).map(([d, w]) => [num(d), num(w)] as const);
const moveDistance = (p: Project, m: Entity) => num(p.resolve(m.get("m_pPath") as Ref)?.get("m_dLength"));

/** HaulResourceCalculator::GetHaulClassMask @0x9ec2a0 */
export function haulClassMask(p: Project, m: Entity): number {
  const src = p.resolve(m.get("m_pSrcWorkPlace") as Ref)!;
  const T = transporterOf(p, p.resolve(src.get("m_pWorkSite") as Ref)!);
  if (!T) return HAUL_CLASS.NO_HAUL_RESOURCE;
  let mask = 0;
  const path = p.resolve(m.get("m_pPath") as Ref);
  if (path && !isSuitablePath(p, T, refs(path.get("m_vpNodes")).map((n) => p.get(n)).filter((n): n is Entity => !!n).map(storedNode))) mask |= HAUL_CLASS.UNSUITABLE_ROUTE;
  const d = moveDistance(p, m), tb = table(T);
  if (d > maxDistance(tb)) mask |= HAUL_CLASS.TOO_LONG;
  else if (!(wachAtDistance(tb, d) > 0)) throw new ControlError("ZERO_PRODUCTION", "Production rate at the haul's distance is <= 0");
  return mask;
}

// ---------- uso de recursos e custos (RF-035) ----------

export interface ResourceUsageResult {
  usage: ResourceUsage;
  /** sum task raiz (consultas de pico e total) */
  root: bigint | undefined;
  /** transportes com impedimento (máscara ≠ 0) */
  impeded: { move: bigint; mask: number }[];
}

/** ResourceCalculator::Calculate @0x9ee6e0 / @0x9ee510 / AddUsages @0x9ee380 + HaulResourceCalculator::Calculate @0x9ebfb0 */
export function resourceUsage(p: Project, withHauls = true, filter: (ws: Entity) => boolean = () => true): ResourceUsageResult {
  const sched = new Scheduler(p);
  const usage = new ResourceUsage(false, () => 0, (st) => {
    const par = p.get(st)?.get("m_pParent");
    return typeof par === "bigint" ? par : undefined;
  });
  const sms = refs(moveManager(p).get("m_vpSchedMoves")).map((o) => p.get(o)!);
  for (const site of sched.sites.values()) {
    const ws = site.entity;
    // `ResourceCalculator::Calculate(filtro, …)`: só as tarefas do filtro ativo da visão [O U-30]
    if (!filter(ws)) continue;
    if (site.strict) {
      for (const w of site.wps) usage.addCrew(site.crew, w.begin, w.end);
      continue;
    }
    for (const [bSource, mask, wk, vk] of [[true, SWGU.SEND, "m_pSrcWorkPlace", "m_pSourceWachVector"], [false, SWGU.RECEIVE, "m_pDstWorkPlace", "m_pDestinationWachVector"]] as const) {
      const crew = sched.crewFor(ws, mask);
      for (const m of sms) {
        const wp = p.resolve(m.get(wk) as Ref);
        if (!wp || wp.get("m_pWorkSite") !== ws.oid) continue;
        const slt = p.resolve(m.get("m_pSourceLandType") as Ref)!;
        const w = readWach(p.resolve(m.get(vk) as Ref)!);
        const rate = productionRate(p, ws, bSource, w.unit, slt);
        if (!(rate > 0)) continue;
        for (const s of w.spans) if (s.q > 0) usage.addCrew(crew, s.b, s.e, s.q / rate);
      }
    }
  }
  const impeded: ResourceUsageResult["impeded"] = [];
  if (withHauls)
    for (const m of sms) {
      const mask = haulClassMask(p, m);
      if (mask) {
        impeded.push({ move: m.oid, mask });
        continue;
      }
      const src = p.resolve(m.get("m_pSrcWorkPlace") as Ref)!, ws = p.resolve(src.get("m_pWorkSite") as Ref)!;
      // [O U-61f] `HaulResourceCalculator::Calculate@0x9ebfb0`: o transportador vem do SWGU_SEND da tarefa do work place
      // de origem (`GetTrackingID` = `GetSrcWorkPlace`, getter dobrado) e `AddUsage` recebe a sum task dessa mesma tarefa (L6);
      // veículos por span = ceil(q / w(d)); w(d) ≤ 0 → `logic_error("Division by zero attempted")`
      if (!filter(ws)) continue;
      const T = transporterOf(p, ws)!;
      const wd = wachAtDistance(table(T), moveDistance(p, m));
      for (const s of readWach(p.resolve(m.get("m_pSourceWachVector") as Ref)!).spans)
        if (s.q > 0 && s.e > s.b) usage.addResource(sched.sumTaskOf(ws), T.oid, vehiclesNeeded(s.q, wd), s.b, s.e);
    }
  const rootSum = p.root()!.get("m_pRootSumTask");
  return { usage, root: typeof rootSum === "bigint" ? rootSum : undefined, impeded };
}

/** GetPeakUsage @0x9ee7a0 e GetTotalHours @0x9ee7c0 sobre os spans de (sum task, recurso). */
export const peakUsage = (spans: readonly Span[]) => spans.reduce((m, s) => Math.max(m, s.q), 0);
export const totalHours = (spans: readonly Span[]) => spans.reduce((t, s) => t + (s.q * (s.e - s.b)) / 3600, 0);

/**
 * U-55 (D11) [O/I]: horas de trabalho da TAREFA, `(AS2WS(fim) − AS2WS(início))/3600` com início e fim da tarefa
 * (`HasTiming::GetBeginTime/GetEndTime` pela vbase), não a soma por work place (diferem quando há folga entre eles).
 */
function taskHours(site: Site): number {
  if (!site.wps.length) return 0;
  const b = Math.min(...site.wps.map((w) => w.begin)), e = Math.max(...site.wps.map((w) => w.end));
  return (site.calendar.AS2WS(e) - site.calendar.AS2WS(b)) / 3600;
}

/** ResourceCostHelpers::GetResourceCost @0x9eddf0 (movable, lado) e @0x9ee0f0 (outra tarefa). */
export function resourceCost(p: Project, ws: Entity, sendSide = true): number {
  const sched = new Scheduler(p);
  const site = sched.sites.get(ws.oid);
  if (!site) return 0;
  if (isOther(ws)) {
    const g = selectedGroup(p, ws, SWGU.OTHER);
    if (!g) return 0;
    const t = p.resolve(ws.get("m_pWorkType") as Ref);
    return taskHours(site) * pricePerHour(p, g) + sideAmount(p, ws, true) * (t ? pricePerUnit(g, t) : 0);
  }
  if (sendSide ? !isSource(ws) : !isDestination(ws)) return 0;
  const g = selectedGroup(p, ws, sendSide ? SWGU.SEND : SWGU.RECEIVE);
  if (!g) return 0;
  const type = sendSide ? sourceLandType(p, ws) : destLandType(p, ws);
  if (site.strict) {
    return taskHours(site) * pricePerHour(p, g) + sideAmount(p, ws, sendSide) * (type ? pricePerUnit(g, type) : 0);
  }
  let cost = 0;
  const [wk, vk] = sendSide ? ["m_pSrcWorkPlace", "m_pSourceWachVector"] : ["m_pDstWorkPlace", "m_pDestinationWachVector"];
  for (const o of refs(moveManager(p).get("m_vpSchedMoves"))) {
    const m = p.get(o)!;
    if (p.resolve(m.get(wk) as Ref)?.get("m_pWorkSite") !== ws.oid) continue;
    const slt = p.resolve(m.get("m_pSourceLandType") as Ref)!;
    const w = readWach(p.resolve(m.get(vk) as Ref)!);
    const rate = productionRate(p, ws, sendSide, w.unit, slt);
    const qty = w.total();
    if (rate > 0) cost += (qty / rate) * pricePerHour(p, g);
    if (type) cost += convertAmount(slt, qty, w.unit, siteUnit(p, ws, sendSide)) * pricePerUnit(g, type);
  }
  return cost;
}

// ---------- curva de massa do projeto (RF-036, RN-019) ----------

/**
 * MassIntegrator::AddWorkSite @0x5e9880 sobre as tarefas pedidas (padrão: todas as de movimento de terra da road
 * line), corte positivo e aterro negativo na unidade de aterro do projeto (m_pFillUnit); devolve os pontos (estaca,
 * massa acumulada) de GetIntegral @0x5e9c20, sem o sinal de tela.
 */
export function massCurve(p: Project, roadLine: bigint | null, sites?: Entity[]): [number, number][] {
  const fill = (p.root()!.get("m_pFillUnit") as bigint | null) ?? null;
  const map = new DensityMap();
  const list = sites ?? [...p.entities()].filter((e) => STRICT_CLASSES.has(e.className) || ["BorrowPit", "WasteLand", "StockPile", "CrushingPlant"].includes(e.className));
  for (const ws of list) {
    if (isOther(ws)) continue;
    for (const o of refs(ws.get("m_vpWorkPlaces"))) {
      const wp = p.get(o)!;
      const loc = p.resolve(wp.get("m_pLocation") as Ref);
      if (!loc || (roadLine !== null && loc.get("m_pRoadLine") !== roadLine)) continue;
      const b = num(loc.get("m_dStationBegin")), e = num(loc.get("m_dStationEnd")), c = num(loc.get("m_dStationCOG"));
      if (areEqual(b, e)) continue;
      for (const src of [true, false]) {
        if (src ? !isSourceAmount(ws) : !isDestinationAmount(ws)) continue;
        const t = src ? sourceLandType(p, ws) : destLandType(p, ws);
        const q = num(wp.get(src ? "m_dSourceAmount" : "m_dDestinationAmount"));
        const m = t && fill !== null ? convertAmount(t, q, siteUnit(p, ws, src), fill) : q;
        if (!areEqual(m, 0)) addWorkPlaceMass(map, b, c, e, src ? m : -m);
      }
    }
  }
  return integral(map);
}
