// L-042 (U-20): timing TASK/PERMANENT nos períodos de rede e transportador no LP Schedule.
// Evidência: analises/2026-10-11_dynaroad/handoff/docs/analise_rede_transportador_l042.md e
// evidencias/decompilado/{u20,u20_l042}/ (HasVariantTiming::GetBeginTime @0x973130, GetEndTime @0x973190,
// WorkSite::GetEndTime @0x5e8520 → @0x93f7f0(true), OnDependent*WorkSiteDeleted @0x973410/@0x973450,
// LightNode/Node::GetLocation @0x99a2f0/@0x99a3c0, TransporterHelpers::IsSuitablePath @0x99cf70/@0x99d020,
// Transporter::GetMaxDistance @0x99cd60, HaulChainCandidateStepWithDates @0x9fddf0).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_DATE, MIN_DATE } from "../../calendar/src/index.js";
import { readDr5 } from "../../dr5/src/index.js";
import { FIXTURES } from "../../dr5/test/helpers.js";
import { encode, encodeContainer, Project, type Entity } from "../../model/src/index.js";
import {
  combineWorkSites, DBL_MAX, DistanceCalculator, DistanceCalculatorManager, haulClassMask, HAUL_CLASS, isSuitablePath, maxDistance, nodeLocation, scheduleOptimize,
  storedNode, variantTiming,
} from "../src/index.js";

const load = () => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")))));
const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);
const date = (v: unknown) => (typeof v === "bigint" ? Number(v) : 0);
const wps = (p: Project, ws: Entity) => refs(ws.get("m_vpWorkPlaces")).map((o) => p.get(o)!);
const taskEnd = (p: Project, ws: Entity) => Math.max(...wps(p, ws).map((w) => date(w.get("m_endTime"))));
const schedMoves = (p: Project) => refs(p.get(p.root()!.get("m_pMoveManager") as bigint)!.get("m_vpSchedMoves")).map((o) => p.get(o)!);
const srcSite = (p: Project, m: Entity) => p.get(p.get(m.get("m_pSrcWorkPlace") as bigint)!.get("m_pWorkSite") as bigint)!;

function variant(p: Project, cls: "UsageBreak" | "RoadConnection", f: Record<string, unknown>): Entity {
  let e!: Entity;
  p.edit("variante", () => {
    e = p.create(cls);
    for (const [k, v] of Object.entries(f)) e.set(k, v as never);
  });
  return e;
}

describe("L-042 HasVariantTiming::GetBeginTime/GetEndTime", () => {
  it("PERMANENT → MinDate/MaxDate mesmo com datas gravadas; no fim vale o tipo do início", () => {
    const p = load();
    const perm = variant(p, "UsageBreak", { m_beginTimingType: 0, m_endTimingType: 1, m_beginDate: 1000n, m_endDate: 2000n });
    expect(variantTiming(p, perm)).toEqual([MIN_DATE, MAX_DATE]);
    const stat = variant(p, "UsageBreak", { m_beginTimingType: 1, m_endTimingType: 1, m_beginDate: 1000n, m_endDate: 2000n });
    expect(variantTiming(p, stat)).toEqual([1000, 2000]);
  });
  it("TASK → fim da tarefa dependente (WorkSite::GetEndTime(true) = maior fim dos work places), nos dois lados", () => {
    const p = load();
    const [a, b] = p.byClass("LandCut");
    const e = variant(p, "RoadConnection", { m_beginTimingType: 2, m_endTimingType: 2, m_pBeginWorkSite: a!.oid, m_pEndWorkSite: b!.oid, m_beginDate: 1n, m_endDate: 2n });
    expect(variantTiming(p, e)).toEqual([taskEnd(p, a!), taskEnd(p, b!)]);
  });
  it("tarefa dependente removida: TASK vira STATIC e a referência é zerada (OnDependent*WorkSiteDeleted)", () => {
    const p = load();
    const cuts = p.byClass("LandCut").filter((w) => /^LandCut [12]$/.test(w.name)).sort((x, y) => x.name.localeCompare(y.name));
    expect(cuts.length).toBe(2);
    const e = variant(p, "UsageBreak", { m_beginTimingType: 1, m_endTimingType: 2, m_pEndWorkSite: cuts[1]!.oid, m_beginDate: 1000n, m_endDate: 5000n });
    combineWorkSites(p, cuts);
    expect(p.get(cuts[1]!.oid)).toBeUndefined();
    expect([e.get("m_endTimingType"), e.get("m_pEndWorkSite") ?? null]).toEqual([1, null]);
    expect(variantTiming(p, e)).toEqual([1000, 5000]);
  });
});

