// U-10: transporte manual (RF-028, RN-020; CA-RN-020).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeContainer } from "../../model/src/index.js";
import { readDr5 } from "../../dr5/src/index.js";
import { FIXTURES } from "../../dr5/test/helpers.js";
import { Project, type Entity } from "../../model/src/index.js";
import { createManualMove, readWach, unmoved, wpTimes } from "../src/index.js";

const load = () => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")))));
const n = (v: unknown) => (typeof v === "number" ? v : 0);
const mm = (p: Project) => p.get(p.root()!.get("m_pMoveManager") as bigint)!;
/** projeto no modo pedido, sem transportes (os objetos antigos ficam órfãos, irrelevante aqui) */
function clean(mode: number): Project {
  const p = load();
  p.edit("limpar", () => {
    p.root()!.set("m_nMode", mode);
    mm(p).setRaw("m_vpLPMoves", encodeContainer(0x18, []));
    mm(p).setRaw("m_vpSchedMoves", encodeContainer(0x18, []));
  });
  return p;
}
const landCut = (p: Project) => p.get(142n)!; // work places 158 (10900 bcm) e 210 (13100 bcm), m_bLow = false
const fill = (p: Project) => p.get(177n)!; // work place 179 (31000 ccm)

describe("CA-RN-020 transporte manual no Plan", () => {
  it("origem com dois work places e destino com um: um LPMove manual por par, min(restante, não movido)", () => {
    const p = clean(0);
    const oids = createManualMove(p, { source: landCut(p), destination: fill(p), amount: 15000 });
    const ms = oids.map((o) => p.get(o)!);
    // tarefa "high" (m_bLow = false): work places invertidos → 210 primeiro
    expect(ms.map((m) => [m.className, m.get("m_pSrcWorkPlace"), m.get("m_pDstWorkPlace"), n(m.get("m_dAmount")), m.get("m_bManual"), m.get("m_bActual")])).toEqual([
      ["LPMove", 210n, 179n, 13100, true, false],
      ["LPMove", 158n, 179n, 1900, true, false],
    ]);
    expect(unmoved(p, p.get(158n)!, true, 0)).toBeCloseTo(9000, 9);
    expect(n(p.get(ms[0]!.get("m_pPath") as bigint)!.get("m_dLength"))).toBeGreaterThan(0);
  });
  it("pedido maior que o disponível para quando a origem acaba; undo desfaz", () => {
    const p = clean(0);
    const oids = createManualMove(p, { source: landCut(p), destination: fill(p), amount: 99999 });
    expect(oids.map((o) => n(p.get(o)!.get("m_dAmount"))).reduce((a, b) => a + b)).toBeCloseTo(24000, 9);
    p.undo();
    expect(mm(p).get("m_vpLPMoves")).toEqual([]);
  });
  it("recusas: quantidade ≤ 0, mesma tarefa, tarefa intermediária", () => {
    const p = clean(0);
    expect(() => createManualMove(p, { source: landCut(p), destination: fill(p), amount: 0 })).toThrow(expect.objectContaining({ code: "AMOUNT_LESS_THAN_OR_EQUAL_ZERO" }));
    expect(() => createManualMove(p, { source: landCut(p), destination: landCut(p), amount: 10 })).toThrow(expect.objectContaining({ code: "INTERMEDIATE_SITE" }));
    const crush = p.byClass("CrushingPlant")[0]!;
    expect(() => createManualMove(p, { source: landCut(p), destination: crush, amount: 10 })).toThrow("manual moves to or from intermedate work sites are not supported");
  });
});

describe("RN-020 transporte manual no Schedule", () => {
  it("SchedMove manual com o mesmo perfil nos dois lados, dentro da janela e da capacidade livre", () => {
    const p = clean(1);
    const a = wpTimes(p.get(210n)!), b = wpTimes(p.get(179n)!);
    const begin = Math.max(a.begin, b.begin), end = Math.min(a.end, b.end);
    const oids = createManualMove(p, { source: landCut(p), destination: fill(p), amount: 5000, begin, end });
    expect(oids.length).toBeGreaterThan(0);
    const m = p.get(oids[0]!)!;
    expect([m.className, m.get("m_bManual"), m.get("m_bActual")]).toEqual(["SchedMove", true, false]);
    const sw = readWach(p.get(m.get("m_pSourceWachVector") as bigint)!), dw = readWach(p.get(m.get("m_pDestinationWachVector") as bigint)!);
    expect(sw.spans).toEqual(dw.spans);
    expect(sw.spans.every((s) => s.b >= begin && s.e <= end)).toBe(true);
    expect(sw.total()).toBeCloseTo(n(m.get("m_dAmount")), 6);
    const total = oids.reduce((s, o) => s + n(p.get(o)!.get("m_dAmount")), 0);
    expect(total).toBeLessThanOrEqual(5000 + 1e-6);
    // densidade nunca acima da taxa da equipe da origem (100 bcm/h) nem da do destino
    expect(Math.max(...sw.spans.map((s) => s.q))).toBeLessThanOrEqual(100 + 1e-9);
  });
  it("recusa fim ≤ início", () => {
    const p = clean(1);
    expect(() => createManualMove(p, { source: landCut(p), destination: fill(p), amount: 10, begin: 100, end: 100 })).toThrow(expect.objectContaining({ code: "BEGIN_TIME_GREATER_THAN_END_TIME" }));
  });
  it("work places travados como realizados ficam de fora", () => {
    const p = clean(1);
    p.edit("travar", () => (p.get(210n) as Entity).set("m_bLockedAsActual", true));
    const a = wpTimes(p.get(158n)!), b = wpTimes(p.get(179n)!);
    const oids = createManualMove(p, { source: landCut(p), destination: fill(p), amount: 500, begin: Math.max(a.begin, b.begin), end: Math.min(a.end, b.end) });
    expect(oids.every((o) => p.get(o)!.get("m_pSrcWorkPlace") === 158n)).toBe(true);
  });
});
