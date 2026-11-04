/**
 * @apex/lp — adaptador do solver LP (RN-010, RN-012 parte "solver", RNF-002, RNF-006; D-005: HiGHS no lugar do CLP).
 * Evidência: analises/2026-10-11_dynaroad/evidencias/decompilado/otimizacao/ (LomBuild::LomBuild @0xa10190,
 * LomBuild::AllocateSuperCol @0xa10e70, ClpHelpers::ModelRow::* @0xa11180…0xa116f0, RunSimplex @0xa04ca0,
 * ClpHelpers::EventHandler::event @0xa11950).
 *
 * - [O] LomBuild: n colunas de transporte com limites [0, COIN_DBL_MAX]; colunas extras ("super") alocadas depois,
 *   também [0, COIN_DBL_MAX].
 * - [O] ModelRow: linha esparsa com limites [0, COIN_DBL_MAX] por padrão. AddTo: linha vazia ignorada; 1 termo vira
 *   limite de coluna (máx dos inferiores, mín dos superiores, divididos pelo coeficiente); senão entra só se
 *   IsEffective (os limites da linha cortam algo do intervalo de atividade possível).
 * - [O] SparsifyThis: linha com mais de 5460 (0x1554) termos ganha coluna auxiliar a = Σ termos (a com os limites da
 *   linha) e a linha vira Σ termos − a = 0; a auxiliar entra numa linha própria.
 * - [O] RunSimplex: modelo inviável → "Linear programming model was not feasible."; status ≠ ótimo → "Calculation
 *   could not be proven optimal."; cancelado (flag) → sem solução.
 * - [P] D-005: HiGHS (simplex primal, sem log). O cancelamento é verificado a cada iteração do simplex
 *   (simplexInterrupt), como o EventHandler do CLP. Ótimos alternativos podem diferir do CLP (R-6).
 */
import highsModule, { type Highs } from "highs";

// O pacote se declara CommonJS, mas o "import" resolve para build/highs.mjs, cujo default é a função carregadora.
const highsLoader = highsModule as unknown as () => Promise<Highs>;

/** COIN_DBL_MAX (= DBL_MAX). */
export const COIN_DBL_MAX = Number.MAX_VALUE;
/** ClpHelpers::ModelRow::SparsifyThis divide linhas acima deste número de termos. */
export const MAX_ROW_TERMS = 0x1554;

export interface BuiltRow {
  indices: number[];
  coeffs: number[];
  lower: number;
  upper: number;
}

/** LomBuild: limites das colunas e linhas acumuladas (CoinBuild). */
export class LomBuild {
  readonly columnLowers: number[];
  readonly columnUppers: number[];
  readonly solution: number[];
  readonly rows: BuiltRow[] = [];
  nSuperCol: number;
  superHaulBeginCol = 0;
  superHaulEndCol = 0;
  /** coluna super → coluna do transporte que a criou, por lado (m_superHaulsFromSource / ToDestination) */
  readonly superHaulsFromSource = new Map<number, number>();
  readonly superHaulsToDestination = new Map<number, number>();

  constructor(columns: number) {
    this.nSuperCol = columns;
    this.columnUppers = Array<number>(columns).fill(COIN_DBL_MAX);
    this.columnLowers = Array<number>(columns).fill(0);
    this.solution = Array<number>(columns).fill(0);
  }

  get numCols(): number {
    return this.columnUppers.length;
  }

  allocateSuperCol(): number {
    this.columnUppers.push(COIN_DBL_MAX);
    this.columnLowers.push(0);
    this.solution.push(0);
    return this.nSuperCol++;
  }
}

/** ClpHelpers::ModelRow. */
export class ModelRow {
  indices: number[] = [];
  coeffs: number[] = [];
  lower = 0;
  upper = COIN_DBL_MAX;

  addEntry(col: number, coeff: number): void {
    this.indices.push(col);
    this.coeffs.push(coeff);
  }

  /** Atividade mínima e máxima possíveis com os limites atuais das colunas; a linha só entra se cortar algo. */
  isEffective(b: LomBuild): boolean {
    let min = 0, max = 0;
    for (let i = 0; i < this.indices.length; i++) {
      const c = this.coeffs[i]!, j = this.indices[i]!;
      const lo = b.columnLowers[j]! * c, up = b.columnUppers[j]! * c;
      min += Math.min(lo, up);
      max += Math.max(lo, up);
    }
    return !(this.lower <= min && max <= this.upper);
  }

