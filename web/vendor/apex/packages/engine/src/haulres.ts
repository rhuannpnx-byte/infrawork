/**
 * Recursos de transporte (caminhões) — RF-034, RN-008. Evidência: analises/2026-10-11_dynaroad/handoff/docs/
 * analise_distancias_cronograma.md §3.2 (`Transporter::GetWAchAtDistance` @0x99cda0, `HaulResourceCalculator::
 * GetHaulClassMask` @0x9ec2a0, `Calculate` @0x9ebfb0) e analise_rede_transportador_l042.md §3 (L-042).
 */
import type { Entity, Project, Ref } from "@apex/model";

export class HaulResourceError extends Error {
  constructor(readonly code: "NEGATIVE_DISTANCE" | "ZERO_PRODUCTION", message: string) {
    super(message);
    this.name = "HaulResourceError";
  }
}

/**
 * Produção de um veículo na distância d (tabela distância → produção/h, `m_mDistanceWorkAchievement`): abaixo do 1º
 * ponto, o 1º valor; acima do último, 0; entre pontos, interpolação linear de 1/w (harmônica).
 */
export function wachAtDistance(table: readonly (readonly [number, number])[], d: number): number {
  if (d < 0) throw new HaulResourceError("NEGATIVE_DISTANCE", "NEGATIVE_DISTANCE");
  const t = [...table].sort((a, b) => a[0] - b[0]);
  if (!t.length) return 0;
  if (d <= t[0]![0]) return t[0]![1];
  if (d > t[t.length - 1]![0]) return 0;
  for (let i = 1; i < t.length; i++) {
    const [d0, w0] = t[i - 1]!, [d1, w1] = t[i]!;
    if (d <= d1) {
      if (d === d1) return w1;
      return ((d1 - d0) * w0 * w1) / ((d - d0) * w0 + (d1 - d) * w1);
    }
  }
  return 0;
}

/** Transporter::GetMaxDistance @0x99cd60 [O]: maior distância da tabela; tabela vazia → −1 (toda distância é longa demais). */
export function maxDistance(table: readonly (readonly [number, number])[]): number {
  return table.length ? Math.max(...table.map((x) => x[0])) : -1;
}

/** nó de caminho: LightNode do grafo (roadConnection/from/workPlace) ou Node gravado (m_pRoadConnection/…) */
export interface PathNodeLike {
  roadConnection?: bigint | null;
  from?: boolean;
  workPlace?: bigint | null;
}
const oid = (v: unknown) => (typeof v === "bigint" ? v : null);

/**
 * LightNode::GetLocation @0x99a2f0 / Node::GetLocation @0x99a3c0 [O]: nó de intersection → road line (ou área) do lugar
 * de entrada (from ? PlaceFrom : PlaceTo); nó de work place → road line da Location; sem nenhum → "No location.".
 */
export function nodeLocation(p: Project, n: PathNodeLike): bigint | null {
  if (n.roadConnection) {
    const rc = p.get(n.roadConnection);
    const place = rc ? p.resolve(rc.get(n.from ? "m_pPlaceFrom" : "m_pPlaceTo") as Ref) : undefined;
    return oid(place?.get("m_pRoadLine"));
  }
  if (n.workPlace) {
    const loc = p.resolve(p.get(n.workPlace)?.get("m_pLocation") as Ref);
    return oid(loc?.get("m_pRoadLine"));
  }
  throw new Error("No location.");
}

/** Node gravado (Path::m_vpNodes) → PathNodeLike */
export const storedNode = (n: Entity): PathNodeLike => ({ roadConnection: oid(n.get("m_pRoadConnection")), from: n.get("m_bRoadConnectionFrom") === true, workPlace: oid(n.get("m_pWorkPlace")) });

/**
 * TransporterHelpers::IsSuitablePath @0x99cf70 (LightPath) / @0x99d020 (Path) [O]: falso se o local de algum nó ou a
 * intersection do nó está em `m_unsuitableRoutes` (f305). Só o caminho dado é testado (sem desvio).
 */
export function isSuitablePath(p: Project, transporter: Entity, nodes: readonly PathNodeLike[]): boolean {
  const raw = transporter.get("m_unsuitableRoutes");
  const bad = new Set(Array.isArray(raw) ? (raw as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);
  if (!bad.size) return true;
  for (const n of nodes) {
    const loc = nodeLocation(p, n);
    if (loc !== null && bad.has(loc)) return false;
    if (n.roadConnection && bad.has(n.roadConnection)) return false;
  }
  return true;
}

/** tabela distância → produção do transportador (f303) */
export const transporterTable = (t: Entity): [number, number][] =>
  (Array.isArray(t.get("m_mDistanceWorkAchievement")) ? (t.get("m_mDistanceWorkAchievement") as [unknown, unknown][]) : []).map(([d, w]) => [typeof d === "number" ? d : 0, typeof w === "number" ? w : 0]);

/** RN-008: número de veículos para uma taxa de transporte (quantidade/h) na distância: ceil(taxa / w(d)). */
export function vehiclesNeeded(rate: number, w: number): number {
  if (!(w > 0)) throw new HaulResourceError("ZERO_PRODUCTION", "ZERO_PRODUCTION");
  return Math.ceil(rate / w);
}

/** Máscara de impedimento (`GetHaulClassMask` @0x9ec2a0). */
export const HAUL_CLASS = { NO_HAUL_RESOURCE: 1, UNSUITABLE_ROUTE: 2, TOO_LONG: 4 } as const;
