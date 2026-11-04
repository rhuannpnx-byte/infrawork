// U-10: dividir e combinar tarefas (RF-032, RN-021).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDr5 } from "../../dr5/src/index.js";
import { FIXTURES } from "../../dr5/test/helpers.js";
import { Project, type Entity, type Ref } from "../../model/src/index.js";
import { combineWorkSites, splitWorkSiteByAmounts, splitWorkSiteByStation } from "../src/index.js";

const load = () => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")))));
const n = (v: unknown) => (typeof v === "number" ? v : 0);
const refs = (v: unknown) => (Array.isArray(v) ? (v as bigint[]) : []);
const wps = (p: Project, ws: Entity) => refs(ws.get("m_vpWorkPlaces")).map((o) => p.get(o)!);
const loc = (p: Project, wp: Entity) => p.resolve(wp.get("m_pLocation") as Ref)!;
const span = (p: Project, wp: Entity) => ["m_dStationBegin", "m_dStationCOG", "m_dStationEnd"].map((k) => n(loc(p, wp).get(k)));
const src = (p: Project, ws: Entity) => wps(p, ws).reduce((s, w) => s + n(w.get("m_dSourceAmount")), 0);
const movesAt = (p: Project, wp: Entity) =>
  p.byClass("LPMove").filter((m) => m.get("m_pSrcWorkPlace") === wp.oid || m.get("m_pDstWorkPlace") === wp.oid).length;
const landCut = (p: Project) => p.get(142n)!; // work places 158 e 210

describe("RN-021 dividir por estaca", () => {
  it("corta o work place atravessado com r = (s − b)/(e − b) e recoloca o COG no meio de cada parte", () => {
    const p = load();
    const ws = landCut(p);
    const [w] = wps(p, ws).sort((a, b) => span(p, a)[0]! - span(p, b)[0]!);
    const [b, , e] = span(p, w!) as [number, number, number];
    const A = n(w!.get("m_dSourceAmount")), total = src(p, ws), count = wps(p, ws).length;
    const s = b + 0.3 * (e - b);
    expect(movesAt(p, w!)).toBeGreaterThan(0);
    const clone = splitWorkSiteByStation(p, ws, s)!;
    expect(clone.oid).not.toBe(ws.oid);
    expect(clone.className).toBe("LandCut");
    // o work place cortado fica no original com a fração r; o resto vai para o clone
    const cut = p.get(w!.oid)!;
    expect(n(cut.get("m_dSourceAmount"))).toBeCloseTo(A * 0.3, 6);
    expect(span(p, cut)).toEqual([b, b + (s - b) * 0.5, s]);
    const part = wps(p, clone).find((x) => n(loc(p, x).get("m_dStationBegin")) === s)!;
    expect(n(part.get("m_dSourceAmount"))).toBeCloseTo(A * 0.7, 6);
    expect(span(p, part)).toEqual([s, s + (e - s) * 0.5, e]);
    // conservação e transportes do work place cortado apagados
    expect(src(p, ws) + src(p, clone)).toBeCloseTo(total, 6);
    expect(wps(p, ws).length + wps(p, clone).length).toBe(count + 1);
    expect(movesAt(p, cut)).toBe(0);
    // cópia: preços 0, recursos identificados vazios, derivar predecessores
    expect([clone.get("m_dSourceUnitPrice"), clone.get("m_bDerivePredecessorsFromTypes")]).toEqual([0, true]);
    // round-trip
    expect(() => Project.fromNativeJson(p.toNativeJson())).not.toThrow();
    expect(p.toDpl().length).toBeGreaterThan(0);
  });
  it("estaca fora da tarefa não divide; undo desfaz a divisão", () => {
    const p = load();
    const ws = landCut(p);
    const all = wps(p, ws).flatMap((w) => span(p, w));
    expect(splitWorkSiteByStation(p, ws, Math.min(...all))).toBeUndefined();
    expect(splitWorkSiteByStation(p, ws, Math.max(...all) + 10)).toBeUndefined();
    const before = p.byClass("LandCut").length, total = src(p, ws);
    const mid = (Math.min(...all) + Math.max(...all)) / 2;
    splitWorkSiteByStation(p, ws, mid);
    expect(p.byClass("LandCut").length).toBe(before + 1);
    p.undo();
    expect(p.byClass("LandCut").length).toBe(before);
    expect(src(p, landCut(p))).toBeCloseTo(total, 9);
  });
  it("nome automático: menor número livre do mesmo tipo e road line (LandCut 1, 2, 3 já existem)", () => {
    const p = load();
    const ws = landCut(p);
    p.edit("auto", () => ws.set("m_bAutoName", true));
    const all = wps(p, ws).flatMap((w) => span(p, w));
    const clone = splitWorkSiteByStation(p, ws, (Math.min(...all) + Math.max(...all)) / 2)!;
    expect(clone.get("m_strName")).toBe("LandCut 4");
  });
});

