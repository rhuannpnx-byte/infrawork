// L-045 (U-20): TaskActuals::Calculate @0x9caf00 e auxiliares, contra os casos de
// analises/2026-10-11_dynaroad/handoff/docs/analise_realizados_l045_l048.md §1.5–§1.6.
import { describe, expect, it } from "vitest";
import { Calendar, type CalendarSpec } from "../../calendar/src/index.js";
import { ddlDateFromParts } from "../../dr5/src/index.js";
import type { Entity } from "../../model/src/index.js";
import { actualIntervals, calculateTaskActuals, mapQuantityPosToDatePos, subtimespanPortion } from "../src/actuals.js";

const H = 3600;
/** segunda a sexta 8:00–16:00 */
const SPEC: CalendarSpec = {
  version: 12,
  week: { flag: 1, days: [0, 1, 2, 3, 4, 5, 6].map((d) => (d < 5 ? { begin: 8 * H, length: 8 * H } : { begin: 0, length: 0 })) as CalendarSpec["week"]["days"] },
  generators: [],
  order: [],
  spans: [],
};
const cal = new Calendar(SPEC);
const at = (day: number, h: number) => Number(ddlDateFromParts(2016, 7, 18 + day, h)); // 18/07/2016 = segunda
let next = 1000n;
const fake = (className: string, f: Record<string, unknown>): Entity => {
  const oid = next++;
  return { oid, className, get: (k: string) => f[k] } as unknown as Entity;
};
const ws = (finished = false) => fake("LandCut", { m_bFinished: finished });
const actual = (amount: number, b: number, e: number, low = true) => fake("ImplInfo", { m_dAmount: amount, m_dateBegin: BigInt(b), m_dateEnd: BigInt(e), m_bLow: low, m_bSource: true });

describe("auxiliares do TaskActuals", () => {
  it("GetSubtimespanPortion em horas de trabalho; MapQuantityPosToDatePos com floor no início e ceil no fim", () => {
    expect(subtimespanPortion(at(0, 12), at(0, 16), at(0, 8), at(0, 16), cal)).toBe(0.5);
    expect(subtimespanPortion(at(0, 20), at(0, 22), at(0, 20), at(0, 22), cal)).toBe(1); // fora do expediente: segundos absolutos
    expect(mapQuantityPosToDatePos(1, 3, at(0, 8), at(0, 16), cal, true)).toBe(at(0, 8) + Math.floor(28800 / 3));
    expect(mapQuantityPosToDatePos(1, 3, at(0, 8), at(0, 16), cal, false)).toBe(at(0, 8) + Math.ceil(28800 / 3));
    expect(mapQuantityPosToDatePos(0, 0, at(0, 8), at(0, 16), cal, false)).toBe(at(0, 16));
  });
  it("interval_map: instantâneo vira 1 s; sobreposição gera trecho com os dois", () => {
    const a1 = actual(160, at(0, 8), at(0, 16)), a2 = actual(40, at(0, 12), at(0, 16)), a3 = actual(5, at(1, 9), at(1, 9));
    const segs = actualIntervals([a1, a2, a3]);
    expect(segs.map((s) => [s.b, s.e, s.set.length])).toEqual([[at(0, 8), at(0, 12), 1], [at(0, 12), at(0, 16), 2], [at(1, 9), at(1, 9) + 1, 1]]);
  });
});

describe("L-045 TaskActuals::Calculate (§1.6)", () => {
  const W = () => [fake("MovableWorkPlace", {}), fake("MovableWorkPlace", {}), fake("MovableWorkPlace", {})] as const;
  it("sentido baixo: W1 completo, W2 completo em dois dias, W3 sem chave; porções e datas", () => {
    const [w1, w2, w3] = W();
    const a1 = actual(200, at(0, 8), at(0, 16)), a2 = actual(100, at(1, 8), at(1, 16));
    const r = calculateTaskActuals(ws(), [[w1, 100], [w2, 200], [w3, 100]], true, actualIntervals([a1, a2]), cal);
    expect([...r.taskLocationQuantities]).toEqual([[w1.oid, 100], [w2.oid, 200]]);
    expect(r.locationTimings.get(w1.oid)).toEqual([at(0, 8), at(0, 12)]);
    expect(r.locationTimings.get(w2.oid)).toEqual([at(0, 12), at(1, 16)]);
    expect(r.portions.get(a1.oid)).toEqual([0, 0.5]);
    expect(r.portions.get(a2.oid)).toEqual([0.5, 0.75]);
    expect(r.locationQuantities.get(a1.oid)).toEqual(new Map([[w1.oid, 100], [w2.oid, 100]]));
    expect(r.actualTimings.get(`${w2.oid}:${a2.oid}`)).toEqual([at(1, 8), at(1, 16)]);
  });
  it("sentido alto: começa por W3; porções medidas da estaca baixa", () => {
    const [w1, w2, w3] = W();
    const a1 = actual(200, at(0, 8), at(0, 16), false), a2 = actual(100, at(1, 8), at(1, 16), false);
    const r = calculateTaskActuals(ws(), [[w1, 100], [w2, 200], [w3, 100]], false, actualIntervals([a1, a2]), cal);
    expect(r.taskLocationQuantities.get(w3.oid)).toBe(100);
    expect(r.taskLocationQuantities.get(w2.oid)).toBe(200);
    expect(r.taskLocationQuantities.has(w1.oid)).toBe(false);
    expect(r.portions.get(a1.oid)).toEqual([0.5, 1]);
    expect(r.portions.get(a2.oid)).toEqual([0.25, 0.5]);
  });
  it("sobreposição: o trecho de 60 vai 40 para A1 e 20 para A2, das 12:00 às 14:00", () => {
    const [w1, w2] = W();
    const a1 = actual(160, at(0, 8), at(0, 16)), a2 = actual(40, at(0, 12), at(0, 16));
    const r = calculateTaskActuals(ws(), [[w1, 140], [w2, 60]], true, actualIntervals([a1, a2]), cal);
    expect(r.actualTimings.get(`${w1.oid}:${a2.oid}`)).toEqual([at(0, 12), at(0, 14)]);
    expect(r.locationQuantities.get(a2.oid)!.get(w1.oid)).toBeCloseTo(20, 9);
    expect(r.locationQuantities.get(a1.oid)!.get(w1.oid)).toBeCloseTo(120, 9);
    expect(r.taskLocationQuantities.get(w2.oid)).toBeCloseTo(60, 9);
    expect(r.locationTimings.get(w2.oid)).toEqual([at(0, 14), at(0, 16)]);
  });
  it("sobre-execução (A > P) e tarefa encerrada (A < P) espalham por todos os work places", () => {
    const [w1, w2] = W();
    const over = calculateTaskActuals(ws(), [[w1, 100], [w2, 100]], true, actualIntervals([actual(300, at(0, 8), at(0, 16))]), cal);
    expect([over.taskLocationQuantities.get(w1.oid), over.taskLocationQuantities.get(w2.oid)]).toEqual([150, 150]);
    const fin = calculateTaskActuals(ws(true), [[w1, 100], [w2, 100]], true, actualIntervals([actual(100, at(0, 8), at(0, 16))]), cal);
    expect([fin.taskLocationQuantities.get(w1.oid), fin.taskLocationQuantities.get(w2.oid)]).toEqual([50, 50]);
  });
  it("sem apontamentos: nada iniciado", () => {
    const [w1] = W();
    expect(calculateTaskActuals(ws(), [[w1, 100]], true, [], cal).taskLocationQuantities.size).toBe(0);
  });
});
