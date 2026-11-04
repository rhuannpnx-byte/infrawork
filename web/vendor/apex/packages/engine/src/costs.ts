/**
 * Custos e unidades (RF-008…010, RN-014, RN-023, RN-024). Evidência: analises/2026-10-11_dynaroad/evidencias/
 * decompilado/custos/ (Ghidra, 2026-10-13) e handoff/funcoes/5_custos_e_horas/; vtables em
 * handoff/docs/vtables_worksite.md; papéis/MassType em handoff/docs/analise_otimizacao_plan.md.
 *
 * - [O] SourceLandType::GetConvCoeff @0x946f90: mesma unidade → 1; da unidade base do material → fator de
 *   m_conversions; para a base → 1/fator; entre outras duas → passando pela base; sem fator → "invalid conversion".
 * - [O] AmountHelpers::ConvertAmount @0x932490 = quantidade × coeficiente; UnitPriceHelpers::GetConvertedPrice
 *   @0x9cf9a0 = preço ÷ coeficiente(unidade do preço → unidade pedida).
 * - [O] PriceVector::GetPriceAtDistance @0x951fc0 (ver priceAtDistance).
 * - [O] MovableWorkSite::GetUnitPrice @0x9b6870 (RN-014) e GetRefiningPrice @0x9b62f0; HaulInfo::GetHaulPrice
 *   @0x9d96b0 = GetUnitPrice(material, destino, distância, interpolar, unidade do material, com refino), convertido.
 * - [O] adequação (RN-024): SourceLandType/DestLandType::IsSuitable @0x947240/@0x9cf390 (lista m_vpSuitableTypes);
 *   IsSuitableMoveDestination de LandCut, BorrowPit, MassExchange, StockPile.
 * - [O] CrushingPlant::IsSuitableMoveDestination @0x9f3370 = destino ≠ a própria britagem e GetRefinedTypeForMoveTo
 *   @0x9f2f40 não nulo (U-08); refinado escolhido pela taxa da equipe de envio (U-09; empate: L-039).
 * - Fora desta unidade (D-019): a parcela de recursos do GetTotalPrice do Schedule (GetPricePerHour/GetPricePerUnit da
 *   equipe ÷ taxa de produção), que depende da equipe selecionada e da produção (U-07/U-09).
 */
import type { Entity, Project, Ref } from "@apex/model";

export class CostError extends Error {
  constructor(readonly code: "INVALID_CONVERSION" | "NOT_A_SOURCE" | "NOT_A_DESTINATION" | "SITE_UNIT_MISMATCH" | "NOT_IMPLEMENTED" | "NO_DLT" | "REFINED_TYPE_AMBIGUOUS", message: string) {
    super(message);
    this.name = "CostError";
  }
}

type Pairs = [unknown, unknown][];
const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
const refOf = (v: unknown): bigint | null => (typeof v === "bigint" ? v : null);
const pairs = (v: unknown): Pairs => (Array.isArray(v) ? (v as Pairs) : []);

/** Unidade base de um tipo (WorkSiteType f210 m_pUnit). */
export function unitOfType(t: Entity): bigint | null {
  return refOf(t.get("m_pUnit"));
}

/** GetConvCoeff @0x946f90: quantas unidades `to` há em uma unidade `from`, para o material `slt`. */
export function convCoeff(slt: Entity, from: bigint | null, to: bigint | null): number {
  if (from === to) return 1;
  const base = unitOfType(slt);
  const factor = (u: bigint | null) => pairs(slt.get("m_conversions")).find(([k]) => k === u)?.[1];
  if (from === base) {
    const f = factor(to);
    if (typeof f === "number") return f;
  } else if (to !== base) {
    return convCoeff(slt, from, base) * convCoeff(slt, base, to);
  } else {
    const f = factor(from);
    if (typeof f === "number") return 1 / f;
  }
  throw new CostError("INVALID_CONVERSION", `invalid conversion (${from} → ${to}, material ${slt.oid})`);
}

/** AmountHelpers::ConvertAmount @0x932490 (RN-023). */
export function convertAmount(slt: Entity, amount: number, from: bigint | null, to: bigint | null): number {
  return amount * convCoeff(slt, from, to);
}

