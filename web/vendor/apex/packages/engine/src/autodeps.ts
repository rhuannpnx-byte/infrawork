/**
 * Dependências automáticas por tipo (RN-030; D-020/U-07b). Evidência: analises/2026-10-11_dynaroad/evidencias/
 * decompilado/distancias_tempo_extra/ DependencyManager::UpdateAutoDependencies @0x9a5000, AddTypeDependencies
 * @0x9a3380; u07b/ WorkSiteHelpers::Intersect @0x92a3d0; u07b_dep/ IsSupposedToBeThere @0x9a4600,
 * anon::GetDelayDaysBetween @0x9a39a0, WorkSiteType::GetDelayDaysBetween @0x993cd0, WorkPlace::Intersects @0x9363f0,
 * RemoveTypeDependencies @0x9a4b40, ForceRemoveDependencies @0x9a3830, AddDependency @0x9a3260.
 *
 * - [O] tarefa não estrita: remove todas as suas dependências. Estrita: remove as não geradas pelo usuário em que ela
 *   é predecessora ou sucessora e, para cada outra tarefa estrita cujos work places se cruzam, cria no máximo uma:
 *   outra → ela se algum tipo da outra é seguido por um tipo dela e ela deriva predecessores dos tipos; senão
 *   ela → outra se o inverso vale e a outra deriva. Tipo BY_STATIONS; FINISH_START se a road line da tarefa é Area.
 *   Atraso = maior GetDelayDaysBetween entre os pares de tipos encadeados; mínimo = máximo = atraso, só o mínimo vale,
 *   dias corridos, não gerada pelo usuário (como as dependências salvas dos exemplos).
 * - [O] WorkPlace::Intersects: mesma área (Area) e Location::Intersect.
 * - [I] IsSucceededBy(a, b) = a tem TypeDependency com predecessor a e sucessor b; GetDelayDaysBetween(a, b) = +atraso
 *   dessa TypeDependency, −atraso se for b → a (os exemplos só têm atraso 0); tipos da tarefa = origem, destino e
 *   trabalho não nulos; Location::Intersect = mesma road line e faixas de estaca com sobreposição de comprimento > 0 (tocar
 *   na borda não conta: o example_area_construction não tem dependência automática entre 0–350 e 350–640).
 */
import { encodeContainer, type Entity, type Project, type Ref } from "@apex/model";
import { DEP, STRICT_CLASSES } from "./timing.js";
import { deferTiming } from "./postpone.js";

const WS_CLASSES = ["LandCut", "Embankment", "MassExchange", "BorrowPit", "WasteLand", "StockPile", "CrushingPlant", "OtherWorkSite"];
const CONTAINER_ORDER = ["m_vpLandCuts", "m_vpEmbankments", "m_vpMassExchanges", "m_vpBorrowPits", "m_vpWasteLands", "m_vpStockPiles", "m_vpCrushingPlants", "m_vpOtherWorkSites"];
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);

export interface PlannedDependency {
  pred: bigint;
  succ: bigint;
  type: number;
  delay: number;
}

/** WorkSiteContainer::GetWorkSitesBegin(-1): corte, aterro, substituição, jazida, bota-fora, pilha, britagem, outras. */
export function workSitesInOrder(p: Project): Entity[] {
  const c = p.resolve(p.root()!.get("m_pWSContainer") as Ref);
  const out: Entity[] = [];
  const seen = new Set<bigint>();
  const add = (e: Entity | undefined) => {
    if (e && !seen.has(e.oid)) {
      seen.add(e.oid);
      out.push(e);
    }
  };
  if (c) for (const k of CONTAINER_ORDER) for (const o of refs(c.get(k))) add(p.get(o));
  for (const cls of WS_CLASSES) for (const e of p.byClass(cls)) add(e);
  return out;
}

function typesOf(e: Entity): bigint[] {
  return ["m_pSourceLandType", "m_pDestLandType", "m_pWorkType"].map((k) => e.get(k)).filter((x): x is bigint => typeof x === "bigint");
}
function typeDeps(p: Project, t: bigint): Entity[] {
  return refs(p.get(t)?.get("m_vpDependencies")).map((o) => p.get(o)).filter((x): x is Entity => !!x);
}
function isSucceededBy(p: Project, a: bigint, b: bigint): boolean {
  return typeDeps(p, a).some((d) => d.get("m_pPredecessor") === a && d.get("m_pSuccessor") === b);
}
function delayDaysBetween(p: Project, a: bigint, b: bigint): number {
  if (a === b) return 0;
  for (const d of typeDeps(p, a)) {
    if (d.get("m_pPredecessor") === a && d.get("m_pSuccessor") === b) return num(d.get("m_nDelayDays"));
    if (d.get("m_pPredecessor") === b && d.get("m_pSuccessor") === a) return -num(d.get("m_nDelayDays"));
  }
  return 0;
}
function isSupposedToBeThere(p: Project, a: bigint[], b: bigint[]): boolean {
  return a.some((x) => b.some((y) => isSucceededBy(p, x, y)));
}
function delayBetween(p: Project, a: bigint[], b: bigint[]): number {
  let best = -0x80000000;
  for (const x of a) for (const y of b) if (isSucceededBy(p, x, y)) best = Math.max(best, delayDaysBetween(p, x, y));
  return best;
}

