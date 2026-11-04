// U-07b: pack schedule (RF-031, RN-006). Sem oráculo de prioridades no original: os exemplos guardam prioridades
// escolhidas à mão. Os testes conferem as regras lidas (PackSchedule @0x97ea00, TotalFloatCmp @0x97bc20).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDr5 } from "../../dr5/src/index.js";
import { FIXTURES } from "../../dr5/test/helpers.js";
import { Project } from "../../model/src/index.js";
import { packSchedule, Scheduler } from "../src/index.js";

const load = () => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")))));

describe("RN-006 pack schedule", () => {
  it("prioridades 10, 20, 30… em ordem de fim total mais tarde (o mais crítico recebe a maior)", () => {
    const p = load();
    const opt = new Scheduler(p, { optimistic: true });
    const order = opt.order();
    opt.calculate(false);
    const fl = opt.floats([...order, ...[...opt.sites.keys()].filter((o) => !order.includes(o))]);
    const finish = (o: bigint) => {
      const s = opt.sites.get(o)!, d = opt.nonLockedDuration(s), lts = fl.get(o)!.latestTotalStart;
      return d !== 0 ? s.calendar.WS2AS(s.calendar.AS2WS(lts) + d, false) : lts;
    };
    const { priorities } = packSchedule(p);
    expect(priorities.size).toBe(opt.sites.size);
    expect([...priorities.values()].sort((a, b) => a - b)).toEqual(Array.from({ length: priorities.size }, (_, i) => 10 * (i + 1)));
    const byPrio = [...priorities].sort((a, b) => b[1] - a[1]).map(([o]) => o);
    for (let i = 1; i < byPrio.length; i++) expect(finish(byPrio[i - 1]!)).toBeLessThanOrEqual(finish(byPrio[i]!));
    for (const [o, pr] of priorities) expect(p.get(o)!.get("m_nSchedulingPriority")).toBe(pr);
  });
  it("CPM otimista: ASAP e equipe adequada de maior taxa", () => {
    const p = load();
    const opt = new Scheduler(p, { optimistic: true });
    // LandCut 1 (Landcut 40t, 85/h): a Rock Cut também serve ao tipo? a escolhida tem a maior taxa entre as adequadas
    const site = p.get(142n)!;
    const best = opt.chooseBest(site)!;
    const type = site.get("m_pSourceLandType");
    const rate = (g: typeof best) => ((g.get("m_rates") as [unknown, number[]][] | undefined)?.find(([t]) => t === type)?.[1][0] ?? 0);
    for (const g of p.byClass("WorkGroup")) if (opt.isSuitableGroup(site, g, 1)) expect(rate(g)).toBeLessThanOrEqual(rate(best));
    expect(opt.sites.get(142n)!.rate).toBe(rate(best) * Math.max(site.get("m_dWachCoeff") as number, 1));
  });
  it("início desejado = início do projeto; um nível de undo devolve prioridades e datas", () => {
    const p = load();
    const before = new Map([...p.entities()].map((e) => [e.oid, [e.get("m_nSchedulingPriority"), e.get("pDVar2"), e.get("m_endTime")]]));
    const { result } = packSchedule(p);
    const start = new Scheduler(p).projectStart;
    // nenhuma tarefa estrita sem predecessor começa depois do início do projeto ajustado ao primeiro instante útil
    const strictNoPred = [142n, 177n, 138n];
    for (const o of strictNoPred) {
      const s = new Scheduler(p).sites.get(o)!;
      const b = Math.min(...s.wps.map((w) => result.workPlaces.get(w.entity.oid)!.begin));
      expect(b).toBe(s.calendar.WS2AS(s.calendar.AS2WS(start), true));
    }
    p.undo();
    for (const e of p.entities()) expect([e.get("m_nSchedulingPriority"), e.get("pDVar2"), e.get("m_endTime")]).toEqual(before.get(e.oid));
  });
  it("determinístico", () => {
    expect([...packSchedule(load()).priorities]).toEqual([...packSchedule(load()).priorities]);
  });
});
