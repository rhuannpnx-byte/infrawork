// U-08: otimização Plan (RF-026, RN-010, RN-011, RN-017; CA-RN-010 com o critério da D-005).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readDr5, writeContainer } from "../../dr5/src/index.js";
import { oracleFiles } from "../../dr5/test/helpers.js";
import { Project, type Entity } from "../../model/src/index.js";
import {
  convertAmount, DistanceCalculatorManager, haulPrice, isChild, isDestinationAmount, isDestinationConstraint,
  isHaulPreventedAsExternal, isSourceAmount, MASS_TYPE, massType, planCandidates, planOptimize, srcUnit, dstUnit,
} from "../src/index.js";

const load = (path: string) => Project.fromDr5(readDr5(new Uint8Array(readFileSync(path))));
const withMoves = () => oracleFiles().filter(({ path }) => /example_(simple_road_project|interchange|area_construction)/.test(path));
/** o arquivo em inglês (ou a fixture): os outros idiomas têm OIDs e dados próprios */
const byName = (n: string) => {
  const unix = (f: string) => f.replace(/\\/g, "/");
  return withMoves().map(({ path }) => path).find((f) => unix(f).endsWith(`/en/${n}.dr5`) || unix(f).endsWith(`/fixtures/${n}.dr5`))!;
};
const moves = (p: Project) => ((p.get(p.root()!.get("m_pMoveManager") as bigint)!.get("m_vpLPMoves") as bigint[]) ?? []).map((o) => p.get(o)!);
const site = (p: Project, wp: bigint) => p.get(p.get(wp)!.get("m_pWorkSite") as bigint)!;
const n = (v: unknown) => (typeof v === "number" ? v : 0);

/** Custo de transporte de um conjunto de LPMoves: Σ quantidade × preço do passo (a parte "x" do objetivo). */
function haulCost(p: Project, ms: Entity[]): number {
  const dc = new DistanceCalculatorManager(p).plan();
  let c = 0;
  for (const m of ms) {
    const s = m.get("m_pSrcWorkPlace") as bigint, d = m.get("m_pDstWorkPlace") as bigint;
    const slt = p.get(m.get("m_pSourceLandType") as bigint)!;
    c += n(m.get("m_dAmount")) * haulPrice(p, site(p, s), slt, site(p, d), dc.distance(s, d), slt.get("m_pUnit") as bigint);
  }
  return c;
}

/** Fluxos por work place, na unidade da tarefa (origem/destino), e o que falta mover nas obrigatórias. */
function flows(p: Project, ms: Entity[]) {
  const out = new Map<bigint, number>(), inn = new Map<bigint, number>();
  for (const m of ms) {
    const slt = p.get(m.get("m_pSourceLandType") as bigint)!;
    const s = m.get("m_pSrcWorkPlace") as bigint, d = m.get("m_pDstWorkPlace") as bigint, a = n(m.get("m_dAmount"));
    out.set(s, (out.get(s) ?? 0) + convertAmount(slt, a, slt.get("m_pUnit") as bigint, srcUnit(p, site(p, s))));
    inn.set(d, (inn.get(d) ?? 0) + convertAmount(slt, a, slt.get("m_pUnit") as bigint, dstUnit(p, site(p, d))));
  }
  const unmet = new Map<bigint, number>();
  const violations: string[] = [];
  for (const wp of p.byClass("MovableWorkPlace")) {
    const ws = site(p, wp.oid);
    if (isSourceAmount(ws)) {
      const free = n(wp.get("m_dSourceAmount")), o = out.get(wp.oid) ?? 0;
      if (o > free + 1e-6) violations.push(`origem ${wp.oid}: ${o} > ${free}`);
      if (massType(ws, "source") & MASS_TYPE.MUST) unmet.set(wp.oid, free - o);
    }
    if (isDestinationAmount(ws)) {
      const free = n(wp.get("m_dDestinationAmount")), i = inn.get(wp.oid) ?? 0;
      if (i > free + 1e-6) violations.push(`destino ${wp.oid}: ${i} > ${free}`);
      if (massType(ws, "destination") & MASS_TYPE.MUST) unmet.set(-wp.oid, free - i);
    }
    if (isDestinationConstraint(ws) && ws.className === "CrushingPlant") {
      // conservação na britagem: o que entra (unidade do tipo de destino) sai convertido no material refinado
      const i = inn.get(wp.oid) ?? 0, o = out.get(wp.oid) ?? 0;
      if (Math.abs(i - o) > 1e-6 * Math.max(1, i)) violations.push(`britagem ${wp.oid}: entra ${i} sai ${o}`);
    }
  }
  return { unmet, violations };
}

