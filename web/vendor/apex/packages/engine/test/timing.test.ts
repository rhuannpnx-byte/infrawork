// U-07 (núcleo, D-020): cronograma. CA-RN-004: o recálculo reproduz m_beginTime/m_endTime salvos de todos os work
// places estritos dos exemplos (tolerância 0 s).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDr5 } from "../../dr5/src/index.js";
import { FIXTURES, oracleFiles } from "../../dr5/test/helpers.js";
import { Project, type Entity } from "../../model/src/index.js";
import { DEP, Scheduler, setToEndOfDay, STRICT_CLASSES } from "../src/index.js";

const load = (f: string) => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, f)))));
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 16);
const begin = (w: Entity) => Number(w.get("pDVar2") as bigint);
const end = (w: Entity) => Number(w.get("m_endTime") as bigint);

describe("CA-RN-004: recálculo = datas salvas pelo original", () => {
  for (const { entry, path } of oracleFiles()) {
    const p = Project.fromDr5(readDr5(new Uint8Array(readFileSync(path))));
    const strictWps = [...p.entities()].filter((e) => STRICT_CLASSES.has(e.className)).flatMap((s) => (s.get("m_vpWorkPlaces") as bigint[]).map((o) => p.get(o)!));
    if (strictWps.length === 0) continue;
    it(`${entry.file}: ${strictWps.length} work places estritos`, () => {
      const r = new Scheduler(p).calculate();
      const bad = strictWps.filter((w) => {
        const c = r.workPlaces.get(w.oid)!;
        return c.begin !== begin(w) || c.end !== end(w);
      }).map((w) => `${w.oid}: ${iso(r.workPlaces.get(w.oid)!.begin)}→${iso(r.workPlaces.get(w.oid)!.end)} salvo ${iso(begin(w))}→${iso(end(w))}`);
      expect(bad).toEqual([]);
    });
  }
});

describe("fora do ponto fixo: mudar o predecessor desloca o sucessor ASAP", () => {
  it("LandCut 2 com 50 % mais material → LandCut 3 (ASAP, FS) começa no novo fim", () => {
    const p = load("example_simple_road_project.dr5");
    const lc2 = p.get(164n)!, lc3 = p.get(145n)!;
    expect(lc3.get("m_bASAP")).toBe(true);
    const wp = p.get((lc2.get("m_vpWorkPlaces") as bigint[])[0]!)!;
    p.edit("mais material", () => wp.set("m_dSourceAmount", (wp.get("m_dSourceAmount") as number) * 1.5));
    const s = new Scheduler(p);
    const r = s.calculate();
    const newEnd = r.workPlaces.get(wp.oid)!.end;
    expect(newEnd).toBeGreaterThan(end(wp));
    const firstOf3 = Math.min(...(lc3.get("m_vpWorkPlaces") as bigint[]).map((o) => r.workPlaces.get(o)!.begin));
    const dep = p.byClass("Dependency").find((d) => d.get("m_pPredecessor") === 164n && d.get("m_pSuccessor") === 145n)!;
    expect(dep.get("m_nType")).toBe(DEP.FINISH_START);
    expect(firstOf3).toBe(newEnd); // StartTimeType ANYTIME, sem atraso
  });
  it("apply grava as datas num nível de undo; undo devolve as salvas", () => {
    const p = load("example_simple_road_project.dr5");
    const wp = p.get(158n)!;
    const before = [begin(wp), end(wp)];
    p.edit("dobra", () => wp.set("m_dSourceAmount", 21800));
    const s = new Scheduler(p);
    s.apply(s.calculate());
    expect(end(wp)).toBeGreaterThan(before[1]!);
    p.undo();
    expect([begin(wp), end(wp)]).toEqual(before);
  });
});

