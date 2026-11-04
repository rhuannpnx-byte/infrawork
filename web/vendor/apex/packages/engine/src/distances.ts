/**
 * Distâncias de transporte (RF-025, RN-009; RF-016/RF-017 em uso). Evidência:
 * analises/2026-10-11_dynaroad/handoff/docs/analise_distancias_cronograma.md §1 (DistanceCalculator::UpdateGraph
 * @0x9e14f0, anon::UpdateSource @0x9e2b70, GetDistanceBetween @0x9e0f60, DistanceCalculatorManager §1.5);
 * UsageBreak::ManageState @0x984100 (estacas f300/f301, road line f304 — L-024 fechada em 2026-10-13).
 *
 * - [O] vértices = LightPlace(estaca, road line, afastamento); afastamento ≠ 0 cria também o vértice projetado
 *   (afastamento 0). Intersections não ignoradas com from ≠ to: aresta from→to com o peso da intersection e
 *   to→from se bidirecional; para (u, v) guarda a de menor distância (empate: a permanente).
 * - [O] cada MovableWorkPlace vira o vértice (GetStationCOG, road line, afastamento) da sua Location.
 * - [O] mesma estaca com afastamentos diferentes: aresta |Δafastamento| — [I] nos dois sentidos, entre todos
 *   os pares (L-009).
 * - [O] vértices consecutivos na mesma road line com afastamento ≤ 0 e sem usage break entre as estacas:
 *   aresta |Δestaca|, só crescente se D_LOW_TO_HIGH (1), só decrescente se D_HIGH_TO_LOW (2). [I] Área (classe
 *   148) não tem direção: dois sentidos.
 * - [O] usage break "entre" = [min, max] das estacas intersecta [m_nStationBegin, m_nStationEnd] ([I] fechado).
 * - [O] Dijkstra a partir da origem, cache por origem, distância dirigida; sem rota → NO_ROUTE (ou DBL_MAX).
 * - [O] caminho: passo (u→v) é intersection se |RC.distance − (d[v] − d[u])| < 0,01.
 */

import { MAX_DATE, MIN_DATE } from "@apex/calendar";
import type { Entity, Project, Ref } from "@apex/model";

export const DBL_MAX = 1.7976931348623157e308;
const RC_TOLERANCE = 0.01;
const D_LOW_TO_HIGH = 1, D_HIGH_TO_LOW = 2;

export class NoRouteError extends Error {
  readonly code = "NO_ROUTE";
  constructor(readonly source: bigint, readonly destination: bigint) {
    super(`NO_ROUTE: sem rota do work place ${source} para ${destination}`);
    this.name = "NoRouteError";
  }
}

export interface LightNode {
  roadConnection?: bigint;
  /** true: entrando pelo lado "from" da intersection */
  from?: boolean;
  workPlace?: bigint;
}
export interface LightPath {
  length: number;
  nodes: LightNode[];
}

export interface GraphOptions {
  /** usage breaks que NÃO bloqueiam (DistanceCalculatorHelpers::UpdateGraph: os não ativos) */
  ignoredBreaks?: ReadonlySet<bigint>;
  /** intersections que NÃO existem neste grafo (as não ativas) */
  ignoredRoadConnections?: ReadonlySet<bigint>;
}

interface Place {
  st: number;
  rl: bigint;
  d: number;
}

const num = (v: unknown, dflt = 0): number => (typeof v === "number" ? v : dflt);
const ref = (v: unknown): bigint | null => (typeof v === "bigint" ? v : null);

/** RoadConnection::IsPermanent @0x9bc990: m_beginTimingType == PERMANENT (0) [I forte: alias ICF @0x9a2590]. */
export function isPermanent(e: Entity): boolean {
  return num(e.get("m_beginTimingType")) === 0;
}

const TIMING = { PERMANENT: 0, STATIC: 1, TASK: 2 } as const;
const dateOf = (v: unknown, dflt: number) => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : dflt);
/** WorkSite::GetEndTime (L-042 [I]): maior fim dos work places, com as datas em vigor quando a rede é montada. */
function taskEnd(p: Project, ws: Entity): number {
  const ends = ((ws.get("m_vpWorkPlaces") as unknown[] | undefined) ?? []).map((o) => p.get(o as bigint)).filter((w): w is Entity => !!w).map((w) => dateOf(w.get("m_endTime"), MIN_DATE));
  return ends.length ? Math.max(...ends) : MIN_DATE;
}

