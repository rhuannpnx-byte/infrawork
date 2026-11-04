/**
 * Realizados do `ImplManager` (U-53): transportes realizados (`ImplUtilization`), recriação das utilizações e remoção
 * de apontamentos. Evidência: analises/2026-10-11_dynaroad/handoff/docs/motor_controle_u52_u55.md §2,
 * analise_controle_u11.md §2.2/§7 e handoff/funcoes/24_motor_controle/ (ImplManager_*, ImplInfo_*, ImplUtilization*).
 *
 * - [O] `CreateUtilizations@0x95a450`: casamento guloso das quantidades por work place dos dois apontamentos
 *   (`GetActualHaulQuantitiesForTaskLocations`), cada passo com o menor dos dois restos e o total pedido; utilização
 *   criada só se o passo ≥ 1e-5 (`IsGreaterThanOrEqual`).
 * - [O] `ImplInfo::AddUtilization@0x9553c0`: work place de um dos lados do apontamento; quantidade > 0; livre =
 *   quantidade − utilizado, `DoubleToInt(livre) < DoubleToInt(q)` → exceção; a utilização fica com min(q, livre).
 * - [O] `ImplInfo::RemoveUtilization@0x955ef0`: tira dos dois apontamentos e apaga; com `encolher`, o apontamento
 *   automático passa a ter a quantidade utilizada.
 * - [O] `ImplManager::RecreateUtilizations@0x95bd70` + `ImplUtilizationRecreator@0x9fc820`: fecho de um salto
 *   (entrada ∪ tarefas parceiras diretas), soma das utilizações dos `ImplInfo` do usuário por par de apontamentos,
 *   apaga e recria pelo casamento guloso (soma > 0,001), depois `RemoveEmptyActuals@0x95c680`. [O U-61f, P-3] a assinatura
 *   reparada de `CreateInfoMovesAndRemoveUtils@0x9fbbf0` confirma o mapa `tuple<infoO, infoD, set<materiais>> →
 *   map<((tarefaO, lowO), (tarefaD, lowD)), Quantity>` (`MoveInfosLess`); com um material por apontamento dá o mesmo.
 * - [O] `UtilizationRecreationPostponer`: dentro de `postponeRecreation`, as recriações juntam as tarefas sujas e rodam
 *   uma vez no fim.
 * - [I] unidade da utilização: a do apontamento de origem (`ConvertAmount(q, unidade do info1)`); o utilizado do
 *   apontamento de destino é convertido pelo material.
 * - [I] sem rota entre os work places, a utilização fica sem `Path` (o original usa o `DistanceCalculator` do
 *   `ImplManager`, `MakeImplDistanceCalculator`, não lido).
 */
import type { Entity, Project, Ref } from "@apex/model";
import { encodeContainer } from "@apex/model";
import { ActualsContext, actualsOf, implManager } from "./actuals.js";
import { convertAmount, isDestination, isSource } from "./costs.js";
import { DistanceCalculator, type LightPath } from "./distances.js";
import { siteUnit } from "./plan.js";

export class ImplError extends Error {
  constructor(
    readonly code:
      | "SOURCE_AND_DESTINATION_ARE_THE_SAME" | "AMOUNT_LESS_THAN_OR_EQUAL_ZERO" | "AUTOMATICALLY_GENERATED_IMPLEMENTATION_IS_UNEDITABLE"
      | "UTILIZATION_IS_TOO_LARGE_FOR_IMPLEMENTATION" | "START_END_MISMATCH" | "UNRELATED_HAUL" | "AMOUNT_OUT_OF_RANGE" | "TASK_FINISHED",
    message: string,
  ) {
    super(message);
    this.name = "ImplError";
  }
}

/** Mensagens do original (excecoes_ids.tsv / strings_ui_en.txt) [O]. */
export const IMPL_MSG = {
  SAME: "The source and destination cannot be the same tasks.", // 14625
  AMOUNT: "Quantity has to be greater than zero.", // 14029
  AUTO: "Failed to modify an automatically created actual.", // 14044
  TOO_LARGE: "The total quantity of actual hauls is greater than the quantity of the actual.", // 14717
  FINISHED: "Task %1% is marked finished and its actuals cannot be edited.", // 14781
} as const;

