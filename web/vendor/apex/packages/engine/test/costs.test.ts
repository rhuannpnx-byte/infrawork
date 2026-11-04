// U-06: custos e unidades (RF-008…010, RN-014, RN-023, RN-024) com os dados dos .dr5 do original.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDr5 } from "../../dr5/src/index.js";
import { FIXTURES, oracleFiles } from "../../dr5/test/helpers.js";
import { Project, type Entity } from "../../model/src/index.js";
import {
  convCoeff, convertAmount, convertedPrice, DistanceCalculatorManager, haulPrice, isSuitableMoveDestination,
  massType, MASS_TYPE, priceAtDistance, sourceLandType, unitPrice,
} from "../src/index.js";

const load = (f: string) => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, f)))));
const def = load("default.dr5");
const T = 10n, BCM = 9n, CCM = 11n, M2 = 268n;
const baseAgg = def.get(87n)!, earth = def.get(84n)!;

describe("conversão de unidades (RN-023, GetConvCoeff)", () => {
  it("fatores do material 'Base Agg.' (base ccm: t 2,4, bcm 1)", () => {
    expect(convCoeff(baseAgg, CCM, T)).toBe(2.4);
    expect(convCoeff(baseAgg, T, CCM)).toBe(1 / 2.4);
    expect(convCoeff(baseAgg, T, BCM)).toBeCloseTo(1 / 2.4, 12);
    expect(convCoeff(baseAgg, T, T)).toBe(1);
    expect(convertAmount(baseAgg, 100, CCM, T)).toBeCloseTo(240, 12);
    expect(convertedPrice(baseAgg, 24, CCM, T)).toBe(10); // 24 por ccm = 10 por t
    expect(() => convCoeff(baseAgg, CCM, M2)).toThrow(/invalid conversion/);
  });
});

describe("PriceVector::GetPriceAtDistance (RF-010) — tabela 'Earth' do default.dr5", () => {
  const at = (d: number, i = true) => priceAtDistance(earth, d, i).price;
  it("pontos, interpolação e degrau", () => {
    expect(priceAtDistance(earth, 250, true)).toEqual({ price: 0.41, unit: BCM });
    expect(at(375)).toBeCloseTo(0.475, 12);
    expect(at(375, false)).toBe(0.54);
    expect(at(0)).toBe(0);
    expect(at(-50)).toBe(0);
  });
  it("além do último ponto: inclinação dos dois últimos, linear ou em degraus de 100", () => {
    expect(at(6000)).toBeCloseTo(1.42, 12);
    expect(at(6000, false)).toBeCloseTo(1.42, 12);
    expect(at(5050, false)).toBe(1.27);
    expect(at(5050)).toBeCloseTo(1.2775, 12);
  });
  it("casos de borda (sintéticos): ponto único em 0, ponto único fora de 0, tabela vazia, inclinação negativa", () => {
    const p = new Project();
    const pv = (entries: [number, number][]) => {
      let e!: Entity;
      p.edit("pv", () => {
        e = p.create("PriceVector");
        e.setRaw("m_distances", { kind: "map", type: 0x15, keyType: entries.length ? 0x0d : null, valueType: entries.length ? 0x0d : null, entries: entries.map(([k, v]) => [{ kind: "float", type: 0x0d, value: k, raw: new Uint8Array(0) }, { kind: "float", type: 0x0d, value: v, raw: new Uint8Array(0) }]) });
      });
      return e;
    };
    expect(priceAtDistance(pv([[0, 3]]), 9999, true).price).toBe(3);
    expect(priceAtDistance(pv([[100, 2]]), 300, true).price).toBeCloseTo(6, 12);
    expect(priceAtDistance(pv([]), 300, true).price).toBe(0);
    expect(priceAtDistance(pv([[100, 5], [200, 4]]), 400, true).price).toBe(4);
  });
});