/**
 * HasVariantTiming::GetBeginTime @0x973130 / GetEndTime @0x973190 (L-042): PERMANENT → MinDate/MaxDate; TASK → fim da
 * tarefa dependente (f200 no início, f201 no fim) [O fluxo]; STATIC → f204/f205. No fim, a permanência segue o tipo do
 * início [O]. [P] TASK sem tarefa (o original desreferencia o nulo): usa a data gravada.
 */
export function variantTiming(p: Project, e: Entity): [number, number] {
  const bt = num(e.get("m_beginTimingType")), et = num(e.get("m_endTimingType"));
  const task = (member: string) => {
    const ws = p.resolve(e.get(member) as Ref);
    return ws ? taskEnd(p, ws) : undefined;
  };
  const b = bt === TIMING.TASK ? task("m_pBeginWorkSite") ?? dateOf(e.get("m_beginDate"), MIN_DATE) : bt === TIMING.PERMANENT ? MIN_DATE : dateOf(e.get("m_beginDate"), MIN_DATE);
  const en = et === TIMING.TASK ? task("m_pEndWorkSite") ?? dateOf(e.get("m_endDate"), MAX_DATE) : bt === TIMING.PERMANENT ? MAX_DATE : dateOf(e.get("m_endDate"), MAX_DATE);
  return [b, en];
}

export class DistanceCalculator {
  private readonly places: Place[] = [];
  private readonly vertexOf = new Map<string, number>();
  private readonly adj: [number, number][][] = [];
  private readonly rcMap = new Map<string, Entity>();
  private readonly wpVertex = new Map<bigint, number>();
  private readonly rcVertices = new Map<bigint, [number, number]>();
  private readonly cache = new Map<bigint, { dist: Float64Array; pred: Int32Array }>();

  constructor(private readonly project: Project, opts: GraphOptions = {}) {
    this.build(opts);
  }

  private vertex(p: Place): number {
    const key = `${p.rl}|${p.st}|${p.d}`;
    let i = this.vertexOf.get(key);
    if (i === undefined) {
      i = this.places.length;
      this.places.push(p);
      this.adj.push([]);
      this.vertexOf.set(key, i);
    }
    return i;
  }
  /** AddVertex @0x9e0e10: com afastamento ≠ 0 cria também o projetado. */
  private addVertex(p: Place): number {
    const i = this.vertex(p);
    if (p.d !== 0) this.vertex({ ...p, d: 0 });
    return i;
  }
  private edge(u: number, v: number, w: number): void {
    this.adj[u]!.push([v, w]);
  }

