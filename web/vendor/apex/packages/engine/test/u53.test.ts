// U-53: realizados (ER-2/ER-3, D4): transportes realizados, recriação das utilizações, Remove all actuals e
// Remove actuals in timespan. Oráculo: pseudocódigo (handoff/docs/motor_controle_u52_u55.md §2) e casos calculados à mão.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDr5, writeContainer } from "../../dr5/src/index.js";
import { FIXTURES } from "../../dr5/test/helpers.js";
import { Project, type Entity } from "../../model/src/index.js";
import {
  actualsOf, addActual, addActualHaul, lockActuals, recreateUtilizations, removeActual, removeActualHauls, removeActualsInTimeSpan, removeAllActuals,
  scheduleOptimize, setFinished, utilizationsOf, wpTimes,
} from "../src/index.js";

const load = () => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")))));
const n = (v: unknown) => (typeof v === "number" ? v : 0);
const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);
const mm = (p: Project) => p.get(p.root()!.get("m_pMoveManager") as bigint)!;
const DAY = 86400;
const utilRows = (p: Project, info: Entity) => utilizationsOf(p, info).map((u) => [u.get("m_pSrcWorkPlace"), u.get("m_pDstWorkPlace"), Math.round(n(u.get("m_dAmount")) * 1e6) / 1e6]);

/** apontamento de origem em LandCut 1 (142: 158 [10 900] e 210 [13 100]) no sentido baixo */
function sourceInfo(p: Project, amount = 12000): Entity {
  const t0 = wpTimes(p.get(158n)!).begin;
  return addActual(p, { workSite: p.get(142n)!, begin: t0, end: t0 + 3 * DAY, amount, low: true, source: true });
}
const haul = (p: Project, info: Entity, amount: number, extra: Partial<Parameters<typeof addActualHaul>[1]> = {}) =>
  addActualHaul(p, { info, amount, source: p.get(142n)!, sourceLow: true, destination: p.get(177n)!, destinationLow: true, ...extra });

describe("U-53 Add actual haul (AddActualHaul@0x959920, CreateUtilizations@0x95a450)", () => {
  it("casamento guloso por work place: 12 000 → 158 (10 900) e 210 (1 100) para 179; ImplInfo automático em Fill 1", () => {
    const p = load();
    const info = sourceInfo(p);
    haul(p, info, 12000);
    expect(p.undoNames().at(-1)).toBe("Add actual haul");
    expect(utilRows(p, info)).toEqual([[158n, 179n, 10900], [210n, 179n, 1100]]);
    const auto = actualsOf(p, p.get(177n)!);
    expect(auto.length).toBe(1);
    expect(auto[0]!.get("m_bUserMade")).toBe(false);
    expect(auto[0]!.get("m_bSource")).toBe(false);
    expect(auto[0]!.get("m_dateBegin")).toBe(info.get("m_dateBegin"));
    expect(utilizationsOf(p, auto[0]!).map((u) => u.oid)).toEqual(utilizationsOf(p, info).map((u) => u.oid));
    expect(refs(mm(p).get("m_utilizations")).length).toBe(2);
    expect(() => Project.fromDr5(readDr5(writeContainer(p.toDpl())))).not.toThrow();
  });
  it("parte do apontamento: 5 000 cabem no 1º work place", () => {
    const p = load();
    const info = sourceInfo(p);
    haul(p, info, 5000);
    expect(utilRows(p, info)).toEqual([[158n, 179n, 5000]]);
  });
  it("validações do original: mesma tarefa 14625, quantidade ≤ 0 14029, sentido trocado, automático 14044, excesso 14717", () => {
    const p = load();
    const info = sourceInfo(p);
    expect(() => haul(p, info, 100, { destination: p.get(142n)! })).toThrow("The source and destination cannot be the same tasks.");
    expect(() => haul(p, info, 0)).toThrow("Quantity has to be greater than zero.");
    expect(() => haul(p, info, 100, { sourceLow: false })).toThrow("src start end mismatch");
    expect(() => haul(p, info, 12000.2)).toThrow("The total quantity of actual hauls is greater than the quantity of the actual.");
    haul(p, info, 12000.05); // tolerância 0,1 [O]
    const auto = actualsOf(p, p.get(177n)!)[0]!;
    expect(() => addActualHaul(p, { info: auto, amount: 1, source: p.get(142n)!, sourceLow: true, destination: p.get(177n)!, destinationLow: true })).toThrow("Failed to modify an automatically created actual.");
  });
  it("edição (Edit actual haul): troca a utilização; sem mudança não faz nada", () => {
    const p = load();
    const info = sourceInfo(p);
    haul(p, info, 5000);
    const u = utilizationsOf(p, info)[0]!;
    const levels = p.undoNames().length;
    haul(p, info, 5000, { utilization: u });
    expect(p.get(u.oid)).toBe(u);
    haul(p, info, 3000, { utilization: u });
    expect(p.undoNames().at(-1)).toBe("Edit actual haul");
    expect(p.undoNames().length).toBe(levels + 1); // a edição sem mudança não deixa nível
    expect(utilRows(p, info)).toEqual([[158n, 179n, 3000]]);
  });
});

