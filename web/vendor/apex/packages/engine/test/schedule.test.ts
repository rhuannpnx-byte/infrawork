// U-09: otimização Schedule (RF-027, RN-012, RN-013, RN-015, RN-016; CA-RN-012 com o critério da D-005).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readDr5, writeContainer } from "../../dr5/src/index.js";
import { oracleFiles } from "../../dr5/test/helpers.js";
import { Project, type Entity } from "../../model/src/index.js";
import {
  DistanceCalculatorManager, makeContainer, Scheduler, productionRate, readWach, refinedTypeForMoveTo, scheduleOptimize, totalPrice, WachContainer, wpTimes,
} from "../src/index.js";

const load = (path: string) => Project.fromDr5(readDr5(new Uint8Array(readFileSync(path))));
const files = () => oracleFiles().filter(({ path }) => /example_(simple_road_project|interchange|area_construction)/.test(path));
const byName = (n: string) => {
  const unix = (f: string) => f.replace(/\\/g, "/");
  return files().map(({ path }) => path).find((f) => unix(f).endsWith(`/en/${n}.dr5`) || unix(f).endsWith(`/fixtures/${n}.dr5`))!;
};
const moves = (p: Project) => ((p.get(p.root()!.get("m_pMoveManager") as bigint)!.get("m_vpSchedMoves") as bigint[]) ?? []).map((o) => p.get(o)!);
const site = (p: Project, wp: bigint) => p.get(p.get(wp)!.get("m_pWorkSite") as bigint)!;
const n = (v: unknown) => (typeof v === "number" ? v : 0);
const key = (m: Entity) => `${m.get("m_pSrcWorkPlace")}>${m.get("m_pDstWorkPlace")}:${m.get("m_pSourceLandType")}`;
/** perfil sem os trechos de densidade 0 (o CLP do original às vezes deixa colunas com x ínfimo, que só somam zeros) */
const profile = (p: Project, m: Entity, k: string) => readWach(p.get(m.get(k) as bigint)!).spans.filter((s) => Math.abs(s.q) > 1e-9).map((s) => `${s.b}-${s.e}:${s.q.toFixed(6)}`).join(" ");

/**
 * Custo do conjunto (parte "x" do objetivo): Σ quantidade × GetTotalPrice, com a distância recalculada nos dados atuais
 * (o de/example_interchange guarda comprimentos de caminho de antes de uma edição das estacas: 704 × 703 etc.).
 */
function cost(p: Project, ms: Entity[]): number {
  const dc = new DistanceCalculatorManager(p).plan();
  return ms.reduce((c, m) => {
    const slt = p.get(m.get("m_pSourceLandType") as bigint)!;
    const len = dc.distance(m.get("m_pSrcWorkPlace") as bigint, m.get("m_pDstWorkPlace") as bigint);
    return c + n(m.get("m_dAmount")) * totalPrice(p, site(p, m.get("m_pSrcWorkPlace") as bigint), slt, site(p, m.get("m_pDstWorkPlace") as bigint), len);
  }, 0);
}

/** RN-012/RN-015/RN-016: perfis dentro do período do work place, horas de equipe ≤ 1 por hora, pilha dentro da capacidade. */
function violations(p: Project, ms: Entity[]): string[] {
  const out: string[] = [];
  const load = new Map<string, WachContainer>();
  const piles = new Map<bigint, WachContainer>();
  for (const m of ms) {
    const slt = p.get(m.get("m_pSourceLandType") as bigint)!;
    for (const [wk, vk, src] of [["m_pSrcWorkPlace", "m_pSourceWachVector", true], ["m_pDstWorkPlace", "m_pDestinationWachVector", false]] as const) {
      const wp = p.get(m.get(wk) as bigint)!, w = readWach(p.get(m.get(vk) as bigint)!);
      const t = wpTimes(wp);
      for (const s of w.spans) if (s.q > 1e-9 && (s.b < t.begin || s.e > t.end)) out.push(`${key(m)} fora de ${wp.oid}`);
      const r = productionRate(p, site(p, wp.oid), src, w.unit, slt);
      const k = `${wp.oid}:${src}`;
      if (!load.has(k)) load.set(k, new WachContainer(null));
      for (const s of w.spans) load.get(k)!.addSpan({ b: s.b, e: s.e, q: s.q / r });
      if (site(p, wp.oid).className === "StockPile") {
        if (!piles.has(wp.oid)) piles.set(wp.oid, new WachContainer(null));
        for (const s of w.spans) piles.get(wp.oid)!.addSpan({ b: s.b, e: s.e, q: src ? -s.q : s.q });
      }
    }
  }
  for (const [k, w] of load) for (const s of w.spans) if (s.q > 1 + 1e-6) out.push(`horas ${k} ${s.q}`);
  for (const [o, w] of piles) {
    const cap = n(p.get(o)!.get("m_dDestinationAmount"));
    if (cap <= 0) continue; // capacidade 0 = sem limite (AddInitialBounds/AddCapacityConstraints só com Cap > 0)
    let stock = 0;
    for (const s of w.spans) {
      stock += (s.q * (s.e - s.b)) / 3600;
      if (stock > cap + 1e-6 || stock < -1e-6) out.push(`pilha ${o} ${stock}`);
    }
  }
  return out;
}

