// U-08: adaptador LP (RN-010 parte "solver"; ClpHelpers::ModelRow, LomBuild, RunSimplex).
import { describe, expect, it } from "vitest";
import { COIN_DBL_MAX, LomBuild, LpError, MAX_ROW_TERMS, ModelRow, solveLp, type LpModel } from "../src/index.js";

const model = (b: LomBuild, cost: number[]): LpModel => ({ colCost: cost, colLower: b.columnLowers, colUpper: b.columnUppers, rows: b.rows });

describe("ModelRow", () => {
  it("linha vazia é ignorada; 1 termo vira limite de coluna", () => {
    const b = new LomBuild(2);
    new ModelRow().addTo(b);
    const r = new ModelRow();
    r.addEntry(1, 2);
    r.lower = 4;
    r.upper = 10;
    r.addTo(b);
    expect(b.rows).toEqual([]);
    expect([b.columnLowers[1], b.columnUppers[1]]).toEqual([2, 5]);
  });
  it("linha sem efeito (limites não cortam a atividade possível) é descartada", () => {
    const b = new LomBuild(2);
    const r = new ModelRow();
    r.addEntry(0, 1);
    r.addEntry(1, 1);
    b.columnUppers[0] = b.columnUppers[1] = 3;
    r.addTo(b); // [0, COIN_DBL_MAX] com atividade em [0, 6]
    expect(b.rows).toEqual([]);
    r.upper = 5;
    r.addTo(b);
    expect(b.rows).toEqual([{ indices: [0, 1], coeffs: [1, 1], lower: 0, upper: 5 }]);
  });
  it("mais de 5460 termos: coluna auxiliar com os limites da linha", () => {
    const n = MAX_ROW_TERMS + 1;
    const b = new LomBuild(n);
    const r = new ModelRow();
    for (let j = 0; j < n; j++) r.addEntry(j, 1);
    r.upper = 3;
    r.sparsifyAndAddTo(b);
    expect(b.numCols).toBe(n + 1);
    expect([b.columnLowers[n], b.columnUppers[n]]).toEqual([0, 3]);
    expect(b.rows).toHaveLength(1); // Σ − a = 0; a linha da auxiliar tem 1 termo e vira limite
    expect(b.rows[0]!.indices).toHaveLength(n + 1);
    expect([b.rows[0]!.lower, b.rows[0]!.upper, b.rows[0]!.coeffs.at(-1)]).toEqual([0, 0, -1]);
  });
});

describe("solveLp", () => {
  // 2 origens (10, 5) × 1 destino obrigatório (12) com folga penalizada
  const transport = () => {
    const b = new LomBuild(2);
    const src = [10, 5].map((free, j) => {
      const r = new ModelRow();
      r.upper = free;
      r.addEntry(j, 1);
      return r;
    });
    const dst = new ModelRow();
    dst.lower = dst.upper = 12;
    const s = b.allocateSuperCol();
    dst.addEntry(s, 1);
    dst.addEntry(0, 1);
    dst.addEntry(1, 1);
    for (const r of [...src, dst]) r.addTo(b);
    return b;
  };
  it("ótimo: usa a origem barata até o limite e completa com a cara", async () => {
    const b = transport();
    const r = await solveLp(model(b, [1, 3, 100]));
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    expect(r.x.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([10, 2, 0]);
    expect(r.objective).toBeCloseTo(16, 9);
  });
  it("inviável: mesma mensagem do original", async () => {
    const b = new LomBuild(2);
    const r = new ModelRow();
    r.addEntry(0, 1);
    r.addEntry(1, 1);
    r.lower = 5;
    r.upper = 5;
    b.columnUppers[0] = b.columnUppers[1] = 1;
    r.addTo(b);
    await expect(solveLp(model(b, [1, 1]))).rejects.toThrow(new LpError("INFEASIBLE", "Linear programming model was not feasible."));
  });
  it("cancelado antes ou durante: sem solução", async () => {
    expect(await solveLp(model(transport(), [1, 3, 100]), () => false)).toEqual({ status: "canceled" });
    let calls = 0;
    const big = new LomBuild(400);
    for (let i = 0; i < 20; i++) {
      const r = new ModelRow();
      for (let j = i * 20; j < i * 20 + 20; j++) r.addEntry(j, 1 + ((i * j) % 7));
      r.lower = r.upper = 50 + i;
      r.addTo(big);
    }
    for (let j = 0; j < 400; j++) {
      const r = new ModelRow();
      for (let i = j % 20; i < 20; i += 3) r.addEntry((j + i * 20) % 400, 1);
      r.upper = 30;
      r.addTo(big);
    }
    const out = await solveLp(model(big, Array.from({ length: 400 }, (_, j) => 1 + ((j * 37) % 11))), () => calls++ < 3);
    expect(out).toEqual({ status: "canceled" });
  });
  it("COIN_DBL_MAX vira infinito do solver", async () => {
    const b = new LomBuild(1);
    expect(b.columnUppers[0]).toBe(COIN_DBL_MAX);
    const r = await solveLp(model(b, [2]));
    expect(r).toEqual({ status: "optimal", x: [0], objective: 0 });
  });
});