/** Rótulos de undo [O]. */
export const IMPL_OP = {
  ADD_HAUL: "Add actual haul", // 14715
  EDIT_HAUL: "Edit actual haul", // 14716
  REMOVE_HAUL: "Remove actual haul", // 14718
  REMOVE_ACTUAL: "Remove actual", // 14323
} as const;

const EPS = 8.881784197001252e-16;
const areEqual = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * EPS;
const isLessThanOrEqual = (a: number, b: number) => a < b || areEqual(a, b);
const isGreaterThanOrEqual = (a: number, b: number) => a > b || areEqual(a, b);
const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);
const pairs = (v: unknown) => (Array.isArray(v) ? (v as [unknown, unknown][]) : []);
const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
const setList = (e: Entity, member: string, items: bigint[]) => e.setRaw(member, encodeContainer(0x18, items));
const moveManager = (p: Project) => p.resolve(p.root()!.get("m_pMoveManager") as Ref)!;
const siteOf = (p: Project, a: Entity) => p.resolve(a.get("m_pWorkSite") as Ref);
const wpSite = (p: Project, wp: Entity | undefined) => (wp ? p.resolve(wp.get("m_pWorkSite") as Ref) : undefined);
const infoIsSource = (a: Entity) => a.get("m_bSource") !== false;
const userMade = (a: Entity) => a.get("m_bUserMade") !== false;
const refMap = (entries: [bigint, bigint][]) =>
  entries.length
    ? { kind: "map" as const, type: 0x15, keyType: 0x18, valueType: 0x18, entries: entries.map(([k, v]) => [{ kind: "bigint" as const, type: 0x18, value: k }, { kind: "bigint" as const, type: 0x18, value: v }]) }
    : { kind: "map" as const, type: 0x15, keyType: null, valueType: null, entries: [] };

// ---------- consultas ----------

/** `ImplInfo::m_vpUtilizations` */
export const utilizationsOf = (p: Project, info: Entity): Entity[] => refs(info.get("m_vpUtilizations")).map((o) => p.get(o)).filter((u): u is Entity => !!u);

/** `ImplInfo::GetUtilizedAmount`: soma das utilizações, na unidade do apontamento [I conversão no destino]. */
export function utilizedAmount(p: Project, info: Entity): number {
  let s = 0;
  for (const u of utilizationsOf(p, info)) s += num(u.get("m_dAmount"));
  if (infoIsSource(info)) return s;
  const ws = siteOf(p, info), slt = p.resolve(info.get("m_pSourceLandType") as Ref);
  const src = p.resolve(utilizationsOf(p, info)[0]?.get("m_pSourceInfo") as Ref);
  const srcWs = src && siteOf(p, src);
  return ws && slt && srcWs ? convertAmount(slt, s, siteUnit(p, srcWs, true), siteUnit(p, ws, false)) : s;
}

/** `ImplUtilizationHelpers::GetUserMadeInfo` / `GetOtherInfo` */
export function utilizationInfos(p: Project, u: Entity): { source: Entity | undefined; destination: Entity | undefined } {
  return { source: p.resolve(u.get("m_pSourceInfo") as Ref), destination: p.resolve(u.get("m_pDestinationInfo") as Ref) };
}

// ---------- postponer ----------

const postponed = new WeakMap<Project, { depth: number; dirty: Set<bigint> | "all" | null }>();

/** `UtilizationRecreationPostponer`: as recriações pedidas dentro de `fn` rodam uma vez no fim [O]. */
export function postponeRecreation<T>(p: Project, fn: () => T): T {
  const st = postponed.get(p) ?? { depth: 0, dirty: null };
  postponed.set(p, st);
  st.depth++;
  try {
    return fn();
  } finally {
    st.depth--;
    if (st.depth === 0) {
      const dirty = st.dirty;
      st.dirty = null;
      if (dirty) recreateNow(p, dirty === "all" ? undefined : dirty);
    }
  }
}

