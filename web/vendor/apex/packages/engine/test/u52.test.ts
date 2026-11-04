// U-52: Calculate hauls com as opções do 13031 num nível só (D1), Remove calculated hauls (D2), Rename tasks
// automatically (D3) e Lock internal timing. Evidência: analises/2026-10-11_dynaroad/handoff/docs/motor_controle_u52_u55.md §1.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDr5 } from "../../dr5/src/index.js";
import { FIXTURES, oracleDirAvailable, oracleFiles } from "../../dr5/test/helpers.js";
import { Project, type Entity } from "../../model/src/index.js";
import {
  addActual, autoNameEverything, planOptimize, removeCalculatedHauls, renameTasksAutomatically, Scheduler, scheduleOptimize, wpTimes,
} from "../src/index.js";

const load = (name = "example_simple_road_project.dr5") => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, name)))));
const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);
const n = (v: unknown) => (typeof v === "number" ? v : 0);
const mm = (p: Project) => p.get(p.root()!.get("m_pMoveManager") as bigint)!;
const moves = (p: Project, list: string) => refs(mm(p).get(list)).map((o) => p.get(o)!);
const DAY = 86400;

/** transporte apontado 166 (LandCut 2) → 179 (Fill 1) com a utilização, como em l045_l048.test.ts */
function executedHaul(p: Project): void {
  const t0 = wpTimes(p.get(166n)!).begin;
  const si = addActual(p, { workSite: p.get(164n)!, begin: t0, end: t0 + 3 * DAY, amount: n(p.get(166n)!.get("m_dSourceAmount")), low: true, source: true });
  const di = addActual(p, { workSite: p.get(177n)!, begin: t0, end: t0 + 3 * DAY, amount: n(p.get(179n)!.get("m_dDestinationAmount")), low: true, source: false });
  p.edit("utilização", () => {
    const u = p.create("ImplUtilization");
    for (const [k, v] of Object.entries({ m_strName: "", m_strLongName: "", m_pUIInfo: null, m_pSrcWorkPlace: 166n, m_pDstWorkPlace: 179n, m_pSourceLandType: si.get("m_pSourceLandType"), m_pPath: null, m_bManual: false, m_bActual: true, m_dAmount: 1000, m_pSourceInfo: si.oid, m_pDestinationInfo: di.oid }))
      u.set(k, v as never);
    mm(p).setRaw("m_utilizations", { kind: "container", type: 0x14, elemType: 0x18, items: [{ kind: "bigint", type: 0x18, value: u.oid }] } as never);
  });
}

describe("U-52 Calculate hauls: transação do 13031 (D1)", () => {
  it("Schedule com 'Lock actual quantities': trava, remove, LockActuals e resultado num nível só; undo volta tudo", async () => {
    const p = load();
    executedHaul(p);
    const levels = p.undoNames().length;
    expect(mm(p).get("m_bActualsLockedInLP")).not.toBe(true);
    await scheduleOptimize(p, { lockActualQuantities: true });
    expect(p.undoNames().length).toBe(levels + 1);
    expect(p.undoNames().at(-1)).toBe("Haul Calculation"); // U-61f: MakeUndoText sem nome de projeto = o título do 13031 [O]
    expect(p.undoNames()).not.toContain("Lock actuals");
    expect(mm(p).get("m_bActualsLockedInLP")).toBe(true);
    expect(moves(p, "m_vpSchedMoves").filter((m) => m.get("m_bActual") === true).length).toBe(1);
    p.undo();
    expect(mm(p).get("m_bActualsLockedInLP")).not.toBe(true);
    expect(moves(p, "m_vpSchedMoves").some((m) => m.get("m_bActual") === true)).toBe(false);
    expect(p.get(166n)!.get("m_bLockedAsActual")).not.toBe(true);
  });
  it("sem travar: RemoveAllSchedMoves(false, true) apaga também os SchedMoves realizados não manuais [O]", async () => {
    const p = load();
    executedHaul(p);
    await scheduleOptimize(p, { lockActualQuantities: true });
    expect(moves(p, "m_vpSchedMoves").some((m) => m.get("m_bActual") === true)).toBe(true);
    await scheduleOptimize(p, { lockActualQuantities: false, isRunning: () => false }); // cancelado
    expect(mm(p).get("m_bActualsLockedInLP")).toBe(false);
    expect(moves(p, "m_vpSchedMoves").filter((m) => m.get("m_bManual") !== true).length).toBe(0);
  });
  it("Plan: a opção grava m_bActualsLockedInLP no mesmo nível 'Haul calculation'", async () => {
    const p = load();
    executedHaul(p);
    const levels = p.undoNames().length;
    await planOptimize(p, { lockActualQuantities: true });
    expect(p.undoNames().length).toBe(levels + 1);
    expect(mm(p).get("m_bActualsLockedInLP")).toBe(true);
    expect(moves(p, "m_vpLPMoves").filter((m) => m.get("m_bActual") === true).length).toBe(1);
  });
  it("distância máxima pequena exclui as cadeias longas (LomSolver::SetMaxMoveDistance)", async () => {
    const p = load(), q = load();
    const all = await planOptimize(p);
    const short = await planOptimize(q, { maxMoveDistance: 1 });
    expect(all.moves.length).toBeGreaterThan(0);
    expect(short.moves.every((m) => m.path.length <= 1)).toBe(true);
    expect(short.moves.length).toBeLessThan(all.moves.length);
  });
});