  addTo(b: LomBuild): void {
    const n = this.indices.length;
    if (n === 0) return;
    if (n === 1) {
      const j = this.indices[0]!, inv = 1 / this.coeffs[0]!;
      b.columnLowers[j] = Math.max(b.columnLowers[j]!, this.lower * inv);
      b.columnUppers[j] = Math.min(b.columnUppers[j]!, this.upper * inv);
      return;
    }
    if (this.isEffective(b)) b.rows.push({ indices: [...this.indices], coeffs: [...this.coeffs], lower: this.lower, upper: this.upper });
  }

  sparsifyThis(b: LomBuild): void {
    if (this.indices.length <= MAX_ROW_TERMS) return;
    const aux = b.allocateSuperCol();
    const next = new ModelRow();
    next.lower = this.lower;
    next.upper = this.upper;
    next.addEntry(aux, 1);
    b.columnLowers[aux] = this.lower;
    b.columnUppers[aux] = this.upper;
    let v = 0;
    for (let i = 0; i < this.indices.length; i++) v += b.solution[this.indices[i]!]! * this.coeffs[i]!;
    b.solution[aux] = v;
    this.addEntry(aux, -1);
    this.lower = 0;
    this.upper = 0;
    this.addTo(b);
    this.indices = next.indices;
    this.coeffs = next.coeffs;
    this.lower = next.lower;
    this.upper = next.upper;
  }

  sparsifyAndAddTo(b: LomBuild): void {
    if (!this.isEffective(b)) return;
    this.sparsifyThis(b);
    this.addTo(b);
  }
}

export class LpError extends Error {
  constructor(readonly code: "INFEASIBLE" | "NOT_OPTIMAL", message: string) {
    super(message);
    this.name = "LpError";
  }
}

export interface LpModel {
  colCost: number[];
  colLower: number[];
  colUpper: number[];
  rows: BuiltRow[];
}

export type LpOutcome = { status: "optimal"; x: number[]; objective: number } | { status: "canceled" };

type HighsInstance = Highs;
let instance: Promise<HighsInstance> | undefined;
const highs = () => (instance ??= highsLoader());

const inf = (v: number, h: HighsInstance) => (v >= COIN_DBL_MAX ? h.infinity : v <= -COIN_DBL_MAX ? -h.infinity : v);

/** RunSimplex: minimiza; `isRunning` é consultado antes e a cada iteração (false → cancelado). */
export async function solveLp(m: LpModel, isRunning: () => boolean = () => true): Promise<LpOutcome> {
  if (!isRunning()) return { status: "canceled" };
  const h = await highs();
  const n = m.colCost.length;
  const starts = [0], indices: number[] = [], values: number[] = [];
  for (const r of m.rows) {
    // [I] coeficientes repetidos da mesma coluna somados (o HiGHS recusa índices duplicados numa linha)
    const acc = new Map<number, number>();
    r.indices.forEach((j, i) => acc.set(j, (acc.get(j) ?? 0) + r.coeffs[i]!));
    for (const [j, c] of acc) {
      indices.push(j);
      values.push(c);
    }
    starts.push(indices.length);
  }
  const model = h.createModel({
    numCols: n,
    numRows: m.rows.length,
    colCost: m.colCost,
    colLower: m.colLower.map((v) => inf(v, h)),
    colUpper: m.colUpper.map((v) => inf(v, h)),
    rowLower: m.rows.map((r) => inf(r.lower, h)),
    rowUpper: m.rows.map((r) => inf(r.upper, h)),
    matrix: { format: "csr", numRows: m.rows.length, numCols: n, starts, indices, values },
  });
  try {
    model.options.set({ output_flag: false, solver: "simplex", simplex_strategy: 4 });
    model.run({
      [h.constants.callbackType.simplexInterrupt](event: { interrupt(): void }) {
        if (!isRunning()) event.interrupt();
      },
    });
    const st = model.getModelStatus();
    const S = h.constants.modelStatus;
    if (st === S.interrupted || !isRunning()) return { status: "canceled" };
    if (st === S.infeasible || st === S.unboundedOrInfeasible) throw new LpError("INFEASIBLE", "Linear programming model was not feasible.");
    if (st !== S.optimal && st !== S.empty) throw new LpError("NOT_OPTIMAL", "Calculation could not be proven optimal.");
    const x = st === S.empty ? Array<number>(n).fill(0) : [...model.getSolution().colValue];
    return { status: "optimal", x, objective: x.reduce((s, v, j) => s + v * m.colCost[j]!, 0) };
  } finally {
    model.dispose();
  }
}