// ---------- utilizações ----------

function storePath(p: Project, path: LightPath | null): bigint | null {
  if (!path) return null;
  const e = p.create("Path");
  e.set("m_strName", "");
  e.set("m_strLongName", "");
  e.set("m_pUIInfo", null);
  e.setRaw("m_vpPlaces_OLD", encodeContainer(0x18, []));
  e.set("m_dLength", path.length);
  setList(e, "m_vpNodes", path.nodes.map((n) => {
    const x = p.create("Node");
    x.set("m_strName", "");
    x.set("m_strLongName", "");
    x.set("m_pUIInfo", null);
    x.set("m_pRoadConnection", n.roadConnection ?? null);
    x.set("m_bRoadConnectionFrom", n.from ?? false);
    x.set("m_pWorkPlace", n.workPlace ?? null);
    return x.oid;
  }));
  return e.oid;
}

/** `ImplInfo::AddUtilization(other, q, srcWP, dstWP, dc)@0x9553c0` sobre o apontamento de origem `src`. */
export function addUtilization(p: Project, src: Entity, dst: Entity, q: number, srcWp: Entity, dstWp: Entity, dc: DistanceCalculator): Entity {
  const ws = siteOf(p, src);
  if (wpSite(p, srcWp)?.oid !== ws?.oid && wpSite(p, dstWp)?.oid !== ws?.oid) throw new ImplError("UNRELATED_HAUL", "unrelated haul");
  if (isLessThanOrEqual(q, 0)) throw new ImplError("AMOUNT_LESS_THAN_OR_EQUAL_ZERO", IMPL_MSG.AMOUNT);
  const free = num(src.get("m_dAmount")) - utilizedAmount(p, src);
  if (Math.round(free) < Math.round(q)) throw new ImplError("AMOUNT_OUT_OF_RANGE", "amount out of range"); // Tools::DoubleToInt [I arredonda]
  let path: LightPath | null = null;
  try {
    path = dc.path(srcWp.oid, dstWp.oid);
  } catch {
    path = null; // [I] sem rota
  }
  const u = p.create("ImplUtilization");
  u.set("m_strName", "");
  u.set("m_strLongName", "");
  u.set("m_pUIInfo", null);
  u.set("m_pSrcWorkPlace", srcWp.oid);
  u.set("m_pDstWorkPlace", dstWp.oid);
  u.set("m_pSourceLandType", (src.get("m_pSourceLandType") as bigint | null) ?? null);
  u.set("m_pPath", storePath(p, path));
  u.set("m_bManual", false);
  u.set("m_bActual", true);
  u.set("m_dAmount", Math.min(q, free));
  u.set("m_pSourceInfo", src.oid);
  u.set("m_pDestinationInfo", dst.oid);
  const mm = moveManager(p);
  setList(mm, "m_utilizations", [...refs(mm.get("m_utilizations")), u.oid]);
  setList(src, "m_vpUtilizations", [...refs(src.get("m_vpUtilizations")), u.oid]);
  setList(dst, "m_vpUtilizations", [...refs(dst.get("m_vpUtilizations")), u.oid]);
  return u;
}

/** `GetActualHaulQuantitiesForTaskLocations`: (work place, quantidade) do apontamento, na ordem dos work places [I ordem]. */
function haulQuantities(p: Project, ac: ActualsContext, info: Entity): [Entity, number][] {
  const ws = siteOf(p, info);
  const q = ac.actualQuantities(info);
  return refs(ws?.get("m_vpWorkPlaces")).flatMap((o) => (q.has(o) ? [[p.get(o)!, q.get(o)!] as [Entity, number]] : []));
}