describe("RN-011 flags por classe", () => {
  it("quantidade de origem, de destino e restrição de destino", () => {
    const by = (cls: string) => ({ className: cls }) as Entity;
    expect(["LandCut", "BorrowPit", "WasteLand", "Embankment", "CrushingPlant"].map((c) => [isSourceAmount(by(c)), isDestinationAmount(by(c)), isDestinationConstraint(by(c))])).toEqual([
      [true, false, false], [true, false, false], [false, true, false], [false, true, false], [false, false, true],
    ]);
  });
});

describe("CA-RN-010 oráculos (D-005: mesmo objetivo, restrições satisfeitas)", () => {
  it("transportes recalculados: mesmo custo, mesma massa obrigatória atendida, sem violação", async () => {
    let files = 0;
    for (const { path } of withMoves()) {
      const p = load(path);
      const saved = moves(p);
      const c0 = haulCost(p, saved), f0 = flows(p, saved);
      const r = await planOptimize(p);
      expect(r.canceled).toBe(false);
      const now = moves(p);
      const c1 = haulCost(p, now), f1 = flows(p, now);
      expect(Math.abs(c1 - c0) / Math.max(1, c0), path).toBeLessThan(1e-6);
      expect(f0.violations, path).toEqual([]);
      expect(f1.violations, path).toEqual([]);
      for (const [k, v] of f0.unmet) expect(Math.abs((f1.unmet.get(k) ?? 0) - v), `${path} ${k}`).toBeLessThan(1e-6);
      // valor do LP = custo de transporte + penalidade da massa obrigatória não movida
      const lp = r.zones.reduce((s, z) => s + z.objective, 0);
      if ([...f1.unmet.values()].every((v) => Math.abs(v) < 1e-6)) expect(Math.abs(lp - c1) / Math.max(1, c1)).toBeLessThan(1e-6);
      else expect(lp).toBeGreaterThan(c1);
      files++;
    }
    expect(files).toBeGreaterThanOrEqual(2);
  });
  it("britagem: a cadeia conserva massa com a conversão do material (8177,78 bcm de rocha → 9200 ccm de agregado)", async () => {
    const p = load(byName("example_simple_road_project"));
    await planOptimize(p);
    const ms = moves(p);
    const crushWp = p.byClass("CrushingPlant")[0]!.get("m_vpWorkPlaces") as bigint[];
    const into = ms.filter((m) => m.get("m_pDstWorkPlace") === crushWp[0]).reduce((s, m) => s + n(m.get("m_dAmount")), 0);
    const out = ms.filter((m) => m.get("m_pSrcWorkPlace") === crushWp[0]);
    expect(into).toBeCloseTo(8177.777777777777, 6);
    expect(out.map((m) => [p.get(m.get("m_pSourceLandType") as bigint)!.name, n(m.get("m_dAmount"))])).toEqual([["Base Agg.", expect.closeTo(9200, 6)]]);
  });
  it("LPMove criado com Path e Nodes; undo devolve o arquivo byte a byte", async () => {
    const path = byName("example_simple_road_project");
    const raw = new Uint8Array(readFileSync(path));
    const p = load(path);
    await planOptimize(p);
    const m = moves(p)[0]!;
    const pathE = p.get(m.get("m_pPath") as bigint)!;
    const nodes = (pathE.get("m_vpNodes") as bigint[]).map((o) => p.get(o)!);
    expect(nodes.at(0)!.get("m_pWorkPlace")).toBe(m.get("m_pSrcWorkPlace"));
    expect(nodes.at(-1)!.get("m_pWorkPlace")).toBe(m.get("m_pDstWorkPlace"));
    expect(n(pathE.get("m_dLength"))).toBeGreaterThan(0);
    p.undo();
    expect(Buffer.compare(Buffer.from(writeContainer(p.toDpl())), Buffer.from(raw))).toBe(0);
  });
});

describe("RF-026 controle da execução", () => {
  it("cancelado: os LPMoves calculados somem, os manuais ficam", async () => {
    const p = load(byName("example_simple_road_project"));
    const keep = moves(p)[0]!;
    p.edit("manual", () => keep.set("m_bManual", true));
    const r = await planOptimize(p, { isRunning: () => false });
    expect(r.canceled).toBe(true);
    expect(moves(p).map((m) => m.oid)).toEqual([keep.oid]);
  });
  it("transporte manual é descontado das quantidades livres e mantido", async () => {
    const p = load(byName("example_simple_road_project"));
    const keep = moves(p).find((m) => m.get("m_pSrcWorkPlace") === 158n)!; // 10900 de 158 → 179
    p.edit("manual", () => {
      keep.set("m_bManual", true);
      keep.set("m_dAmount", 4000);
    });
    await planOptimize(p);
    const from158 = moves(p).filter((m) => m.get("m_pSrcWorkPlace") === 158n);
    expect(from158.find((m) => m.oid === keep.oid)).toBeDefined();
    expect(from158.reduce((s, m) => s + n(m.get("m_dAmount")), 0)).toBeCloseTo(10900, 6);
  });
  it("distância máxima de transporte abaixo de todas as rotas: nenhum transporte", async () => {
    const p = load(byName("example_simple_road_project"));
    const r = await planOptimize(p, { maxMoveDistance: 1 });
    expect(r.zones).toEqual([]);
    expect(moves(p)).toEqual([]);
  });
});

