/**
 * Otimização de transportes, modo Plan (RF-026, RN-010, RN-011, RN-017, RNF-002; D-005). Evidência:
 * analises/2026-10-11_dynaroad/handoff/docs/analise_otimizacao_plan.md e evidencias/decompilado/{otimizacao,
 * candidatos, janelas, u08, u08b}/ (PlanLom::Solve @0xa04ed0, GetHaulChainCandidates @0x9d17b0,
 * MakeHaulChainCandidateSteps @0x9fe4b0/Impl @0x9fe730, MakeHaulInfos @0x9d9930, AddImpl @0xa104f0,
 * AddChainEqualityConstraints @0xa040a0, BuildModel @0xa043b0, MakeUniqueHauls @0xa04970, TrackQuantity @0xa053d0,
 * Export @0xa04730, AmountTracker::* @0xa0f9c0…, SumTaskHelpers::IsHaulPreventedAsExternal @0x9ba540,
 * MoveManager::FilterPreventedHaulChains @0x94e7e0, LPMove::LPMove @0x952cc0).
 *
 * Fluxo [O]: apaga os LPMoves não manuais; AmountTracker com as quantidades livres (descontados os manuais);
 * cadeias candidatas origem → [britagem] → destino (sem pilhas no Plan); zonas de construção em pós-ordem; em cada
 * zona, as cadeias cujos elos são todos filhos dela saem da lista, viram passos (um por par de work places), o LP
 * da zona é resolvido e os transportes agregados por (origem, destino, material, caminho) viram LPMoves; a sobra
 * passa para a zona seguinte. Cancelado: todos os LPMoves não manuais ficam apagados.
 *
 * Decisões e inferências:
 * - [P] o cálculo inteiro roda antes e o projeto muda num único nível de undo "Haul calculation"; um erro no meio
 *   não deixa LPMoves parciais (o original exporta zona a zona e o estado após erro não foi lido).
 * - [I] RemoveAllLPMoves(false) remove os não manuais (o getter fundido por /OPT:ICF lê o 1º bool do LPMove), com o
 *   Path e os Nodes de cada um.
 * - [I] AddWorkPlaceAmountConstraints: o pseudocódigo mostra só o laço das linhas de origem; as linhas de destino
 *   também entram (sem elas as folgas de destino não teriam linha e os aterros não limitariam nada; os oráculos
 *   confirmam limites de destino).
 * - [I] ordens por endereço de memória (sort das cadeias, std::map dos transportes) viram ordem por OID; só mudam a
 *   ordem das colunas e dos LPMoves, nunca o ótimo (D-005).
 * - [O] realizados travados no LP (m_bActualsLockedInLP, L-048; analise_realizados_l045_l048.md §5.1): LPMoves
 *   realizados recriados dos ImplUtilization (CreateLPMovesFromImplMoves @0x94e420), massa realizada descontada por
 *   work place (AmountTracker::SubtractActuals @0xa0fbc0) e tarefas encerradas fora das cadeias.
 */
import { COIN_DBL_MAX, LomBuild, ModelRow, solveLp } from "@apex/lp";
import { encodeContainer, type Entity, type Project, type Ref } from "@apex/model";
import {
  convertAmount, convertedPrice, destLandType, dstUnit, haulPrice, isDestination, isSource, isSuitable,
  isSuitableMoveDestination, MASS_TYPE, massType, refinedTypeForMoveTo, refinedTypes, sourceLandType, srcUnit, unitOfType,
} from "./costs.js";
import { ActualsContext } from "./actuals.js";
import { HAUL_CALCULATION_ACTION, projectUndoText } from "./names.js";
import { totalPrice } from "./schedule.js";
import { DBL_MAX, DistanceCalculatorManager, type DistanceCalculator, type LightNode, type LightPath } from "./distances.js";

export class PlanError extends Error {
  constructor(readonly code: "TASK_QUANTITY_EXCEEDED" | "UNIT_MISMATCH" | "SITE_UNIT_MISMATCH" | "NOT_IMPLEMENTED" | "NEGATIVE_AMOUNT", message: string) {
    super(message);
    this.name = "PlanError";
  }
}

/** LomSolver: m_dMaxMoveDistance inicial (analise_otimizacao_schedule.md §3). */
export const MAX_MOVE_DISTANCE_INIT = 1_000_000;

const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);
const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
const byOid = (a: Entity, b: Entity) => (a.oid < b.oid ? -1 : a.oid > b.oid ? 1 : 0);

// ---------- RN-011: flags por classe (vtables_worksite.md +0x74/+0x78/+0x80) ----------
const SOURCE_AMOUNT = new Set(["LandCut", "MassExchange", "BorrowPit"]);
const DESTINATION_AMOUNT = new Set(["Embankment", "MassExchange", "WasteLand"]);
const DESTINATION_CONSTRAINT = new Set(["StockPile", "CrushingPlant"]);
export const isSourceAmount = (ws: Entity) => SOURCE_AMOUNT.has(ws.className);
export const isDestinationAmount = (ws: Entity) => DESTINATION_AMOUNT.has(ws.className);
export const isDestinationConstraint = (ws: Entity) => DESTINATION_CONSTRAINT.has(ws.className);