/** `ImplManager::CreateUtilizations(info1, info2, q, dc)@0x95a450` [O]; `q` na unidade do apontamento de origem. */
export function createUtilizations(p: Project, src: Entity, dst: Entity, q: number, dc = new DistanceCalculator(p, {})): Entity[] {
  const ac = new ActualsContext(p);
  const S = haulQuantities(p, ac, src), D = haulQuantities(p, ac, dst);
  const slt = p.resolve(src.get("m_pSourceLandType") as Ref);
  const srcWs = siteOf(p, src)!, dstWs = siteOf(p, dst)!;
  const conv = (x: number, from: bigint, to: bigint) => (slt ? convertAmount(slt, x, from, to) : x);
  const uSrc = siteUnit(p, srcWs, true), uDst = siteUnit(p, dstWs, false);
  const out: Entity[] = [];
  let usedS = 0, usedD = 0, i = 0, j = 0, rest = q;
  while (i < S.length && j < D.length) {
    const [wpS, qS] = S[i]!, [wpD, qD0] = D[j]!;
    const qD = conv(qD0, uDst, uSrc);
    const a = Math.min(qS - usedS, rest), b = Math.min(qD - usedD, rest);
    let step: number;
    if (a < b) {
      step = a;
      usedS = 0;
      i++;
      usedD += step;
    } else {
      step = b;
      usedD = 0;
      j++;
      usedS += step;
    }
    rest -= step;
    if (isGreaterThanOrEqual(step, 1e-5)) out.push(addUtilization(p, src, dst, step, wpS, wpD, dc));
  }
  return out;
}

/** `ImplInfo::RemoveUtilization(u, encolher)@0x955ef0` [O]: também sai de `MoveManager::m_utilizations` [I]. */
export function removeUtilization(p: Project, u: Entity, shrink: boolean): void {
  const { source, destination } = utilizationInfos(p, u);
  for (const info of [source, destination]) if (info) setList(info, "m_vpUtilizations", refs(info.get("m_vpUtilizations")).filter((o) => o !== u.oid));
  const mm = moveManager(p);
  setList(mm, "m_utilizations", refs(mm.get("m_utilizations")).filter((o) => o !== u.oid));
  const path = p.resolve(u.get("m_pPath") as Ref);
  if (path) {
    for (const n of refs(path.get("m_vpNodes"))) if (p.get(n)) p.remove(p.get(n)!);
    p.remove(path);
  }
  p.remove(u);
  if (shrink) {
    const auto = [source, destination].find((x) => x && !userMade(x));
    if (auto) auto.set("m_dAmount", utilizedAmount(p, auto));
  }
}

/** `MoveManager::RemoveActualLPAndSchedMoves(ws)@0x94f880`: LPMove e SchedMove realizados que tocam a tarefa [O]. */
export function removeActualLPAndSchedMoves(p: Project, ws: Entity): number {
  const mm = moveManager(p);
  let n = 0;
  for (const list of ["m_vpLPMoves", "m_vpSchedMoves"]) {
    const keep: bigint[] = [];
    for (const o of refs(mm.get(list))) {
      const m = p.get(o);
      if (!m) continue;
      const touches = m.get("m_bActual") === true && [m.get("m_pSrcWorkPlace"), m.get("m_pDstWorkPlace")].some((w) => wpSite(p, p.resolve(w as Ref))?.oid === ws.oid);
      if (!touches) {
        keep.push(o);
        continue;
      }
      const path = p.resolve(m.get("m_pPath") as Ref);
      if (path) {
        for (const x of refs(path.get("m_vpNodes"))) if (p.get(x)) p.remove(p.get(x)!);
        p.remove(path);
      }
      for (const k of ["m_pSourceWachVector", "m_pDestinationWachVector"]) {
        const w = m.has(k) ? p.resolve(m.get(k) as Ref) : undefined;
        if (w) p.remove(w);
      }
      p.remove(m);
      n++;
    }
    if (keep.length !== refs(mm.get(list)).length) setList(mm, list, keep);
  }
  return n;
}

// ---------- recriação ----------

const sitesWithInfos = (p: Project) => new Set(pairs(implManager(p).get("m_mpImplInfos")).map(([k]) => k as bigint));

