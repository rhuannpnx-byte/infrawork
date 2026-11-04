// U-11: controle — curva de massa (RN-019), caminhões (RN-008), forecast (RN-007).
import { describe, expect, it } from "vitest";
import { addWorkPlaceMass, DensityMap, integral } from "../src/masscurve.js";
import { vehiclesNeeded, wachAtDistance } from "../src/haulres.js";

describe("CA-RN-019 curva de massa", () => {
  it("corte de 1.000 entre 0 e 100 com COG em 25: dois blocos que preservam o COG e integral 1.000", () => {
    const m = new DensityMap();
    addWorkPlaceMass(m, 0, 25, 100, 1000);
    const segs = m.segments();
    expect(segs.map((s) => [s.s0, s.s1])).toEqual([[0, 25], [25, 100]]);
    expect(segs[0]!.density).toBeCloseTo(30, 12); // 750 em 25 m: (e − c)/(e − b) = 0,75
    expect(segs[1]!.density).toBeCloseTo(10 / 3, 12); // 250 em 75 m
    const cog = segs.reduce((s, x) => s + x.density * (x.s1 - x.s0) * (x.s0 + x.s1) / 2, 0) / 1000;
    expect(cog).toBeCloseTo(25, 12);
    const pts = integral(m);
    expect(pts[pts.length - 1]![1]).toBeCloseTo(1000, 9);
  });
  it("COG na borda desloca min(0,5, (e − b)/2); aterro entra negativo e soma com o corte", () => {
    const m = new DensityMap();
    addWorkPlaceMass(m, 0, 0, 100, 1000);
    expect(m.segments()[0]!.s1).toBe(0.5);
    addWorkPlaceMass(m, 0, 50, 100, -1000);
    const pts = integral(m);
    expect(pts[pts.length - 1]![1]).toBeCloseTo(0, 9);
  });
});

describe("CA-RN-008 produção do veículo na distância", () => {
  const table = [[100, 60], [1000, 20], [3000, 10]] as const;
  it("abaixo do 1º ponto é o 1º valor, acima do último é 0, entre pontos é harmônica", () => {
    expect(wachAtDistance(table, 0)).toBe(60);
    expect(wachAtDistance(table, 3000.1)).toBe(0);
    // 1/w linear: em 550 m, 1/w = (1/60 + 1/20)/2 → w = 30
    expect(wachAtDistance(table, 550)).toBeCloseTo(30, 12);
    expect(wachAtDistance(table, 1000)).toBe(20);
    expect(() => wachAtDistance(table, -1)).toThrow("NEGATIVE_DISTANCE");
  });
  it("número de veículos = ceil(taxa / w(d))", () => {
    expect(vehiclesNeeded(100, wachAtDistance(table, 550))).toBe(4);
    expect(vehiclesNeeded(90, 30)).toBe(3);
  });
});
