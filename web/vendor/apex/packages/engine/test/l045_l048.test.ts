// L-045 e L-048 (U-20): travamento de realizados em tarefas com vários work places e LP com massa realizada travada.
// Evidência: analises/2026-10-11_dynaroad/handoff/docs/analise_realizados_l045_l048.md §3–§5 (LockActuals @0x95b130
// reparado, SplitAtCompletionBoundaries @0x988ce0, SplitWorkPlaceAtWorkSitePortion @0x92a560, PlanLom::Solve,
// ScheduleLom::Solve, AmountTracker/RateTracker::SubtractActuals @0xa0fbc0/@0xa00850, GetHaulChainCandidates @0x9d17b0).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDr5, writeContainer } from "../../dr5/src/index.js";
import { FIXTURES } from "../../dr5/test/helpers.js";
import { Project, type Entity } from "../../model/src/index.js";
import { ActualsContext, addActual, determineNewCOGs, lockActuals, planOptimize, Scheduler, scheduleOptimize, setFinished, setToEndOfDay, splitWorkPlace, wpTimes } from "../src/index.js";

const load = () => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")))));
const n = (v: unknown) => (typeof v === "number" ? v : 0);
const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);
const DAY = 86400;
const wps = (p: Project, ws: Entity) => refs(ws.get("m_vpWorkPlaces")).map((o) => p.get(o)!);
const src = (w: Entity) => n(w.get("m_dSourceAmount"));
const mm = (p: Project) => p.get(p.root()!.get("m_pMoveManager") as bigint)!;
const moves = (p: Project, list: string) => refs(mm(p).get(list)).map((o) => p.get(o)!);
const siteOf = (p: Project, wpOid: unknown) => p.get(p.get(wpOid as bigint)!.get("m_pWorkSite") as bigint)!;

/** transporte apontado 166 (LandCut 2) → 179 (Fill 1), com os dois work places inteiros executados */
function executedHaul(p: Project, amount = 1000): number {
  const t0 = wpTimes(p.get(166n)!).begin;
  const si = addActual(p, { workSite: p.get(164n)!, begin: t0, end: t0 + 3 * DAY, amount: src(p.get(166n)!), low: true, source: true });
  const di = addActual(p, { workSite: p.get(177n)!, begin: t0, end: t0 + 3 * DAY, amount: n(p.get(179n)!.get("m_dDestinationAmount")), low: true, source: false });
  p.edit("utilização", () => {
    const u = p.create("ImplUtilization");
    for (const [k, v] of Object.entries({ m_strName: "", m_strLongName: "", m_pUIInfo: null, m_pSrcWorkPlace: 166n, m_pDstWorkPlace: 179n, m_pSourceLandType: si.get("m_pSourceLandType"), m_pPath: null, m_bManual: false, m_bActual: true, m_dAmount: amount, m_pSourceInfo: si.oid, m_pDestinationInfo: di.oid }))
      u.set(k, v as never);
    mm(p).setRaw("m_utilizations", { kind: "container", type: 0x14, elemType: 0x18, items: [{ kind: "bigint", type: 0x18, value: u.oid }] } as never);
  });
  return t0;
}
const lockInLP = (p: Project) => p.edit("travar no LP", () => mm(p).set("m_bActualsLockedInLP", true));