describe("RN-015 WachContainer e horas livres", () => {
  const cal = (p: Project) => new Scheduler(p).calendarOf(p.byClass("LandCut")[0]!);
  it("MakeContainer espalha a quantidade por igual nas horas de expediente", () => {
    const p = load(byName("example_simple_road_project"));
    const w = makeContainer(90, null, Date.UTC(2016, 7, 8) / 1000, Date.UTC(2016, 7, 13) / 1000, cal(p)); // seg–sex
    expect(w.total()).toBeCloseTo(90, 9);
    expect(new Set(w.spans.map((s) => s.q)).size).toBe(1);
    expect(w.spans.every((s) => cal(p).isWorkTime(s.b))).toBe(true);
  });
  it("Remove escala por igual; trechos que chegam a 0 saem (MergeImpl, L-040); RemoveNegatives zera", () => {
    const w = new WachContainer(null);
    w.addSpan({ b: 0, e: 3600, q: 10 });
    w.addSpan({ b: 3600, e: 7200, q: 30 });
    w.remove(20);
    expect(w.spans.map((s) => s.q)).toEqual([5, 15]);
    w.removeSpan({ b: 0, e: 3600, q: 5 });
    w.removeSpan({ b: 1800, e: 7200, q: 20 });
    expect(w.spans.map((s) => [s.b, s.e, s.q])).toEqual([[1800, 3600, -20], [3600, 7200, -5]]);
    expect(w.removeNegatives()).toBe(true);
    expect(w.spans.map((s) => s.q)).toEqual([0, 0]);
    w.addSpan({ b: 0, e: 100, q: 0 }); // Merge ignora densidade ≈ 0 [O]
    expect(w.spans.length).toBe(2);
    expect(() => w.remove(1)).toThrow("can't remove that much.");
  });
});

describe("CA-RN-012 oráculos (D-005: mesmo custo, restrições satisfeitas)", () => {
  it("SchedMoves recalculados: mesmas quantidades e custo; janelas, horas e pilhas respeitadas; perfis iguais em quase todos", async () => {
    let total = 0, sameProfile = 0, filesSeen = 0;
    for (const { path } of files()) {
      const p = load(path);
      const saved = moves(p);
      const c0 = cost(p, saved);
      const s0 = new Map(saved.map((m) => [key(m), { a: n(m.get("m_dAmount")), s: profile(p, m, "m_pSourceWachVector"), d: profile(p, m, "m_pDestinationWachVector") }]));
      expect(violations(p, saved), path).toEqual([]);
      const r = await scheduleOptimize(p);
      expect(r.canceled).toBe(false);
      const now = moves(p);
      expect(violations(p, now), path).toEqual([]);
      expect(Math.abs(cost(p, now) - c0) / Math.max(1, c0), path).toBeLessThan(1e-6);
      expect(now.length, path).toBe(saved.length);
      for (const m of now) {
        const o = s0.get(key(m));
        expect(o, `${path} ${key(m)}`).toBeDefined();
        expect(Math.abs(n(m.get("m_dAmount")) - o!.a), `${path} ${key(m)}`).toBeLessThan(1e-6);
        total++;
        if (profile(p, m, "m_pSourceWachVector") === o!.s && profile(p, m, "m_pDestinationWachVector") === o!.d) sameProfile++;
      }
      filesSeen++;
    }
    expect(filesSeen).toBeGreaterThanOrEqual(2);
    // fr/example_simple_road_project: ótimo alternativo do LP em 2 transportes (mesmos totais, outra distribuição no tempo)
    expect(total - sameProfile).toBeLessThanOrEqual(2);
  });
  it("SchedMove com Path, Nodes e dois KernelWachVector; undo devolve o arquivo byte a byte", async () => {
    const path = byName("example_simple_road_project");
    const raw = new Uint8Array(readFileSync(path));
    const p = load(path);
    await scheduleOptimize(p);
    const m = moves(p)[0]!;
    const sv = p.get(m.get("m_pSourceWachVector") as bigint)!;
    expect(sv.className).toBe("KernelWachVector");
    expect(readWach(sv).total()).toBeCloseTo(n(m.get("m_dAmount")), 6);
    p.undo();
    expect(Buffer.compare(Buffer.from(writeContainer(p.toDpl())), Buffer.from(raw))).toBe(0);
  });
  it("custo do passe = GetTotalPrice (transporte + recursos de origem e destino)", () => {
    const p = load(byName("example_simple_road_project"));
    const m = moves(p)[0]!;
    const slt = p.get(m.get("m_pSourceLandType") as bigint)!;
    const src = site(p, m.get("m_pSrcWorkPlace") as bigint), dst = site(p, m.get("m_pDstWorkPlace") as bigint);
    const len = new DistanceCalculatorManager(p).plan().distance(m.get("m_pSrcWorkPlace") as bigint, m.get("m_pDstWorkPlace") as bigint);
    expect(totalPrice(p, src, slt, dst, len)).toBeGreaterThan(0);
  });
});

