// U-07b: dependências automáticas por tipo (RN-030). Oráculo: as dependências não geradas pelo usuário salvas nos
// exemplos (8 + 12 + 23 por idioma) — o plano tem de reproduzi-las exatamente.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDr5, writeDr5 } from "../../dr5/src/index.js";
import { FIXTURES, oracleFiles } from "../../dr5/test/helpers.js";
import { Project, type Entity } from "../../model/src/index.js";
import { applyAutoDependencies, planAutoDependencies } from "../src/index.js";

const load = () => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")))));
const savedAuto = (p: Project) =>
  p.byClass("Dependency").filter((d) => d.get("m_bUserGenerated") !== true).map((d) => `${d.get("m_pPredecessor")}>${d.get("m_pSuccessor")}:${d.get("m_nType")}:${d.get("m_nDelayMin")}`).sort();
const planned = (p: Project) => planAutoDependencies(p).map((d) => `${d.pred}>${d.succ}:${d.type}:${d.delay}`).sort();

describe("CA-RN-030: plano = dependências automáticas salvas pelo original", () => {
  for (const { entry, path } of oracleFiles()) {
    const p = Project.fromDr5(readDr5(new Uint8Array(readFileSync(path))));
    if (p.byClass("Dependency").length === 0) continue;
    it(`${entry.file}: ${savedAuto(p).length} automáticas`, () => expect(planned(p)).toEqual(savedAuto(p)));
  }
});

describe("aplicação", () => {
  it("projeto já consistente: nada muda e não abre nível de undo", () => {
    const p = load();
    expect(applyAutoDependencies(p)).toEqual({ removed: 0, created: 0 });
    expect(p.canUndo).toBe(false);
  });
  it("sem a TypeDependency LandCut → RockCut, saem as automáticas desse par; undo devolve; regravar e reler funciona", () => {
    const p = load();
    const before = savedAuto(p);
    const lc = p.byClass("SourceLandType").find((t) => t.name === "LandCut")!;
    const rc = p.byClass("SourceLandType").find((t) => t.name === "RockCut")!;
    const td = p.byClass("TypeDependency").find((t) => t.get("m_pPredecessor") === lc.oid && t.get("m_pSuccessor") === rc.oid)!;
    p.edit("tira regra", () => {
      for (const t of [lc, rc]) t.setRaw("m_vpDependencies", { ...(t.fields.find((f) => f.id === 200)!.value as never), items: (t.fields.find((f) => f.id === 200)!.value as { items: { value: bigint }[] }).items.filter((i) => i.value !== td.oid) } as never);
    });
    const r = applyAutoDependencies(p);
    expect(r.removed).toBeGreaterThan(0);
    expect(r.created).toBe(0);
    const after = savedAuto(p);
    expect(after.length).toBe(before.length - r.removed);
    expect(after.some((k) => k.startsWith("164n>160n") || k.startsWith("164>160"))).toBe(false);
    // listas das tarefas e do gerenciador sem referências soltas
    for (const ws of [...p.byClass("LandCut"), ...p.byClass("Embankment"), ...p.byClass("OtherWorkSite")])
      for (const o of ws.get("m_vpDependencies") as bigint[]) expect(p.get(o)?.className).toBe("Dependency");
    const again = Project.fromDr5(readDr5(writeDr5(p.toDr5())));
    expect(savedAuto(again)).toEqual(after);
    p.undo();
    expect(savedAuto(p)).toEqual(before);
  });
  it("tarefa nova que cruza uma existente e deriva dos tipos ganha a dependência, com UIInfo/UILayOut próprios", () => {
    const p = load();
    const lc1 = p.get(142n)!;
    p.edit("deriva", () => p.get(160n)!.set("m_bDerivePredecessorsFromTypes", true));
    // RockCut (160) cruza LandCut 1 (142)? só se as faixas se sobrepõem; força cruzamento movendo um work place
    const wp = p.get((p.get(160n)!.get("m_vpWorkPlaces") as bigint[])[0]!)!;
    const loc = p.get(wp.get("m_pLocation") as bigint)!;
    const lcLoc = p.get(p.get((lc1.get("m_vpWorkPlaces") as bigint[])[0]!)!.get("m_pLocation") as bigint)!;
    p.edit("cruza", () => {
      loc.set("m_pRoadLine", lcLoc.get("m_pRoadLine") as bigint);
      loc.set("m_dStationBegin", lcLoc.get("m_dStationBegin") as number);
      loc.set("m_dStationEnd", (lcLoc.get("m_dStationBegin") as number) + 10);
    });
    const exp = planned(p).filter((k) => !savedAuto(p).includes(k));
    const r = applyAutoDependencies(p);
    expect(r.created).toBe(exp.length);
    expect(savedAuto(p)).toEqual(planned(p));
    const fresh = p.byClass("Dependency").reduce((a, b) => (b.oid > a.oid ? b : a)) as Entity;
    for (const k of ["m_pUIInfo", "m_pUILayOut"]) expect(p.get(fresh.get(k) as bigint)).toBeDefined();
    expect(fresh.get("m_bHasMinDelay")).toBe(true);
    expect(fresh.get("m_bHasMaxDelay")).toBe(false);
  });
});