describe("L-045 LockActuals em tarefa com vários work places", () => {
  it("apontamento que cobre exatamente o 1º work place: trava só ele, com as datas do TaskActuals, sem corte", () => {
    const p = load();
    const ws = p.get(142n)!; // LandCut 1: 158 [0, 300] 10.900 e 210 [300, 600] 13.100
    const t0 = wpTimes(p.get(158n)!).begin;
    addActual(p, { workSite: ws, begin: t0, end: t0 + 2 * DAY, amount: 10900, low: true, source: true });
    const r = lockActuals(p);
    expect(r.locked).toEqual([158n]);
    expect(wps(p, ws).map((w) => w.oid)).toEqual([158n, 210n]);
    expect(p.get(210n)!.get("m_bLockedAsActual")).not.toBe(true);
    const { begin, end } = wpTimes(p.get(158n)!);
    expect(begin).toBe(t0);
    expect(end).toBeGreaterThan(t0);
    expect(end).toBeLessThanOrEqual(t0 + 2 * DAY);
    expect(() => Project.fromDr5(readDr5(writeContainer(p.toDpl())))).not.toThrow();
  });
  it("execução parcial no sentido baixo: corta na fronteira (pedaço novo antes) e trava o executado", () => {
    const p = load();
    const ws = p.get(142n)!;
    const t0 = wpTimes(p.get(158n)!).begin;
    addActual(p, { workSite: ws, begin: t0, end: t0 + DAY, amount: 5000, low: true, source: true });
    const r = lockActuals(p);
    const list = wps(p, ws);
    expect(list.length).toBe(3);
    expect(list[1]!.oid).toBe(158n);
    expect(src(list[0]!)).toBeCloseTo(5000, 6);
    expect(src(list[1]!)).toBeCloseTo(5900, 6);
    expect(list.reduce((s, w) => s + src(w), 0)).toBeCloseTo(24000, 6);
    expect(r.locked).toEqual([list[0]!.oid]);
    expect(p.get(158n)!.get("m_bLockedAsActual")).not.toBe(true);
  });
  it("execução parcial no sentido alto: corte em 1 − p; trava o trecho alto e a tarefa passa ao sentido alto", () => {
    const p = load();
    const ws = p.get(142n)!;
    const t0 = wpTimes(p.get(210n)!).begin;
    addActual(p, { workSite: ws, begin: t0, end: t0 + DAY, amount: 3000, low: false, source: true });
    const r = lockActuals(p);
    const list = wps(p, ws);
    expect(list.map((w) => w.oid).slice(-1)).toEqual([210n]);
    expect(list.length).toBe(3);
    expect(src(list[1]!)).toBeCloseTo(10100, 6);
    expect(src(p.get(210n)!)).toBeCloseTo(3000, 6);
    expect(r.locked).toEqual([210n]);
    expect(ws.get("m_bLow")).toBe(false);
  });
  it("tarefa não estrita (bota-fora): só estende o período do único work place", () => {
    const p = load();
    const ws = p.get(254n)!, wp = p.get(256n)!;
    const before = wpTimes(wp);
    const b = before.begin - 5 * DAY, e = before.end + 5 * DAY;
    addActual(p, { workSite: ws, begin: b, end: e, amount: 100, low: true, source: false });
    const r = lockActuals(p);
    expect(r.locked).toEqual([]);
    const after = wpTimes(p.get(256n)!);
    // U-54 (L-016) [O]: o recálculo também roda nas não estritas: início = max(desejada, início do projeto) e o work place
    // mantém as horas de trabalho do período estendido
    const start = Number(p.root()!.get("m_dateBegin"));
    const cal = new Scheduler(p).calendarOf(ws);
    expect(after.begin).toBeGreaterThanOrEqual(start);
    expect(after.begin).toBeLessThan(Math.max(b, start) + DAY); // SetToBeginOfDay (início do expediente)
    expect(cal.AS2WS(after.end) - cal.AS2WS(after.begin)).toBeGreaterThanOrEqual(cal.AS2WS(e) - cal.AS2WS(Math.max(b, start)) - 2 * DAY);
  });
  it("ActualHelpers: repartição e datas por work place de um apontamento que atravessa dois work places", () => {
    const p = load();
    const ws = p.get(142n)!;
    const t0 = wpTimes(p.get(158n)!).begin;
    const a = addActual(p, { workSite: ws, begin: t0, end: t0 + 4 * DAY, amount: 24000, low: true, source: true });
    const ac = new ActualsContext(p);
    const q = ac.actualQuantities(a);
    expect([q.get(158n), q.get(210n)]).toEqual([10900, 13100]);
    const [b1, e1] = ac.actualTimingOf(p.get(158n)!, a), [b2, e2] = ac.actualTimingOf(p.get(210n)!, a);
    expect(b1).toBe(t0);
    expect(e1).toBe(b2);
    expect(e2).toBeLessThanOrEqual(t0 + 4 * DAY);
    expect(ac.isFinished(p.get(158n)!) && ac.isFinished(p.get(210n)!)).toBe(true);
  });
});