describe("RN-017/RN-010 zonas e transporte externo", () => {
  const ramps = 415n; // sum task "Ramps" do example_interchange
  it("zona marcada é resolvida antes da raiz, só com as cadeias internas", async () => {
    const p = load(byName("example_interchange"));
    const base = load(byName("example_interchange"));
    await planOptimize(base);
    p.edit("zona", () => p.get(ramps)!.set("m_bMassEconomyArea", true));
    const r = await planOptimize(p);
    expect(r.zones.map((z) => z.zone)).toEqual([ramps, 37n]);
    const inside = (wp: bigint) => isChild(p, site(p, wp), p.get(ramps)!);
    const internal = moves(p).filter((m) => inside(m.get("m_pSrcWorkPlace") as bigint) && inside(m.get("m_pDstWorkPlace") as bigint));
    expect(internal.length).toBeGreaterThan(0);
    // otimizar por partes nunca fica mais barato que o todo
    expect(haulCost(p, moves(p))).toBeGreaterThanOrEqual(haulCost(base, moves(base)) - 1e-6);
  });
  it("Prevent external hauls: nenhuma cadeia cruza a fronteira da sum task", async () => {
    const p = load(byName("example_interchange"));
    const before = planCandidates(p).length;
    p.edit("proibir", () => p.get(ramps)!.set("m_bPreventExternalHauls", true));
    const inside = (e: Entity) => isChild(p, e, p.get(ramps)!);
    // tarefa direto na raiz é isenta (IsHaulPreventedAsExternal pula a raiz)
    const atRoot = (e: Entity) => e.get("m_pSumTaskParent") === 37n;
    const crossing = (a: Entity, b: Entity) => inside(a) !== inside(b) && !atRoot(a) && !atRoot(b);
    const chains = planCandidates(p);
    expect(chains.length).toBeLessThan(before);
    expect(chains.filter((c) => crossing(c.source, c.destination)).map((c) => `${c.source.oid}>${c.destination.oid}`)).toEqual([]);
    expect(chains.some((c) => inside(c.source) !== inside(c.destination))).toBe(true); // as da raiz continuam
    await planOptimize(p);
    for (const m of moves(p)) expect(crossing(site(p, m.get("m_pSrcWorkPlace") as bigint), site(p, m.get("m_pDstWorkPlace") as bigint))).toBe(false);
  });
  it("IsHaulPreventedAsExternal: menos de 2 elos, raiz isenta, duas áreas diferentes", () => {
    const p = load(byName("example_interchange"));
    const st = (o: bigint) => p.get(o)!;
    expect(isHaulPreventedAsExternal(p, [st(415n)])).toBe(true);
    expect(isHaulPreventedAsExternal(p, [st(415n), st(273n)])).toBe(false);
    p.edit("proibir", () => {
      st(415n).set("m_bPreventExternalHauls", true);
      st(273n).set("m_bPreventExternalHauls", true);
    });
    expect(isHaulPreventedAsExternal(p, [st(415n), st(415n)])).toBe(false);
    expect(isHaulPreventedAsExternal(p, [st(415n), st(37n)])).toBe(false); // elo direto na raiz não conta
    expect(isHaulPreventedAsExternal(p, [st(415n), st(276n)])).toBe(true);
    expect(isHaulPreventedAsExternal(p, [st(415n), st(273n)])).toBe(true);
  });
  it("cadeia proibida pelo usuário (m_preventedChains) sai da lista", () => {
    const p = load(byName("example_simple_road_project"));
    const all = planCandidates(p);
    const target = all.find((c) => c.crush)!;
    p.edit("proibir cadeia", () => {
      const k = p.create("KernelHaulChainCandidate");
      k.set("m_strName", "");
      k.set("m_strLongName", "");
      k.set("m_pUIInfo", null);
      k.set("m_candidate.m_pSource", target.source.oid);
      k.set("m_candidate.m_pPile", null);
      k.set("m_candidate.m_pCrush", target.crush!.oid);
      k.set("m_candidate.m_pPile2", null);
      k.set("m_candidate.m_pDestination", target.destination.oid);
      const mm = p.get(p.root()!.get("m_pMoveManager") as bigint)!;
      mm.setRaw("m_preventedChains", { kind: "container", type: 0x14, elemType: 0x18, items: [{ kind: "bigint", type: 0x18, value: k.oid }] });
    });
    const left = planCandidates(p);
    expect(left).toHaveLength(all.length - 1);
    expect(left.some((c) => c.source.oid === target.source.oid && c.crush?.oid === target.crush!.oid && c.destination.oid === target.destination.oid)).toBe(false);
  });
});
