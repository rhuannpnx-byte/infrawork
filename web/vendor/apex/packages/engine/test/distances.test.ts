// U-05: distâncias (RF-025, RN-009). CA-RN-009: distância de cada transporte salvo = comprimento do Path salvo.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readDr5 } from "../../dr5/src/index.js";
import { oracleFiles } from "../../dr5/test/helpers.js";
import { Project, type Entity } from "../../model/src/index.js";
import { DistanceCalculator, DistanceCalculatorManager, NoRouteError } from "../src/index.js";

/**
 * Oráculos inconsistentes (V-018): o de/example_interchange é da versão 70017 (comprimentos da versão antiga do
 * original); o fr/example_area_construction tem 5 Path salvos com 0,5 a mais que a própria geometria (o mesmo
 * transporte no en/ salva 95,5, igual ao cálculo) — caminho não recalculado depois de editar o local.
 */
const STALE: Record<string, number> = { "de/example_interchange.dr5": 38, "fr/example_area_construction.dr5": 5 };

function moves(p: Project) {
  return ["LPMove", "SchedMove"].flatMap((c) => p.byClass(c)).map((m) => ({ m, path: p.resolve(m.get("m_pPath") as bigint) })).filter((x) => x.path);
}

describe("CA-RN-009: distância calculada = Path salvo pelo original", () => {
  for (const { entry, path } of oracleFiles()) {
    const p = Project.fromDr5(readDr5(new Uint8Array(readFileSync(path))));
    const ms = moves(p);
    if (ms.length === 0) continue;
    it(`${entry.file}: ${ms.length} transportes`, () => {
      const dc = new DistanceCalculatorManager(p).plan();
      let bad = 0, nodesOk = 0;
      for (const { m, path: saved } of ms) {
        const src = m.get("m_pSrcWorkPlace") as bigint, dst = m.get("m_pDstWorkPlace") as bigint;
        const lp = dc.path(src, dst);
        if (Math.abs(lp.length - (saved!.get("m_dLength") as number)) >= 0.01) {
          bad++;
          continue;
        }
        const want = (saved!.get("m_vpNodes") as bigint[]).map((o) => {
          const n = p.get(o)!;
          const rc = n.get("m_pRoadConnection"), wp = n.get("m_pWorkPlace");
          return rc ? { roadConnection: rc, from: n.get("m_bRoadConnectionFrom") } : { workPlace: wp };
        });
        expect(lp.nodes).toEqual(want);
        nodesOk++;
      }
      expect(bad).toBe(STALE[entry.file] ?? 0);
      expect(nodesOk).toBe(ms.length - bad);
    });
  }
});

/** Projeto sintético: uma road line 0..1000 e work places pontuais. */
function synth(opts: { dir?: number } = {}) {
  const p = new Project();
  const ids: Record<string, bigint> = {};
  p.edit("monta", () => {
    p.create("Project");
    const rl = p.create("RoadLine");
    rl.set("m_nStationBegin", 0);
    rl.set("m_nStationEnd", 1000);
    if (opts.dir !== undefined) rl.set("m_nDirectionality", opts.dir);
    ids.rl = rl.oid;
    const wp = (name: string, st: number, d = 0) => {
      const loc = p.create("Location");
      loc.set("m_pRoadLine", rl.oid);
      loc.set("m_dStationBegin", st);
      loc.set("m_dStationCOG", st);
      loc.set("m_dStationEnd", st);
      loc.set("m_dDistance", d);
      const w = p.create("MovableWorkPlace");
      w.set("m_pLocation", loc.oid);
      ids[name] = w.oid;
    };
    wp("a", 100);
    wp("b", 400);
    wp("c", 900);
    wp("lado", 400, 30);
  });
  return { p, ids };
}
const place = (p: Project, rl: bigint, st: number): Entity => {
  const e = p.create("Place");
  e.set("m_pRoadLine", rl);
  e.set("m_dStation", st);
  e.set("m_dDistance", 0);
  return e;
};