/**
 * `ImplManager::RecreateUtilizations(dc, set)@0x95bd70` [O]: conjunto vazio = todas as tarefas com `ImplInfo`; com o
 * postponer ativo só marca as tarefas.
 */
export function recreateUtilizations(p: Project, sites?: Iterable<bigint>): void {
  const st = postponed.get(p);
  if (st && st.depth > 0) {
    if (!sites) st.dirty = "all";
    else if (st.dirty !== "all") {
      st.dirty ??= new Set();
      for (const s of sites) st.dirty.add(s);
    }
    return;
  }
  recreateNow(p, sites ? new Set(sites) : undefined);
}

function recreateNow(p: Project, sites: Set<bigint> | undefined): void {
  const set = sites && sites.size ? sites : sitesWithInfos(p);
  // CalculateUtilizationClosure: um salto (o laço percorre o conjunto de entrada) [O ASM 0x9fbbcb]
  const closure = new Set(set);
  for (const s of set) {
    const ws = p.get(s);
    if (!ws) continue;
    for (const info of actualsOf(p, ws))
      for (const u of utilizationsOf(p, info))
        for (const k of ["m_pSrcWorkPlace", "m_pDstWorkPlace"]) {
          const t = wpSite(p, p.resolve(u.get(k) as Ref));
          if (t) closure.add(t.oid);
        }
  }
  // CreateInfoMovesAndRemoveUtils: só os ImplInfo do usuário; soma por par de apontamentos e apaga as utilizações
  const sums = new Map<string, { src: Entity; dst: Entity; q: number }>();
  const seen = new Set<bigint>();
  for (const s of closure) {
    const ws = p.get(s);
    if (!ws || ws.className === "OtherWorkSite") continue;
    for (const info of actualsOf(p, ws)) {
      if (!userMade(info)) continue;
      for (const u of utilizationsOf(p, info)) {
        if (seen.has(u.oid)) continue;
        seen.add(u.oid);
        const { source, destination } = utilizationInfos(p, u);
        if (source && destination) {
          const k = `${source.oid}:${destination.oid}`;
          const cur = sums.get(k);
          if (cur) cur.q += num(u.get("m_dAmount"));
          else sums.set(k, { src: source, dst: destination, q: num(u.get("m_dAmount")) });
        }
        removeUtilization(p, u, false);
      }
    }
  }
  // CreateUtilizationsFromInfoMoves: soma > 0,001 → CreateUtilizations [O]
  const dc = new DistanceCalculator(p, {});
  for (const { src, dst, q } of sums.values()) if (q > 0.001 && p.get(src.oid) && p.get(dst.oid)) createUtilizations(p, src, dst, q, dc);
  removeEmptyActuals(p);
}

// ---------- remoção ----------

/** `ImplManager::RemoveOtherActual(a, reabrir)@0x95cc50` [O]: sai do multimap; reabre a tarefa encerrada. */
export function removeOtherActual(p: Project, a: Entity, reopen: boolean): void {
  const im = implManager(p);
  const list = pairs(im.get("m_otherActuals")).map(([k, v]) => [k as bigint, v as bigint] as [bigint, bigint]);
  im.setRaw("m_otherActuals", refMap(list.filter(([, v]) => v !== a.oid)) as never);
  const ws = siteOf(p, a);
  p.remove(a);
  if (reopen && ws?.get("m_bFinished") === true) ws.set("m_bFinished", false);
}

/**
 * `ImplManager::RemoveImplementation(dc, info, reabrir)@0x95c910` [O]: sai do multimap e é apagado (as utilizações
 * dele saem, o automático do outro lado encolhe [I ~ImplInfo]); `RemoveActualLPAndSchedMoves(tarefa)`; reabre a tarefa
 * encerrada se pedido; quantidade > 0 → `RecreateUtilizations({tarefa})`.
 */
