// U-07b: nivelamento por recursos (RN-004, Crew::FindSlot). Os exemplos não têm restrição que limite (a única, 10 no
// example_area_construction, nunca é atingida): os cenários abaixo restringem o Exc40 do example_simple a 1.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Calendar } from "@apex/calendar";
import { readDr5 } from "../../dr5/src/index.js";
import { FIXTURES } from "../../dr5/test/helpers.js";
import { Project } from "../../model/src/index.js";
import { findSlotImpl, Scheduler, SpanContainer } from "../src/index.js";

const load = () => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")))));
const EXC40 = 59n, ROOT_ST = 37n;
const USERS = [142n, 145n, 160n, 164n]; // equipes Landcut 40t e Rock Cut usam 1 Exc40
const restrict = (p: Project, res: bigint, st: bigint, n: number) =>
  p.edit("restrição", () =>
    p.get(res)!.setRaw("m_mQuantityRestrictions", {
      kind: "map", type: 21, keyType: 24, valueType: 7,
      entries: [[{ kind: "bigint", type: 24, value: st }, { kind: "int", type: 7, value: n }]],
    }),
  );
const intervals = (p: Project, r: ReturnType<Scheduler["calculate"]>, oids: bigint[]) =>
  oids.flatMap((o) => (p.get(o)!.get("m_vpWorkPlaces") as bigint[]).map((w) => ({ site: o, ...r.workPlaces.get(w)! })));
const overlaps = (xs: { site: bigint; begin: number; end: number }[]) =>
  xs.flatMap((a, i) => xs.slice(i + 1).filter((b) => a.site !== b.site && a.begin < b.end && b.begin < a.end && a.begin < a.end && b.begin < b.end).map((b) => `${a.site}×${b.site}`));

describe("SpanContainer e FindSlotImpl", () => {
  it("soma na sobreposição e corta nas bordas", () => {
    const c = new SpanContainer();
    c.merge(0, 10, 1);
    c.merge(5, 15, 2);
    expect(c.spans).toEqual([{ b: 0, e: 5, q: 1 }, { b: 5, e: 10, q: 3 }, { b: 10, e: 15, q: 2 }]);
    c.merge(3, 3, 5);
    c.merge(20, 30, 0);
    expect(c.spans.length).toBe(3);
  });
  it("empurra para o fim do último span em conflito; respeita o limite", () => {
    const c = new SpanContainer();
    c.merge(100, 200, 1);
    c.merge(300, 400, 1);
    const cal24 = { AS2WS: (t: number) => t, WS2AS: (t: number) => t } as unknown as Calendar;
    expect(findSlotImpl(c, 1, 1, 0, 50, cal24)).toBe(0); // janela [0,50] livre
    expect(findSlotImpl(c, 1, 1, 0, 350, cal24)).toBe(400); // cruza os dois: o último
    expect(findSlotImpl(c, 2, 1, 0, 350, cal24)).toBe(0); // limite 2 comporta
    expect(findSlotImpl(c, 1, 1, 200, 50, cal24)).toBe(200); // span que termina no início não conta
    expect(findSlotImpl(undefined, 1, 1, 7, 5, cal24)).toBe(7);
  });
});

describe("RN-004 nivelamento: Exc40 limitado a 1 na sum task raiz", () => {
  it("sem restrição as tarefas do Exc40 se sobrepõem; com limite 1 não", () => {
    const p = load();
    const free = new Scheduler(p).calculate();
    expect(overlaps(intervals(p, free, USERS)).length).toBeGreaterThan(0);
    restrict(p, EXC40, ROOT_ST, 1);
    const lev = new Scheduler(p).calculate();
    expect(overlaps(intervals(p, lev, USERS))).toEqual([]);
    // calculate(false) ignora a restrição (CalculateTimings sem recursos)
    expect(new Scheduler(p).calculate(false).workPlaces).toEqual(free.workPlaces);
  });
  it("limite 2 comporta as duas ao mesmo tempo; limite numa sum task de outro ramo não vale", () => {
    const p = load();
    const free = new Scheduler(p).calculate();
    restrict(p, EXC40, ROOT_ST, 2);
    expect(new Scheduler(p).calculate().workPlaces).toEqual(free.workPlaces);
    let other!: bigint;
    p.edit("sum task vazia", () => {
      const st = p.create("SumTask");
      st.set("m_pParent", ROOT_ST);
      other = st.oid;
    });
    restrict(p, EXC40, other, 1);
    expect(new Scheduler(p).calculate().workPlaces).toEqual(free.workPlaces);
  });
  it("recurso identificado ocupa capacidade 1", () => {
    const p = load();
    const free = new Scheduler(p).calculate();
    let ir!: bigint;
    p.edit("identificado", () => {
      ir = p.create("IdentifiedResource").oid;
      for (const o of [145n, 160n])
        p.get(o)!.setRaw("m_mIdentifiedResources", {
          kind: "map", type: 21, keyType: 7, valueType: 24,
          entries: [[{ kind: "int", type: 7, value: 1 }, { kind: "bigint", type: 24, value: ir }]],
        });
    });
    const lev = new Scheduler(p).calculate();
    expect(overlaps(intervals(p, free, [145n, 160n])).length).toBeGreaterThan(0);
    expect(overlaps(intervals(p, lev, [145n, 160n]))).toEqual([]);
  });
});
