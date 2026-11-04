// U-11: controle sobre um projeto — forecast (RN-007, RF-033), travamento (RF-023), caminhões e recursos (RF-034,
// RF-035), curva de massa do projeto (RF-036). Sem oráculo do original (nenhum .dr5 de exemplo tem apontamentos):
// casos sintéticos sobre example_simple_road_project, conferidos contra o pseudocódigo (analise_controle_u11.md).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDr5, writeContainer } from "../../dr5/src/index.js";
import { FIXTURES } from "../../dr5/test/helpers.js";
import { encode, encodeContainer, Project, type Entity } from "../../model/src/index.js";
import {
  actualProductionRate, addActual, compareSchedule, compareTiming, controlDate, forecast, forecastedProductionRate, implementationDegree, lockActuals, massCurve,
  resourceCost, resourceUsage, Scheduler, setControlDate, setFinished, totalHours, unlockAsActual, wpTimes,
} from "../src/index.js";

const load = () => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")))));
const n = (v: unknown) => (typeof v === "number" ? v : 0);
const DAY = 86400;
const firstBegin = (p: Project, oid: bigint) => Math.min(...new Scheduler(p).sites.get(oid)!.wps.map((w) => w.begin));

describe("RN-007 forecast", () => {
  it("taxa prevista = d·real + (1 − d)·planejada com os apontamentos do sentido", () => {
    const p = load();
    const ws = p.get(142n)!; // LandCut 1: 24.000 bcm, tarefa high
    const s = new Scheduler(p);
    const t0 = firstBegin(p, 142n);
    addActual(p, { workSite: ws, begin: t0, end: t0 + 2 * DAY, amount: 6000, low: false, source: true });
    const cal = s.sites.get(142n)!.calendar;
    const hours = (cal.AS2WS(t0 + 2 * DAY) - cal.AS2WS(t0)) / 3600;
    expect(actualProductionRate(p, ws, cal, false, true)).toBeCloseTo(6000 / hours, 9);
    expect(implementationDegree(p, ws, true, false, true)).toBeCloseTo(0.25, 12);
    const plan = s.sites.get(142n)!.rate;
    expect(forecastedProductionRate(p, ws, new Scheduler(p), false, true)).toBeCloseTo(0.25 * (6000 / hours) + 0.75 * plan, 9);
    // sentido baixo sem apontamento: d = 0 → só a planejada
    expect(forecastedProductionRate(p, ws, new Scheduler(p), true, false)).toBeCloseTo(plan, 9);
  });
  it("frente única: realizado travado no alto, saldo de 18.000 a partir de max(data de controle, fim do apontamento)", () => {
    const p = load();
    const ws = p.get(142n)!;
    const t0 = firstBegin(p, 142n);
    addActual(p, { workSite: ws, begin: t0, end: t0 + 2 * DAY, amount: 6000, low: false, source: true });
    setControlDate(p, t0 + 5 * DAY);
    const [f, ...rest] = forecast(p).get(142n)!;
    expect(rest).toEqual([]);
    expect(f!.low).toBe(false);
    expect(f!.start).toBe(t0 + 5 * DAY);
    const acts = f!.places.filter((x) => x.actual), fc = f!.places.filter((x) => !x.actual);
    expect(acts.map((x) => [x.begin, x.end, x.amount])).toEqual([[t0, t0 + 2 * DAY, 6000]]);
    expect(fc.reduce((a, x) => a + x.amount, 0)).toBeCloseTo(18000, 6);
    // realizado no topo (sentido alto); saldo abaixo dele, em sequência de cima para baixo depois do início
    expect(Math.max(...fc.map((x) => x.stationEnd))).toBeLessThanOrEqual(acts[0]!.stationBegin + 1e-9);
    const ord = fc.slice().sort((a, b) => b.stationBegin - a.stationBegin);
    expect(ord[0]!.begin).toBeGreaterThanOrEqual(t0 + 5 * DAY);
    for (let i = 1; i < ord.length; i++) expect(ord[i]!.begin).toBeGreaterThanOrEqual(ord[i - 1]!.end);
  });
  it("duas frentes opostas se encontram: nenhuma estaca prevista em dobro e saldo ≤ o que falta", () => {
    const p = load();
    const ws = p.get(142n)!;
    const t0 = firstBegin(p, 142n);
    addActual(p, { workSite: ws, begin: t0, end: t0 + DAY, amount: 3000, low: true, source: true });
    addActual(p, { workSite: ws, begin: t0, end: t0 + DAY, amount: 3000, low: false, source: true });
    setControlDate(p, t0 + 2 * DAY);
    const fronts = forecast(p).get(142n)!;
    expect(fronts.map((f) => f.low).sort()).toEqual([false, true]);
    const lo = fronts.find((f) => f.low)!.places.filter((x) => !x.actual), hi = fronts.find((f) => !f.low)!.places.filter((x) => !x.actual);
    const loMax = Math.max(...lo.map((x) => x.stationEnd)), hiMin = Math.min(...hi.map((x) => x.stationBegin));
    expect(loMax).toBeLessThanOrEqual(hiMin + 1e-6);
    expect([...lo, ...hi].reduce((a, x) => a + x.amount, 0)).toBeLessThanOrEqual(18000 + 1e-6);
  });
  it("tarefa encerrada sem apontamento não tem previsão; data de controle fica no intervalo do calendário", () => {
    const p = load();
    setFinished(p, p.get(142n)!, true);
    expect(forecast(p).has(142n)).toBe(false);
    setControlDate(p, -1e12);
    expect(controlDate(p)).toBeGreaterThan(0);
  });
});

