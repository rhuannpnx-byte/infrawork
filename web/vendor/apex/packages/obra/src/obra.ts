/**
 * U-24 (D-024) — dados da obra `apex-obra/1`: tipos, auxiliares comuns e `exportObra` (projeto → documento). A
 * montagem (`buildObra`) está em `obra-build.ts` e a prontidão (`checkReadiness`) em `obra-check.ts`. Sem DOM.
 *
 * Evidência do domínio: `analises/2026-10-11_dynaroad/handoff/docs/montagem_obra.md` (§4 ordem de criação, §5 padrões
 * implícitos, §6 o que não tem padrão) e `criacao_objetos.md`. O esquema e as regras do formato estão em
 * `@apex/mcp` (`obra-format.ts`), o mesmo objeto que valida a entrada.
 *
 * Campos "de cálculo" = os membros que o motor (`packages/engine`) lê: datas e modo do projeto, unidades e
 * conversões, custos por distância, adequação, tipos refinados e preços de beneficiamento, distância máxima, tipos de
 * dependência entre tipos, calendários, recursos (preço/hora, limites por sum task), transportadores (capacidade,
 * taxas por distância, rotas proibidas), equipes (recursos, taxas, base de custo, transportador), road lines
 * (estacas, direcionalidade), áreas, interseções (pontas, comprimento, sentido, janela), usage breaks, sum tasks
 * (zona, transportes externos), tarefas (tipo, locais e quantidades, datas dos work places, equipes, coeficiente,
 * prioridade, ASAP, sentido, início do dia, restrições, pilha local, preços unitários, must use/fill, contrato,
 * concluída), dependências do usuário e marcos. Fora do documento (vão em `notes`): transportes calculados (são
 * resultado), transportes manuais e impedidos, realizados (Control), recursos identificados, geometria do mapa.
 */
import { MAX_DATE, MIN_DATE } from "@apex/calendar";
import type { Entity, Project } from "@apex/model";
import { OBRA_FORMAT } from "@apex/mcp";
import {
  allTasks, calendarsOf, calendarSpec, defaultCalendar, mainRoadLine, massUnits, projectRoot, rootSumTask, TASK_KINDS, workPlacesOf,
  type TaskClass, type TaskKind,
} from "./create.js";
import { asRef, num, pairs, refs, str } from "./values.js";

// =====================================================================================================================
// Documento
// =====================================================================================================================

/** Valores como chegam do JSON (validados pelo esquema de `@apex/mcp`). */
export type O = Record<string, unknown>;

export interface ObraDoc {
  format: typeof OBRA_FORMAT;
  base?: "current" | "empty";
  remove?: O[];
  notes?: string[];
  project?: O;
  units?: { cut?: O; fill?: O; crush?: O; haul?: O; other?: O[] };
  haul_costs?: O[];
  source_types?: O[];
  destination_types?: O[];
  task_types?: O[];
  type_dependencies?: O[];
  calendars?: O[];
  resources?: O[];
  haul_resources?: O[];
  crews?: O[];
  road_lines?: O[];
  areas?: O[];
  intersections?: O[];
  usage_breaks?: O[];
  sum_tasks?: O[];
  tasks?: O[];
  dependencies?: O[];
  milestones?: O[];
  view_filters?: O[];
}

// =====================================================================================================================
// Vocabulário comum (export e montagem)
// =====================================================================================================================