describe("L-042 períodos de rede (RecreateActiveCombinations/GetValidDistanceCalculators)", () => {
  it("break com início TASK só bloqueia depois do fim da tarefa; break PERMANENT bloqueia sempre", () => {
    const p = load();
    const mainRl = p.root()!.get("m_pMainRoadLine") as bigint;
    const lc = p.byClass("LandCut").find((w) => w.name === "LandCut 1")!;
    const t = taskEnd(p, lc);
    const ub = variant(p, "UsageBreak", { m_pRoadLine: mainRl, m_nStationBegin: 0, m_nStationEnd: 4000, m_beginTimingType: 2, m_endTimingType: 1, m_pBeginWorkSite: lc.oid, m_endDate: BigInt(t + 10 * 86400) });
    const parts = new DistanceCalculatorManager(p).calculatorsFor(t - 86400, t + 20 * 86400);
    expect(parts.map((x) => [x.begin, x.end])).toEqual([[t - 86400, t], [t, t + 10 * 86400], [t + 10 * 86400, t + 20 * 86400]]);
    expect(parts[0]!.calculator).toBe(parts[2]!.calculator);
    expect(parts[1]!.calculator).not.toBe(parts[0]!.calculator);
    p.edit("permanente", () => ub.set("m_beginTimingType", 0));
    expect(new DistanceCalculatorManager(p).calculatorsFor(t - 86400, t + 20 * 86400).length).toBe(1);
  });
});

describe("L-042 transportador", () => {
  function withTransporter(p: Project, table: [number, number][], unsuitable: bigint[] = []): Entity {
    let T!: Entity;
    p.edit("transportador", () => {
      T = p.create("Transporter");
      T.set("m_strName", "Caminhão");
      T.setRaw("m_mDistanceWorkAchievement", table.length
        ? { kind: "map", type: 0x15, keyType: 0x0d, valueType: 0x0d, entries: table.map(([d, w]) => [encode(0x0d, d), encode(0x0d, w)]) }
        : { kind: "map", type: 0x15, keyType: null, valueType: null, entries: [] });
      T.setRaw("m_unsuitableRoutes", encodeContainer(0x18, unsuitable));
      for (const g of [128n, 129n]) p.get(g)!.set("m_pHaulResource", T.oid);
    });
    return T;
  }
  const users = (p: Project) => new Set(p.entities().filter((e) => ((e.get("m_cSelectedSubWorkGroups") as [unknown, unknown][] | undefined) ?? []).some(([u, g]) => u === 1 && (g === 128n || g === 129n))).map((e) => e.oid));

  it("GetMaxDistance: maior distância da tabela; vazia → −1", () => {
    expect(maxDistance([[100, 60], [5000, 10]])).toBe(5000);
    expect(maxDistance([])).toBe(-1);
  });
  it("IsSuitablePath: local do nó (road line do work place ou do lado da intersection) e a intersection", () => {
    const p = load();
    const T = withTransporter(p, [[10000, 50]]);
    const dc = new DistanceCalculator(p);
    const lcs = p.byClass("LandCut").flatMap((w) => wps(p, w));
    const fills = p.byClass("Embankment").flatMap((w) => wps(p, w));
    const path = dc.path(lcs[0]!.oid, fills[0]!.oid);
    const rl = nodeLocation(p, path.nodes[0]!)!;
    expect(rl).toBe(p.get(lcs[0]!.get("m_pLocation") as bigint)!.get("m_pRoadLine"));
    expect(isSuitablePath(p, T, path.nodes)).toBe(true);
    p.edit("inadequada", () => T.setRaw("m_unsuitableRoutes", encodeContainer(0x18, [rl])));
    expect(isSuitablePath(p, T, path.nodes)).toBe(false);
    expect(() => nodeLocation(p, {})).toThrow("No location.");
  });
  it("GetHaulClassMask usa o local do nó do Path gravado (Node::GetLocation)", async () => {
    const p = load();
    await scheduleOptimize(p);
    const T = withTransporter(p, [[100000, 50]]);
    const m = schedMoves(p).find((x) => users(p).has(srcSite(p, x).oid) && x.get("m_pPath"))!;
    expect(haulClassMask(p, m)).toBe(0);
    const node = p.get(refs(p.get(m.get("m_pPath") as bigint)!.get("m_vpNodes"))[0]!)!;
    p.edit("inadequada", () => T.setRaw("m_unsuitableRoutes", encodeContainer(0x18, [nodeLocation(p, storedNode(node))!])));
    expect(haulClassMask(p, m) & HAUL_CLASS.UNSUITABLE_ROUTE).toBe(HAUL_CLASS.UNSUITABLE_ROUTE);
  });
  it("Schedule: distância acima do máximo ou rota inadequada → alternativa descartada; tabela larga = sem efeito", async () => {
    const base = load();
    await scheduleOptimize(base);
    const from = (p: Project) => schedMoves(p).filter((m) => users(p).has(srcSite(p, m).oid)).length;
    expect(from(base)).toBeGreaterThan(0);

    const wide = load();
    withTransporter(wide, [[1e9, 50]]);
    await scheduleOptimize(wide);
    expect(schedMoves(wide).length).toBe(schedMoves(base).length);

    const short = load();
    withTransporter(short, [[1, 50]]);
    await scheduleOptimize(short);
    expect(from(short)).toBe(0);

    const empty = load();
    withTransporter(empty, []);
    await scheduleOptimize(empty);
    expect(from(empty)).toBe(0);

    const blocked = load();
    withTransporter(blocked, [[1e9, 50]], [blocked.root()!.get("m_pMainRoadLine") as bigint]);
    await scheduleOptimize(blocked);
    expect(from(blocked)).toBe(0);
    expect(DBL_MAX).toBeGreaterThan(1e300);
  });
});
