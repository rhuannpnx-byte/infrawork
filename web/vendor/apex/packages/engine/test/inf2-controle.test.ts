// U-61j (D-041, frente controle, só estática): taxas do rótulo de recursos (GetResourceString@0x6e6340 → AL-VIS-42),
// encontro das frentes do forecast com os operandos lidos (GetForecastIntersectionStation@0x9f80e0, L-047),
// SchedMove::CheckDates@0x95f880 depois da divisão (L-R12) e Path::SetSource/SetDestination (L-R13).
// Evidência: analises/2026-10-11_dynaroad/evidencias/decompilado/u61j_controle/.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDr5 } from "../../dr5/src/index.js";
import { FIXTURES } from "../../dr5/test/helpers.js";
import { encode, Project, type Entity } from "../../model/src/index.js";
import {
  actualProductionRate, addActual, forecast, forecastIntersectionStation, NULL_WORK_GROUP_RATE, readWach, resourceLines, Scheduler, setControlDate, siteCalendar, splitWorkPlace,
  SplitError, wpTimes, type ForecastPlace,
} from "../src/index.js";

const load = (f = "example_simple_road_project.dr5") => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, f)))));
const loadActuals = () => load("example_simple_road_project_actuals.dr5");
const n = (v: unknown) => (typeof v === "number" ? v : 0);
const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);
const DAY = 86400;
const setMode = (p: Project, m: number) => p.edit("mode", () => p.root()!.set("m_nMode", m));
/** troca o mapa `uso → equipe` mantendo os tipos de chave e valor gravados */
const setSel = (ws: Entity, entries: [number, bigint][]) => {
  const v = ws.field("m_cSelectedSubWorkGroups")!.value as { keyType: number | null; valueType: number | null };
  const kt = v.keyType!, vt = v.valueType!;
  ws.setRaw("m_cSelectedSubWorkGroups", { kind: "map", type: 0x15, keyType: kt, valueType: vt, entries: entries.map(([k, g]) => [encode(kt, k), encode(vt, g)]) });
};
const groupRate = (g: Entity, type: unknown) => n(((g.get("m_rates") as [unknown, unknown[]][]).find(([k]) => k === type)?.[1] ?? [])[0]);