interface Loc {
  roadLine: unknown;
  b: number;
  e: number;
}
function locations(p: Project, e: Entity): Loc[] {
  return refs(e.get("m_vpWorkPlaces"))
    .map((o) => p.resolve(p.get(o)?.get("m_pLocation") as Ref))
    .filter((x): x is Entity => !!x)
    .map((l) => ({ roadLine: l.get("m_pRoadLine"), b: num(l.get("m_dStationBegin")), e: num(l.get("m_dStationEnd")) }));
}
/** WorkSiteHelpers::Intersect @0x92a3d0: algum par de work places se cruza. */
export function intersect(p: Project, a: Entity, b: Entity): boolean {
  const la = locations(p, a), lb = locations(p, b);
  return la.some((x) => lb.some((y) => x.roadLine === y.roadLine && Math.min(x.b, x.e) < Math.max(y.b, y.e) && Math.min(y.b, y.e) < Math.max(x.b, x.e)));
}
function onArea(p: Project, e: Entity): boolean {
  const l = locations(p, e)[0];
  return typeof l?.roadLine === "bigint" && p.get(l.roadLine)?.className === "Area";
}

/**
 * Estado final de UpdateAutoDependencies aplicado a cada tarefa na ordem do WorkSiteContainer: as dependências do
 * usuário ficam; as automáticas são as que este plano devolve.
 */
export function planAutoDependencies(p: Project): PlannedDependency[] {
  // InfraWork (vendor): mesmo resultado do original com dois atalhos de desempenho — locais, tipos e o flag de derivação
  // de cada tarefa lidos uma vez por passada, e a relação entre os tipos (barata) testada antes da interseção dos locais
  // (cara). A interseção só decide quando alguma das duas relações vale, então a ordem dos testes não muda nada.
  const auto = new Map<string, PlannedDependency>();
  const sites = workSitesInOrder(p);
  const strict = sites.filter((e) => STRICT_CLASSES.has(e.className));
  const locs = new Map<bigint, Loc[]>(), types = new Map<bigint, bigint[]>(), derive = new Map<bigint, boolean>();
  for (const e of strict) {
    locs.set(e.oid, locations(p, e));
    types.set(e.oid, typesOf(e));
    derive.set(e.oid, e.get("m_bDerivePredecessorsFromTypes") === true);
  }
  const succeeded = new Map<string, boolean>();
  const supposed = (a: bigint[], b: bigint[]) =>
    a.some((x) => b.some((y) => {
      const k = `${x}>${y}`;
      let v = succeeded.get(k);
      if (v === undefined) succeeded.set(k, (v = isSucceededBy(p, x, y)));
      return v;
    }));
  const crosses = (la: Loc[], lb: Loc[]) => la.some((x) => lb.some((y) => x.roadLine === y.roadLine && Math.min(x.b, x.e) < Math.max(y.b, y.e) && Math.min(y.b, y.e) < Math.max(x.b, x.e)));
  for (const s of sites) {
    for (const [k, d] of [...auto]) if (d.pred === s.oid || d.succ === s.oid) auto.delete(k);
    if (!STRICT_CLASSES.has(s.className)) continue;
    const mine = types.get(s.oid)!;
    const type = onArea(p, s) ? DEP.FINISH_START : DEP.BY_STATIONS;
    for (const o of strict) {
      if (o === s) continue;
      const theirs = types.get(o.oid)!;
      const asSucc = supposed(theirs, mine) && derive.get(s.oid) === true;
      const asPred = !asSucc && supposed(mine, theirs) && derive.get(o.oid) === true;
      if (!asSucc && !asPred) continue;
      if (!crosses(locs.get(s.oid)!, locs.get(o.oid)!)) continue;
      if (asSucc) auto.set(`${o.oid}>${s.oid}`, { pred: o.oid, succ: s.oid, type, delay: delayBetween(p, theirs, mine) });
      else auto.set(`${s.oid}>${o.oid}`, { pred: s.oid, succ: o.oid, type, delay: delayBetween(p, mine, theirs) });
    }
  }
  return [...auto.values()];
}