describe("RF-023 travamento dos realizados", () => {
  it("trava os work places concluídos, cria o SchedMove realizado do transporte apontado e registra o ActualsLocking", () => {
    const p = load();
    const cut = p.get(164n)!, fill = p.get(177n)!; // um work place cada: 166 e 179
    const t0 = wpTimes(p.get(166n)!).begin;
    const si = addActual(p, { workSite: cut, begin: t0, end: t0 + 3 * DAY, amount: n(p.get(166n)!.get("m_dSourceAmount")), low: true, source: true });
    const di = addActual(p, { workSite: fill, begin: t0, end: t0 + 3 * DAY, amount: n(p.get(179n)!.get("m_dDestinationAmount")), low: true, source: false });
    setControlDate(p, t0 + 4 * DAY);
    const mm = p.get(p.root()!.get("m_pMoveManager") as bigint)!;
    p.edit("utilização", () => {
      const u = p.create("ImplUtilization");
      u.set("m_strName", "");
      u.set("m_strLongName", "");
      u.set("m_pUIInfo", null);
      u.set("m_pSrcWorkPlace", 166n);
      u.set("m_pDstWorkPlace", 179n);
      u.set("m_pSourceLandType", si.get("m_pSourceLandType") as bigint);
      u.set("m_pPath", null);
      u.set("m_bManual", false);
      u.set("m_bActual", true);
      u.set("m_dAmount", 1000);
      u.set("m_pSourceInfo", si.oid);
      u.set("m_pDestinationInfo", di.oid);
      mm.setRaw("m_utilizations", encodeContainer(0x18, [u.oid]));
    });
    const r = lockActuals(p);
    expect(r.locked.slice().sort()).toEqual([166n, 179n]);
    expect(wpTimes(p.get(166n)!)).toEqual({ begin: t0, end: t0 + 3 * DAY });
    const act = p.byClass("SchedMove").filter((m) => m.get("m_bActual") === true);
    expect(act.map((m) => [m.get("m_pSrcWorkPlace"), m.get("m_pDstWorkPlace")])).toEqual([[166n, 179n]]);
    expect(n(act[0]!.get("m_dAmount"))).toBeCloseTo(1000, 6);
    expect(p.byClass("ActualsLocking").map((x) => x.get("m_date"))).toEqual([BigInt(t0 + 4 * DAY)]);
    expect(() => Project.fromDr5(readDr5(writeContainer(p.toDpl())))).not.toThrow();
    unlockAsActual(p, p.get(166n)!);
    unlockAsActual(p, p.get(179n)!);
    expect(p.byClass("ActualsLocking")).toEqual([]);
  });
  it("com realizados (e o LP sem travá-los) o cronograma e a otimização continuam iguais ao original", async () => {
    const p = load();
    addActual(p, { workSite: p.get(142n)!, begin: 0, end: DAY, amount: 10, low: true, source: true });
    expect(compareTiming(p).ok).toBe(true);
    expect((await compareSchedule(p)).ok).toBe(true);
  });
});

describe("RF-034/RF-035 caminhões, recursos e custos", () => {
  function withTransporter(p: Project): Entity {
    let T!: Entity;
    p.edit("transportador", () => {
      T = p.create("Transporter");
      T.set("m_strName", "Caminhão");
      T.setRaw("m_mDistanceWorkAchievement", { kind: "map", type: 0x15, keyType: 0x0d, valueType: 0x0d, entries: [[encode(0x0d, 100), encode(0x0d, 60)], [encode(0x0d, 5000), encode(0x0d, 10)]] });
      T.setRaw("m_unsuitableRoutes", encodeContainer(0x18, []));
      for (const g of [128n, 129n]) p.get(g)!.set("m_pHaulResource", T.oid);
    });
    return T;
  }
  it("caminhões por span = ceil(taxa / w(d)) sob a sum task da origem e seus ancestrais", () => {
    const p = load();
    const T = withTransporter(p);
    const r = resourceUsage(p);
    expect(r.impeded.every((x) => x.mask === 1)).toBe(true); // só origens cuja equipe não tem transportador
    const spans = r.usage.usage(r.root!, T.oid);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.every((s) => Number.isInteger(s.q) && s.q > 0)).toBe(true);
  });
  it("tarefa estrita usa a equipe inteira; aterro não tem custo do lado de envio", () => {
    const p = load();
    const r = resourceUsage(p, false);
    const it = new Scheduler(p).sites.get(177n)!.crew.items[0]!;
    expect(totalHours(r.usage.usage(it.sumTask!, it.resource))).toBeGreaterThan(0);
    expect(resourceCost(p, p.get(177n)!, false)).toBeGreaterThanOrEqual(0);
    expect(resourceCost(p, p.get(177n)!, true)).toBe(0);
  });
});

describe("RF-036 curva de massa do projeto", () => {
  it("estacas crescentes, trechos de corte (sobe) e de aterro (desce) na road line principal", () => {
    const p = load();
    const pts = massCurve(p, p.root()!.get("m_pMainRoadLine") as bigint);
    expect(pts.length).toBeGreaterThan(2);
    for (let i = 1; i < pts.length; i++) expect(pts[i]![0]).toBeGreaterThanOrEqual(pts[i - 1]![0]);
    const d = pts.slice(1).map((x, i) => x[1] - pts[i]![1]);
    expect(d.some((x) => x > 0) && d.some((x) => x < 0)).toBe(true);
  });
});