  private build(opts: GraphOptions): void {
    const p = this.project;
    const placeOf = (e: Entity): Place => ({ st: num(e.get("m_dStation")), rl: ref(e.get("m_pRoadLine")) ?? 0n, d: num(e.get("m_dDistance")) });
    for (const rc of p.byClass("RoadConnection")) {
      if (opts.ignoredRoadConnections?.has(rc.oid)) continue;
      const a = p.resolve(rc.get("m_pPlaceFrom") as Ref), b = p.resolve(rc.get("m_pPlaceTo") as Ref);
      if (!a || !b || a.oid === b.oid) continue;
      const u = this.addVertex(placeOf(a)), v = this.addVertex(placeOf(b)), w = num(rc.get("m_dDistance"));
      this.rcVertices.set(rc.oid, [u, v]);
      this.edge(u, v, w);
      this.keepShortest(u, v, rc);
      if (rc.get("m_bBidirectional") === true) {
        this.edge(v, u, w);
        this.keepShortest(v, u, rc);
      }
    }
    for (const wp of p.byClass("MovableWorkPlace")) {
      const loc = p.resolve(wp.get("m_pLocation") as Ref);
      if (!loc) continue;
      this.wpVertex.set(wp.oid, this.addVertex({ st: num(loc.get("m_dStationCOG")), rl: ref(loc.get("m_pRoadLine")) ?? 0n, d: num(loc.get("m_dDistance")) }));
    }
    // afastamento lateral: mesma road line e estaca
    const byStation = new Map<string, number[]>();
    this.places.forEach((pl, i) => {
      const k = `${pl.rl}|${pl.st}`;
      byStation.set(k, [...(byStation.get(k) ?? []), i]);
    });
    for (const ids of byStation.values()) {
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]!, b = ids[j]!, w = Math.abs(this.places[a]!.d - this.places[b]!.d);
        this.edge(a, b, w);
        this.edge(b, a, w);
      }
    }
    // ao longo da pista
    const breaks = new Map<bigint, { b: number; e: number }[]>();
    for (const ub of p.byClass("UsageBreak")) {
      if (opts.ignoredBreaks?.has(ub.oid)) continue;
      const rl = ref(ub.get("m_pRoadLine"));
      if (rl === null) continue;
      breaks.set(rl, [...(breaks.get(rl) ?? []), { b: num(ub.get("m_nStationBegin")), e: num(ub.get("m_nStationEnd")) }]);
    }
    const onRoad = this.places.map((pl, i) => ({ pl, i })).filter((x) => x.pl.d <= 0)
      .sort((x, y) => (x.pl.rl < y.pl.rl ? -1 : x.pl.rl > y.pl.rl ? 1 : x.pl.st - y.pl.st || x.pl.d - y.pl.d));
    for (let k = 1; k < onRoad.length; k++) {
      const a = onRoad[k - 1]!, b = onRoad[k]!;
      if (a.pl.rl !== b.pl.rl) continue;
      const lo = Math.min(a.pl.st, b.pl.st), hi = Math.max(a.pl.st, b.pl.st);
      if ((breaks.get(a.pl.rl) ?? []).some((x) => lo <= x.e && x.b <= hi)) continue;
      const rl = p.get(a.pl.rl);
      const dir = rl?.className === "RoadLine" ? num(rl.get("m_nDirectionality")) : 0;
      const w = Math.abs(b.pl.st - a.pl.st);
      if (dir !== D_HIGH_TO_LOW) this.edge(a.i, b.i, w);
      if (dir !== D_LOW_TO_HIGH) this.edge(b.i, a.i, w);
    }
  }

  /** AddRoadConnectionToMap @0x9e0d80: a de menor distância; empate → permanente. */
  private keepShortest(u: number, v: number, rc: Entity): void {
    const k = `${u}|${v}`, cur = this.rcMap.get(k);
    const d = num(rc.get("m_dDistance"));
    if (!cur) return void this.rcMap.set(k, rc);
    const dc = num(cur.get("m_dDistance"));
    if (d < dc || (d === dc && isPermanent(rc) && !isPermanent(cur))) this.rcMap.set(k, rc);
  }

  /** Dijkstra a partir do vértice do work place de origem, guardado por origem (m_sDoneSources). */
  private run(src: bigint): { dist: Float64Array; pred: Int32Array } | undefined {
    const hit = this.cache.get(src);
    if (hit) return hit;
    const s = this.wpVertex.get(src);
    if (s === undefined) return undefined;
    const n = this.places.length;
    const dist = new Float64Array(n).fill(Infinity), pred = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    dist[s] = 0;
    // heap binário simples (o original usa d-ário 4; só muda o desempate entre caminhos de mesmo comprimento)
    const heap: [number, number][] = [[0, s]];
    const push = (x: [number, number]) => {
      heap.push(x);
      let i = heap.length - 1;
      while (i > 0) {
        const par = (i - 1) >> 1;
        if (heap[par]![0] <= heap[i]![0]) break;
        [heap[par], heap[i]] = [heap[i]!, heap[par]!];
        i = par;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0]!, last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i]!, heap[m]!];
          i = m;
        }
      }
      return top;
    };
    while (heap.length > 0) {
      const [d, u] = pop();
      if (done[u]) continue;
      done[u] = 1;
      for (const [v, w] of this.adj[u]!) {
        if (d + w < dist[v]!) {
          dist[v] = d + w;
          pred[v] = u;
          push([dist[v]!, v]);
        }
      }
    }
    const r = { dist, pred };
    this.cache.set(src, r);
    return r;
  }

  /** GetDistanceBetweenNoThrow @0x9e11b0: DBL_MAX sem rota. */
  distanceNoThrow(src: bigint, dst: bigint): number {
    const r = this.run(src), t = this.wpVertex.get(dst);
    if (!r || t === undefined || !Number.isFinite(r.dist[t]!)) return DBL_MAX;
    return r.dist[t]!;
  }

  /** GetDistanceBetween @0x9e0f60: NO_ROUTE sem rota. */
  distance(src: bigint, dst: bigint): number {
    const d = this.distanceNoThrow(src, dst);
    if (d === DBL_MAX) throw new NoRouteError(src, dst);
    return d;
  }

  /** Caminho reconstruído pelos predecessores, como o LightPath (UpdateSource @0x9e2b70). */
  path(src: bigint, dst: bigint): LightPath {
    const length = this.distance(src, dst);
    const r = this.run(src)!;
    const steps: number[] = [];
    for (let v = this.wpVertex.get(dst)!; v !== -1; v = r.pred[v]!) steps.push(v);
    steps.reverse();
    const nodes: LightNode[] = [{ workPlace: src }];
    for (let i = 1; i < steps.length; i++) {
      const u = steps[i - 1]!, v = steps[i]!;
      const rc = this.rcMap.get(`${u}|${v}`);
      if (rc && Math.abs(num(rc.get("m_dDistance")) - (r.dist[v]! - r.dist[u]!)) < RC_TOLERANCE) {
        const forward = this.rcVertices.get(rc.oid)?.[0] === u;
        nodes.push({ roadConnection: rc.oid, from: forward }, { roadConnection: rc.oid, from: !forward });
      }
    }
    nodes.push({ workPlace: dst });
    return { length, nodes };
  }
}