describe("AL-VIS-42 GetResourceString@0x6e6340: taxas planejada e realizada por uso", () => {
  it("LandCut 1 no CONTROL: uso 1, planejada = taxa da equipe × m_dWachCoeff, realizada = Σ q / Σ horas úteis da tarefa", () => {
    const p = loadActuals();
    const ws = p.get(142n)!;
    const [l, ...rest] = resourceLines(p, ws, true);
    expect(rest).toEqual([]);
    expect(l!.usage).toBe(1);
    expect(l!.group.get("m_strName")).toBe("Landcut 40t");
    expect(l!.planned!.q).toBeCloseTo(groupRate(l!.group, ws.get("m_pSourceLandType")) * n(ws.get("m_dWachCoeff") ?? 1), 9);
    // GetActualProductionRate(im, ws, true, true, bSource = true)@0x985f10 com o calendário da tarefa (m_pCalendar +0x110)
    const cal = new Scheduler(p).calendarOf(ws);
    expect(siteCalendar(p, ws)!.AS2WS(1470902400)).toBe(cal.AS2WS(1470902400));
    const info = p.byClass("ImplInfo").find((a) => a.get("m_pWorkSite") === 142n)!;
    const b = Number(info.get("m_dateBegin")), e = Number(info.get("m_dateEnd"));
    const hours = (cal.AS2WS(e) - cal.AS2WS(b)) / 3600;
    expect(l!.actual!.q).toBeCloseTo(12000 / hours, 9);
    expect(l!.actual!.q).toBeCloseTo(actualProductionRate(p, ws, cal, true, true, true), 12);
    expect(l!.actual!.unit).toBe(l!.planned!.unit);
  });
  it("fora do CONTROL não há realizada; tarefa não começada no CONTROL também não (optional vazio → '?')", () => {
    const p = loadActuals();
    expect(resourceLines(p, p.get(142n)!, false)[0]!.actual).toBeNull();
    const other = [...p.byClass("LandCut")].find((w) => w.oid !== 142n && !p.byClass("ImplInfo").some((a) => a.get("m_pWorkSite") === w.oid))!;
    const [l] = resourceLines(p, other, true);
    expect(l!.planned).not.toBeNull();
    expect(l!.actual).toBeNull();
  });
  it("aterro (uso 2, GetReceiveRate) com o ImplInfo automático do destino: realizada com bSource = false", () => {
    const p = loadActuals();
    const fill = p.get(177n)!;
    const [l] = resourceLines(p, fill, true);
    expect(l!.usage).toBe(2);
    const cal = new Scheduler(p).calendarOf(fill);
    expect(l!.actual!.q).toBeCloseTo(actualProductionRate(p, fill, cal, true, true, false), 12);
    expect(l!.actual!.q).toBeGreaterThan(0);
  });
  it("outra tarefa (uso 8, GetMainWach): a realizada só conta apontamentos 'baixos' (GetActualProductionRate(im, ws, true, false)@0x9863c0)", () => {
    const p = loadActuals();
    const oa = p.byClass("OtherActual")[0]!;
    const ws = p.get(oa.get("m_pWorkSite") as bigint)!;
    const [l] = resourceLines(p, ws, true);
    expect(l!.usage).toBe(8);
    expect(l!.planned!.q).toBeCloseTo(groupRate(l!.group, ws.get("m_pWorkType")) * n(ws.get("m_dWachCoeff") ?? 1), 9);
    expect(l!.actual!.q).toBeGreaterThan(0);
    p.edit("alto", () => oa.set("m_bLow", false));
    const [h] = resourceLines(p, ws, true);
    expect(h!.actual).toEqual({ q: 0, unit: l!.actual!.unit }); // começada (IsStarted) mas sem apontamento baixo: Q(0, unidade)
  });
  it("todas as entradas de m_cSelectedSubWorkGroups entram, em ordem de uso; NullWorkGroup tem taxa 1e7 (AL-MOT-26)", () => {
    const p = loadActuals();
    const ws = p.get(142n)!;
    const nullGroup = p.root()!.get("m_pNullWorkGroup") as bigint;
    const sel = (ws.get("m_cSelectedSubWorkGroups") as [number, bigint][]).map(([k, g]) => [k, g] as [number, bigint]);
    p.edit("equipe nula", () => setSel(ws, [[2, nullGroup], ...sel]));
    const lines = resourceLines(p, ws, false);
    expect(lines.map((l) => l.usage)).toEqual([1, 2]);
    // LandCut não tem tipo de destino: o original lançaria "no destination type" no GetReceiveRate [P: sem valor]
    expect(lines[1]!.planned).toBeNull();
    const cut2 = p.get(177n)!;
    p.edit("nula no aterro", () => setSel(cut2, [[2, nullGroup]]));
    expect(resourceLines(p, cut2, false)[0]!.planned!.q).toBeCloseTo(NULL_WORK_GROUP_RATE * n(cut2.get("m_dWachCoeff") ?? 1), 6);
  });
});

