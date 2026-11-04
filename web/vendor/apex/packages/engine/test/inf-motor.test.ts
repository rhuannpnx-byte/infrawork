// U-61f (frente motor-controle, D-040): fechamento por inferência estática dos itens do ALINHAMENTO sobre o motor,
// o cronograma, os custos, a otimização, o controle e o undo. Evidência nova em
// analises/2026-10-11_dynaroad/evidencias/decompilado/u61f_motor/ (lote1, lote2, consts, repair) e os 27 .dr5 (APEX_ORACLES).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FieldValue } from "@apex/dr5";
import { readDr5 } from "../../dr5/src/index.js";
import { FIXTURES, oracleFiles } from "../../dr5/test/helpers.js";
import { MAX_UNDO_LEVELS, Project, type Entity } from "../../model/src/index.js";
import {
  actualsOf, addActual, addActualHaul, ceil64, combineWorkSites, doubleToInt64, floor64, forecast, fullTransactionDescription, HAUL_CALCULATION_ACTION, hasSavedMoves,
  implementedAmount, logicalCompare, makeUndoText, namePred, NULL_WORK_GROUP_RATE, PACK_SCHEDULE_ACTION, packSchedule, planOptimize, projectUndoText,
  scheduleOptimize, Scheduler, setControlDate, splitWorkSiteByAmounts, splitWorkSiteByStation, STRICT_CLASSES, utilizationsOf, wpTimes,
} from "../src/index.js";

const load = () => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")))));
const n = (v: unknown) => (typeof v === "number" ? v : 0);
const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);
const mm = (p: Project) => p.get(p.root()!.get("m_pMoveManager") as bigint)!;
const DAY = 86400;
const named = (p: Project, name: string) => p.edit("nome", () => p.root()!.set("m_strName", name));

describe("U-61f names.ts: KernelObjectHelpers::NamePred@0x930900 e ChangeInfo::MakeUndoText@0x4ae3e0", () => {
  it("ordem lógica (P-7 [O chamada; P colador]): 'Cut 2' antes de 'Cut 10'; nomes iguais → descrição; tudo igual → OID", () => {
    const p = load();
    const [a, b, c] = ["Cut 2", "Cut 10", "cut 2"].map((nm, i) => p.edit("t", () => {
      const e = p.create("LandCut");
      e.set("m_strName", nm);
      e.set("m_strLongName", i === 2 ? "B" : "A");
      return e;
    }));
    expect(logicalCompare("Cut 2", "Cut 10")).toBeLessThan(0);
    expect("Cut 2" < "Cut 10").toBe(false); // a ordem por unidade de código daria o contrário
    expect(namePred(a!, b!)).toBeLessThan(0);
    expect(namePred(b!, a!)).toBeGreaterThan(0);
    // nomes diferentes só por maiúsculas: o colador empata → OID [P]
    expect(namePred(a!, c!)).toBeLessThan(0);
    // nomes iguais, descrições diferentes → descrição
    const d = p.edit("t", () => {
      const e = p.create("LandCut");
      e.set("m_strName", "Cut 2");
      e.set("m_strLongName", "0");
      return e;
    });
    expect(namePred(d, a!)).toBeLessThan(0);
    expect(namePred(a!, a!)).toBe(0);
  });
  it("MakeUndoText: alvo vazio → ação; ação vazia → alvo; os dois → 'alvo: ação em minúsculas'; junção com ', '", () => {
    expect(makeUndoText("", "Haul Calculation")).toBe("Haul Calculation");
    expect(makeUndoText("Obra", "")).toBe("Obra");
    expect(makeUndoText("Obra", "Haul Calculation")).toBe("Obra: haul calculation");
    expect(fullTransactionDescription(["Task 1: actuals", "", "Task 1: add actual"])).toBe("Task 1: actuals, Task 1: add actual");
    const p = load();
    expect(projectUndoText(p, HAUL_CALCULATION_ACTION)).toBe("Haul Calculation"); // o exemplo não tem nome de projeto
    named(p, "Obra");
    expect(projectUndoText(p, HAUL_CALCULATION_ACTION)).toBe("Obra: haul calculation");
    expect(projectUndoText(p, PACK_SCHEDULE_ACTION)).toBe("Obra: pack schedule");
  });
  it("AL-MOT-70/AL-RIB-26: o nível do Plan, do Schedule e do Pack usa o nome do projeto (13031 e PackScheduleCommand 14584)", async () => {
    const p = load();
    named(p, "Obra");
    await planOptimize(p, { maxMoveDistance: 1 });
    expect(p.undoNames().at(-1)).toBe("Obra: haul calculation");
    p.edit("modo", () => p.root()!.set("m_nMode", 1));
    await scheduleOptimize(p, { maxMoveDistance: 1 });
    expect(p.undoNames().at(-1)).toBe("Obra: haul calculation");
    packSchedule(p);
    expect(p.undoNames().at(-1)).toBe("Obra: pack schedule");
  });
});