describe("preço unitário (RN-014) e contrato de fornecimento (CA-RN-014)", () => {
  /** Jazida → aterro sintéticos sobre os tipos e o PriceVector reais do default.dr5. */
  function scene(contract: boolean) {
    const p = load("default.dr5");
    const slt = p.byClass("SourceLandType").find((s) => (s.get("m_vpSuitableTypes") as bigint[] | undefined)?.length)!;
    const dlt = p.get((slt.get("m_vpSuitableTypes") as bigint[])[0]!)!;
    let pit!: Entity, fill!: Entity;
    p.edit("cena", () => {
      pit = p.create("BorrowPit");
      pit.set("m_pSourceLandType", slt.oid);
      pit.set("m_dSourceUnitPrice", 2);
      pit.set("m_bDeliveryContract", contract);
      fill = p.create("Embankment");
      fill.set("m_pDestLandType", dlt.oid);
      fill.set("m_dDestinationUnitPrice", 0.5);
    });
    return { p, slt, dlt, pit, fill };
  }
  it("sem contrato: origem + destino + preço por distância do material", () => {
    const { p, slt, pit, fill } = scene(false);
    const base = slt.get("m_pUnit") as bigint;
    const pv = p.resolve(slt.get("m_pPriceVector") as bigint)!;
    const at = priceAtDistance(pv, 1500, true);
    const expected = 2 + convertedPrice(slt, 0.5, p.resolve(p.resolve(fill.get("m_pDestLandType") as bigint)!.get("m_pUnit") as bigint)?.oid ?? null, base) + convertedPrice(slt, at.price, at.unit, base);
    expect(unitPrice(p, pit, slt, fill, 1500, true, base, true)).toBeCloseTo(expected, 12);
    expect(haulPrice(p, pit, slt, fill, 1500, base)).toBeCloseTo(expected, 12);
  });
  it("com contrato: a distância não pesa", () => {
    const { p, slt, pit, fill } = scene(true);
    const base = slt.get("m_pUnit") as bigint;
    const a = unitPrice(p, pit, slt, fill, 100, true, base, true);
    expect(unitPrice(p, pit, slt, fill, 4000, true, base, true)).toBe(a);
  });
  it("papéis: origem/destino e MassType", () => {
    const { pit, fill } = scene(false);
    expect([massType(pit, "source"), massType(fill, "destination")]).toEqual([MASS_TYPE.MAY, MASS_TYPE.MUST]);
    expect(() => unitPrice(def, fill, baseAgg, pit, 1, true, CCM, false)).toThrow(/not a source/);
  });
});

describe("adequação (RN-024): todo transporte salvo pelo original é adequado", () => {
  for (const { entry, path } of oracleFiles()) {
    const p = Project.fromDr5(readDr5(new Uint8Array(readFileSync(path))));
    const ms = ["LPMove", "SchedMove"].flatMap((c) => p.byClass(c));
    if (ms.length === 0) continue;
    it(`${entry.file}: ${ms.length} transportes`, () => {
      let checked = 0;
      for (const m of ms) {
        const src = p.get(p.get(m.get("m_pSrcWorkPlace") as bigint)!.get("m_pWorkSite") as bigint)!;
        const dst = p.get(p.get(m.get("m_pDstWorkPlace") as bigint)!.get("m_pWorkSite") as bigint)!;
        if (src.className === "CrushingPlant") continue; // depende das cadeias (U-08)
        expect(isSuitableMoveDestination(p, src, dst), `${src.className}→${dst.className}`).toBe(true);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});

describe("custo de cada transporte salvo (Plan): calcula sem erro na unidade de aterro", () => {
  it("example_simple_road_project: haulPrice finito e ≥ 0 para os LPMove", () => {
    const p = load("example_simple_road_project.dr5");
    const dc = new DistanceCalculatorManager(p).plan();
    const fillUnit = p.root()!.get("m_pFillUnit") as bigint;
    for (const m of p.byClass("LPMove")) {
      const swp = m.get("m_pSrcWorkPlace") as bigint, dwp = m.get("m_pDstWorkPlace") as bigint;
      const src = p.get(p.get(swp)!.get("m_pWorkSite") as bigint)!, dst = p.get(p.get(dwp)!.get("m_pWorkSite") as bigint)!;
      const slt = p.resolve(m.get("m_pSourceLandType") as bigint) ?? sourceLandType(p, src)!;
      const c = haulPrice(p, src, slt, dst, dc.distance(swp, dwp), fillUnit);
      expect(Number.isFinite(c) && c >= 0).toBe(true);
    }
  });
});