describe("L-047 GetForecastIntersectionStation@0x9f80e0 e HandleIntersectingForecasts@0x9f87c0", () => {
  const place = (stationBegin: number, stationEnd: number, begin: number, end: number): ForecastPlace => ({ stationBegin, stationEnd, begin, end, amount: 1, actual: false });
  it("a fórmula do ASM é a interseção da reta baixa (A→S) com a alta (S→A) em segundos de trabalho do calendário de p1", () => {
    const p = load();
    const cal = siteCalendar(p, p.get(142n)!)!;
    const t0 = wpTimes(p.get(158n)!).begin;
    const p1 = place(100, 400, t0, t0 + 3 * DAY), p2 = place(250, 700, t0 + DAY, t0 + 6 * DAY);
    const x = forecastIntersectionStation(cal, p1, p2);
    const ws = (t: number) => cal.AS2WS(t);
    const t1 = ws(p1.begin) + ((x - p1.stationBegin) / (p1.stationEnd - p1.stationBegin)) * (ws(p1.end) - ws(p1.begin));
    const t2 = ws(p2.begin) + ((p2.stationEnd - x) / (p2.stationEnd - p2.stationBegin)) * (ws(p2.end) - ws(p2.begin));
    expect(Number.isFinite(x)).toBe(true);
    expect(t1).toBeCloseTo(t2, 6);
    // com trechos válidos o denominador nunca zera (e1 < 0); trechos de duração nula no mesmo instante dão 0/0 = NaN,
    // que nenhum IsIntersecting aceita (o laço segue para o próximo par)
    const xd = forecastIntersectionStation(cal, place(0, 100, t0, t0), place(50, 150, t0, t0));
    expect(Number.isFinite(xd)).toBe(false);
  });
  it("duas frentes: a baixa termina onde a alta começa (estaca de encontro comum), saldo ≤ o que falta", () => {
    const p = load();
    const ws = p.get(142n)!;
    const t0 = Math.min(...new Scheduler(p).sites.get(142n)!.wps.map((w) => w.begin));
    addActual(p, { workSite: ws, begin: t0, end: t0 + DAY, amount: 3000, low: true, source: true });
    addActual(p, { workSite: ws, begin: t0, end: t0 + 2 * DAY, amount: 2000, low: false, source: true });
    setControlDate(p, t0 + 3 * DAY);
    const fronts = forecast(p).get(142n)!;
    const lo = fronts.find((f) => f.low)!.places.filter((x) => !x.actual), hi = fronts.find((f) => !f.low)!.places.filter((x) => !x.actual);
    expect(lo.length && hi.length).toBeGreaterThan(0);
    const loMax = Math.max(...lo.map((x) => x.stationEnd)), hiMin = Math.min(...hi.map((x) => x.stationBegin));
    expect(loMax).toBeCloseTo(hiMin, 6);
    expect([...lo, ...hi].reduce((a, x) => a + x.amount, 0)).toBeLessThanOrEqual(24000 - 5000 + 1e-6);
  });
});

describe("L-R12 SchedMove::CheckDates@0x95f880 e L-R13 Path::SetSource/SetDestination@0x99ba70/@0x99ba20", () => {
  const sched = (p: Project) => refs(p.get(p.root()!.get("m_pMoveManager") as bigint)!.get("m_vpSchedMoves")).map((o) => p.get(o)!);
  it("divisão normal passa pela validação; perfil que começa mais de 1 dia antes do work place da ponta lança invalid_argument", () => {
    const p = load();
    const ok = sched(p).filter((m) => m.get("m_pSrcWorkPlace") === 158n);
    expect(ok.length).toBeGreaterThan(0);
    let novo: Entity | undefined;
    p.edit("corte", () => (novo = splitWorkPlace(p, p.get(142n)!, p.get(158n)!, 0.25)));
    expect(novo).toBeDefined();
    // caso hostil: o destino do transporte passa a começar 2 dias depois do início do perfil de destino
    const q = load();
    const m = sched(q).find((x) => x.get("m_pSrcWorkPlace") === 158n)!;
    const dwp = q.get(m.get("m_pDstWorkPlace") as bigint)!;
    const w = readWach(q.get(m.get("m_pDestinationWachVector") as bigint)!);
    const wb = Math.min(...w.spans.map((s) => s.b));
    q.edit("destino", () => dwp.set("pDVar2", BigInt(wb + 2 * DAY) as never));
    let err: unknown;
    try {
      q.edit("corte", () => splitWorkPlace(q, q.get(142n)!, q.get(158n)!, 0.25));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SplitError);
    expect((err as SplitError).code).toBe("INVALID_SCHED_MOVE_DATES");
    expect((err as Error).message).toBe("destination wach vector starts before destination");
  });
  it("o caminho copiado do transporte novo troca só o work place da ponta; o comprimento fica (sem recálculo)", () => {
    const p = load();
    const before = sched(p).filter((m) => m.get("m_pSrcWorkPlace") === 158n).map((m) => n(p.get(m.get("m_pPath") as bigint)!.get("m_dLength")));
    let novo!: Entity;
    p.edit("corte", () => (novo = splitWorkPlace(p, p.get(142n)!, p.get(158n)!, 0.25)!));
    const created = sched(p).filter((m) => m.get("m_pSrcWorkPlace") === novo.oid);
    for (const m of created) {
      const path = p.get(m.get("m_pPath") as bigint)!;
      expect(p.get(refs(path.get("m_vpNodes"))[0]!)!.get("m_pWorkPlace")).toBe(novo.oid);
      expect(before).toContain(n(path.get("m_dLength")));
    }
  });
});