export function removeImplementation(p: Project, info: Entity, reopen: boolean): void {
  const ws = siteOf(p, info);
  const amount = num(info.get("m_dAmount"));
  const im = implManager(p);
  const list = pairs(im.get("m_mpImplInfos")).map(([k, v]) => [k as bigint, v as bigint] as [bigint, bigint]);
  im.setRaw("m_mpImplInfos", refMap(list.filter(([, v]) => v !== info.oid)) as never);
  for (const u of utilizationsOf(p, info)) removeUtilization(p, u, true);
  p.remove(info);
  if (!ws) return;
  removeActualLPAndSchedMoves(p, ws);
  if (reopen && ws.get("m_bFinished") === true) ws.set("m_bFinished", false);
  if (amount > 0) recreateUtilizations(p, [ws.oid]);
}

/** `ImplManager::RemoveEmptyActuals@0x95c680` [O]: ImplInfo e OtherActual com quantidade ≤ 0, sem reabrir. */
export function removeEmptyActuals(p: Project): void {
  const im = implManager(p);
  for (const [, v] of pairs(im.get("m_otherActuals"))) {
    const a = p.get(v as bigint);
    if (a && isLessThanOrEqual(num(a.get("m_dAmount")), 0)) removeOtherActual(p, a, false);
  }
  for (const [, v] of pairs(im.get("m_mpImplInfos"))) {
    const a = p.get(v as bigint);
    if (a && isLessThanOrEqual(num(a.get("m_dAmount")), 0)) removeImplementation(p, a, false);
  }
}

/** Remove all actuals (36076): `RemoveAllActualsCommand@0x5bb930` → `RemoveAllActuals(true)@0x95c440` [O], rótulo 14323. */
export function removeAllActuals(p: Project): void {
  p.edit(IMPL_OP.REMOVE_ACTUAL, () => removeAllActualsIn(p, true));
}
export function removeAllActualsIn(p: Project, reopen: boolean): void {
  postponeRecreation(p, () => {
    const im = implManager(p);
    for (const o of refs(im.get("m_spActualsLockings"))) if (p.get(o)) p.remove(p.get(o)!); // [I] o objeto sai junto
    setList(im, "m_spActualsLockings", []);
    for (const [, v] of pairs(im.get("m_otherActuals"))) if (p.get(v as bigint)) removeOtherActual(p, p.get(v as bigint)!, false);
    for (const [, v] of pairs(im.get("m_mpImplInfos"))) if (p.get(v as bigint)) removeImplementation(p, p.get(v as bigint)!, false);
    if (reopen) for (const ws of p.entities()) if (ws.get("m_bFinished") === true && ws.has("m_vpWorkPlaces")) ws.set("m_bFinished", false);
  });
}

const DAY = 86400;
/**
 * Remove actuals in timespan (36075, 13049): `RemoveActualsInTimeSpan(from, to, set)@0x95c080` [O]: `from` no início do
 * dia, `to` no início do dia + 86 399 s; sai o apontamento com fim ≥ from e início ≤ to, reabrindo a tarefa.
 */
export function removeActualsInTimeSpan(p: Project, from: number, to: number, sites: readonly Entity[]): number {
  let n = 0;
  p.edit(IMPL_OP.REMOVE_ACTUAL, () => {
    n = removeActualsInTimeSpanIn(p, from, to, sites);
  });
  return n;
}
export function removeActualsInTimeSpanIn(p: Project, from: number, to: number, sites: readonly Entity[]): number {
  const f = Math.floor(from / DAY) * DAY, t = Math.floor(to / DAY) * DAY + DAY - 1;
  let n = 0;
  postponeRecreation(p, () => {
    for (const ws of sites)
      for (const a of actualsOf(p, ws)) {
        if (!p.get(a.oid)) continue;
        const b = Number(a.get("m_dateBegin") ?? 0), e = Number(a.get("m_dateEnd") ?? 0);
        if (!(e >= f && b <= t)) continue;
        if (a.className === "OtherActual") removeOtherActual(p, a, true);
        else removeImplementation(p, a, true);
        n++;
      }
  });
  return n;
}