describe("RN-021 dividir por quantidades", () => {
  it("move a quantidade pedida para a tarefa nova; acima do atual é AMOUNT_OUT_OF_RANGE", () => {
    const p = load();
    const ws = landCut(p);
    const total = src(p, ws);
    expect(() => splitWorkSiteByAmounts(p, ws, new Map([[158n, [99999, 0]]]))).toThrow(expect.objectContaining({ code: "AMOUNT_OUT_OF_RANGE" }));
    expect(src(p, landCut(p))).toBeCloseTo(total, 9); // a recusa não deixa meia edição
    const clone = splitWorkSiteByAmounts(p, ws, new Map([[158n, [4000, 0]], [210n, [13100, 0]]]));
    expect(src(p, clone)).toBeCloseTo(17100, 6);
    expect(src(p, ws)).toBeCloseTo(total - 17100, 6);
    // 210 zerou no original (que tem dois) → apagado; 158 zerou… não: ficou com 6900
    expect(wps(p, ws).map((w) => w.oid)).toEqual([158n]);
  });
});

describe("RN-021 combinar", () => {
  it("dividir e combinar de volta conserva quantidades e cobre o mesmo trecho", () => {
    const p = load();
    const ws = landCut(p);
    const total = src(p, ws);
    const all = wps(p, ws).flatMap((w) => span(p, w));
    const clone = splitWorkSiteByStation(p, ws, (Math.min(...all) + Math.max(...all)) / 2)!;
    const kept = combineWorkSites(p, [ws, clone])!;
    expect(kept.oid).toBe(ws.oid);
    expect(p.get(clone.oid)).toBeUndefined();
    expect(src(p, kept)).toBeCloseTo(total, 6);
    const spans = wps(p, kept).map((w) => span(p, w));
    expect(Math.min(...spans.map((s) => s[0]!))).toBeCloseTo(Math.min(...all), 9);
    expect(Math.max(...spans.map((s) => s[2]!))).toBeCloseTo(Math.max(...all), 9);
    // COG ponderado pela massa: dentro de cada trecho
    for (const [b, c, e] of spans) expect(b! <= c! && c! <= e!).toBe(true);
    expect(() => Project.fromNativeJson(p.toNativeJson())).not.toThrow();
  });
  it("recusa tipos diferentes e road lines diferentes", () => {
    const p = load();
    const ws = landCut(p);
    expect(() => combineWorkSites(p, [ws, p.get(177n)!])).toThrow(expect.objectContaining({ code: "CANT_COMBINE_TASKS_WITH_DIFFERENT_TYPES" }));
    const all = wps(p, ws).flatMap((w) => span(p, w));
    const clone = splitWorkSiteByStation(p, ws, (Math.min(...all) + Math.max(...all)) / 2)!;
    const other = p.byClass("RoadLine").find((r) => r.oid !== loc(p, wps(p, ws)[0]!).get("m_pRoadLine"));
    if (!other) return; // fixture com uma road line só
    p.edit("mover", () => wps(p, clone).forEach((w) => loc(p, w).set("m_pRoadLine", other.oid)));
    expect(() => combineWorkSites(p, [ws, clone])).toThrow(expect.objectContaining({ code: "CANT_COMBINE_TASKS_ON_DIFFERENT_LOCATIONS" }));
  });
});