/** UnitPriceHelpers::GetConvertedPrice @0x9cf9a0: preço por `from` → preço por `to`. */
export function convertedPrice(slt: Entity, price: number, from: bigint | null, to: bigint | null): number {
  return price / convCoeff(slt, from, to);
}

/**
 * PriceVector::GetPriceAtDistance @0x951fc0 (RF-010). Tabela distância → preço (m_distances, chaves crescentes):
 * - distância < 0 conta como 0; tabela com um só ponto na distância 0 → preço fixo; tabela vazia → 0;
 * - dentro da tabela: com `interpolate`, linear entre o ponto anterior (ou a origem (0, 0)) e o primeiro ponto com
 *   distância ≥ d (intervalo nulo → o preço do ponto); sem, o preço desse ponto (degrau);
 * - além do último ponto: inclinação "por 100" dos dois últimos pontos, nunca negativa (com um só ponto, preço ÷
 *   distância × 100); com `interpolate`, linear; sem, degraus inteiros de 100.
 */
export function priceAtDistance(pv: Entity, distance: number, interpolate: boolean): { price: number; unit: bigint | null } {
  const unit = refOf(pv.get("m_pUnit"));
  const d = Math.max(0, distance);
  const pts = pairs(pv.get("m_distances")).map(([k, v]) => [num(k), num(v)] as [number, number]).sort((a, b) => a[0] - b[0]);
  if (pts.length === 1 && pts[0]![0] === 0) return { price: pts[0]![1], unit };
  let prev: [number, number] = [0, 0];
  for (const [k, v] of pts) {
    if (d <= k) {
      if (!interpolate) return { price: v, unit };
      const span = k - prev[0];
      return { price: span > 0 ? ((v - prev[1]) * (d - prev[0])) / span + prev[1] : v, unit };
    }
    prev = [k, v];
  }
  if (pts.length === 0) return { price: 0, unit };
  const [lk, lv] = pts[pts.length - 1]!;
  let slope = 0;
  if (pts.length === 1) slope = (lv / lk) * 100;
  else {
    const [pk, pvv] = pts[pts.length - 2]!;
    slope = Math.max(0, ((lv - pvv) * 100) / (lk - pk));
  }
  const price = interpolate ? (d - lk) * slope * 0.01 + lv : Math.floor((d - lk) * 0.01) * slope + lv;
  return { price, unit };
}

// ---------- papéis dos tipos de tarefa (vtables_worksite.md, analise_otimizacao_plan.md) ----------

export const MASS_TYPE = { NONE: 0, MUST: 1, MAY: 2, SIMULTANEOUSLY: 8 } as const;
const SOURCE = new Set(["LandCut", "BorrowPit", "StockPile", "MassExchange", "CrushingPlant"]);
const DESTINATION = new Set(["Embankment", "WasteLand", "StockPile", "MassExchange", "CrushingPlant"]);

export const isSource = (ws: Entity) => SOURCE.has(ws.className);
export const isDestination = (ws: Entity) => DESTINATION.has(ws.className);

/** Get{Source,Destination}MassType (+0x84/+0x88). */
export function massType(ws: Entity, role: "source" | "destination"): number {
  switch (ws.className) {
    case "LandCut": return role === "source" ? MASS_TYPE.MUST : MASS_TYPE.NONE;
    case "Embankment": return role === "destination" ? MASS_TYPE.MUST : MASS_TYPE.NONE;
    case "BorrowPit": return role === "source" ? (ws.get("m_bMustUse") === true ? MASS_TYPE.MUST : MASS_TYPE.MAY) : MASS_TYPE.NONE;
    case "WasteLand": return role === "destination" ? (ws.get("m_bMustFill") === true ? MASS_TYPE.MUST : MASS_TYPE.MAY) : MASS_TYPE.NONE;
    case "StockPile": return MASS_TYPE.MAY;
    case "MassExchange": return MASS_TYPE.MUST | MASS_TYPE.SIMULTANEOUSLY;
    case "CrushingPlant": return MASS_TYPE.MAY | MASS_TYPE.SIMULTANEOUSLY;
    default: return MASS_TYPE.NONE;
  }
}