/** MovableWorkSites na ordem do WorkSiteContainer */
const MOVABLE_LISTS = ["m_vpLandCuts", "m_vpEmbankments", "m_vpMassExchanges", "m_vpBorrowPits", "m_vpWasteLands", "m_vpStockPiles", "m_vpCrushingPlants"];
/** WorkSiteContainer em ordem de lista; máscara 0x1f = corte, aterro, troca de massa, jazida, bota-fora. */
const MASK_1F = ["m_vpLandCuts", "m_vpEmbankments", "m_vpMassExchanges", "m_vpBorrowPits", "m_vpWasteLands"];

interface Quantity {
  amount: number;
  unit: bigint | null;
}

/** MovableWorkSiteHelpers::GetUnit @0x9b67c0. */
export function siteUnit(p: Project, site: Entity, source: boolean): bigint {
  const u = source ? srcUnit(p, site) : dstUnit(p, site);
  if (u === null) throw new PlanError("SITE_UNIT_MISMATCH", "site&src/dst mismatch.");
  return u;
}

/** AmountTracker (@0xa0f9c0…): quantidade livre por work place, origem e destino, inicializada na 1ª consulta. */
export class AmountTracker {
  readonly src = new Map<bigint, Quantity>();
  readonly dst = new Map<bigint, Quantity>();
  constructor(private readonly p: Project) {}

  free(wp: Entity, source: boolean): Quantity {
    const m = source ? this.src : this.dst;
    let q = m.get(wp.oid);
    if (q) return q;
    const site = this.p.resolve(wp.get("m_pWorkSite") as Ref)!;
    q = { amount: 1e100, unit: siteUnit(this.p, site, source) };
    if (source) {
      if (isSourceAmount(site)) q = { amount: num(wp.get("m_dSourceAmount")), unit: siteUnit(this.p, site, true) };
    } else if (isDestinationAmount(site)) {
      q = { amount: num(wp.get("m_dDestinationAmount")), unit: siteUnit(this.p, site, false) };
    } else if (isDestinationConstraint(site) && massType(site, "destination") & MASS_TYPE.SIMULTANEOUSLY && num(wp.get("m_dDestinationAmount")) > 0) {
      q = { amount: num(wp.get("m_dDestinationAmount")), unit: siteUnit(this.p, site, false) };
    }
    m.set(wp.oid, q);
    return q;
  }

  /** SubtractAmount @0xa0fe00: desconta um LPMove (quantidade no material) nos dois lados. */
  subtractMove(m: Entity): void {
    const slt = this.p.resolve(m.get("m_pSourceLandType") as Ref)!;
    const amount = num(m.get("m_dAmount"));
    for (const [k, source] of [["m_pSrcWorkPlace", true], ["m_pDstWorkPlace", false]] as const) {
      const wp = this.p.resolve(m.get(k) as Ref);
      if (!wp) continue;
      const q = this.free(wp, source);
      q.amount -= convertAmount(slt, amount, unitOfType(slt), q.unit);
    }
  }

  /**
   * SubtractActuals @0xa0fbc0: tira da quantidade livre de cada work place o realizado que o TaskActuals lhe atribuiu
   * (os dois sentidos), nos lados que a tarefa tem.
   */
  subtractActuals(ac: ActualsContext): void {
    const c = this.p.resolve(this.p.root()!.get("m_pWSContainer") as Ref);
    const sites = c ? MOVABLE_LISTS.flatMap((k) => refs(c.get(k)).map((o) => this.p.get(o)!)) : [];
    for (const ws of sites)
      for (const wp of refs(ws.get("m_vpWorkPlaces")).map((o) => this.p.get(o)!)) {
        for (const source of [true, false]) {
          if (source ? !isSource(ws) : !isDestination(ws)) continue;
          const q = ac.actualQuantityBoth(wp, source);
          if (q > 0) this.free(wp, source).amount -= q;
        }
      }
  }

  /** RemoveNegatives @0xa0faf0: zera negativos; true se algum passou de −0,1. */
  removeNegatives(): boolean {
    let bad = false;
    for (const m of [this.src, this.dst])
      for (const q of m.values())
        if (q.amount < 0) {
          if (q.amount < -0.1) bad = true;
          q.amount = 0;
        }
    return bad;
  }
}

// ---------- RN-017: cadeias candidatas ----------

export interface Chain {
  source: Entity;
  pile?: Entity;
  crush?: Entity;
  pile2?: Entity;
  destination: Entity;
}

function sumTaskParent(p: Project, e: Entity): Entity | undefined {
  return p.resolve(e.get("m_pSumTaskParent") as Ref);
}

/** WorkSiteHelpers::IsChild @0x92a4c0: a zona está na cadeia de sum tasks pai da tarefa. */
export function isChild(p: Project, ws: Entity, zone: Entity): boolean {
  for (let s = sumTaskParent(p, ws); s; s = p.resolve(s.get("m_pParent") as Ref)) if (s.oid === zone.oid) return true;
  return false;
}

/** SumTaskHelpers::IsHaulPreventedAsExternal @0x9ba540 sobre as sum tasks pai dos elos. */
export function isHaulPreventedAsExternal(p: Project, parents: (Entity | undefined)[]): boolean {
  if (parents.length < 2) return true;
  const parentOf = (s: Entity) => p.resolve(s.get("m_pParent") as Ref);
  let area: Entity | undefined;
  for (const first of parents)
    for (let s = first; s; s = parentOf(s))
      if (s.get("m_bPreventExternalHauls") === true) {
        if (area && area.oid !== s.oid) return true;
        area = s;
        break;
      }
  if (!area) return false;
  const root = p.resolve(p.root()!.get("m_pRootSumTask") as Ref);
  for (const first of parents) {
    if (!first || first.oid === root?.oid || first.oid === area.oid) continue;
    let s: Entity | undefined = first;
    while (s && s.oid !== area.oid) s = parentOf(s);
    if (!s) return true;
  }
  return false;
}