// ---------- transporte realizado (ER-2) ----------

export interface ActualHaulInput {
  /** apontamento do usuário de onde o diálogo foi aberto */
  info: Entity;
  /** quantidade na unidade do apontamento */
  amount: number;
  source: Entity;
  sourceLow: boolean;
  destination: Entity;
  destinationLow: boolean;
  /** utilização editada (Edit actual haul) */
  utilization?: Entity;
}

/**
 * `ImplManager::AddActualHaul@0x959920` (REPARADO em evidencias/decompilado/u61f_motor/repair_lote1/, U-61f: P-5 fechada) [O]:
 * valida, remove a utilização antiga (edição; o apontamento do usuário é o `info` ou, se o outro lado for do usuário, ele),
 * `RemoveActualLPAndSchedMoves` dos dois lados, `AddImplementationImpl(tarefa do outro lado, info.begin, info.end,
 * quantidade convertida, info.tipo, low = rádio do outro lado, userMade = false)` e `CreateUtilizations(origem, destino, q)`
 * + `AddIds(materiais)`.
 */
export function addActualHaulIn(p: Project, h: ActualHaulInput): Entity[] {
  const { info } = h;
  if (h.source.oid === h.destination.oid) throw new ImplError("SOURCE_AND_DESTINATION_ARE_THE_SAME", IMPL_MSG.SAME);
  if (isLessThanOrEqual(h.amount, 0)) throw new ImplError("AMOUNT_LESS_THAN_OR_EQUAL_ZERO", IMPL_MSG.AMOUNT);
  const ws = siteOf(p, info)!;
  const isSrc = infoIsSource(info);
  const low = info.get("m_bLow") === true;
  if ((isSrc && (h.source.oid !== ws.oid || h.sourceLow !== low)) || (!isSrc && (h.destination.oid !== ws.oid || h.destinationLow !== low)))
    throw new ImplError("START_END_MISMATCH", isSrc ? "src start end mismatch" : "dst start end mismatch");
  if (!userMade(info)) throw new ImplError("AUTOMATICALLY_GENERATED_IMPLEMENTATION_IS_UNEDITABLE", IMPL_MSG.AUTO);
  const old = h.utilization ? num(h.utilization.get("m_dAmount")) : 0;
  const oldInInfo = h.utilization && !isSrc ? utilizedAmountOf(p, info, [h.utilization]) : old;
  if (utilizedAmount(p, info) - oldInInfo + h.amount - num(info.get("m_dAmount")) > 0.1) throw new ImplError("UTILIZATION_IS_TOO_LARGE_FOR_IMPLEMENTATION", IMPL_MSG.TOO_LARGE);
  if (h.utilization) {
    if (!isUtilChanged(p, h)) return [h.utilization];
    removeUtilization(p, h.utilization, true);
  }
  removeActualLPAndSchedMoves(p, h.source);
  removeActualLPAndSchedMoves(p, h.destination);
  const otherWs = isSrc ? h.destination : h.source;
  const slt = p.resolve(info.get("m_pSourceLandType") as Ref);
  const qOther = slt ? convertAmount(slt, h.amount, siteUnit(p, ws, isSrc), siteUnit(p, otherWs, !isSrc)) : h.amount;
  const other = p.create("ImplInfo");
  other.set("m_strName", "");
  other.set("m_strLongName", "");
  other.set("m_pUIInfo", null);
  other.set("m_pImplManager", implManager(p).oid);
  other.set("m_pWorkSite", otherWs.oid);
  other.set("m_dateBegin", info.get("m_dateBegin") as bigint);
  other.set("m_dateEnd", info.get("m_dateEnd") as bigint);
  other.set("m_bLow", isSrc ? h.destinationLow : h.sourceLow);
  other.set("m_dAmount", qOther);
  other.set("m_pSourceLandType", slt?.oid ?? null);
  other.setRaw("m_vpUtilizations", encodeContainer(0x18, []));
  other.set("m_bUserMade", false);
  other.set("m_bSource", !isSrc);
  const im = implManager(p);
  im.setRaw("m_mpImplInfos", refMap([...pairs(im.get("m_mpImplInfos")).map(([k, v]) => [k as bigint, v as bigint] as [bigint, bigint]), [otherWs.oid, other.oid]]) as never);
  const [src, dst] = isSrc ? [info, other] : [other, info];
  const qSrc = isSrc ? h.amount : qOther;
  return createUtilizations(p, src, dst, qSrc);
}
const utilizedAmountOf = (p: Project, info: Entity, us: Entity[]) => {
  const s = us.reduce((t, u) => t + num(u.get("m_dAmount")), 0);
  if (infoIsSource(info)) return s;
  const src = p.resolve(us[0]?.get("m_pSourceInfo") as Ref), slt = p.resolve(info.get("m_pSourceLandType") as Ref);
  return src && slt ? convertAmount(slt, s, siteUnit(p, siteOf(p, src)!, true), siteUnit(p, siteOf(p, info)!, false)) : s;
};
/** `IsUtilChanged` [I]: quantidade, tarefas e sentidos iguais aos da utilização. */
function isUtilChanged(p: Project, h: ActualHaulInput): boolean {
  const u = h.utilization!;
  const { source, destination } = utilizationInfos(p, u);
  const same = source && destination && siteOf(p, source)?.oid === h.source.oid && siteOf(p, destination)?.oid === h.destination.oid
    && (source.get("m_bLow") === true) === h.sourceLow && (destination.get("m_bLow") === true) === h.destinationLow
    && areEqual(infoIsSource(h.info) ? num(u.get("m_dAmount")) : utilizedAmountOf(p, h.info, [u]), h.amount);
  return !same;
}

