// U-55: lacunas [D] do motor — L-040 (Merge do WachContainer), L-041 (defeito do TryToExtractChain, imitado),
// L-053/D12 (spans de grafos), D11 (horas da tarefa no custo), L-015 (MakeContainerNoWork).
// Evidência: analises/2026-10-11_dynaroad/handoff/docs/motor_controle_u52_u55.md §4–§5.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Calendar } from "@apex/calendar";
import { readDr5 } from "../../dr5/src/index.js";
import { FIXTURES } from "../../dr5/test/helpers.js";
import { Project } from "../../model/src/index.js";
import { DistanceCalculatorManager, makeContainer, resourceCost, tryToExtractChain, WachContainer, wpTimes } from "../src/index.js";

const load = () => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")))));
const DAY = 86400;

describe("L-040 QuantitySpanContainer<Date,Quantity>::Merge@0x963880 / MergeImpl@0x963910", () => {
  it("ignora densidade ≈ 0 e span vazio; descarta peça de soma ≈ 0; não funde vizinhos iguais", () => {
    const w = new WachContainer(null);
    w.addSpan({ b: 0, e: 100, q: 0 });
    w.addSpan({ b: 50, e: 50, q: 3 });
    expect(w.spans).toEqual([]);
    w.addSpan({ b: 0, e: 100, q: 2 });
    w.addSpan({ b: 100, e: 200, q: 2 });
    expect(w.spans.map((s) => [s.b, s.e, s.q])).toEqual([[0, 100, 2], [100, 200, 2]]);
    w.addSpan({ b: 50, e: 150, q: -2 });
    expect(w.spans.map((s) => [s.b, s.e, s.q])).toEqual([[0, 50, 2], [150, 200, 2]]);
  });
});

describe("L-041 TryToExtractChain@0x9db0e0 (defeito do original imitado, D10)", () => {
  it("V2 recebe as últimas k colunas do vetor; as da cadeia fora do fim somem; as do fim ficam duplicadas", () => {
    const v = [{ chain: 1, id: "1a" }, { chain: 2, id: "2a" }, { chain: 1, id: "1b" }, { chain: 3, id: "3a" }, { chain: 2, id: "2b" }];
    const r = tryToExtractChain(v, 1);
    expect(r.kept.map((x) => x.id)).toEqual(["2a", "3a", "2b"]);
    expect(r.extracted.map((x) => x.id)).toEqual(["3a", "2b"]);
    // cadeia no fim do vetor: o resultado coincide com o correto
    const ok = tryToExtractChain([{ chain: 2, id: "2a" }, { chain: 1, id: "1a" }], 1);
    expect(ok.extracted.map((x) => x.id)).toEqual(["1a"]);
  });
});

describe("L-053 / D12: grafos válidos no tempo (QuantitySpanContainer<ActiveRoadConnectionsAndBreaks>)", () => {
  const breakWith = (p: Project, b: number, e: number) =>
    p.edit("break", () => {
      const u = p.create("UsageBreak");
      u.set("m_beginTimingType", 1);
      u.set("m_endTimingType", 1);
      u.set("m_beginDate", BigInt(b));
      u.set("m_endDate", BigInt(e));
    });
  it("peças vizinhas com o mesmo grafo não se fundem; span invertido é descartado (sem corte)", () => {
    const p = load();
    breakWith(p, 10 * DAY, 20 * DAY);
    const pieces = new DistanceCalculatorManager(p).calculatorsFor(0, 30 * DAY);
    expect(pieces.map((x) => [x.begin / DAY, x.end / DAY])).toEqual([[0, 10], [10, 20], [20, 30]]);
    expect(pieces[0]!.calculator).toBe(pieces[2]!.calculator);
    const q = load();
    breakWith(q, 20 * DAY, 10 * DAY);
    expect(new DistanceCalculatorManager(q).calculatorsFor(0, 30 * DAY).length).toBe(1);
  });
});

describe("D11 ResourceCostHelpers::GetResourceCost: horas da tarefa", () => {
  it("folga entre os work places entra nas horas (a soma por work place não mudaria)", () => {
    const p = load();
    const ws = p.get(142n)!;
    const before = resourceCost(p, ws, true);
    // o work place que começa primeiro vai 14 dias mais cedo, com a mesma duração: abre uma folga
    const w = [p.get(158n)!, p.get(210n)!].sort((a, b) => wpTimes(a).begin - wpTimes(b).begin)[0]!;
    const { begin, end } = wpTimes(w);
    p.edit("folga", () => {
      w.set("pDVar2", BigInt(begin - 14 * DAY));
      w.set("m_endTime", BigInt(end - 14 * DAY));
    });
    expect(resourceCost(p, ws, true)).toBeGreaterThan(before);
  });
});

describe("L-015 MakeContainerNoWork@0x963590", () => {
  it("sem horas de trabalho: um span [b, e] com densidade q / horas corridas", () => {
    const cal = { AS2WS: () => 0, workPeriods: () => [] } as unknown as Calendar;
    const w = makeContainer(48, null, 0, 2 * DAY, cal);
    expect(w.spans).toEqual([{ b: 0, e: 2 * DAY, q: 1 }]);
  });
});
