// U-07b: violações (RF-037, ViolationHelper @0x6b31b0). Os exemplos não trazem marcos nem datas forçadas; os cenários
// partem do example_simple e conferem cada regra lida.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDr5 } from "../../dr5/src/index.js";
import { FIXTURES, oracleFiles } from "../../dr5/test/helpers.js";
import { Project, type Entity } from "../../model/src/index.js";
import { realDelay, Scheduler, violations } from "../src/index.js";

const load = () => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")))));
const DAY = 86400;
const span = (p: Project, oid: bigint) => {
  const s = new Scheduler(p).sites.get(oid)!;
  return { b: Math.min(...s.wps.map((w) => w.begin)), e: Math.max(...s.wps.map((w) => w.end)) };
};
const kinds = (p: Project, oid: bigint) => violations(new Scheduler(p)).filter((v) => v.site === oid).map((v) => `${v.kind}:${"point" in v ? v.point : ""}`).sort();

describe("RF-037 violações", () => {
  it("exemplos como salvos: nenhuma violação de projeto ou dependência", () => {
    for (const { path } of oracleFiles()) {
      const p = Project.fromDr5(readDr5(new Uint8Array(readFileSync(path))));
      expect(violations(new Scheduler(p)).filter((v) => v.kind === "project" || v.kind === "dependency")).toEqual([]);
    }
  });
  it("datas forçadas: só o dia conta", () => {
    const p = load();
    const { b, e } = span(p, 142n);
    p.edit("exata no mesmo dia", () => {
      const s = p.get(142n)!;
      s.set("m_forcedBeginConstraint", 2);
      s.set("m_forcedBeginDate", BigInt(Math.floor(b / DAY) * DAY + 3600));
      s.set("m_forcedEndConstraint", 1);
      s.set("m_forcedEndDate", BigInt(Math.floor(e / DAY) * DAY));
    });
    expect(kinds(p, 142n)).toEqual([]);
    p.edit("um dia antes", () => {
      p.get(142n)!.set("m_forcedBeginDate", BigInt(b - DAY));
      p.get(142n)!.set("m_forcedEndDate", BigInt(e - DAY));
    });
    expect(kinds(p, 142n)).toEqual(["forced:FINISH", "forced:START"]);
    p.edit("mais cedo", () => p.get(142n)!.set("m_forcedBeginConstraint", 1));
    expect(kinds(p, 142n)).toEqual(["forced:FINISH"]); // início depois do mais cedo permitido não viola
  });
  it("marco que contém a tarefa e janela do projeto", () => {
    const p = load();
    const { b, e } = span(p, 145n);
    let m!: Entity;
    p.edit("marco", () => {
      m = p.create("Milestone");
      m.set("m_beginDate", BigInt(b + 3600));
      m.set("m_endDate", BigInt(e - 3600));
      m.setRaw("m_spIncludedWorkSites", { kind: "container", type: 0x14, elemType: 0x18, items: [{ kind: "bigint", type: 0x18, value: 145n }] });
    });
    expect(kinds(p, 145n)).toEqual(["milestone:FINISH", "milestone:START"]);
    p.edit("prazo", () => p.root()!.set("m_dateDeadline", BigInt(e - 1)));
    expect(kinds(p, 145n)).toContain("project:FINISH");
    expect(kinds(p, 142n)).not.toContain("project:FINISH");
  });
  it("atraso máximo: FS em dias corridos e em dias úteis", () => {
    const p = load();
    const dep = p.byClass("Dependency").find((d) => d.get("m_pPredecessor") === 177n && d.get("m_pSuccessor") === 185n)!; // Fill 1 → Fill 2, FS
    const s = new Scheduler(p);
    const r = realDelay(s, dep)!;
    const fill1 = span(p, 177n), fill2 = span(p, 185n);
    expect(r).toBe((fill2.b - fill1.e) / DAY);
    p.edit("máximo abaixo", () => {
      dep.set("m_bHasMaxDelay", true);
      dep.set("m_nDelayMax", Math.floor(r) - 1 < 0 ? -1 : Math.floor(r) - 1);
    });
    expect(kinds(p, 185n)).toEqual(["dependency:"]);
    p.edit("dias úteis", () => dep.set("m_bIsDelayWorkDays", true));
    const wd = realDelay(new Scheduler(p), dep)!;
    expect(Number.isInteger(wd)).toBe(true);
    p.edit("máximo = real", () => dep.set("m_nDelayMax", wd));
    expect(kinds(p, 185n)).toEqual([]);
  });
});