describe("CA-RN-001: duração = quantidade ÷ (taxa × coeficiente) em horas de trabalho", () => {
  it("LandCut 1: 10.900 a 85/h → fim no dia útil correspondente, ajustado ao fim do expediente", () => {
    const p = load("example_simple_road_project.dr5");
    const s = new Scheduler(p);
    const site = s.sites.get(142n)!;
    const wg = p.get(128n)!;
    const rate = ((wg.get("m_rates") as [bigint, number[]][]).find(([t]) => t === p.get(142n)!.get("m_pSourceLandType"))![1][0]!) * 1;
    expect(site.rate).toBe(rate);
    const w = site.wps.find((x) => x.entity.oid === 158n)!;
    expect(s.duration(site, w)).toBe(Math.round((10900 / rate) * 3600));
    const cal = site.calendar;
    const start = Number(new Date("2016-08-08T08:00:00Z").getTime() / 1000);
    expect(setToEndOfDay(cal, cal.WS2AS(cal.AS2WS(start) + s.duration(site, w), false))).toBe(end(p.get(158n)!));
  });
});

describe("CA-RN-003 e CA-RN-005 (cenários sobre o example_simple)", () => {
  it("FS com atraso de 2 dias úteis e de 2 dias corridos", () => {
    const run = (workDays: boolean) => {
      const p = load("example_simple_road_project.dr5");
      const dep = p.byClass("Dependency").find((d) => d.get("m_pPredecessor") === 164n && d.get("m_pSuccessor") === 145n)!;
      p.edit("atraso", () => {
        dep.set("m_nDelayMin", 2);
        dep.set("m_bIsDelayWorkDays", workDays);
      });
      const s = new Scheduler(p);
      const r = s.calculate();
      const predEnd = Math.max(...(p.get(164n)!.get("m_vpWorkPlaces") as bigint[]).map((o) => r.workPlaces.get(o)!.end));
      const succBegin = Math.min(...(p.get(145n)!.get("m_vpWorkPlaces") as bigint[]).map((o) => r.workPlaces.get(o)!.begin));
      return { predEnd, succBegin, cal: s.sites.get(145n)!.calendar };
    };
    const wd = run(true);
    expect(wd.succBegin).toBe(wd.cal.WS2AS(wd.cal.AS2WS(wd.cal.addWorkDays(wd.predEnd, 2, false)), true));
    const cd = run(false);
    expect(cd.succBegin).toBe(cd.cal.WS2AS(cd.cal.AS2WS(cd.predEnd + 2 * 86400), true));
  });
  it("fim mais tarde = mínimo de prazo, marco e data forçada; folgas", () => {
    const p = load("example_simple_road_project.dr5");
    const s0 = new Scheduler(p);
    const order = s0.calculate().order;
    const site = s0.sites.get(145n)!;
    expect(s0.latestAllowedFinish(site).constraint).toBe("TC_DEADLINE");
    const deadline = s0.projectEnd;
    let ms!: Entity;
    p.edit("marco e forçada", () => {
      ms = p.create("Milestone");
      ms.set("m_endDate", BigInt(deadline - 30 * 86400));
      ms.setRaw("m_spIncludedWorkSites", { kind: "container", type: 0x14, elemType: 0x18, items: [{ kind: "bigint", type: 0x18, value: 145n }] });
    });
    const s1 = new Scheduler(p);
    expect(s1.latestAllowedFinish(s1.sites.get(145n)!)).toEqual({ date: deadline - 30 * 86400, constraint: "TC_MILESTONE" });
    p.edit("forçada", () => {
      p.get(145n)!.set("m_forcedEndConstraint", 1);
      p.get(145n)!.set("m_forcedEndDate", BigInt(deadline - 60 * 86400));
    });
    const s2 = new Scheduler(p);
    expect(s2.latestAllowedFinish(s2.sites.get(145n)!).constraint).toBe("TC_FORCED_FINISH");
    const f = s2.floats(order).get(145n)!;
    expect(f.latestTotalStart).toBeGreaterThanOrEqual(f.currentStart);
    expect(f.latestFreeStart).toBeLessThanOrEqual(f.latestTotalStart);
    // um prazo antes do início atual zera as folgas
    p.edit("prazo curto", () => p.get(145n)!.set("m_forcedEndDate", BigInt(f.currentStart - 86400)));
    const f3 = new Scheduler(p).floats(order).get(145n)!;
    expect([f3.latestFreeStart, f3.latestTotalStart]).toEqual([f3.currentStart, f3.currentStart]);
  });
});