/** Add/Edit actual haul (`AddOrUpdateUtilizationCommand@0x556e30`): um nível 14715 (novo) ou 14716 (edição) [O]. */
export function addActualHaul(p: Project, h: ActualHaulInput): Entity[] {
  let r: Entity[] = [];
  p.edit(h.utilization ? IMPL_OP.EDIT_HAUL : IMPL_OP.ADD_HAUL, () => (r = addActualHaulIn(p, h)));
  return r;
}

/**
 * Remove actual haul (`WorkSiteImplDlg::OnButtonRemoveUtil@0x6e3440` → `RemoveUtilizationsCommand` →
 * `RemoveActualHauls(set)@0x95bf40`) [O]: tarefa encerrada num dos lados → 14781 (a do destino, se encerrada; senão a da
 * origem) e nada muda; senão `GetUserMadeInfo(u).RemoveUtilization(u, true)` (o automático encolhe).
 */
export function removeActualHaulsIn(p: Project, us: readonly Entity[]): void {
  for (const u of us) {
    const dst = wpSite(p, p.resolve(u.get("m_pDstWorkPlace") as Ref)), src = wpSite(p, p.resolve(u.get("m_pSrcWorkPlace") as Ref));
    const fin = dst?.get("m_bFinished") === true ? dst : src?.get("m_bFinished") === true ? src : undefined;
    if (fin) throw new ImplError("TASK_FINISHED", IMPL_MSG.FINISHED.replace("%1%", fin.name));
  }
  postponeRecreation(p, () => {
    for (const u of us) if (p.get(u.oid)) removeUtilization(p, u, true);
  });
}
export function removeActualHauls(p: Project, us: readonly Entity[]): void {
  p.edit(IMPL_OP.REMOVE_HAUL, () => removeActualHaulsIn(p, us));
}

/** Tarefas do outro lado oferecidas no 13010 (`GetSourceWorkSites`/`GetDestinationWorkSites`) [I: as que podem mandar/receber]. */
export function haulPartners(p: Project, info: Entity): Entity[] {
  const want = infoIsSource(info) ? isDestination : isSource;
  const ws = siteOf(p, info);
  return [...p.entities()].filter((e) => e.has("m_vpWorkPlaces") && e.className !== "OtherWorkSite" && e.oid !== ws?.oid && want(e));
}
