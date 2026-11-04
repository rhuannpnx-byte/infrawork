// U-54: dividir/combinar com realizados (D5), L-016 não estritas (D6), L-037 BY_STATIONS (D7), L-008 prioridade.
// Oráculo: pseudocódigo (handoff/docs/motor_controle_u52_u55.md §3) e casos calculados à mão.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Calendar } from "@apex/calendar";
import { readDr5, writeContainer } from "../../dr5/src/index.js";
import { FIXTURES } from "../../dr5/test/helpers.js";
import { Project, type Entity } from "../../model/src/index.js";
import {
  ActualsContext, actualsOf, addActual, addActualHaul, combineWorkSites, portionAtStation, realDelay, Scheduler, splitWorkSiteByStation, stationDelay,
  utilizationsOf, wpTimes, type StationDateSpan,
} from "../src/index.js";

const load = () => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")))));
const n = (v: unknown) => (typeof v === "number" ? v : 0);
const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);
const DAY = 86400;
const wps = (p: Project, ws: Entity) => refs(ws.get("m_vpWorkPlaces")).map((o) => p.get(o)!);

/** LandCut 1 (142): 158 [0, 300] 10 900 e 210 [300, 600] 13 100; realizados de 5 000 (baixo) e 3 000 (alto) */
function landCutWithActuals(p: Project): { low: Entity; high: Entity } {
  const t0 = wpTimes(p.get(158n)!).begin;
  const low = addActual(p, { workSite: p.get(142n)!, begin: t0, end: t0 + DAY, amount: 5000, low: true, source: true });
  const high = addActual(p, { workSite: p.get(142n)!, begin: t0, end: t0 + DAY, amount: 3000, low: false, source: true });
  return { low, high };
}

describe("U-54 dividir por estaca com realizados (SplitWorkSiteByStation@0x97fb10)", () => {
  it("GetPortionAtStation: massa do lado acumulada em ordem de estaca", () => {
    const p = load();
    const ws = p.get(142n)!;
    expect(portionAtStation(p, ws, "m_dSourceAmount", 300)).toBeCloseTo(10900 / 24000, 12);
    expect(portionAtStation(p, ws, "m_dSourceAmount", 450)).toBeCloseTo((10900 + 6550) / 24000, 12);
  });
  it("corte dentro do realizado baixo ou alto: 14759 e nada muda", () => {
    const p = load();
    landCutWithActuals(p);
    const levels = p.undoNames().length;
    expect(() => splitWorkSiteByStation(p, p.get(142n)!, 50)).toThrow("The task cannot be split at the location where there is an actual.");
    expect(() => splitWorkSiteByStation(p, p.get(142n)!, 560)).toThrow("The task cannot be split at the location where there is an actual.");
    expect(p.undoNames().length).toBe(levels);
  });
  it("corte entre os realizados: o alto vai inteiro para a tarefa nova com as utilizações remapeadas; o baixo fica", () => {
    const p = load();
    const { low, high } = landCutWithActuals(p);
    addActualHaul(p, { info: high, amount: 3000, source: p.get(142n)!, sourceLow: false, destination: p.get(177n)!, destinationLow: true });
    const clone = splitWorkSiteByStation(p, p.get(142n)!, 300)!;
    expect(actualsOf(p, p.get(142n)!).map((a) => a.oid)).toEqual([low.oid]);
    expect(actualsOf(p, clone).map((a) => a.oid)).toEqual([high.oid]);
    expect(high.get("m_pWorkSite")).toBe(clone.oid);
    const us = utilizationsOf(p, high);
    expect(us.length).toBeGreaterThan(0);
    for (const u of us) expect(wps(p, clone).map((w) => w.oid)).toContain(u.get("m_pSrcWorkPlace"));
    expect(us.reduce((s, u) => s + n(u.get("m_dAmount")), 0)).toBeCloseTo(3000, 6);
    expect(() => Project.fromDr5(readDr5(writeContainer(p.toDpl())))).not.toThrow();
  });
  it("outra tarefa (OtherActual::Split@0x956fd0): r = 0,5 → metade para a nova, data de corte por GetDateAtPortion", () => {
    const p = load();
    const ws = p.get(215n)!; // Paving: 217 [0, 3750]
    const A = n(p.get(217n)!.get("m_dAmount"));
    const t0 = wpTimes(p.get(217n)!).begin, t1 = t0 + 10 * DAY;
    const a = addActual(p, { workSite: ws, begin: t0, end: t1, amount: A / 2, low: true });
    expect(new ActualsContext(p).portionSpan(a)).toEqual([0, 0.5]);
    const clone = splitWorkSiteByStation(p, ws, 3750 / 4)!;
    const moved = actualsOf(p, clone);
    expect(moved.length).toBe(1);
    expect(n(a.get("m_dAmount"))).toBeCloseTo(A / 4, 9);
    expect(n(moved[0]!.get("m_dAmount"))).toBeCloseTo(A / 4, 9);
    const cal = new Scheduler(p).calendarOf(ws);
    const dR = cal.WS2AS(cal.AS2WS(t0) + Math.trunc(0.5 * (cal.AS2WS(t1) - cal.AS2WS(t0))), false);
    expect(Number(a.get("m_dateEnd"))).toBe(dR);
    expect([Number(moved[0]!.get("m_dateBegin")), Number(moved[0]!.get("m_dateEnd"))]).toEqual([dR, t1]);
  });
  it("combinar (CombineWorkSites@0x97d270): a que fica recebe os realizados da absorvida", () => {
    const p = load();
    const { low, high } = landCutWithActuals(p);
    const clone = splitWorkSiteByStation(p, p.get(142n)!, 300)!;
    combineWorkSites(p, [p.get(142n)!, clone]);
    expect(p.get(clone.oid)).toBeUndefined();
    expect(actualsOf(p, p.get(142n)!).map((x) => x.oid).sort()).toEqual([low.oid, high.oid].sort());
    expect(high.get("m_pWorkSite")).toBe(142n);
  });
});

