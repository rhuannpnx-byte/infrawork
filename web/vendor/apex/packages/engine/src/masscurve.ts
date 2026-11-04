/**
 * Curva de massa (Brückner) — RF-036, RN-019. Evidência: analises/2026-10-11_dynaroad/handoff/docs/
 * analise_distancias_cronograma.md §3.3 (`MassIntegrator::AddWorkSite` @0x5e9880, `AddMassSpot` @0x5e9680,
 * `GetIntegral` @0x5e9c20).
 *
 * [O] `boost::icl::interval_map<double,double>` estaca → densidade, somada por `inplace_plus`; o interval_map padrão
 * (partial_absorber) não guarda trechos de valor 0 [I: padrão da biblioteca]. Corte entra com `+sourceAmount`,
 * aterro com `−destinationAmount`; cada work place vira dois blocos uniformes que preservam o COG.
 */
import { areEqual } from "./schedule.js";

export class MassCurveError extends Error {
  constructor(readonly code: "ZERO_SPAN", message: string) {
    super(message);
    this.name = "MassCurveError";
  }
}

export interface DensitySpan {
  s0: number;
  s1: number;
  density: number;
}

/** interval_map<double,double> com soma; trechos que somam 0 somem. */
export class DensityMap {
  private spans: DensitySpan[] = [];

  /** `AddMassSpot` @0x5e9680: densidade m/(s1 − s0); vão zero é erro. */
  addMass(s0: number, s1: number, m: number): void {
    if (areEqual(s0, s1)) throw new MassCurveError("ZERO_SPAN", "zero span");
    const [a, b] = s0 < s1 ? [s0, s1] : [s1, s0];
    this.addDensity(a, b, m / (b - a));
  }

  addDensity(s0: number, s1: number, d: number): void {
    if (!(s1 > s0) || d === 0) return;
    const cuts = new Set<number>([s0, s1]);
    for (const x of this.spans) cuts.add(x.s0).add(x.s1);
    const pts = [...cuts].sort((a, b) => a - b);
    const out: DensitySpan[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!, b = pts[i + 1]!, mid = (a + b) / 2;
      let v = this.spans.find((x) => x.s0 <= mid && mid < x.s1)?.density ?? 0;
      if (s0 <= mid && mid < s1) v += d;
      if (v !== 0) out.push({ s0: a, s1: b, density: v });
    }
    // junta vizinhos contíguos com a mesma densidade (o interval_map funde segmentos iguais)
    this.spans = out.reduce<DensitySpan[]>((acc, x) => {
      const last = acc[acc.length - 1];
      if (last && last.s1 === x.s0 && last.density === x.density) last.s1 = x.s1;
      else acc.push({ ...x });
      return acc;
    }, []);
  }

  segments(): readonly DensitySpan[] {
    return this.spans;
  }
}

/**
 * `AddWorkSite` @0x5e9880, por work place: massa `m` (com sinal) em [b, e] com COG c. Se c coincide com b ou e,
 * desloca min(0,5, (e − b)/2) para dentro. Blocos [b, c] com m·(e − c)/(e − b) e [c, e] com m·(c − b)/(e − b).
 */
export function addWorkPlaceMass(map: DensityMap, b: number, c: number, e: number, m: number): void {
  if (areEqual(b, e)) throw new MassCurveError("ZERO_SPAN", "zero span");
  const shift = Math.min(0.5, (e - b) / 2);
  if (areEqual(c, b)) c = b + shift;
  else if (areEqual(c, e)) c = e - shift;
  map.addMass(b, c, (m * (e - c)) / (e - b));
  map.addMass(c, e, (m * (c - b)) / (e - b));
}

/** `GetIntegral` @0x5e9c20: da estaca baixa para a alta, cum += (s1 − s0)·densidade; pontos (s, cum). */
export function integral(map: DensityMap): [number, number][] {
  const pts: [number, number][] = [];
  let cum = 0;
  for (const x of map.segments()) {
    if (!pts.length || pts[pts.length - 1]![0] !== x.s0) pts.push([x.s0, cum]);
    cum += (x.s1 - x.s0) * x.density;
    pts.push([x.s1, cum]);
  }
  return pts;
}