/**
 * anon::IsUsable @0x9d24c0 com a equipe de envio selecionada da tarefa: equipe nula → false; [I] senão, a equipe tem
 * taxa para o tipo (virtual +0x20, a mesma leitura de WorkSite::IsSuitable). [I] sem equipe selecionada → false.
 */
function isUsable(p: Project, site: Entity, type: Entity | undefined): boolean {
  if (!type) return false;
  const sel = (site.get("m_cSelectedSubWorkGroups") as [unknown, unknown][] | undefined)?.find(([u]) => u === 1);
  const g = sel ? p.resolve(sel[1] as Ref) : undefined;
  if (!g || g.className === "NullWorkGroup") return false;
  const rates = (g.get("m_rates") as [unknown, unknown][] | undefined) ?? [];
  return rates.some(([t]) => t === type.oid);
}

const suitable = (p: Project, a: Entity, b: Entity) => isSuitableMoveDestination(p, a, b);

/** IsSuitableMoveChain(origem, britagem, destino, usável) @0x9d2160. */
function chainSCD(p: Project, s: Entity, c: Entity, d: Entity, checkUsable: boolean): boolean {
  if (!suitable(p, s, c) || !suitable(p, c, d)) return false;
  const slt = sourceLandType(p, s), dlt = destLandType(p, d);
  if (!slt || !dlt) return false;
  return refinedTypes(p, slt).some((r) => isSuitable(r, dlt) && (!checkUsable || isUsable(p, c, r)));
}
/** IsSuitableMoveChain(origem, pilha, destino) @0x9d2310. */
function chainSPD(p: Project, s: Entity, sp: Entity, d: Entity): boolean {
  return suitable(p, s, d) && suitable(p, s, sp) && suitable(p, sp, d) && isUsable(p, sp, sourceLandType(p, s));
}
/** IsSuitableMoveChain(origem, britagem, pilha2, destino) @0x9d2220. [I] o segundo IsUsable é o da pilha2. */
function chainSCPD(p: Project, s: Entity, c: Entity, sp: Entity, d: Entity): boolean {
  if (!suitable(p, s, c) || !suitable(p, c, sp) || !suitable(p, sp, d)) return false;
  const slt = sourceLandType(p, s), dltP = destLandType(p, sp), dltD = destLandType(p, d);
  if (!slt || !dltP || !dltD) return false;
  return refinedTypes(p, slt).some((r) => isSuitable(r, dltP) && isSuitable(r, dltD) && isUsable(p, c, r) && isUsable(p, sp, r));
}
/** IsSuitableMoveChain(origem, pilha, britagem, destino) @0x9d2370. */
function chainSPCD(p: Project, s: Entity, sp: Entity, c: Entity, d: Entity): boolean {
  return suitable(p, s, c) && suitable(p, s, sp) && suitable(p, sp, c) && isUsable(p, sp, sourceLandType(p, s)) && chainSCD(p, s, c, d, true);
}
/** IsSuitableMoveChain(origem, pilha, britagem, pilha2, destino) @0x9d23f0. */
function chainSPCPD(p: Project, s: Entity, sp: Entity, c: Entity, sp2: Entity, d: Entity): boolean {
  return suitable(p, s, c) && suitable(p, s, sp) && suitable(p, sp, c) && isUsable(p, sp, sourceLandType(p, s)) && chainSCPD(p, s, c, sp2, d);
}

/** HaulChainCandidateHelpers::IsUnplausibleCandidate @0x9d2470. */
export function isUnplausible(ch: Chain): boolean {
  if (!ch.pile && !ch.pile2) return false;
  if ((massType(ch.destination, "destination") & MASS_TYPE.MAY) === 0 && (massType(ch.source, "source") & MASS_TYPE.MAY) === 0) return !!ch.pile && !!ch.pile2;
  return true;
}

export interface CandidateOptions {
  /** com pilhas (Schedule) */
  piles: boolean;
  /** tira tarefas concluídas (realizados travados no LP) */
  excludeFinished: boolean;
  /** U-33b: sem o filtro das cadeias impedidas (4.º argumento false, grade "Suitable hauls") */
  keepPrevented?: boolean;
}