describe("U-53 Remove actual haul e remoção de apontamentos (ER-3)", () => {
  it("RemoveActualHauls: o automático encolhe ao utilizado e sai quando zera (RemoveEmptyActuals)", () => {
    const p = load();
    const info = sourceInfo(p);
    haul(p, info, 12000);
    const [u1] = utilizationsOf(p, info);
    removeActualHauls(p, [u1!]);
    expect(p.undoNames().at(-1)).toBe("Remove actual haul");
    const auto = actualsOf(p, p.get(177n)!)[0]!;
    expect(utilRows(p, info)).toEqual([[210n, 179n, 1100]]);
    expect(n(auto.get("m_dAmount"))).toBeLessThan(n(info.get("m_dAmount")));
  });
  it("tarefa encerrada num dos lados: 14781 com o nome (destino primeiro) e nada muda", () => {
    const p = load();
    const info = sourceInfo(p);
    haul(p, info, 5000);
    setFinished(p, p.get(177n)!, true);
    const u = utilizationsOf(p, info)[0]!;
    expect(() => removeActualHauls(p, [u])).toThrow("Task Fill 1 is marked finished and its actuals cannot be edited.");
    expect(p.get(u.oid)).toBe(u);
  });
  it("RemoveImplementation do apontamento do usuário: utilizações e o automático saem; realizados travados saem", async () => {
    const p = load();
    const info = sourceInfo(p, 24000);
    haul(p, info, 24000);
    const t0 = Number(info.get("m_dateBegin"));
    // destino inteiro executado para travar os dois lados
    p.edit("dest", () => actualsOf(p, p.get(177n)!)[0]!.set("m_dAmount", 31000));
    void t0;
    p.edit("trava", () => mm(p).set("m_bActualsLockedInLP", true));
    await scheduleOptimize(p);
    expect(refs(mm(p).get("m_vpSchedMoves")).map((o) => p.get(o)!).some((m) => m.get("m_bActual") === true)).toBe(true);
    removeActual(p, info);
    expect(actualsOf(p, p.get(142n)!)).toEqual([]);
    expect(refs(mm(p).get("m_utilizations"))).toEqual([]);
    expect(refs(mm(p).get("m_vpSchedMoves")).map((o) => p.get(o)!).some((m) => m.get("m_bActual") === true)).toBe(false);
  });
  it("RecreateUtilizations: apontamento passado para o sentido alto redistribui a mesma quantidade (210 primeiro)", () => {
    const p = load();
    const info = sourceInfo(p);
    haul(p, info, 12000);
    p.edit("alto", () => {
      info.set("m_bLow", false);
      recreateUtilizations(p, [142n]);
    });
    expect(utilRows(p, info)).toEqual([[210n, 179n, 12000]]);
  });
  it("Remove all actuals: tudo sai, travamentos limpos, encerradas reabertas; um nível 'Remove actual'", () => {
    const p = load();
    const info = sourceInfo(p, 10900);
    haul(p, info, 10900);
    lockActuals(p);
    const t0 = wpTimes(p.get(140n)!).begin;
    addActual(p, { workSite: p.get(138n)!, begin: t0, end: t0 + DAY, amount: 1, low: true });
    setFinished(p, p.get(145n)!, true);
    expect(p.byClass("ActualsLocking").length).toBe(1);
    removeAllActuals(p);
    expect(p.undoNames().at(-1)).toBe("Remove actual");
    expect(p.byClass("ImplInfo").length + p.byClass("OtherActual").length + p.byClass("ImplUtilization").length).toBe(0);
    expect(refs(p.get(p.root()!.get("m_pImplManager") as bigint)!.get("m_spActualsLockings"))).toEqual([]);
    expect(p.get(145n)!.get("m_bFinished")).toBe(false);
    p.undo();
    expect(p.byClass("ImplInfo").length).toBe(2);
  });
  it("Remove actuals in timespan: dia inteiro nas pontas (from 00:00, to 23:59:59), interseção, reabre a tarefa", () => {
    const p = load();
    const d0 = Math.floor(wpTimes(p.get(140n)!).begin / DAY) * DAY;
    const mk = (b: number, e: number) => addActual(p, { workSite: p.get(138n)!, begin: b, end: e, amount: 1, low: true });
    const before = mk(d0 - 3 * DAY, d0 - 1); // termina antes do dia inicial
    const touchStart = mk(d0 - 2 * DAY, d0 + 10); // termina no dia inicial
    const lastDay = mk(d0 + 5 * DAY + 86000, d0 + 6 * DAY); // começa no último dia, 23:53
    const after = mk(d0 + 6 * DAY, d0 + 7 * DAY); // começa no dia seguinte
    setFinished(p, p.get(138n)!, true);
    const removed = removeActualsInTimeSpan(p, d0 + 3600, d0 + 5 * DAY + 7200, [p.get(138n)!]);
    expect(removed).toBe(2);
    expect([before, touchStart, lastDay, after].map((a) => !!p.get(a.oid))).toEqual([true, false, false, true]);
    expect(p.get(138n)!.get("m_bFinished")).toBe(false);
  });
});