/**
 * DistanceCalculatorManager (§1.5): um grafo por combinação de usage breaks ativos e intersections não
 * permanentes ativas no tempo; no modo Plan, todos os breaks bloqueiam e todas as intersections existem
 * (PlanLom::Solve: UpdateGraph(nullptr, nullptr, true)).
 * RecreateActiveCombinations @0x9e79c0 [O]: todos os usage breaks e todas as road connections, as permanentes por
 * [MinDate, MaxDate], com as datas de HasVariantTiming (variantTiming, L-042) lidas uma vez, quando o gerenciador é
 * criado no início do Solve. Break ativo bloqueia; road connection inativa some do grafo (UpdateGraph @0x9e2610 [O]).
 * [I] janela semiaberta [b, e) (GetActivesAndDates @0x9e64c0, comparações estritas).
 */
export class DistanceCalculatorManager {
  private readonly byKey = new Map<string, DistanceCalculator>();
  private actives?: { breaks: { oid: bigint; span: [number, number] }[]; rcs: { oid: bigint; span: [number, number] }[] };
  constructor(private readonly project: Project) {}

  /** Grafo do modo Plan. */
  plan(): DistanceCalculator {
    return this.get(new Set(), new Set());
  }

  private get(ignoredBreaks: Set<bigint>, ignoredRoadConnections: Set<bigint>): DistanceCalculator {
    const key = [...ignoredBreaks].sort().join(",") + "|" + [...ignoredRoadConnections].sort().join(",");
    let dc = this.byKey.get(key);
    if (!dc) {
      dc = new DistanceCalculator(this.project, { ignoredBreaks, ignoredRoadConnections });
      this.byKey.set(key, dc);
    }
    return dc;
  }

  /** Grafos válidos em [begin, end): cada trecho com a mesma combinação ativa (GetValidDistanceCalculators). */
  calculatorsFor(begin: number, end: number): { begin: number; end: number; calculator: DistanceCalculator }[] {
    const p = this.project;
    this.actives ??= {
      breaks: p.byClass("UsageBreak").map((e) => ({ oid: e.oid, span: variantTiming(p, e) })),
      rcs: p.byClass("RoadConnection").map((e) => ({ oid: e.oid, span: variantTiming(p, e) })),
    };
    const { breaks, rcs } = this.actives;
    const cuts = new Set<number>([begin, end]);
    // L-053 [O]: QuantitySpanContainer<ActiveRoadConnectionsAndBreaks>::Merge@0x9e7120 descarta span com begin ≥ end
    for (const x of [...breaks, ...rcs]) if (x.span[0] < x.span[1]) for (const t of x.span) if (t > begin && t < end) cuts.add(t);
    const points = [...cuts].sort((a, b) => a - b);
    const out: { begin: number; end: number; calculator: DistanceCalculator }[] = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!, b = points[i + 1]!, mid = a + (b - a) / 2;
      const active = (s: [number, number]) => s[0] <= mid && mid <= s[1];
      const calc = this.get(new Set(breaks.filter((x) => !active(x.span)).map((x) => x.oid)), new Set(rcs.filter((x) => !active(x.span)).map((x) => x.oid)));
      // U-55 (D12) [O Merge, I GetValidDistanceCalculators]: peças vizinhas com o mesmo grafo não são fundidas
      out.push({ begin: a, end: b, calculator: calc });
    }
    return out;
  }
}