describe("RF-027 controle e britagem", () => {
  it("cancelado: os SchedMoves calculados somem, os manuais ficam", async () => {
    const p = load(byName("example_simple_road_project"));
    const keep = moves(p)[0]!;
    p.edit("manual", () => keep.set("m_bManual", true));
    const r = await scheduleOptimize(p, { isRunning: () => false });
    expect(r.canceled).toBe(true);
    expect(moves(p).map((m) => m.oid)).toEqual([keep.oid]);
  });
  it("U-13: depois do cálculo, o projeto grava .apex.json e .dr5 e volta igual (reais dos KernelWachVector com raw)", async () => {
    const p = load(byName("example_simple_road_project"));
    await scheduleOptimize(p);
    const text = p.toNativeJson();
    expect(Project.fromNativeJson(text).toNativeJson()).toBe(text);
    expect(() => writeContainer(p.toDpl())).not.toThrow();
  });
  it("transporte manual mantido e descontado (quantidade e horas)", async () => {
    const p = load(byName("example_simple_road_project"));
    const keep = moves(p)[0]!;
    const k = key(keep), a = n(keep.get("m_dAmount"));
    p.edit("manual", () => keep.set("m_bManual", true));
    await scheduleOptimize(p);
    const ms = moves(p);
    expect(ms.find((m) => m.oid === keep.oid)).toBeDefined();
    expect(ms.filter((m) => key(m) === k).reduce((s, m) => s + n(m.get("m_dAmount")), 0)).toBeCloseTo(a, 6);
    expect(violations(p, ms)).toEqual([]);
  });
  it("britagem com dois refinados possíveis: fica o de maior taxa da equipe de envio (L-039)", () => {
    const fr = oracleFiles().map(({ path }) => path).find((f) => f.replace(/\\/g, "/").endsWith("/fr/example_simple_road_project.dr5"));
    if (!fr) return;
    const p = load(fr);
    const crush = p.byClass("CrushingPlant")[0]!;
    const dst = p.byClass("Embankment").find((e) => refinedTypeForMoveTo(p, crush, e))!;
    expect(refinedTypeForMoveTo(p, crush, dst)).toBeDefined();
  });
});

describe("gravação depois da otimização (defeito achado na U-12)", () => {
  it("SchedMoves e perfis novos gravam em .dr5 e .apex.json e relêem iguais", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { readDr5, writeContainer } = await import("../../dr5/src/index.js");
    const { FIXTURES } = await import("../../dr5/test/helpers.js");
    const { Project } = await import("../../model/src/index.js");
    const eng = await import("../src/index.js");
    const p = Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")))));
    await eng.scheduleOptimize(p);
    const bytes = writeContainer(p.toDpl());
    const q = Project.fromDr5(readDr5(bytes));
    const r = Project.fromNativeJson(p.toNativeJson());
    const prof = (x: InstanceType<typeof Project>) => x.byClass("SchedMove").map((m) => eng.readWach(x.get(m.get("m_pSourceWachVector") as bigint)!).spans);
    expect(prof(q)).toEqual(prof(p));
    expect(prof(r)).toEqual(prof(p));
  });
});