describe("L-048 LP com massa realizada travada", () => {
  it("Plan: LPMove realizado do transporte apontado; nada novo sai do work place executado; encerradas fora", async () => {
    const p = load();
    executedHaul(p);
    setFinished(p, p.get(145n)!, true); // LandCut 3 encerrada
    lockInLP(p);
    await planOptimize(p);
    const lp = moves(p, "m_vpLPMoves");
    const act = lp.filter((m) => m.get("m_bActual") === true);
    expect(act.map((m) => [m.get("m_pSrcWorkPlace"), m.get("m_pDstWorkPlace"), n(m.get("m_dAmount"))])).toEqual([[166n, 179n, 1000]]);
    const computed = lp.filter((m) => m.get("m_bActual") !== true && m.get("m_bManual") !== true);
    expect(computed.length).toBeGreaterThan(0);
    expect(computed.some((m) => m.get("m_pSrcWorkPlace") === 166n || m.get("m_pDstWorkPlace") === 179n)).toBe(false);
    expect(computed.some((m) => siteOf(p, m.get("m_pSrcWorkPlace")).oid === 145n)).toBe(false);
  });
  it("Plan sem a opção: apontamentos ignorados e tarefa encerrada continua candidata", async () => {
    const p = load();
    executedHaul(p);
    setFinished(p, p.get(145n)!, true);
    await planOptimize(p);
    const lp = moves(p, "m_vpLPMoves");
    expect(lp.some((m) => m.get("m_bActual") === true)).toBe(false);
    expect(lp.some((m) => m.get("m_pSrcWorkPlace") === 166n)).toBe(true);
    expect(lp.some((m) => siteOf(p, m.get("m_pSrcWorkPlace")).oid === 145n)).toBe(true);
  });
  it("Schedule: LockActuals no início, SchedMove realizado e nenhum transporte novo do que já foi executado", async () => {
    const p = load();
    executedHaul(p);
    lockInLP(p);
    await scheduleOptimize(p);
    const sm = moves(p, "m_vpSchedMoves");
    expect(p.get(166n)!.get("m_bLockedAsActual")).toBe(true);
    expect(p.get(179n)!.get("m_bLockedAsActual")).toBe(true);
    expect(sm.filter((m) => m.get("m_bActual") === true).map((m) => [m.get("m_pSrcWorkPlace"), m.get("m_pDstWorkPlace")])).toEqual([[166n, 179n]]);
    const computed = sm.filter((m) => m.get("m_bActual") !== true);
    expect(computed.length).toBeGreaterThan(0);
    expect(computed.some((m) => m.get("m_pSrcWorkPlace") === 166n || m.get("m_pDstWorkPlace") === 179n)).toBe(false);
    expect(p.byClass("ActualsLocking").length).toBe(1);
    expect(() => Project.fromDr5(readDr5(writeContainer(p.toDpl())))).not.toThrow();
  });
});