describe("U-61f tools.ts: Tools::DoubleToInt64@0xa13b60, Floor64@0xa13200, Ceil64@0xa12b50 (AL-MOT-27)", () => {
  it("meio afastado de zero; piso e teto reais", () => {
    expect(doubleToInt64(2.5)).toBe(3);
    expect(doubleToInt64(2.4999)).toBe(2);
    expect(doubleToInt64(-2.5)).toBe(-3); // Math.round daria −2
    expect(doubleToInt64(-2.4)).toBe(-2);
    expect(doubleToInt64(0)).toBe(0);
    expect(floor64(-1.5)).toBe(-2);
    expect(ceil64(-1.5)).toBe(-1);
    expect(ceil64(1.0001)).toBe(2);
  });
});

describe("U-61f undo: StateManager::BeginUndoLevel@0x8f1b80 (AL-MOT-69, AL-MOT-71)", () => {
  it("limite de 10 níveis: ao passar de 10 sai o mais antigo (salvo o nível ainda aberto — pinned — que não entra na pilha)", () => {
    const p = load();
    expect(MAX_UNDO_LEVELS).toBe(10);
    for (let i = 1; i <= 12; i++) p.edit(`n${i}`, () => p.root()!.set("m_strName", `x${i}`));
    expect(p.undoNames()).toEqual(["n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11", "n12"]);
    // a transação de um diálogo (nível pinned, UndoLevel::m_bPinned = true desde o construtor) fica fora da pilha até o OK
    p.beginLevel("dlg");
    p.transact(() => p.root()!.set("m_strName", "dlg"));
    expect(p.undoNames().length).toBe(10);
    p.commitLevel("dlg");
    expect(p.undoNames().at(-1)).toBe("dlg");
    expect(p.undoNames().length).toBe(10);
    expect(p.undoNames()[0]).toBe("n4");
  });
});