describe("grafo sintético (RN-009)", () => {
  it("distância ao longo da pista e afastamento lateral", () => {
    const { p, ids } = synth();
    const dc = new DistanceCalculator(p);
    expect(dc.distance(ids.a!, ids.c!)).toBe(800);
    expect(dc.distance(ids.c!, ids.a!)).toBe(800);
    expect(dc.distance(ids.a!, ids.lado!)).toBe(300 + 30);
  });
  it("sentido da road line: D_LOW_TO_HIGH só crescente", () => {
    const { p, ids } = synth({ dir: 1 });
    const dc = new DistanceCalculator(p);
    expect(dc.distance(ids.a!, ids.c!)).toBe(800);
    expect(() => dc.distance(ids.c!, ids.a!)).toThrow(NoRouteError);
    expect(dc.distanceNoThrow(ids.c!, ids.a!)).toBe(1.7976931348623157e308);
  });
  it("usage break entre as estacas corta a pista; intersection contorna; break ignorado não corta", () => {
    const { p, ids } = synth();
    let ub!: Entity, rc!: Entity;
    p.edit("break", () => {
      ub = p.create("UsageBreak");
      ub.set("m_pRoadLine", ids.rl!);
      ub.set("m_nStationBegin", 200);
      ub.set("m_nStationEnd", 300);
    });
    expect(() => new DistanceCalculator(p).distance(ids.a!, ids.b!)).toThrow(NoRouteError);
    expect(new DistanceCalculator(p, { ignoredBreaks: new Set([ub.oid]) }).distance(ids.a!, ids.b!)).toBe(300);
    p.edit("desvio", () => {
      rc = p.create("RoadConnection");
      rc.set("m_pPlaceFrom", place(p, ids.rl!, 150).oid);
      rc.set("m_pPlaceTo", place(p, ids.rl!, 350).oid);
      rc.set("m_dDistance", 250);
      rc.set("m_bBidirectional", true);
    });
    const dc = new DistanceCalculator(p);
    expect(dc.distance(ids.a!, ids.b!)).toBe(50 + 250 + 50);
    expect(dc.path(ids.a!, ids.b!).nodes).toEqual([{ workPlace: ids.a }, { roadConnection: rc.oid, from: true }, { roadConnection: rc.oid, from: false }, { workPlace: ids.b }]);
    expect(dc.path(ids.b!, ids.a!).nodes).toEqual([{ workPlace: ids.b }, { roadConnection: rc.oid, from: false }, { roadConnection: rc.oid, from: true }, { workPlace: ids.a }]);
  });
  it("intersections no mesmo par: a mais curta; empate → a permanente", () => {
    const { p, ids } = synth();
    const mk = (w: number, timing: number) => {
      const rc = p.create("RoadConnection");
      rc.set("m_pPlaceFrom", place(p, ids.rl!, 100).oid);
      rc.set("m_pPlaceTo", place(p, ids.rl!, 900).oid);
      rc.set("m_dDistance", w);
      rc.set("m_beginTimingType", timing);
      rc.set("m_endTimingType", timing);
      return rc;
    };
    let perm!: Entity;
    p.edit("rcs", () => {
      mk(500, 1);
      perm = mk(500, 0);
      mk(700, 0);
    });
    const dc = new DistanceCalculator(p);
    expect(dc.distance(ids.a!, ids.c!)).toBe(500);
    expect(dc.path(ids.a!, ids.c!).nodes[1]).toEqual({ roadConnection: perm.oid, from: true });
  });
  it("no tempo: break ativo só na sua janela; Plan bloqueia sempre", () => {
    const { p, ids } = synth();
    p.edit("break", () => {
      const ub = p.create("UsageBreak");
      ub.set("m_pRoadLine", ids.rl!);
      ub.set("m_nStationBegin", 200);
      ub.set("m_nStationEnd", 300);
      ub.set("m_beginTimingType", 1);
      ub.set("m_endTimingType", 1);
      ub.set("m_beginDate", 1000n);
      ub.set("m_endDate", 2000n);
    });
    const mgr = new DistanceCalculatorManager(p);
    expect(mgr.plan().distanceNoThrow(ids.a!, ids.b!)).toBe(1.7976931348623157e308);
    const parts = mgr.calculatorsFor(0, 3000);
    expect(parts.map((x) => [x.begin, x.end])).toEqual([[0, 1000], [1000, 2000], [2000, 3000]]);
    expect(parts.map((x) => x.calculator.distanceNoThrow(ids.a!, ids.b!))).toEqual([300, 1.7976931348623157e308, 300]);
    expect(parts[0]!.calculator).toBe(parts[2]!.calculator); // mesma combinação, mesmo grafo (cache)
  });
});
