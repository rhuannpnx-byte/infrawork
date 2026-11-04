// U-61h (D-041): cálculo do ApeX × DynaRoad 5.5.2 em execução (DEMO, D-029). Entradas sintéticas montadas pelo ApeX e
// abertas no original (Calculate hauls, Pack schedule); oráculo transcrito das capturas em fixtures/golden/runtime/u61h/.
// Evidência: analises/2026-10-11_dynaroad/evidencias/dinamico_2026-10-15/u61h/ (_LEIA.md).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDr5 } from "../../dr5/src/index.js";
import { FIXTURES } from "../../dr5/test/helpers.js";
import { Project, type Entity } from "../../model/src/index.js";
import {
  chainAverage, chainAverageWithDates, convertAmount, destLandType, DistanceCalculatorManager, packSchedule, planOptimize, scheduleOptimize, Scheduler,
  sourceLandType, suitableHaulChains, unitOfType, wpTimes,
} from "../src/index.js";

const GOLDEN = join(FIXTURES, "golden/runtime/u61h");
const tsv = (f: string) => readFileSync(join(GOLDEN, f), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).slice(1).map((l) => l.split("\t"));
const load = (f: string) => Project.fromDr5(readDr5(new Uint8Array(readFileSync(f))));
const synthetic = (c: string) => load(join(GOLDEN, `${c}.dr5`));
// região pt-BR do original; ICU arredonda meio-a-par
const ptNum = (v: number, max: number, min = 0) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: max, minimumFractionDigits: min, roundingMode: "halfEven" } as Intl.NumberFormatOptions).format(v);
const ptDate = (t: number) => {
  const d = new Date(t * 1000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear() % 100).padStart(2, "0")}`;
};
const ref = (p: Project, v: unknown) => (typeof v === "bigint" ? p.get(v) : undefined);
const siteOfWp = (p: Project, wp: unknown) => ref(p, ref(p, wp)!.get("m_pWorkSite"))!;
const tasks = (p: Project) => [...p.entities()].filter((e) => e.get("m_vpWorkPlaces") !== undefined && e.className !== "SumTask");
const byName = (p: Project, n: string) => tasks(p).find((t) => t.name === n)!;

/** linhas do Hauls by source: (origem, destino) → material, quantidade na unidade do bloco e distância ponderada */
function haulRows(p: Project, list: "m_vpLPMoves" | "m_vpSchedMoves") {
  const mm = ref(p, p.root()!.get("m_pMoveManager"))!;
  const fill = p.root()!.get("m_pFillUnit") as bigint;
  const rows = new Map<string, { slt: Entity; q: number; dq: number; unit: string }>();
  for (const o of (mm.get(list) as bigint[]) ?? []) {
    const m = p.get(o)!;
    const src = siteOfWp(p, m.get("m_pSrcWorkPlace")), dst = siteOfWp(p, m.get("m_pDstWorkPlace"));
    const slt = ref(p, m.get("m_pSourceLandType"))!;
    const st = sourceLandType(p, src);
    const pv = st ? ref(p, st.get("m_pPriceVector")) : undefined;
    const unit = (pv?.get("m_pUnit") as bigint | undefined) ?? fill;
    const q = convertAmount(slt, m.get("m_dAmount") as number, unitOfType(slt), unit);
    const d = ref(p, m.get("m_pPath"))!.get("m_dLength") as number;
    const k = `${src.name}|${dst.name}`;
    const r = rows.get(k) ?? { slt, q: 0, dq: 0, unit: p.get(unit)!.name };
    r.q += q;
    r.dq += q * d;
    rows.set(k, r);
  }
  return rows;
}

describe("U-61h cálculo × original em execução", () => {
  const calc = tsv("calculos.tsv");
  for (const caso of [...new Set(calc.map((r) => r[0]!))]) {
    for (const modo of [...new Set(calc.filter((r) => r[0] === caso).map((r) => r[1]!))]) {
      it(`${caso} (${modo}): transportes, material, quantidades e distâncias do Hauls by source`, async () => {
        const p = synthetic(caso);
        if (modo === "plan") await planOptimize(p);
        else await scheduleOptimize(p, modo === "schedule-alt1" ? { maxAlternativeChains: 1 } : {});
        const rows = haulRows(p, modo === "plan" ? "m_vpLPMoves" : "m_vpSchedMoves");
        const want = calc.filter((r) => r[0] === caso && r[1] === modo);
        expect(rows.size, caso).toBe(want.length);
        for (const [, , src, dst, mat, q, unit, d] of want) {
          const r = rows.get(`${src}|${dst}`);
          expect(r, `${caso} ${src} → ${dst}`).toBeDefined();
          expect(r!.slt.name).toBe(mat); // L-039: o refinado do empate (AggA no u61h_plan, AggB no u61h_plan2) [O]
          expect(r!.unit).toBe(unit);
          expect(ptNum(r!.q, 0)).toBe(q);
          expect(ptNum(r!.dq / r!.q, 1)).toBe(d);
        }
      });
    }
  }

  it("datas depois do cálculo (pilha com capacidade e pilha local) e do Pack schedule no ES; prioridades do Pack", async () => {
    const rows = tsv("datas_e_prioridades.tsv");
    const projects: Record<string, Project> = {};
    for (const c of ["u61h_pilha2", "u61h_local"]) {
      const p = synthetic(c);
      await scheduleOptimize(p);
      p.edit("timing", () => {
        const s = new Scheduler(p);
        s.write(s.calculate(true));
      });
      projects[c] = p;
    }
    const es = load(join(FIXTURES, "example_simple_road_project.dr5"));
    packSchedule(es);
    projects.es_pack = es;
    for (const [caso, tarefa, ini, fim, prio] of rows) {
      const p = projects[caso!]!;
      const t = byName(p, tarefa!);
      const times = ((t.get("m_vpWorkPlaces") as bigint[]) ?? []).map((o) => wpTimes(p.get(o)!));
      expect(ptDate(Math.min(...times.map((x) => x.begin))), `${caso} ${tarefa}`).toBe(ini);
      expect(ptDate(Math.max(...times.map((x) => x.end))), `${caso} ${tarefa}`).toBe(fim);
      if (prio) expect(t.get("m_nSchedulingPriority"), `${caso} ${tarefa} prioridade`).toBe(Number(prio));
    }
  });

  it("Suitable hauls: média com datas no Schedule (só pares com janela), no Plan sem datas; preço na unidade do destino", () => {
    const rows = tsv("telas.tsv").filter((r) => r[0] === "suitable");
    const es = load(join(FIXTURES, "example_simple_road_project.dr5"));
    packSchedule(es);
    const plan = synthetic("u61h_plan");
    for (const [, caso, tarefa, valor] of rows) {
      const p = caso === "es_pack" ? es : plan;
      const [dest, crush, cost, dist] = valor!.split("|");
      const t = byName(p, tarefa!);
      const chain = suitableHaulChains(p, caso === "es_pack").map((x) => x.chain).find((c) => c.source.oid === t.oid && c.destination.name === dest && (c.crush?.name ?? "") === crush)!;
      expect(chain, `${tarefa} → ${dest}`).toBeDefined();
      const u = unitOfType(destLandType(p, chain.destination)!);
      const avg = caso === "es_pack" ? chainAverageWithDates(p, chain, u) : chainAverage(p, chain, new DistanceCalculatorManager(p).plan(), u);
      if (cost === "?") {
        expect(avg.price, `${tarefa} → ${dest}`).toBeNull();
        continue;
      }
      const [, price, unit] = /^US\$([\d.,]+)\/(.+)$/.exec(cost!)!;
      expect(ptNum(avg.price!, 2, 2), `${tarefa} → ${dest}`).toBe(price);
      expect(p.get(u!)!.name).toBe(unit);
      expect(`${ptNum(avg.distance!, 1)} m`).toBe(dist);
    }
  });
});