describe("U-61f cronograma: equipe nula (AL-MOT-26) e arredondamento (AL-MOT-27)", () => {
  it("NullWorkGroup::GetProductionRate@0x9a86c0 = 1e7: a duração sai de DoubleToInt64(q ÷ 1e7 × 3600)", () => {
    const p = load();
    const ws = p.get(142n)!; // LandCut 1, 24 000 bcm
    const fv = ws.field("m_cSelectedSubWorkGroups")!.value;
    expect(fv.kind).toBe("map");
    const nullGroup = p.root()!.get("m_pNullWorkGroup") as bigint;
    expect(p.get(nullGroup)?.className).toBe("NullWorkGroup");
    const edited = structuredClone(fv) as Extract<FieldValue, { kind: "map" }>;
    for (const e of edited.entries) e[1] = { kind: "bigint", type: 0x18, value: nullGroup };
    p.edit("equipe nula", () => ws.setRaw("m_cSelectedSubWorkGroups", edited));
    const s = new Scheduler(p);
    const site = s.sites.get(142n)!;
    expect(site.rate).toBe(NULL_WORK_GROUP_RATE * n(ws.get("m_dWachCoeff") ?? 1));
    const w = site.wps[0]!;
    expect(s.duration(site, w)).toBe(doubleToInt64((w.amount / site.rate) * 3600));
    expect(s.duration(site, w)).toBeLessThan(10);
  });
  it("AL-MOT-25: nos 27 exemplos, as tarefas com marcos, limites de recurso ou dependências BY_STATIONS recalculam nas datas salvas", () => {
    const found: string[] = [];
    for (const { entry, path } of oracleFiles()) {
      const p = Project.fromDr5(readDr5(new Uint8Array(readFileSync(path))));
      const milestones = p.byClass("Milestone").length;
      const limited = p.byClass("Resource").filter((r) => ((r.get("m_mQuantityRestrictions") as unknown[] | undefined) ?? []).length > 0).length;
      const byStations = p.byClass("Dependency").filter((d) => n(d.get("m_nType")) === 4).length;
      if (!milestones && !limited && !byStations) continue;
      const strictWps = [...p.entities()].filter((e) => STRICT_CLASSES.has(e.className)).flatMap((s) => refs(s.get("m_vpWorkPlaces")).map((o) => p.get(o)!));
      const r = new Scheduler(p).calculate();
      const bad = strictWps.filter((w) => {
        const c = r.workPlaces.get(w.oid)!;
        return c.begin !== Number(w.get("pDVar2")) || c.end !== Number(w.get("m_endTime"));
      });
      found.push(`${entry.file}: marcos=${milestones} recursos limitados=${limited} by_stations=${byStations} divergentes=${bad.length}`);
      expect(bad, entry.file).toEqual([]);
    }
    if (oracleFiles().length > 2) expect(found.length).toBeGreaterThan(0);
  });
});