describe("U-52 Remove calculated hauls (D2)", () => {
  it("Plan: RemoveAllLPMoves(false) — sai todo LPMove não manual; os manuais ficam; rótulo 'Remove haul'", async () => {
    const p = load();
    await planOptimize(p);
    const lp = moves(p, "m_vpLPMoves");
    p.edit("manual", () => lp[0]!.set("m_bManual", true));
    const removed = removeCalculatedHauls(p, 0);
    expect(removed).toBe(lp.length - 1);
    expect(moves(p, "m_vpLPMoves").map((m) => m.oid)).toEqual([lp[0]!.oid]);
    expect(p.undoNames().at(-1)).toBe("Remove haul");
    expect(p.get(lp[1]!.oid)).toBeUndefined();
  });
  it("Schedule: RemoveAllSchedMoves(false, false) — ficam os manuais e os realizados", async () => {
    const p = load();
    executedHaul(p);
    await scheduleOptimize(p, { lockActualQuantities: true });
    const sm = moves(p, "m_vpSchedMoves");
    const actual = sm.filter((m) => m.get("m_bActual") === true);
    const computed = sm.filter((m) => m.get("m_bActual") !== true);
    p.edit("manual", () => computed[0]!.set("m_bManual", true));
    removeCalculatedHauls(p, 1);
    expect(moves(p, "m_vpSchedMoves").map((m) => m.oid).sort()).toEqual([...actual.map((m) => m.oid), computed[0]!.oid].sort());
  });
  it("Control: o handler não faz nada", async () => {
    const p = load();
    await scheduleOptimize(p);
    const before = moves(p, "m_vpSchedMoves").length, levels = p.undoNames().length;
    expect(removeCalculatedHauls(p, 2)).toBe(0);
    expect(moves(p, "m_vpSchedMoves").length).toBe(before);
    expect(p.undoNames().length).toBe(levels);
  });
});

describe("U-52 Rename tasks automatically (D3, AutoNameEverything@0x97c410)", () => {
  it("numera cada grupo (tipo, road line) de 1 a n por estaca inicial; só as de 'Name automatically'", () => {
    const p = load();
    const land = p.byClass("LandCut");
    p.edit("prep", () => {
      for (const ws of land) {
        ws.set("m_bAutoName", true);
        ws.set("m_strName", "x");
      }
      land[0]!.set("m_bAutoName", false);
    });
    renameTasksAutomatically(p);
    expect(p.undoNames().at(-1)).toBe("Automatic renaming of all tasks.");
    expect(land[0]!.get("m_strName")).toBe("x");
    const st = (ws: Entity) => Math.min(...refs(ws.get("m_vpWorkPlaces")).map((o) => n(p.get(p.get(o)!.get("m_pLocation") as bigint)!.get("m_dStationBegin"))));
    const byType = new Map<unknown, Entity[]>();
    for (const ws of land.slice(1)) byType.set(ws.get("m_pSourceLandType"), [...(byType.get(ws.get("m_pSourceLandType")) ?? []), ws]);
    for (const g of byType.values()) {
      const sorted = g.slice().sort((a, b) => st(a) - st(b));
      sorted.forEach((ws, i) => expect(String(ws.get("m_strName"))).toMatch(new RegExp(` ${i + 1}$`)));
    }
  });
  it.skipIf(!oracleDirAvailable())("exemplos com nomes automáticos coerentes: o original e o ApeX dão os mesmos nomes", () => {
    const wanted = ["de/example_area_construction.dr5", "de/example_interchange.dr5", "sv/example_area_construction.dr5", "sv/example_interchange.dr5", "en/example_interchange.dr5"];
    let checked = 0;
    for (const { path } of oracleFiles()) {
      if (!wanted.some((w) => path.replace(/\\/g, "/").endsWith(w))) continue;
      const p = Project.fromDr5(readDr5(new Uint8Array(readFileSync(path))));
      const before = [...p.entities()].map((e) => [e.oid, e.get("m_strName"), e.get("m_strLongName")]);
      const auto = [...p.entities()].filter((e) => e.get("m_bAutoName") === true).length;
      p.edit("x", () => autoNameEverything(p));
      expect([...p.entities()].map((e) => [e.oid, e.get("m_strName"), e.get("m_strLongName")])).toEqual(before);
      expect(auto).toBeGreaterThan(0);
      checked++;
    }
    expect(checked).toBe(wanted.length);
  });
});

describe("U-52 Lock internal timing", () => {
  it("o motor não lê m_bLockInternalTiming [O varredura do PE]: o cronograma não muda", () => {
    const p = load();
    const before = new Scheduler(p).calculate();
    p.edit("lock", () => {
      for (const st of p.byClass("SumTask")) st.set("m_bLockInternalTiming", true);
    });
    const after = new Scheduler(p).calculate();
    expect([...after.workPlaces.entries()]).toEqual([...before.workPlaces.entries()]);
  });
});