const keyOf = (pred: unknown, succ: unknown, type: unknown, delay: unknown) => `${pred}>${succ}:${type}:${delay}`;

/**
 * Aplica o plano num nível de undo "Update automatic dependencies": remove as automáticas que saíram (com o UIInfo e o
 * UILayOut próprios [I]) e cria as que faltam, registrando-as no DependencyManager e nas duas tarefas (fim da lista
 * [I]). [I] UIInfo/UILayOut das novas: cópia dos de uma dependência existente (a fonte vem do sucessor no original,
 * AddDependency @0x9a3260); sem dependência no projeto, ficam sem eles. Devolve quantas removeu e criou.
 */
export function applyAutoDependencies(p: Project): { removed: number; created: number } {
  if (deferTiming(p, "autodeps")) return { removed: 0, created: 0 }; // InfraWork: adiador de montagem em lote (postpone.ts)
  const plan = planAutoDependencies(p);
  const wanted = new Map(plan.map((d) => [keyOf(d.pred, d.succ, d.type, d.delay), d]));
  const current = p.byClass("Dependency").filter((d) => d.get("m_bUserGenerated") !== true);
  const stale = current.filter((d) => !wanted.delete(keyOf(d.get("m_pPredecessor"), d.get("m_pSuccessor"), d.get("m_nType"), d.get("m_nDelayMin"))));
  if (stale.length === 0 && wanted.size === 0) return { removed: 0, created: 0 };
  // modelo copiado antes das remoções: pode ser uma das dependências que saem
  const template = p.byClass("Dependency").find((d) => !stale.includes(d)) ?? p.byClass("Dependency")[0];
  const snapshot = (oid: unknown) => {
    const src = typeof oid === "bigint" ? p.get(oid) : undefined;
    return src ? { classId: src.classId, fields: src.fields.map((f) => ({ ...f })) } : undefined;
  };
  const uiInfo = snapshot(template?.get("m_pUIInfo")), uiLayOut = snapshot(template?.get("m_pUILayOut"));
  const clone = (snap: ReturnType<typeof snapshot>) => (snap ? p.create(snap.classId, snap.fields.map((f) => ({ ...f }))).oid : undefined);
  const listOf = (e: Entity, member: string) => refs(e.get(member));
  const setList = (e: Entity, member: string, items: bigint[]) => e.setRaw(member, encodeContainer(0x18, items));
  p.edit("Update automatic dependencies", () => {
    for (const d of stale) {
      for (const k of ["m_pPredecessor", "m_pSuccessor"]) {
        const ws = p.get(d.get(k) as bigint);
        if (ws) setList(ws, "m_vpDependencies", listOf(ws, "m_vpDependencies").filter((o) => o !== d.oid));
        const mgr = ws && p.get(ws.get("m_pDependencyManager") as bigint);
        if (mgr) setList(mgr, "m_vDependencies", listOf(mgr, "m_vDependencies").filter((o) => o !== d.oid));
      }
      for (const k of ["m_pUIInfo", "m_pUILayOut"]) {
        const o = d.get(k);
        if (typeof o === "bigint" && p.get(o)) p.remove(p.get(o)!);
      }
      p.remove(d);
    }
    for (const w of wanted.values()) {
      const d = p.create("Dependency");
      d.set("m_strName", "");
      d.set("m_strLongName", "");
      const ui = clone(uiInfo);
      if (ui !== undefined) d.set("m_pUIInfo", ui);
      d.set("m_bUserGenerated", false);
      d.set("m_pPredecessor", w.pred);
      d.set("m_pSuccessor", w.succ);
      d.set("m_nDelayMin", w.delay);
      d.set("m_nDelayMax", w.delay);
      d.set("m_nType", w.type);
      const lay = clone(uiLayOut);
      if (lay !== undefined) d.set("m_pUILayOut", lay);
      d.set("m_bIsDelayWorkDays", false);
      d.set("m_bHasMinDelay", true);
      d.set("m_bHasMaxDelay", false);
      const succ = p.get(w.succ)!;
      const mgr = p.get(succ.get("m_pDependencyManager") as bigint);
      if (mgr) setList(mgr, "m_vDependencies", [...listOf(mgr, "m_vDependencies"), d.oid]);
      for (const o of [w.pred, w.succ]) {
        const ws = p.get(o)!;
        setList(ws, "m_vpDependencies", [...listOf(ws, "m_vpDependencies"), d.oid]);
      }
    }
  });
  return { removed: stale.length, created: plan.length - (current.length - stale.length) };
}