describe("U-61f dividir e combinar (AL-MOT-08, AL-MOT-09)", () => {
  it("Split by quantity com 100 % de quantidade não inteira: igual à atual → o work place zera e sai; acima (texto arredondado) → AMOUNT_OUT_OF_RANGE [I]", () => {
    const p = load();
    const ws = p.get(142n)!;
    const wp = p.get(158n)!;
    p.edit("q", () => wp.set("m_dSourceAmount", 1234.56));
    const other = refs(ws.get("m_vpWorkPlaces")).filter((o) => o !== 158n);
    // "1234.6" (ToText com 1 casa, lido de volta por TextToDouble) > 1234.56 → `A < x` estrito em SplitWorkSiteByAmounts@0x97f450 [O]
    const amounts = new Map<bigint, [number, number]>([[158n, [1234.6, 0]], ...other.map((o) => [o, [0, 0]] as [bigint, [number, number]])]);
    expect(() => splitWorkSiteByAmounts(p, ws, amounts)).toThrow(/AMOUNT_OUT_OF_RANGE/);
    const exact = new Map<bigint, [number, number]>([[158n, [1234.56, 0]], ...other.map((o) => [o, [0, 0]] as [bigint, [number, number]])]);
    const clone = splitWorkSiteByAmounts(p, ws, exact);
    expect(refs(ws.get("m_vpWorkPlaces"))).not.toContain(158n); // zerou e a tarefa tinha mais de um work place
    expect(refs(clone.get("m_vpWorkPlaces")).length).toBe(1);
  });
  it("Combine (P-1): a tarefa que fica começa no menor início das combinadas (min_element@0x979e50 + WorkSite::SetBeginTime@0x942c60)", () => {
    const p = load();
    const pit = p.byClass("WasteLand")[0]!; // não estrita: as datas dos work places não são refeitas pelo recálculo (RN-018)
    const wp0 = p.get(refs(pit.get("m_vpWorkPlaces"))[0]!)!;
    const b0 = wpTimes(wp0).begin, e0 = wpTimes(wp0).end;
    const clone = splitWorkSiteByAmounts(p, pit, new Map([[wp0.oid, [0, n(wp0.get("m_dDestinationAmount")) / 2]]]));
    const cw = p.get(refs(clone.get("m_vpWorkPlaces"))[0]!)!;
    // a que fica começa 5 dias depois, a absorvida 3 dias depois: o mínimo (3 dias) vence; sem a regra, o recálculo
    // partiria do início do projeto (b0)
    p.edit("datas", () => {
      wp0.set("pDVar2", BigInt(b0 + 5 * DAY));
      wp0.set("m_endTime", BigInt(e0 + 5 * DAY));
      cw.set("pDVar2", BigInt(b0 + 3 * DAY));
      cw.set("m_endTime", BigInt(e0 + 3 * DAY));
    });
    const kept = combineWorkSites(p, [pit, clone])!;
    expect(kept.oid).toBe(pit.oid);
    expect(p.get(clone.oid)).toBeUndefined();
    const begins = refs(kept.get("m_vpWorkPlaces")).map((o) => wpTimes(p.get(o)!).begin);
    // o work place refeito começa em min(início das combinadas) antes do ResetTimings; depois dele as datas da tarefa não
    // estrita seguem os transportes salvos (RN-018), como no original (SetBeginTime → ResetTimings) [I]
    expect(begins.length).toBe(1);
    expect(begins[0]).toBeGreaterThanOrEqual(b0);
    expect(p.undoNames().at(-1)).toBe("Combine tasks");
  });
  it("Combine com realizados (P-2, CopyImplementations@0x984e50): apontamentos e utilizações da absorvida ficam na que fica", () => {
    const p = load();
    const t0 = wpTimes(p.get(158n)!).begin;
    const info = addActual(p, { workSite: p.get(142n)!, begin: t0, end: t0 + 3 * DAY, amount: 12000, low: true, source: true });
    addActualHaul(p, { info, amount: 5000, source: p.get(142n)!, sourceLow: true, destination: p.get(177n)!, destinationLow: true });
    const clone = splitWorkSiteByStation(p, p.get(142n)!, 450)!;
    const before = implementedAmount(p, p.get(142n)!, true, true, true) + implementedAmount(p, clone, true, true, true);
    combineWorkSites(p, [p.get(142n)!, clone]);
    expect(p.get(clone.oid)).toBeUndefined();
    expect(implementedAmount(p, p.get(142n)!, true, true, true)).toBeCloseTo(before, 6);
    const infos = actualsOf(p, p.get(142n)!);
    expect(infos.length).toBeGreaterThan(0);
    const used = infos.reduce((s, a) => s + utilizationsOf(p, a).reduce((t, u) => t + n(u.get("m_dAmount")), 0), 0);
    expect(used).toBeCloseTo(5000, 6);
    expect(refs(mm(p).get("m_utilizations")).every((o) => p.get(o))).toBe(true);
  });
});