/** GetSourceLandType (+0x58) e GetDestLandType (+0x54). */
export function sourceLandType(p: Project, ws: Entity): Entity | undefined {
  return ["LandCut", "BorrowPit", "MassExchange"].includes(ws.className) ? p.resolve(ws.get("m_pSourceLandType") as Ref) : undefined;
}
export function destLandType(p: Project, ws: Entity): Entity | undefined {
  return ["Embankment", "WasteLand", "StockPile", "CrushingPlant", "MassExchange"].includes(ws.className) ? p.resolve(ws.get("m_pDestLandType") as Ref) : undefined;
}

/** GetSrcUnit (+0x8c): unidade do material de origem; britagem [O] e pilha [I, ICF] usam o tipo de destino. */
export function srcUnit(p: Project, ws: Entity): bigint | null {
  const t = ws.className === "CrushingPlant" || ws.className === "StockPile" ? destLandType(p, ws) : sourceLandType(p, ws);
  return t ? unitOfType(t) : null;
}
/** GetDstUnit (+0x90): unidade do material de destino. */
export function dstUnit(p: Project, ws: Entity): bigint | null {
  const t = destLandType(p, ws);
  return t ? unitOfType(t) : null;
}

/** IsDeliveryContract (+0x94): só a jazida tem (BorrowPit f401). */
export function isDeliveryContract(ws: Entity): boolean {
  return ws.className === "BorrowPit" && ws.get("m_bDeliveryContract") === true;
}

/** SourceLandType::IsSuitable / DestLandType::IsSuitable (RN-024). */
export function isSuitable(type: Entity, other: Entity): boolean {
  const list = type.get("m_vpSuitableTypes");
  return Array.isArray(list) && (list as unknown[]).includes(other.oid);
}

/** IsSuitableMoveDestination (+0x48) — RN-024. */
export function isSuitableMoveDestination(p: Project, src: Entity, dst: Entity): boolean {
  const dlt = destLandType(p, dst);
  switch (src.className) {
    case "LandCut":
    case "BorrowPit": {
      const slt = sourceLandType(p, src);
      return !!dlt && isDestination(dst) && !!slt && isSuitable(slt, dlt);
    }
    case "MassExchange": {
      if (src.oid === dst.oid) return false;
      const slt = sourceLandType(p, src);
      return !!dlt && isDestination(dst) && !!slt && isSuitable(slt, dlt);
    }
    case "StockPile":
      return !!dlt && isDestination(dst) && src.oid !== dst.oid && dst.className !== "StockPile";
    case "CrushingPlant":
      return src.oid !== dst.oid && refinedTypeForMoveTo(p, src, dst) !== undefined;
    default:
      return false;
  }
}

/** Refinados de um SourceLandType (m_vpRefinedTypes). */
export function refinedTypes(p: Project, slt: Entity): Entity[] {
  const v = slt.get("m_vpRefinedTypes");
  return (Array.isArray(v) ? (v as unknown[]) : []).map((o) => p.resolve(o as Ref)).filter((e): e is Entity => !!e);
}

/**
 * CrushingPlantHelpers::GetRefinedTypes @0x9f30a0/@0x9f3150: união dos refinados dos materiais aceitos pelo tipo de
 * destino da britagem; sem tipo de destino lança "no dlt".
 */
export function crusherRefinedTypes(p: Project, crush: Entity): Entity[] {
  const dlt = destLandType(p, crush);
  if (!dlt) throw new CostError("NO_DLT", "no dlt");
  const out = new Map<bigint, Entity>();
  const accepted = dlt.get("m_vpSuitableTypes");
  for (const o of Array.isArray(accepted) ? (accepted as unknown[]) : []) {
    const slt = p.resolve(o as Ref);
    if (slt) for (const r of refinedTypes(p, slt)) out.set(r.oid, r);
  }
  return [...out.values()];
}