describe("L-048 corte do work place (WorkPlace(orig, r) @0x933ab0, OnSplit @0x94f660)", () => {
  it("DetermineNewCOGs: casos da síntese §9.1.2", () => {
    expect(determineNewCOGs(0, 50, 100, 30, 0.3)).toEqual([15, 65]);
    const [a, b] = determineNewCOGs(0, 60, 100, 30, 0.3);
    expect(a).toBeCloseTo(20.7, 6);
    expect(b).toBeCloseTo(76.9, 6);
    expect(0.3 * a + 0.7 * b).toBeCloseTo(60.04, 6);
    expect(determineNewCOGs(1000, 1040, 1100, 1050, 0.5)).toEqual([1015, 1065]);
  });
  it("pedaço novo = trecho baixo antes do original; estacas lineares, quantidades r, datas pela fração do trabalho", () => {
    const p = load();
    const ws = p.get(142n)!, wp = p.get(158n)!;
    const { begin, end } = wpTimes(wp);
    let novo!: Entity;
    p.edit("corte", () => (novo = splitWorkPlace(p, ws, wp, 0.25)!));
    expect(wps(p, ws).map((w) => w.oid)).toEqual([novo.oid, 158n, 210n]);
    const L = (w: Entity) => p.get(w.get("m_pLocation") as bigint)!;
    expect([n(L(novo).get("m_dStationBegin")), n(L(novo).get("m_dStationEnd"))]).toEqual([0, 75]);
    expect([n(L(wp).get("m_dStationBegin")), n(L(wp).get("m_dStationEnd"))]).toEqual([75, 300]);
    expect(src(novo)).toBeCloseTo(2725, 9);
    expect(src(wp)).toBeCloseTo(8175, 9);
    expect(novo.get("m_strName")).toBe("");
    // LandCut 1 vai do alto para o baixo (m_bLow = false): o pedaço novo (baixo) vem por último no tempo
    expect(ws.get("m_bLow")).toBe(false);
    const cal = new Scheduler(p).calendarOf(ws);
    const d = Math.round((cal.AS2WS(end) - cal.AS2WS(begin)) * 0.25);
    expect(wpTimes(novo)).toEqual({ begin: cal.WS2AS(cal.AS2WS(end) - d, true), end });
    expect(wpTimes(wp)).toEqual({ begin, end: setToEndOfDay(cal, wpTimes(novo).begin) });
  });
  it("sentido baixo: o pedaço novo vem primeiro no tempo e termina no fim do dia do corte", () => {
    const p = load();
    const ws = p.get(142n)!, wp = p.get(158n)!;
    const { begin, end } = wpTimes(wp);
    let novo!: Entity;
    p.edit("corte", () => {
      ws.set("m_bLow", true);
      novo = splitWorkPlace(p, ws, wp, 0.25)!;
    });
    const cal = new Scheduler(p).calendarOf(ws);
    const d = Math.round((cal.AS2WS(end) - cal.AS2WS(begin)) * 0.25);
    const cut = cal.WS2AS(cal.AS2WS(begin) + d, true);
    expect(wpTimes(wp)).toEqual({ begin: cut, end });
    expect(wpTimes(novo)).toEqual({ begin, end: setToEndOfDay(cal, cut) });
  });
  it("LPMoves e SchedMoves do work place cortado: cópia para o pedaço novo, inserida antes; LP com r da quantidade", async () => {
    const p = load();
    await planOptimize(p);
    await scheduleOptimize(p);
    const lpBefore = moves(p, "m_vpLPMoves").filter((m) => m.get("m_pSrcWorkPlace") === 158n);
    const totalLP = lpBefore.reduce((s, m) => s + n(m.get("m_dAmount")), 0);
    const smBefore = moves(p, "m_vpSchedMoves").filter((m) => m.get("m_pSrcWorkPlace") === 158n);
    expect(lpBefore.length && smBefore.length).toBeGreaterThan(0);
    let novo!: Entity;
    p.edit("corte", () => (novo = splitWorkPlace(p, p.get(142n)!, p.get(158n)!, 0.25)!));
    const lp = moves(p, "m_vpLPMoves");
    const lpNew = lp.filter((m) => m.get("m_pSrcWorkPlace") === novo.oid), lpOld = lp.filter((m) => m.get("m_pSrcWorkPlace") === 158n);
    expect(lpNew.reduce((s, m) => s + n(m.get("m_dAmount")), 0) + lpOld.reduce((s, m) => s + n(m.get("m_dAmount")), 0)).toBeCloseTo(totalLP, 6);
    for (const m of lpNew) {
      const nodes = refs(p.get(m.get("m_pPath") as bigint)!.get("m_vpNodes"));
      expect(p.get(nodes[0]!)!.get("m_pWorkPlace")).toBe(novo.oid);
      expect(lp.indexOf(m)).toBeLessThan(lp.findIndex((x) => x.get("m_pSrcWorkPlace") === 158n && x.get("m_pDstWorkPlace") === m.get("m_pDstWorkPlace")));
    }
    const sm = moves(p, "m_vpSchedMoves");
    const smNew = sm.filter((m) => m.get("m_pSrcWorkPlace") === novo.oid);
    expect(smNew.length).toBeGreaterThan(0);
    for (const m of [...smNew, ...sm.filter((x) => x.get("m_pSrcWorkPlace") === 158n)]) expect(n(m.get("m_dAmount"))).toBeGreaterThanOrEqual(0.5);
    expect(() => Project.fromDr5(readDr5(writeContainer(p.toDpl())))).not.toThrow();
  });
});