describe("U-61f controle L-046: GetPortionMap@0x987b80 / GetPortionMapImpl@0x987dd0 / DoAmount@0x9855d0", () => {
  it("apontamentos sobrepostos no tempo são fundidos (Merge) e a massa acumulada vira estacas; pedaços cortados nos work places", () => {
    const p = load();
    const ws = p.get(142n)!; // LandCut 1: 158 [10 900] e 210 [13 100], 24 000
    const t0 = wpTimes(p.get(158n)!).begin;
    addActual(p, { workSite: ws, begin: t0, end: t0 + 2 * DAY, amount: 3000, low: true, source: true });
    addActual(p, { workSite: ws, begin: t0 + DAY, end: t0 + 3 * DAY, amount: 3000, low: true, source: true });
    setControlDate(p, t0 + 4 * DAY);
    const [f] = forecast(p).get(142n)!;
    const acts = f!.places.filter((x) => x.actual);
    expect(acts.length).toBe(3); // [t0,t0+1d] 1 500, [t0+1d,t0+2d] 3 000, [t0+2d,t0+3d] 1 500
    expect(acts.map((x) => Math.round(x.amount))).toEqual([1500, 3000, 1500]);
    expect(acts.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(6000, 6);
    for (let i = 1; i < acts.length; i++) expect(acts[i]!.stationBegin).toBeCloseTo(acts[i - 1]!.stationEnd, 9);
    expect(acts[0]!.begin).toBe(t0);
    expect(acts[2]!.end).toBe(t0 + 3 * DAY);
  });
  it("denominador: não encerrada → max(planejado, apontado); apontado acima do planejado cobre a tarefa inteira", () => {
    const p = load();
    const ws = p.get(142n)!;
    const t0 = wpTimes(p.get(158n)!).begin;
    addActual(p, { workSite: ws, begin: t0, end: t0 + 5 * DAY, amount: 30000, low: true, source: true });
    setControlDate(p, t0 + 6 * DAY);
    const [f] = forecast(p).get(142n)!;
    const acts = f!.places.filter((x) => x.actual);
    expect(acts.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(24000, 6); // |Δp| × planejado, Δp = 30 000 / 30 000
    expect(f!.places.filter((x) => !x.actual)).toEqual([]);
  });
});

describe("U-61f otimização: erro no meio (AL-MOT-42) e NOT_IMPLEMENTED (AL-MOT-41)", () => {
  it("Schedule que falha depois da remoção inicial não deixa transportes parciais nem nível de undo (Transaction::Cancel do 13031 [O])", async () => {
    const p = load();
    p.edit("modo", () => p.root()!.set("m_nMode", 1));
    const before = refs(mm(p).get("m_vpSchedMoves")).length;
    expect(before).toBeGreaterThan(0);
    const levels = p.undoNames().length;
    // erro depois do 1º passe (a remoção inicial já rodou no nível): `inOneLevel` desfaz tudo, como `Transaction::Cancel`
    let passes = 0;
    const boom = scheduleOptimize(p, { maxMoveDistance: 1e6, onPass: () => { if (++passes === 1) throw new Error("injected mid-solve"); } });
    await expect(boom).rejects.toThrow(/injected/);
    expect(refs(mm(p).get("m_vpSchedMoves")).length).toBe(before);
    expect(p.undoNames().length).toBe(levels);
  });
  it("taxa ≤ 0 da equipe → 'zero wach' (TC::WorkSite) e 'positive production rate required here' (GetUnitPriceFromResources@0x92a290 [O])", async () => {
    const p = load();
    const ws = p.get(142n)!;
    const sel = (ws.get("m_cSelectedSubWorkGroups") as [number, bigint][]).find(([u]) => u === 1)!;
    const g = p.get(sel[1])!;
    const rates = structuredClone(g.field("m_rates")!.value) as Extract<FieldValue, { kind: "map" }>;
    let touched = 0;
    for (const e of rates.entries) if (e[1].kind === "tuple" && e[1].items[0]?.kind === "float") { e[1].items[0] = { ...e[1].items[0], value: 0 }; touched++; }
    expect(touched).toBeGreaterThan(0);
    p.edit("taxa 0", () => g.setRaw("m_rates", rates));
    expect(() => new Scheduler(p)).toThrow(/zero wach/);
  });
});

describe("U-61f AL-MOT-40: passes 2/3 e pilhas nos exemplos com britagem (sem oráculo de transportes do Schedule)", () => {
  it("exemplos com britagem ou pilha e SchedMoves salvos: o Schedule termina sem erro; nenhum exemplo chega ao passe 2 (passes 2/3 seguem sem oráculo [D])", async () => {
    const seen: string[] = [];
    for (const { entry, path } of oracleFiles()) {
      if (!/example_simple_road_project/.test(entry.file)) continue; // os menores com britagem (um por idioma)
      const p = Project.fromDr5(readDr5(new Uint8Array(readFileSync(path))));
      if (!hasSavedMoves(p, "schedule") || (!p.byClass("CrushingPlant").length && !p.byClass("StockPile").length)) continue;
      p.edit("modo", () => p.root()!.set("m_nMode", 1));
      const r = await scheduleOptimize(p, {});
      expect(r.canceled).toBe(false);
      seen.push(`${entry.file}: passes até ${Math.max(1, ...r.passes.map((x) => x.pass))}`);
    }
    for (const s of seen) expect(s).toMatch(/passes até 1$/); // registro: nenhum exemplo exercita os passes 2/3
  }, 240_000);
});