/**
 * CrushingPlant::GetRefinedTypeForMoveTo @0x9f2f40: o material que sai da britagem para `dst`. Destino sem tipo →
 * nenhum. Entre os refinados adequados ao tipo do destino, fica o de maior taxa na equipe de envio selecionada
 * (WorkGroup::GetProductionRate @0x992250 = m_rates[tipo][0], na unidade do tipo; a do candidato anterior é convertida
 * para a unidade do novo pelo material anterior); só troca se for estritamente maior. [D] o original percorre um
 * unordered_set (ordem de hash de ponteiros, não reproduzível); [P U-61f, L-039] em empate fica o primeiro na união dos
 * refinados (ordem de `m_vpSuitableTypes` × `m_vpRefinedTypes`), que é determinística e gravável.
 */
export function refinedTypeForMoveTo(p: Project, crush: Entity, dst: Entity): Entity | undefined {
  const dlt = destLandType(p, dst);
  if (!dlt) return undefined;
  const sel = (crush.get("m_cSelectedSubWorkGroups") as [unknown, unknown][] | undefined)?.find(([u]) => u === 1);
  const g = sel ? p.resolve(sel[1] as Ref) : undefined;
  const rate = (t: Entity) => {
    if (!g || g.className === "NullWorkGroup") return 0;
    const r = (g.get("m_rates") as [unknown, unknown][] | undefined)?.find(([k]) => k === t.oid);
    return Array.isArray(r?.[1]) ? num((r![1] as unknown[])[0]) : 0;
  };
  let best: Entity | undefined;
  for (const r of crusherRefinedTypes(p, crush)) {
    if (!isSuitable(r, dlt)) continue;
    if (best && !(convertAmount(best, rate(best), unitOfType(best), unitOfType(r)) < rate(r))) continue;
    best = r;
  }
  return best;
}

/** MovableWorkSite::GetRefiningPrice @0x9b62f0: preço de refino do material para o tipo de destino, na unidade pedida. */
export function refiningPrice(p: Project, src: Entity, slt: Entity, dst: Entity, unit: bigint | null): number {
  if (!isSource(src)) throw new CostError("NOT_A_SOURCE", "work site is not a source");
  if (!isDestination(dst)) throw new CostError("NOT_A_DESTINATION", "work site is not a destionation");
  const dlt = destLandType(p, dst);
  if (!dlt) return 0;
  const coeff = convCoeff(slt, unit, unitOfType(dlt));
  const price = pairs(slt.get("m_mRefiningPrices")).find(([k]) => k === dlt.oid)?.[1];
  return num(price) * coeff;
}

/**
 * MovableWorkSite::GetUnitPrice @0x9b6870 (RN-014): preço unitário da origem + do destino (cada um convertido para
 * `unit` pelo material) + preço por distância do PriceVector do material (omitido com contrato de fornecimento) +
 * refino (se `withRefining`).
 */
export function unitPrice(p: Project, src: Entity, slt: Entity, dst: Entity, distance: number, interpolate: boolean, unit: bigint | null, withRefining: boolean): number {
  if (!isSource(src)) throw new CostError("NOT_A_SOURCE", "work site is not a source");
  if (!isDestination(dst)) throw new CostError("NOT_A_DESTINATION", "work site is not a destionation");
  let price = convertedPrice(slt, num(src.get("m_dSourceUnitPrice")), srcUnit(p, src), unit)
    + convertedPrice(slt, num(dst.get("m_dDestinationUnitPrice")), dstUnit(p, dst), unit);
  if (!isDeliveryContract(src)) {
    const pv = p.resolve(slt.get("m_pPriceVector") as Ref);
    if (pv) {
      const at = priceAtDistance(pv, distance, interpolate);
      price += convertedPrice(slt, at.price, at.unit, unit);
    }
  }
  if (withRefining) price += refiningPrice(p, src, slt, dst, unit);
  return price;
}

/** HaulInfo::GetHaulPrice @0x9d96b0: custo da coluna no Plan, na unidade pedida. */
export function haulPrice(p: Project, src: Entity, slt: Entity, dst: Entity, distance: number, unit: bigint | null): number {
  const base = unitOfType(slt);
  return convertedPrice(slt, unitPrice(p, src, slt, dst, distance, true, base, true), base, unit);
}