export const MODE_NAMES = ["plan", "schedule", "control"] as const;
/** `SourceLandType::SuitabilityType` 0…2 e `DestLandType::SuitabilityType` 0…4 (criacao_objetos.md §1.4) [O]. */
export const SOURCE_SUIT = ["cut", "soil_replacement", "borrow_pit"] as const;
export const DEST_SUIT = ["fill", "soil_replacement", "disposal_area", "stockpile", "crushing_plant"] as const;
/** Classe → tipo de tarefa do formato. */
export const KIND_OF_CLASS = Object.fromEntries(Object.entries(TASK_KINDS).map(([k, c]) => [c, k])) as Record<TaskClass, TaskKind>;
/** Base de custo da equipe: bit 1 = recursos (preço/hora), bit 2 = quantidades (custo unitário) (`pricePerHour`/`pricePerUnit`, engine/schedule.ts) [O]. */
export const PRICE_CALC = { none: 0, resources: 1, quantities: 2, both: 3 } as const;
/** Usos de equipe (SubWorkGroupUsage) [O]. */
export const USAGE_NAMES: Record<number, "send" | "receive" | "other"> = { 1: "send", 2: "receive", 8: "other" };
export const USAGE_BY_NAME = { send: 1, receive: 2, other: 8 } as const;
/** Padrões de construtor das tarefas (criacao_objetos.md §3.3) [O]. */
export const LOCAL_STOCKPILE_DEFAULT: Partial<Record<string, { on: boolean; days: number }>> = {
  LandCut: { on: false, days: 5 }, Embankment: { on: false, days: 5 }, CrushingPlant: { on: true, days: 0 },
};
/** Classes cuja quantidade principal é a de origem / de destino (RN-011) [O]. */
export const SOURCE_AMOUNT = new Set(["LandCut", "MassExchange", "BorrowPit"]);
export const DEST_AMOUNT = new Set(["Embankment", "MassExchange", "WasteLand", "StockPile", "CrushingPlant"]);

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
/** DDL::Date → "AAAA-MM-DD" (meia-noite), "AAAA-MM-DD hh:mm" ou "AAAA-MM-DD hh:mm:ss" (sem fuso, RD-022). */
export function fmtDate(v: bigint | number): string {
  const s = typeof v === "bigint" ? Number(v) : v;
  const d = new Date(s * 1000);
  const day = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const sec = ((s % 86400) + 86400) % 86400;
  if (sec === 0) return day;
  const hm = `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return sec % 60 === 0 ? hm : `${hm}:${pad(d.getUTCSeconds())}`;
}

/** Sempre com a hora ("AAAA-MM-DD hh:mm[:ss]"): o instante exato, mesmo à meia-noite. */
export function fmtDateTime(v: bigint | number): string {
  const t = fmtDate(v);
  return t.length === 10 ? `${t} 00:00` : t;
}

/** Os três tipos do projeto, com o prefixo usado quando o nome se repete entre espécies. */
export const TYPE_KINDS = [
  { prefix: "source", list: "m_vpSourceLandTypes", cls: "SourceLandType" },
  { prefix: "destination", list: "m_vpDestLandTypes", cls: "DestLandType" },
  { prefix: "task", list: "m_vpWorkTypes", cls: "WorkType" },
] as const;

export const listOf = (p: Project, member: string): Entity[] => refs(projectRoot(p).get(member)).map((o) => p.get(o)).filter((e): e is Entity => !!e);
export const allTypes = (p: Project): Entity[] => TYPE_KINDS.flatMap((k) => listOf(p, k.list));

/** Nome de referência de um tipo: o nome; com prefixo "source:/destination:/task:" se outro tipo tem o mesmo nome. */
export function typeRef(p: Project, t: Entity): string {
  const same = allTypes(p).filter((x) => x.name === t.name);
  if (same.length <= 1) return t.name;
  return `${TYPE_KINDS.find((k) => k.cls === t.className)!.prefix}:${t.name}`;
}

// =====================================================================================================================
// Exportação
// =====================================================================================================================

const nameOf = (p: Project, v: unknown): string | null => p.resolve(asRef(v as bigint | null))?.name ?? null;
const dbl = (v: unknown, d = 0) => num(v as number) ?? d;
const date = (v: unknown): bigint | undefined => (typeof v === "bigint" ? v : undefined);
/** Acrescenta a chave só quando o valor difere do padrão (o documento fica curto; a montagem aplica o padrão). */
function put(o: O, k: string, v: unknown, def?: unknown): void {
  if (v === undefined || v === def) return;
  o[k] = v;
}
const nameDesc = (e: Entity): O => {
  const o: O = { name: e.name };
  put(o, "description", str(e.get("m_strLongName")), "");
  return o;
};

/** Semana do calendário → [{start "hh:mm", hours}] (WeekDayGenerator) [O formato]. */
function weekJson(days: readonly { begin: number; length: number }[]): O[] {
  return days.map((d) => ({ start: `${pad(Math.floor(d.begin / 3600))}:${pad(Math.floor((d.begin % 3600) / 60))}`, hours: d.length / 3600 }));
}

function exportCalendar(c: Entity, notes: string[]): O {
  const o = nameDesc(c);
  const spec = calendarSpec(c);
  if (!spec) {
    notes.push(`calendar "${c.name}": rules not readable, exported without them`);
    return o;
  }
  o.week = weekJson(spec.week.days);
  if (spec.week.flag !== 1) notes.push(`calendar "${c.name}": week flag ${spec.week.flag} not exported (1 is used)`);
  const holidays: O[] = [], easter: string[] = [], weekday: O[] = [];
  for (const g of spec.generators) {
    if (g.type === "StaticHoliday") {
      // dia inteiro: fim às 23:59:59 → só a data do último dia (create_calendar usa a mesma convenção); senão o instante
      const to = (g.end + 1n) % 86400n === 0n ? fmtDate(g.end - 86399n) : fmtDateTime(g.end);
      holidays.push({ name: g.name, from: fmtDate(g.begin), to, yearly: g.yearly !== 0 });
    } else if (g.type === "Easter") easter.push(g.name);
    else weekday.push({ name: g.name, date: fmtDate(g.date), weekday: g.weekday });
  }
  if (holidays.length) o.holidays = holidays;
  if (easter.length) o.easter = easter;
  if (weekday.length) o.weekday_holidays = weekday;
  if (spec.spans.length) o.exceptions = spec.spans.map((s) => ({ name: s.name, from: fmtDate(s.first), to: fmtDate(s.last), week: weekJson(s.week.days) }));
  return o;
}

/** Janela STATIC de interseção/usage break; PERMANENT → nada; ligada a tarefa → nota [O tipos, HasVariantTiming]. */
function windowJson(p: Project, e: Entity, notes: string[], what: string): { from?: string; to?: string } {
  const out: { from?: string; to?: string } = {};
  for (const [tt, dm, wm, k] of [["m_beginTimingType", "m_beginDate", "m_pBeginWorkSite", "from"], ["m_endTimingType", "m_endDate", "m_pEndWorkSite", "to"]] as const) {
    const t = num(e.get(tt)) ?? 0;
    const d = date(e.get(dm));
    if (t === 1 && d !== undefined && d !== BigInt(MIN_DATE) && d !== BigInt(MAX_DATE)) out[k] = fmtDate(d);
    if (t === 2) notes.push(`${what} "${e.name}": ${k === "from" ? "start" : "end"} linked to task "${nameOf(p, e.get(wm)) ?? "?"}" not exported (fixed date used)`);
    if (t === 2 && d !== undefined) out[k] = fmtDate(d);
  }
  return out;
}

function exportTask(p: Project, t: Entity, root: Entity): O {
  const cls = t.className as TaskClass;
  const o: O = { kind: KIND_OF_CLASS[cls], ...nameDesc(t) };
  const src = p.resolve(asRef(t.get("m_pSourceLandType"))), dst = p.resolve(asRef(t.get("m_pDestLandType"))), wt = p.resolve(asRef(t.get("m_pWorkType")));
  if (cls === "MassExchange") {
    put(o, "type", src ? typeRef(p, src) : undefined);
    put(o, "destination_type", dst ? typeRef(p, dst) : undefined);
  } else {
    const ty = wt ?? src ?? dst;
    put(o, "type", ty ? typeRef(p, ty) : undefined);
  }
  const st = p.resolve(asRef(t.get("m_pSumTaskParent")));
  if (st && st.oid !== root.oid) o.sum_task = st.name;
  if (t.get("m_bUseDefaultCalendar") === false) put(o, "calendar", nameOf(p, t.get("m_pCalendar")) ?? undefined);
  o.work_places = workPlacesOf(p, t).map((w) => {
    const loc = p.resolve(asRef(w.get("m_pLocation")));
    const wo: O = {
      location: nameOf(p, loc?.get("m_pRoadLine")),
      station_begin: dbl(loc?.get("m_dStationBegin")), station_center: dbl(loc?.get("m_dStationCOG")), station_end: dbl(loc?.get("m_dStationEnd")),
    };
    put(wo, "distance", dbl(loc?.get("m_dDistance")), 0);
    if (cls === "OtherWorkSite") wo.quantity = dbl(w.get("m_dAmount"));
    else {
      const s = dbl(w.get("m_dSourceAmount")), d = dbl(w.get("m_dDestinationAmount"));
      if (cls === "MassExchange") Object.assign(wo, { source_quantity: s, destination_quantity: d });
      else {
        wo.quantity = SOURCE_AMOUNT.has(cls) ? s : d;
        // a outra quantidade não é lida para a classe, mas vai junto se não for zero (volta exata)
        if (SOURCE_AMOUNT.has(cls) && d !== 0) wo.destination_quantity = d;
        if (DEST_AMOUNT.has(cls) && s !== 0) wo.source_quantity = s;
      }
    }
    const b = date(w.get("pDVar2")), e = date(w.get("m_endTime"));
    if (b !== undefined) wo.start = fmtDate(b);
    if (e !== undefined) wo.finish = fmtDate(e);
    return wo;
  });
  const crews: O = {};
  for (const [u, g] of pairs(t.get("m_cSelectedSubWorkGroups"))) {
    const usage = USAGE_NAMES[num(u) ?? 0];
    if (!usage) continue;
    const ge = p.resolve(asRef(g));
    crews[usage] = !ge || ge.className === "NullWorkGroup" ? null : ge.name;
  }
  if (Object.keys(crews).length) o.crews = crews;
  put(o, "rate_coefficient", dbl(t.get("m_dWachCoeff"), 1), 1);
  put(o, "priority", num(t.get("m_nSchedulingPriority")) ?? 500, 500);
  put(o, "asap", t.get("m_bASAP") === true, false);
  put(o, "start_side", t.get("m_bLow") === false ? "high" : "low", "low");
  put(o, "start_at_beginning_of_day", num(t.get("m_nStartTimeType")) === 1, false);
  const fb = num(t.get("m_forcedBeginConstraint")) ?? 0, fe = num(t.get("m_forcedEndConstraint")) ?? 0;
  if (fb) o.start_constraint = { type: fb === 2 ? "exact" : "earliest", date: fmtDate(date(t.get("m_forcedBeginDate")) ?? 0n) };
  if (fe) o.finish_constraint = { type: fe === 2 ? "exact" : "latest", date: fmtDate(date(t.get("m_forcedEndDate")) ?? 0n) };
  put(o, "derive_predecessors_from_types", t.get("m_bDerivePredecessorsFromTypes") !== false, true);
  const ls = LOCAL_STOCKPILE_DEFAULT[cls];
  if (ls) {
    put(o, "local_stockpile", t.get("m_bLocalStockPile") === true, ls.on);
    put(o, "local_stockpile_extra_days", num(t.get("m_nLocalStockPileExtraDays")) ?? ls.days, ls.days);
  }
  if (cls === "BorrowPit") {
    put(o, "must_use", t.get("m_bMustUse") === true, false);
    put(o, "delivery_contract", t.get("m_bDeliveryContract") === true, false);
  }
  if (cls === "WasteLand") put(o, "must_fill", t.get("m_bMustFill") === true, false);
  if (cls !== "OtherWorkSite") {
    put(o, "source_unit_price", dbl(t.get("m_dSourceUnitPrice")), 0);
    put(o, "destination_unit_price", dbl(t.get("m_dDestinationUnitPrice")), 0);
  }
  put(o, "auto_name", t.get("m_bAutoName") === true, false);
  put(o, "comment", str(t.get("m_strComment")), "");
  if (t.get("m_bFinished") === true) o.fields = { m_bFinished: true };
  return o;
}

/**
 * Projeto aberto → documento `apex-obra/1` (base "empty"): montado sobre qualquer projeto, reproduz os campos de
 * cálculo. Listas na ordem dos contêineres do projeto; tarefas na ordem de criação (OID), que é a ordem em que o
 * motor as percorre; padrões de construtor omitidos (a montagem os aplica).
 */
export function exportObra(p: Project): ObraDoc {
  const root = projectRoot(p);
  const notes: string[] = [];
  const mu = massUnits(p);
  const rootSt = rootSumTask(p);
  const main = mainRoadLine(p);
  const unitName = (v: unknown) => nameOf(p, v) ?? undefined;

  // ---------- projeto ----------
  const project: O = {};
  project.name = root.name;
  put(project, "description", str(root.get("m_strLongName")), "");
  put(project, "client", str(root.get("m_strOrderer")), "");
  put(project, "planner", str(root.get("m_strCreator")), "");
  project.start_date = fmtDate(date(root.get("m_dateBegin")) ?? 0n);
  project.deadline = fmtDate(date(root.get("m_dateDeadline")) ?? 0n);
  project.mode = MODE_NAMES[num(root.get("m_nMode")) ?? 0] ?? "plan";
  put(project, "currency", str(root.get("m_strCurrencySign")));
  put(project, "length_unit", str(root.get("m_strLengthUnit")));
  const impl = p.resolve(asRef(root.get("m_pImplManager")));
  const ctrl = date(impl?.get("m_dateControl"));
  if (ctrl !== undefined) project.control_date = fmtDate(ctrl);
  const defCal = defaultCalendar(p);
  if (defCal) project.default_calendar = defCal.name;
  const mrl: O = { ...nameDesc(main), station_begin: num(main.get("m_nStationBegin")) ?? 0, station_end: num(main.get("m_nStationEnd")) ?? 0 };
  put(mrl, "width", dbl(main.get("m_dWidth")), 0);
  if ((num(main.get("m_nDirectionality")) ?? 0) !== 0) mrl.fields = { m_nDirectionality: num(main.get("m_nDirectionality")) };
  project.main_road_line = mrl;
  const rst: O = nameDesc(rootSt);
  put(rst, "construction_zone", rootSt.get("m_bMassEconomyArea") === true, true);
  put(rst, "prevent_external_hauls", rootSt.get("m_bPreventExternalHauls") === true, false);
  put(rst, "lock_internal_timing", rootSt.get("m_bLockInternalTiming") === true, false);
  put(rst, "comment", str(rootSt.get("m_strComment")), "");
  project.root_sum_task = rst;

  // ---------- unidades, custos, tipos ----------
  const massOids = new Set(Object.values(mu).map((u) => u.oid));
  const units = {
    cut: nameDesc(mu.cut), fill: nameDesc(mu.fill), crush: nameDesc(mu.crush), haul: nameDesc(mu.haul),
    other: listOf(p, "m_vpUnits").filter((u) => !massOids.has(u.oid)).map(nameDesc),
  };
  const haul_costs = listOf(p, "m_vpPriceVectors").map((pv) => ({
    ...nameDesc(pv), unit: unitName(pv.get("m_pUnit")),
    points: pairs(pv.get("m_distances")).map(([d, v]) => [num(d) ?? 0, num(v) ?? 0]).sort((a, b) => a[0]! - b[0]!),
  }));
  const tref = (v: unknown) => {
    const e = p.resolve(asRef(v as bigint | null));
    return e ? typeRef(p, e) : undefined;
  };
  const source_types = listOf(p, "m_vpSourceLandTypes").map((t) => {
    const o: O = { ...nameDesc(t), suitability: SOURCE_SUIT[num(t.get("m_nSuitabilityType")) ?? 0] ?? "cut", unit: unitName(t.get("m_pUnit")) };
    put(o, "haul_cost", unitName(t.get("m_pPriceVector")));
    o.conversions = Object.fromEntries(pairs(t.get("m_conversions")).map(([u, f]) => [nameOf(p, u) ?? "?", num(f) ?? 1]));
    o.suitable_destinations = refs(t.get("m_vpSuitableTypes")).map(tref).filter(Boolean);
    const refined = refs(t.get("m_vpRefinedTypes")).map(tref).filter(Boolean);
    if (refined.length) o.processed_types = refined;
    const rp = pairs(t.get("m_mRefiningPrices"));
    if (rp.length) o.processing_costs = Object.fromEntries(rp.map(([d, v]) => [tref(d) ?? "?", num(v) ?? 0]));
    put(o, "max_haul_distance", dbl(t.get("m_dMaxHaulDistance")), 0);
    return o;
  });
  const destination_types = listOf(p, "m_vpDestLandTypes").map((t) => ({
    ...nameDesc(t), suitability: DEST_SUIT[num(t.get("m_nSuitabilityType")) ?? 0] ?? "fill", unit: unitName(t.get("m_pUnit")),
    suitable_sources: refs(t.get("m_vpSuitableTypes")).map(tref).filter(Boolean),
  }));
  const task_types = listOf(p, "m_vpWorkTypes").map((t) => ({ ...nameDesc(t), unit: unitName(t.get("m_pUnit")) }));
  const tdSeen = new Set<bigint>();
  const type_dependencies: O[] = [];
  for (const ty of allTypes(p)) for (const o of refs(ty.get("m_vpDependencies"))) {
    const d = p.get(o);
    if (!d || d.className !== "TypeDependency" || tdSeen.has(d.oid)) continue;
    tdSeen.add(d.oid);
  }
  for (const o of [...tdSeen].sort((a, b) => (a < b ? -1 : 1))) {
    const d = p.get(o)!;
    const td: O = { predecessor: tref(d.get("m_pPredecessor")), successor: tref(d.get("m_pSuccessor")) };
    put(td, "delay_days", num(d.get("m_nDelayDays")) ?? 0, 0);
    type_dependencies.push(td);
  }

  // ---------- calendários, recursos, transportadores, equipes ----------
  const calendars = calendarsOf(p).map((c) => exportCalendar(c, notes));
  const limits = (e: Entity) => pairs(e.get("m_mQuantityRestrictions")).map(([s, n]) => ({ sum_task: nameOf(p, s), max: num(n) ?? 0 }));
  const resources = listOf(p, "m_vpResources").map((r) => {
    const o: O = { ...nameDesc(r), hourly_cost: dbl(r.get("m_dHourPrice")) };
    const l = limits(r);
    if (l.length) o.limits = l;
    return o;
  });
  const haul_resources = listOf(p, "m_vpTransporters").map((t) => {
    const o: O = { ...nameDesc(t), capacity: dbl(t.get("m_dCapacity")), unit: unitName(t.get("m_pUnit")), hourly_cost: dbl(t.get("m_dHourPrice")) };
    const rates = pairs(t.get("m_mDistanceWorkAchievement")).map(([d, v]) => [num(d) ?? 0, num(v) ?? 0]);
    if (rates.length) o.rates = rates;
    const l = limits(t);
    if (l.length) o.limits = l;
    const bad = refs(t.get("m_unsuitableRoutes")).map((x) => p.get(x)).filter((x): x is Entity => !!x);
    const locs = bad.filter((x) => x.className === "RoadLine" || x.className === "Area").map((x) => x.name);
    const ints = bad.filter((x) => x.className === "RoadConnection").map((x) => x.name);
    if (locs.length) o.unsuitable_locations = locs;
    if (ints.length) o.unsuitable_intersections = ints;
    return o;
  });
  const crews = listOf(p, "m_vpWorkGroups").map((g) => {
    const o: O = { ...nameDesc(g) };
    o.resources = pairs(g.get("m_resources")).map(([r, n]) => ({ resource: nameOf(p, r), count: num(n) ?? 0 }));
    o.rates = pairs(g.get("m_rates")).map(([t, v]) => {
      const tu = Array.isArray(v) ? v : [];
      const ro: O = { type: tref(t), rate: num(tu[0]) ?? 0 };
      put(ro, "unit_cost", num(tu[1]) ?? 0, 0);
      return ro;
    });
    const pc = num(g.get("m_nPriceCalculation")) ?? 0xffff;
    const named = (Object.entries(PRICE_CALC) as [string, number][]).find(([, v]) => v === pc)?.[0];
    if (pc !== 0xffff) o.price_calculation = named ?? pc;
    put(o, "haul_resource", nameOf(p, g.get("m_pHaulResource")) ?? undefined);
    return o;
  });

  // ---------- locais ----------
  const road_lines = listOf(p, "m_vpRoadLines").filter((r) => r.oid !== main.oid).map((r) => {
    const o: O = { ...nameDesc(r), station_begin: num(r.get("m_nStationBegin")) ?? 0, station_end: num(r.get("m_nStationEnd")) ?? 0 };
    put(o, "width", dbl(r.get("m_dWidth")), 0);
    put(o, "parent_area", nameOf(p, r.get("m_pAreaParent")) ?? undefined);
    if ((num(r.get("m_nDirectionality")) ?? 0) !== 0) o.fields = { m_nDirectionality: num(r.get("m_nDirectionality")) };
    return o;
  });
  const areas = listOf(p, "m_vpAreas").map((a) => {
    const o: O = nameDesc(a);
    put(o, "parent_area", nameOf(p, a.get("m_pAreaParent")) ?? undefined);
    return o;
  });
  const place = (v: unknown) => {
    const pl = p.resolve(asRef(v as bigint | null));
    return { location: nameOf(p, pl?.get("m_pRoadLine")), station: dbl(pl?.get("m_dStation")) };
  };
  const intersections = listOf(p, "m_vpRoadConnections").map((rc) => {
    const o: O = { ...nameDesc(rc), from: place(rc.get("m_pPlaceFrom")), to: place(rc.get("m_pPlaceTo")), length: dbl(rc.get("m_dDistance")) };
    put(o, "bidirectional", rc.get("m_bBidirectional") !== false, true);
    const w = windowJson(p, rc, notes, "intersection");
    if (w.from) o.open_from = w.from;
    if (w.to) o.open_until = w.to;
    return o;
  });
  const usage_breaks: O[] = [];
  for (const loc of [...listOf(p, "m_vpRoadLines"), ...listOf(p, "m_vpAreas")]) {
    for (const u of refs(loc.get("m_usageBreaks")).map((o) => p.get(o)).filter((e): e is Entity => !!e)) {
      const o: O = { ...nameDesc(u), location: loc.name, station_begin: num(u.get("m_nStationBegin")) ?? 0, station_end: num(u.get("m_nStationEnd")) ?? 0 };
      const w = windowJson(p, u, notes, "usage break");
      if (w.from) o.from = w.from;
      if (w.to) o.to = w.to;
      usage_breaks.push(o);
    }
  }

  // ---------- WBS, tarefas, dependências, marcos ----------
  const sum_tasks: O[] = [];
  const walk = (s: Entity) => {
    for (const c of refs(s.get("m_vpChildren")).map((o) => p.get(o)).filter((e): e is Entity => !!e)) {
      const o: O = nameDesc(c);
      if (s.oid !== rootSt.oid) o.parent = s.name;
      put(o, "construction_zone", c.get("m_bMassEconomyArea") === true, false);
      put(o, "prevent_external_hauls", c.get("m_bPreventExternalHauls") === true, false);
      put(o, "lock_internal_timing", c.get("m_bLockInternalTiming") === true, false);
      put(o, "comment", str(c.get("m_strComment")), "");
      sum_tasks.push(o);
      walk(c);
    }
  };
  walk(rootSt);
  const tasksList = allTasks(p).sort((a, b) => (a.oid < b.oid ? -1 : 1));
  const tasks = tasksList.map((t) => exportTask(p, t, rootSt));
  const dm = p.resolve(asRef(root.get("m_pDependencyManager")));
  const dependencies = refs(dm?.get("m_vDependencies")).map((o) => p.get(o)).filter((d): d is Entity => !!d && d.get("m_bUserGenerated") === true).map((d) => {
    const o: O = { predecessor: nameOf(p, d.get("m_pPredecessor")), successor: nameOf(p, d.get("m_pSuccessor")) };
    put(o, "type", ["finish_finish", "start_finish", "finish_start", "start_start", "by_stations"][num(d.get("m_nType")) ?? 2], "finish_start");
    if (d.get("m_bHasMinDelay") !== true) o.min_delay_days = null;
    else put(o, "min_delay_days", num(d.get("m_nDelayMin")) ?? 0, 0);
    if (d.get("m_bHasMaxDelay") === true) o.max_delay_days = num(d.get("m_nDelayMax")) ?? 0;
    put(o, "work_days", d.get("m_bIsDelayWorkDays") === true, false);
    return o;
  });
  const filterJson = (f: Entity, kind: string): O => {
    const o: O = nameDesc(f);
    const tasksIn = refs(f.get("m_spIncludedWorkSites")).map((x) => nameOf(p, x)).filter(Boolean);
    const tasksOut = refs(f.get("m_spExcludedWorkSites")).map((x) => nameOf(p, x)).filter(Boolean);
    if (tasksIn.length) o.tasks = tasksIn;
    if (kind === "milestone" && tasksOut.length) o.excluded_tasks = tasksOut;
    if (f.get("m_bWorkSiteTypeFilteringEnabled") === true) o.types = refs(f.get("m_spWorkSiteTypes")).map(tref).filter(Boolean);
    if (f.get("m_bResourceFilteringEnabled") === true) o.resources = refs(f.get("m_spResources")).map((x) => nameOf(p, x)).filter(Boolean);
    if (f.get("m_bStationSpanFilteringEnabled") === true) notes.push(`${kind} "${f.name}": station range filter not exported`);
    return o;
  };
  const milestones = listOf(p, "m_vpMilestones").map((m) => {
    const o = filterJson(m, "milestone");
    const b = date(m.get("m_beginDate")), e = date(m.get("m_endDate"));
    if (b !== undefined) o.from = fmtDate(b);
    if (e !== undefined) o.to = fmtDate(e);
    return o;
  });
  const mainSchedule = asRef(root.get("m_pMainSchedule"));
  const view_filters = listOf(p, "m_vpViewFilters").filter((f) => f.oid !== mainSchedule && f.className === "ViewFilter").map((f) => {
    const o = filterJson(f, "view filter");
    if (!o.types && f.get("m_bWorkSiteTypeFilteringEnabled") !== true) delete o.types;
    return o;
  });

  // ---------- o que não vai no documento ----------
  const mm = p.resolve(asRef(root.get("m_pMoveManager")));
  const manual = [...p.byClass("LPMove"), ...p.byClass("SchedMove")].filter((m) => m.get("m_bManual") === true).length;
  if (manual) notes.push(`${manual} manual haul(s) not exported`);
  if (refs(mm?.get("m_preventedChains")).length) notes.push("prevented hauls not exported");
  const locked = [...p.byClass("MovableWorkPlace"), ...p.byClass("OtherWorkPlace")].filter((w) => w.get("m_bLockedAsActual") === true).length;
  if (locked || pairs(impl?.get("m_mpImplInfos")).length || pairs(impl?.get("m_otherActuals")).length) notes.push("actuals (control mode) not exported");
  if (p.byClass("IdentifiedResource").length) notes.push("identified resources not exported");
  if (p.byClass("PolygonShape").length || p.byClass("Image").length || [...p.byClass("RoadLine")].some((r) => pairs(r.get("m_coordinates")).length)) notes.push("map geometry (coordinates, area polygons, background images) not exported");
  const dupTasks = tasksList.map((t) => t.name).filter((n, i, a) => a.indexOf(n) !== i);
  if (dupTasks.length) notes.push(`duplicate task names (${[...new Set(dupTasks)].join(", ")}): references to them are ambiguous`);

  const doc: ObraDoc = { format: OBRA_FORMAT, base: "empty" };
  if (notes.length) doc.notes = notes;
  Object.assign(doc, {
    project, units, haul_costs, source_types, destination_types, task_types, type_dependencies, calendars, resources, haul_resources, crews,
    road_lines, areas, intersections, usage_breaks, sum_tasks, tasks, dependencies, milestones, view_filters,
  });
  return doc;
}

// =====================================================================================================================
// Chaves de comparação (volta: projeto original × projeto remontado do documento)
// =====================================================================================================================

/**
 * Chaves por nome para comparar resultados entre o projeto original e o remontado (`compareTimingWith`,
 * `comparePlanWith`, `compareScheduleWith` do motor): work place = nome da tarefa + posição na lista; tipo = classe
 * + nome. São as chaves do próprio documento (nomes), então valem para qualquer par original/remontado.
 */
export const OBRA_KEYS = {
  wp(p: Project, oid: bigint): string {
    const w = p.get(oid);
    const t = w ? p.resolve(asRef(w.get("m_pWorkSite"))) : undefined;
    if (!w || !t) return `?${oid}`;
    return `${t.className}:${t.name}#${refs(t.get("m_vpWorkPlaces")).indexOf(oid)}`;
  },
  type(p: Project, oid: bigint): string {
    const t = p.get(oid);
    return t ? `${t.className}:${t.name}` : `?${oid}`;
  },
};