/** HaulChainCandidateHelpers::GetHaulChainCandidates @0x9d17b0 (o 4º argumento, sempre true, filtra as cadeias proibidas). */
export function haulChainCandidates(p: Project, opts: CandidateOptions): Chain[] {
  const c = p.resolve(p.root()!.get("m_pWSContainer") as Ref);
  const live = (e: Entity) => !opts.excludeFinished || e.get("m_bFinished") !== true;
  const sites = c ? MASK_1F.flatMap((k) => refs(c.get(k)).map((o) => p.get(o)!)) : [];
  const sources = sites.filter(isSource).filter(live), dests = sites.filter(isDestination).filter(live);
  const crushers = c ? refs(c.get("m_vpCrushingPlants")).map((o) => p.get(o)!).filter(live) : [];
  const piles = c && opts.piles ? refs(c.get("m_vpStockPiles")).map((o) => p.get(o)!).filter(live) : [];
  const out: Chain[] = [];
  for (const s of sources) {
    const sMay = (massType(s, "source") & MASS_TYPE.MAY) !== 0;
    for (const d of dests) {
      if (sMay && massType(d, "destination") & MASS_TYPE.MAY) continue;
      if (suitable(p, s, d)) {
        out.push({ source: s, destination: d });
        for (const sp of piles) if (chainSPD(p, s, sp, d)) out.push({ source: s, pile: sp, destination: d });
        continue;
      }
      const slt = sourceLandType(p, s), dlt = destLandType(p, d);
      if (!slt || !dlt || !refinedTypes(p, slt).some((r) => isSuitable(r, dlt))) continue;
      for (const k of crushers) {
        if (!chainSCD(p, s, k, d, opts.piles)) continue;
        out.push({ source: s, crush: k, destination: d });
        for (const sp of piles) {
          if (chainSPCD(p, s, sp, k, d)) {
            out.push({ source: s, pile: sp, crush: k, destination: d });
            for (const sp2 of piles) if (chainSPCPD(p, s, sp, k, sp2, d)) out.push({ source: s, pile: sp, crush: k, pile2: sp2, destination: d });
          }
          if (chainSCPD(p, s, k, sp, d)) out.push({ source: s, crush: k, pile2: sp, destination: d });
        }
      }
    }
  }
  const links = (ch: Chain) => [ch.source, ch.pile, ch.crush, ch.pile2, ch.destination].filter((e): e is Entity => !!e);
  const allowed = out.filter((ch) => !isHaulPreventedAsExternal(p, links(ch).map((e) => sumTaskParent(p, e))));
  return opts.keepPrevented ? sortChains(allowed) : filterPreventedChains(p, allowed);
}

/**
 * U-33b: candidatos da grade "Suitable hauls" (13017) — `GetHaulChainCandidates(projeto, modo ≠ Plan, true, false)`
 * [O `tarefa_dialogo.md` §3.2]; `prevented` marca as que `FilterPreventedHaulChains` tiraria (Exclude marcado).
 */
export function suitableHaulChains(p: Project, piles: boolean): { chain: Chain; prevented: boolean }[] {
  const keys = preventedKeys(p);
  return haulChainCandidates(p, { piles, excludeFinished: false, keepPrevented: true }).map((chain) => ({ chain, prevented: keys.has(chainKeyOf(chain)) }));
}

/**
 * `GetAverageUnitPriceAndDistance@0x9d8fd0` no Plan (6.º argumento falso → `MakeHaulInfos`) [O]: média simples, sobre os
 * pares de work places origem × destino com rota, da distância (soma dos passos pelos elos intermediários) e do preço.
 * U-61h [O DynaRoad em execução, u61h_plan]: cada passo no preço do seu material (`HaulInfo::GetHaulPrice`, interpolado,
 * refinado depois da britagem) convertido para `unit` (a unidade do tipo do destino: "US$0,63/t" em Cut R → Crusher C →
 * Base B = 0,2005/bcm ÷ 2,6 + 0,54975/t; "US$1,11/ccm" em Cut S → Fill F) e somado; sem par com rota → null ("?").
 */
export function chainAverage(p: Project, ch: Chain, dc: DistanceCalculator, unit?: bigint | null): { price: number | null; distance: number | null } {
  const links = [ch.source, ch.pile, ch.crush, ch.pile2, ch.destination].filter((e): e is Entity => !!e);
  const slt0 = sourceLandType(p, ch.source);
  if (!slt0) return { price: null, distance: null };
  const refined = ch.crush ? refinedTypeForMoveTo(p, ch.crush, ch.destination) : undefined;
  const to = unit === undefined ? unitOfType(slt0) : unit;
  let n = 0, sumD = 0, sumP = 0;
  for (const sw of workPlaces(p, ch.source))
    for (const dw of workPlaces(p, ch.destination)) {
      const nodes = [sw, ...links.slice(1, -1).map((x) => workPlaces(p, x)[0]!), dw];
      let d = 0, price = 0, ok = true, slt = slt0;
      for (let i = 0; i + 1 < nodes.length; i++) {
        const step = dc.distanceNoThrow(nodes[i]!.oid, nodes[i + 1]!.oid);
        if (!(step < DBL_MAX)) { ok = false; break; }
        d += step;
        price += convertedPrice(slt, haulPrice(p, links[i]!, slt, links[i + 1]!, step, unitOfType(slt)), unitOfType(slt), to);
        if (links[i + 1] === ch.crush && refined) slt = refined;
      }
      if (!ok) continue;
      n++; sumD += d; sumP += price;
    }
  return n ? { price: sumP / n, distance: sumD / n } : { price: null, distance: null };
}

/** Cadeias do Plan: sem pilhas e sem checar a equipe de envio da britagem. */
export function planCandidates(p: Project, excludeFinished = false): Chain[] {
  return haulChainCandidates(p, { piles: false, excludeFinished });
}

const chainKey = (ch: { source?: Ref; pile?: Ref; crush?: Ref; pile2?: Ref; destination?: Ref }) =>
  [ch.source, ch.pile, ch.crush, ch.pile2, ch.destination].map((o) => (o ?? 0n).toString()).join("|");