describe("U-54 L-016: UpdateTiming também nas não estritas (D6)", () => {
  it("bota-fora antes do início do projeto volta ao início, com as mesmas horas de trabalho", () => {
    const p = load();
    const wp = p.get(256n)!;
    const start = Number(p.root()!.get("m_dateBegin"));
    const cal = new Scheduler(p).calendarOf(p.get(254n)!);
    const { begin, end } = wpTimes(wp);
    const hours = cal.AS2WS(end) - cal.AS2WS(begin);
    p.edit("antes", () => {
      wp.set("pDVar2", BigInt(start - 20 * DAY));
      wp.set("m_endTime", BigInt(cal.WS2AS(cal.AS2WS(start - 20 * DAY) + hours, false)));
    });
    const r = new Scheduler(p).calculate();
    const t = r.workPlaces.get(256n)!;
    expect(t.begin).toBeGreaterThanOrEqual(start);
    expect(t.begin).toBeLessThan(start + DAY);
    expect(cal.AS2WS(t.end) - cal.AS2WS(t.begin)).toBeGreaterThanOrEqual(hours - 3600 * 24);
  });
});

describe("U-54 L-037: atraso real BY_STATIONS (GetDistanceInDays@0x9eeb90)", () => {
  const cal = { AS2WS: (t: number) => t, WS2AS: (t: number) => t } as unknown as Calendar;
  const span = (st0: number, d0: number, st1: number, d1: number): StationDateSpan => ({ st0, d0: d0 * DAY, st1, d1: d1 * DAY, cal });
  it("máximo das diferenças nas bordas da sobreposição (dias corridos)", () => {
    expect(stationDelay([span(0, 0, 100, 10)], [span(50, 12, 150, 32)], false, false)).toBeCloseTo(12, 9);
    expect(stationDelay([span(0, 0, 100, 10)], [span(50, 12, 150, 32)], false, true)).toBeCloseTo(7, 9);
  });
  it("dois pontos de comprimento zero: fim do predecessor → início do sucessor; sem sobreposição: undefined", () => {
    expect(stationDelay([span(5, 1, 5, 3)], [span(5, 10, 5, 12)], false, false)).toBeCloseTo(7, 9);
    expect(stationDelay([span(0, 0, 10, 1)], [span(20, 2, 30, 3)], false, false)).toBeUndefined();
  });
  it("dependência BY_STATIONS entre tarefas do exemplo devolve um número (antes: não avaliada)", () => {
    const p = load();
    const sched = new Scheduler(p);
    let d!: Entity;
    p.edit("dep", () => {
      d = p.create("Dependency");
      d.set("m_pPredecessor", 142n);
      d.set("m_pSuccessor", 196n); // Base [0, 3750] sobre LandCut 1 [0, 600]
      d.set("m_nType", 4);
      d.set("m_bIsDelayWorkDays", false);
    });
    const r = realDelay(new Scheduler(p), d);
    expect(typeof r).toBe("number");
    void sched;
  });
});

describe("U-54 L-008: prioridade (PriorityComp@0xa0ef80) — maior prioridade primeiro; empate pelo nome", () => {
  it("tarefas sem dependências saem pela prioridade", () => {
    const p = load();
    const before = new Scheduler(p).order();
    const succ = new Set(p.byClass("Dependency").map((d) => d.get("m_pSuccessor")));
    const last = p.get(before.filter((o) => !succ.has(o)).at(-1)!)!; // sem predecessoras: livre desde o início
    p.edit("prio", () => last.set("m_nSchedulingPriority", 1000));
    expect(new Scheduler(p).order()[0]).toBe(last.oid);
  });
});