const chainKeyOf = (ch: Chain) => chainKey({ source: ch.source.oid, pile: ch.pile?.oid ?? null, crush: ch.crush?.oid ?? null, pile2: ch.pile2?.oid ?? null, destination: ch.destination.oid });
/** Chaves das cadeias de `MoveManager.m_preventedChains`. */
function preventedKeys(p: Project): Set<string> {
  const mm = p.resolve(p.root()!.get("m_pMoveManager") as Ref);
  return new Set(
    refs(mm?.get("m_preventedChains")).map((o) => {
      const k = p.get(o)!;
      const g = (m: string) => k.get(`m_candidate.${m}`) as Ref;
      return chainKey({ source: g("m_pSource"), pile: g("m_pPile"), crush: g("m_pCrush"), pile2: g("m_pPile2"), destination: g("m_pDestination") });
    }),
  );
}
/** MoveManager::FilterPreventedHaulChains @0x94e7e0: ordena as cadeias e tira as proibidas (m_preventedChains). */
function filterPreventedChains(p: Project, chains: Chain[]): Chain[] {
  const prevented = preventedKeys(p);
  return sortChains(chains).filter((ch) => !prevented.has(chainKeyOf(ch)));
}
/** Ordem por (origem, pilha, britagem, pilha 2, destino) do `FilterPreventedHaulChains`. */
function sortChains(chains: Chain[]): Chain[] {
  const tuple = (ch: Chain) => [ch.source.oid, ch.pile?.oid ?? 0n, ch.crush?.oid ?? 0n, ch.pile2?.oid ?? 0n, ch.destination.oid];
  const cmp = (a: Chain, b: Chain) => {
    const x = tuple(a), y = tuple(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
    return 0;
  };
  return [...chains].sort(cmp);
}

/** SumTaskHelpers::GetMassEconomyAreasPostOrder @0x9b91a0 (IsMassEconomyArea: marcada ou raiz). */
export function massEconomyAreasPostOrder(p: Project): Entity[] {
  const out: Entity[] = [];
  const visit = (s: Entity) => {
    for (const o of refs(s.get("m_vpChildren"))) {
      const ch = p.get(o);
      if (ch?.className === "SumTask") visit(ch);
    }
    if (s.get("m_bMassEconomyArea") === true || p.resolve(s.get("m_pParent") as Ref) === undefined) out.push(s);
  };
  const root = p.resolve(p.root()!.get("m_pRootSumTask") as Ref);
  if (root) visit(root);
  return out;
}

// ---------- passos e HaulInfo ----------

export interface HaulInfo {
  source: Entity; // MovableWorkPlace
  destination: Entity;
  slt: Entity;
  distance: number;
  chain: number;
  step: number;
  col: number;
}

const workPlaces = (p: Project, site: Entity) => refs(site.get("m_vpWorkPlaces")).map((o) => p.get(o)!).filter((e) => e.className === "MovableWorkPlace");

/** HaulChainCandidateStep @0x9fdd00: distância sem rota ou acima do máximo do material vira DBL_MAX. */
function stepDistance(dc: DistanceCalculator, src: Entity, dst: Entity, slt: Entity): number {
  const d = dc.distanceNoThrow(src.oid, dst.oid);
  const max = num(slt.get("m_dMaxHaulDistance"));
  return max > 0 && max < d ? DBL_MAX : d;
}

/** MakeHaulInfos @0x9d9930 + MakeHaulChainCandidateSteps(Impl) @0x9fe4b0/@0x9fe730. */
export function makeHaulInfos(p: Project, chains: Chain[], dc: DistanceCalculator, tracker: AmountTracker, maxMoveDistance: number): HaulInfo[] {
  const out: HaulInfo[] = [];
  let chainNo = 0;
  for (const ch of chains) {
    const slt0 = sourceLandType(p, ch.source)!;
    for (const sw of workPlaces(p, ch.source))
      for (const dw of workPlaces(p, ch.destination)) {
        const steps: { source: Entity; destination: Entity; slt: Entity; distance: number }[] = [];
        if (ch.crush) {
          const cw = workPlaces(p, ch.crush)[0]!;
          const refined = refinedTypeForMoveTo(p, ch.crush, ch.destination)!;
          steps.push({ source: sw, destination: cw, slt: slt0, distance: stepDistance(dc, sw, cw, slt0) });
          steps.push({ source: cw, destination: dw, slt: refined, distance: stepDistance(dc, cw, dw, refined) });
        } else steps.push({ source: sw, destination: dw, slt: slt0, distance: stepDistance(dc, sw, dw, slt0) });
        if (steps.some((s) => s.distance === DBL_MAX || maxMoveDistance < s.distance)) continue;
        if (steps.some((s) => tracker.free(s.source, true).amount <= 0.01 || tracker.free(s.destination, false).amount <= 0.01)) continue;
        steps.forEach((s, i) => out.push({ ...s, chain: chainNo, step: i, col: out.length }));
        chainNo++;
      }
  }
  return out;
}

// ---------- modelo (RN-010) ----------

const siteOf = (p: Project, wp: Entity) => p.resolve(wp.get("m_pWorkSite") as Ref)!;

/** AddWorkPlaceAmountConstraints @0xa10c50 / AddImpl @0xa104f0. */
export function addWorkPlaceAmountConstraints(p: Project, b: LomBuild, tracker: AmountTracker, hauls: HaulInfo[]): void {
  const srcRows = new Map<bigint, ModelRow>(), dstRows = new Map<bigint, ModelRow>();
  b.superHaulBeginCol = b.nSuperCol;
  for (const h of hauls) {
    const sSite = siteOf(p, h.source), dSite = siteOf(p, h.destination);
    const sltUnit = unitOfType(h.slt);
    if (!srcRows.has(h.source.oid) && isSourceAmount(sSite)) {
      const free = tracker.free(h.source, true);
      const row = new ModelRow();
      row.upper = free.amount;
      if (free.unit !== sltUnit) throw new PlanError("UNIT_MISMATCH", "Unexpected source unit mismatch");
      if (massType(sSite, "source") & MASS_TYPE.MUST) {
        row.lower = free.amount;
        const sc = b.allocateSuperCol();
        b.superHaulsToDestination.set(sc, h.col);
        row.addEntry(sc, 1);
        b.columnUppers[sc] = free.amount;
      }
      srcRows.set(h.source.oid, row);
    }
    srcRows.get(h.source.oid)?.addEntry(h.col, convertAmount(h.slt, 1, sltUnit, siteUnit(p, sSite, true)));
    if (!dstRows.has(h.destination.oid)) {
      if (isDestinationAmount(dSite)) {
        const free = tracker.free(h.destination, false);
        const row = new ModelRow();
        row.upper = free.amount;
        if (massType(dSite, "destination") & MASS_TYPE.MUST) {
          row.lower = free.amount;
          const sc = b.allocateSuperCol();
          b.superHaulsFromSource.set(sc, h.col);
          row.addEntry(sc, 1);
          b.columnUppers[sc] = free.amount;
        }
        dstRows.set(h.destination.oid, row);
      } else if (isDestinationConstraint(dSite) && massType(dSite, "destination") & MASS_TYPE.SIMULTANEOUSLY && num(h.destination.get("m_dDestinationAmount")) > 0) {
        const row = new ModelRow();
        row.upper = tracker.free(h.destination, false).amount;
        dstRows.set(h.destination.oid, row);
      }
    }
    dstRows.get(h.destination.oid)?.addEntry(h.col, convertAmount(h.slt, 1, sltUnit, siteUnit(p, dSite, false)));
  }
  b.superHaulEndCol = b.nSuperCol;
  for (const r of srcRows.values()) r.addTo(b);
  for (const r of dstRows.values()) r.addTo(b); // [I] ver cabeçalho
}

/** AddChainEqualityConstraints @0xa040a0: coef·x(c, s) − x(c, s+1) = 0, com a conversão na britagem. */
export function addChainEqualityConstraints(p: Project, hauls: HaulInfo[], b: LomBuild): void {
  const byStep = new Map<string, HaulInfo[]>();
  for (const h of hauls) {
    const k = `${h.chain}|${h.step}`;
    byStep.set(k, [...(byStep.get(k) ?? []), h]);
  }
  for (const [k, cur] of byStep) {
    const [c, s] = k.split("|").map(Number) as [number, number];
    const next = byStep.get(`${c}|${s + 1}`);
    if (!next) continue;
    const a = cur.at(-1)!, n = next.at(-1)!;
    let coef = 1;
    if (a.slt.oid !== n.slt.oid) {
      const mid = unitOfType(destLandType(p, siteOf(p, a.destination))!);
      coef = convertAmount(a.slt, 1, unitOfType(a.slt), mid) * convertAmount(n.slt, 1, mid, unitOfType(n.slt));
    }
    const row = new ModelRow();
    row.upper = 0;
    for (const h of next) row.addEntry(h.col, -1);
    for (const h of cur) row.addEntry(h.col, coef);
    row.addTo(b);
  }
}

export interface ZoneModel {
  build: LomBuild;
  cost: number[];
}

/** BuildModel @0xa043b0: custos dos transportes e penalidade 5·max + 1 nas folgas. */
export function buildModel(p: Project, hauls: HaulInfo[], tracker: AmountTracker): ZoneModel {
  const b = new LomBuild(hauls.length);
  addWorkPlaceAmountConstraints(p, b, tracker, hauls);
  addChainEqualityConstraints(p, hauls, b);
  const fill = p.root()!.get("m_pFillUnit") as bigint | null;
  const cost = Array<number>(b.numCols).fill(0);
  let max = 0;
  for (const h of hauls) {
    const u = unitOfType(h.slt);
    const c = haulPrice(p, siteOf(p, h.source), h.slt, siteOf(p, h.destination), h.distance, u);
    cost[h.col] = c;
    max = Math.max(max, convertedPrice(h.slt, c, u, fill));
  }
  const penalty = max * 5 + 1;
  for (let sc = b.superHaulBeginCol; sc < b.superHaulEndCol; sc++) {
    const fromDst = b.superHaulsFromSource.get(sc);
    const h = hauls[fromDst ?? b.superHaulsToDestination.get(sc)!]!;
    const unit = fromDst !== undefined ? unitOfType(destLandType(p, siteOf(p, h.destination))!) : unitOfType(h.slt);
    cost[sc] = convertedPrice(h.slt, penalty, fill, unit);
  }
  return { build: b, cost };
}

// ---------- resultado ----------

export interface UniqueHaul {
  source: Entity;
  destination: Entity;
  slt: Entity;
  path: LightPath;
  /** na unidade de origem da tarefa de origem (GetUnit(site, true)) */
  amount: number;
}

/** TrackQuantity @0xa053d0. */
function trackQuantity(p: Project, tracker: AmountTracker, amount: number, wp: Entity, source: boolean, slt: Entity): void {
  const q = tracker.free(wp, source);
  q.amount -= convertAmount(slt, amount, unitOfType(slt), q.unit);
  if (q.amount < -0.1) {
    const unit = q.unit !== null ? (p.get(q.unit)?.get("m_strName") ?? "") : "";
    throw new PlanError("TASK_QUANTITY_EXCEEDED", `Task quantity exceeded, needed ${-q.amount} ${String(unit)} more for ${source ? "sending" : "receiving"}.`);
  }
}

/** MakeUniqueHauls @0xa04970: soma por (origem, destino, material, caminho); some abaixo de 0,1. */
function makeUniqueHauls(p: Project, dc: DistanceCalculator, hauls: HaulInfo[], x: number[], tracker: AmountTracker): UniqueHaul[] {
  const map = new Map<string, UniqueHaul>();
  for (const h of hauls) {
    const v = x[h.col]!;
    if (!(v > 0)) continue;
    const path = dc.path(h.source.oid, h.destination.oid);
    const key = [h.source.oid, h.destination.oid, h.slt.oid, path.nodes.map((n) => `${n.workPlace ?? ""}:${n.roadConnection ?? ""}:${n.from ?? ""}`).join(",")].join("|");
    let u = map.get(key);
    if (!u) {
      u = { source: h.source, destination: h.destination, slt: h.slt, path, amount: 0 };
      map.set(key, u);
    }
    u.amount += convertAmount(h.slt, v, unitOfType(h.slt), siteUnit(p, siteOf(p, h.source), true));
    trackQuantity(p, tracker, v, h.source, true, h.slt);
    trackQuantity(p, tracker, v, h.destination, false, h.slt);
  }
  return [...map.values()]
    .filter((u) => u.amount >= 0.1)
    .sort((a, b) => byOid(a.source, b.source) || byOid(a.destination, b.destination) || byOid(a.slt, b.slt));
}

export interface PlanOptions {
  maxMoveDistance?: number;
  /** U-52: "Lock actual quantities" do 13031 (`MoveManager::SetActualsLockedInLP`), gravado no mesmo nível [O] */
  lockActualQuantities?: boolean;
  /** consultado entre as zonas e a cada iteração do simplex; false cancela */
  isRunning?: () => boolean;
}

export interface PlanZoneResult {
  zone: bigint;
  hauls: number;
  /** valor da função objetivo do LP da zona (custo + penalidades) */
  objective: number;
  /** penalidade unitária da zona (5·max + 1, na unidade de aterro) */
  penalty: number;
}

export interface PlanResult {
  canceled: boolean;
  zones: PlanZoneResult[];
  moves: UniqueHaul[];
  removed: number;
}

/** PlanLom::Solve @0xa04ed0 (RF-026). Aplica o resultado num nível de undo "Haul calculation". */
export async function planOptimize(p: Project, opts: PlanOptions = {}): Promise<PlanResult> {
  const isRunning = opts.isRunning ?? (() => true);
  const maxMoveDistance = opts.maxMoveDistance ?? MAX_MOVE_DISTANCE_INIT;
  const mm = p.resolve(p.root()!.get("m_pMoveManager") as Ref)!;
  const locked = opts.lockActualQuantities ?? mm.get("m_bActualsLockedInLP") === true;
  const lpMoves = refs(mm.get("m_vpLPMoves")).map((o) => p.get(o)!);
  const kept = lpMoves.filter((m) => m.get("m_bManual") === true);
  const dc = new DistanceCalculatorManager(p).plan();
  const tracker = new AmountTracker(p);
  for (const m of kept) if (m.get("m_bActual") !== true) tracker.subtractMove(m);
  if (locked) tracker.subtractActuals(new ActualsContext(p));
  tracker.removeNegatives();
  let chains = planCandidates(p, locked);
  const zones: PlanZoneResult[] = [];
  const moves: UniqueHaul[] = [];
  let canceled = false;
  for (const zone of massEconomyAreasPostOrder(p)) {
    if (!isRunning()) {
      canceled = true;
      break;
    }
    const inZone = (e?: Entity) => !e || isChild(p, e, zone);
    const mine = chains.filter((ch) => inZone(ch.source) && inZone(ch.destination) && inZone(ch.crush));
    chains = chains.filter((ch) => !mine.includes(ch));
    const hauls = makeHaulInfos(p, mine, dc, tracker, maxMoveDistance);
    if (hauls.length === 0) continue;
    const { build, cost } = buildModel(p, hauls, tracker);
    // BuildModel só passa ao solver os limites das colunas de transporte; as folgas ficam em [0, ∞) [O]
    const colUpper = build.columnUppers.map((u, j) => (j >= build.superHaulBeginCol && j < build.superHaulEndCol ? COIN_DBL_MAX : u));
    const out = await solveLp({ colCost: cost, colLower: build.columnLowers, colUpper, rows: build.rows }, isRunning);
    if (out.status === "canceled") {
      canceled = true;
      break;
    }
    zones.push({ zone: zone.oid, hauls: hauls.length, objective: out.objective, penalty: penaltyOf(cost, build) });
    moves.push(...makeUniqueHauls(p, dc, hauls, out.x, tracker));
    if (tracker.removeNegatives()) throw new PlanError("NEGATIVE_AMOUNT", "negative free amount after export");
  }
  const toRemove = lpMoves.filter((m) => m.get("m_bManual") !== true);
  // U-61f (AL-MOT-70): a transação do 13031 é ("Haul Calculation" = título da janela, alvo = projeto) → nível
  // "<projeto>: haul calculation", ou "Haul Calculation" sem nome de projeto (`ChangeInfo::MakeUndoText@0x4ae3e0`) [O]
  p.edit(projectUndoText(p, HAUL_CALCULATION_ACTION), () => {
    if ((mm.get("m_bActualsLockedInLP") === true) !== locked) mm.set("m_bActualsLockedInLP", locked);
    for (const m of toRemove) removeLPMove(p, mm, m);
    if (locked) createLPMovesFromImplMoves(p, mm);
    if (!canceled) for (const u of moves) addLPMove(p, mm, u);
  });
  return { canceled, zones, moves: canceled ? [] : moves, removed: toRemove.length };
}

function penaltyOf(cost: number[], b: LomBuild): number {
  return b.superHaulEndCol > b.superHaulBeginCol ? cost[b.superHaulBeginCol]! : 0;
}

const setList = (e: Entity, member: string, items: bigint[]) => e.setRaw(member, encodeContainer(0x18, items));

/** MoveManager::RemoveLPMove: o LPMove e o caminho (com os nós). */
export function removeLPMove(p: Project, mm: Entity, m: Entity): void {
  setList(mm, "m_vpLPMoves", refs(mm.get("m_vpLPMoves")).filter((o) => o !== m.oid));
  const path = p.resolve(m.get("m_pPath") as Ref);
  if (path) {
    for (const o of refs(path.get("m_vpNodes"))) {
      const n = p.get(o);
      if (n) p.remove(n);
    }
    p.remove(path);
  }
  p.remove(m);
}

/** MoveManager::AddLPMove @0x94e090 + LPMove::LPMove @0x952cc0 + Path(Path) @0x99b180. */
/**
 * MoveManagerHelpers::CreateLPMovesFromImplMoves @0x94e420: um LPMove realizado (manual = false, actual = true) por
 * ImplUtilization, com origem, destino, material, caminho e quantidade do transporte apontado.
 */
export function createLPMovesFromImplMoves(p: Project, mm: Entity): void {
  for (const o of refs(mm.get("m_utilizations"))) {
    const u = p.get(o);
    const src = p.resolve(u?.get("m_pSrcWorkPlace") as Ref), dst = p.resolve(u?.get("m_pDstWorkPlace") as Ref);
    const slt = p.resolve(u?.get("m_pSourceLandType") as Ref);
    if (!u || !src || !dst || !slt) continue;
    const stored = p.resolve(u.get("m_pPath") as Ref);
    const nodes = refs(stored?.get("m_vpNodes")).map((n) => p.get(n)).filter((n): n is Entity => !!n)
      .map((n): LightNode => {
        const rc = n.get("m_pRoadConnection"), wp = n.get("m_pWorkPlace");
        return typeof rc === "bigint" && rc ? { roadConnection: rc, from: n.get("m_bRoadConnectionFrom") === true } : typeof wp === "bigint" ? { workPlace: wp } : {};
      });
    const path: LightPath = { length: num(stored?.get("m_dLength")), nodes };
    addLPMove(p, mm, { source: src, destination: dst, slt, amount: 0, path }, false, num(u.get("m_dAmount")));
  }
}

/** LPMove novo; `actualAmount` (na unidade do material) marca o LPMove como realizado. */
export function addLPMove(p: Project, mm: Entity, u: UniqueHaul, manual = false, actualAmount?: number): void {
  const m = p.create("LPMove");
  m.set("m_strName", "");
  m.set("m_strLongName", "");
  m.set("m_pUIInfo", null);
  m.set("m_pSrcWorkPlace", u.source.oid);
  m.set("m_pDstWorkPlace", u.destination.oid);
  m.set("m_pSourceLandType", u.slt.oid);
  const path = p.create("Path");
  m.set("m_pPath", path.oid);
  m.set("m_bManual", manual);
  m.set("m_bActual", actualAmount !== undefined);
  m.set("m_dAmount", actualAmount ?? convertAmount(u.slt, u.amount, siteUnit(p, siteOf(p, u.source), true), unitOfType(u.slt)));
  path.set("m_strName", "");
  path.set("m_strLongName", "");
  path.set("m_pUIInfo", null);
  path.setRaw("m_vpPlaces_OLD", encodeContainer(0x18, []));
  path.set("m_dLength", u.path.length);
  const nodes = u.path.nodes.map((n) => {
    const e = p.create("Node");
    e.set("m_strName", "");
    e.set("m_strLongName", "");
    e.set("m_pUIInfo", null);
    e.set("m_pRoadConnection", n.roadConnection ?? null);
    e.set("m_bRoadConnectionFrom", n.from ?? false);
    e.set("m_pWorkPlace", n.workPlace ?? null);
    return e.oid;
  });
  setList(path, "m_vpNodes", nodes);
  setList(mm, "m_vpLPMoves", [...refs(mm.get("m_vpLPMoves")), m.oid]);
}
