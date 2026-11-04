/**
 * U-24 (D-024) — montagem da obra, dados de modelo: projeto, unidades, custos de transporte, tipos e adequação,
 * dependências entre tipos, calendários, recursos, transportadores e equipes (montagem_obra.md §4 passos 1–6).
 * Toda criação passa pelos comandos de `create.ts` (U-23); aqui só a leitura do documento, a atualização por nome e
 * as decisões pendentes. Roda dentro do nível de undo aberto por `buildObra`.
 */
import { FT, type FieldValue } from "@apex/dr5";
import { Calendar, CalendarError, serializeCalendarBlob, type CalendarSpec, type GeneratorSpec, type WorkDay } from "@apex/calendar";
import type { Entity } from "@apex/model";
import {
  addCalendar, addDestLandType, addPriceVector, addResource, addSourceLandType, addTransporter, addTypeDependency, addUnit, addWorkGroup, addWorkType,
  calendarSpec, calendarsOf, constructorCalendarSpec, CreateError, defaultCalendar, isMassUnit, mainRoadLine, massUnits, projectRoot, rootSumTask,
  setConvCoeff, setDefaultCalendar, setPriceAtDistance, setProjectProperties, setStationSpan, setSuitabilityType, setSuitable,
} from "./create.js";
import { Ctx, ObraError, Skip } from "./obra-ctx.js";
import { DEST_SUIT, MODE_NAMES, PRICE_CALC, SOURCE_SUIT, type O } from "./obra.js";
import { parseDate } from "./values-json.js";
import { asRef, num, pairs, refs } from "./values.js";

// ---------- leitura ----------

export const s = (o: O, k: string): string | undefined => (typeof o[k] === "string" ? (o[k] as string) : undefined);
export const n = (o: O, k: string): number | undefined => (typeof o[k] === "number" ? (o[k] as number) : undefined);
export const b = (o: O, k: string): boolean | undefined => (typeof o[k] === "boolean" ? (o[k] as boolean) : undefined);
export const arr = (o: O, k: string): O[] | undefined => (Array.isArray(o[k]) ? (o[k] as O[]) : undefined);
export const strs = (o: O, k: string): string[] | undefined => (Array.isArray(o[k]) ? (o[k] as string[]) : undefined);
export function date(o: O, k: string, path: string): bigint | undefined {
  const v = s(o, k);
  if (v === undefined) return undefined;
  try {
    return parseDate(v);
  } catch (e) {
    throw new ObraError([`${path}.${k}: ${(e as Error).message}`]);
  }
}
/** Último instante do dia quando só a data foi dada (fim de feriado, "to" inclusivo). */
export function endDate(o: O, k: string, path: string): bigint | undefined {
  const v = date(o, k, path);
  if (v === undefined) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(o[k]).trim()) ? v + 86399n : v;
}

const emptyMap = (): FieldValue => ({ kind: "map", type: FT.PAIR_CONTAINER, keyType: null, valueType: null, entries: [] });
const fRef = (oid: bigint): FieldValue => ({ kind: "bigint", type: FT.POINTER64, value: oid });
const fDbl = (v: number): FieldValue => ({ kind: "float", type: FT.DOUBLE, value: v, raw: new Uint8Array(0) });
const fInt = (v: number): FieldValue => ({ kind: "int", type: FT.SINT, value: v });
export const refMap = (entries: [bigint, FieldValue][], valueType: number): FieldValue =>
  entries.length ? { kind: "map", type: FT.PAIR_CONTAINER, keyType: FT.POINTER64, valueType, entries: entries.map(([k, v]) => [fRef(k), v]) } : emptyMap();
export const refList = (oids: bigint[]): FieldValue => ({ kind: "container", type: FT.CONTAINER, elemType: oids.length ? FT.POINTER64 : null, items: oids.map(fRef) });
const setDesc = (e: Entity, o: O) => {
  const d = s(o, "description");
  if (d !== undefined) e.set("m_strLongName", d);
};
/** base "empty": os objetos que ficaram (linha principal, raiz, unidades de massa, calendário padrão) recebem o que o
 * documento diz e, no que ele omite, o padrão do construtor, como se fossem novos [P]. */
const resetDesc = (ctx: Ctx, e: Entity, o: O) => (ctx.report.base === "empty" ? e.set("m_strLongName", s(o, "description") ?? "") : setDesc(e, o));
/** limites por sum task (m_mQuantityRestrictions: SumTask → quantidade) [O formato nos exemplos: inteiro]. */
export const limitsValue = (ctx: Ctx, list: O[], path: string): FieldValue =>
  refMap(list.map((l, i) => [ctx.ref("sum_task", l.sum_task, `${path}[${i}].sum_task`).oid, Number.isInteger(l.max) ? fInt(l.max as number) : fDbl(l.max as number)]), FT.SINT);

// =====================================================================================================================
// Projeto (§4 passo 1)
// =====================================================================================================================

export function buildProject(ctx: Ctx, tasksOnMain: { min: number; max: number } | null): void {
  const p = ctx.p;
  const o = (ctx.doc.project ?? {}) as O;
  const root = projectRoot(p);
  ctx.item("project", "project", undefined, () => {
    setProjectProperties(p, { name: s(o, "name"), longName: s(o, "description"), client: s(o, "client"), planner: s(o, "planner"), currency: s(o, "currency"), lengthUnit: s(o, "length_unit") });
    const begin = date(o, "start_date", "project"), deadline = date(o, "deadline", "project");
    if (begin !== undefined || deadline !== undefined) setProjectProperties(p, { begin, deadline });
    const ctrl = date(o, "control_date", "project");
    if (ctrl !== undefined) p.resolve(asRef(root.get("m_pImplManager")))?.set("m_dateControl", ctrl);
    ctx.applyFields(root, o.fields, "project");
  });
  if (ctx.isNew) {
    const has = (k: string) => o[k] !== undefined;
    if (!has("name") && !root.name) ctx.decide({ path: "project.name", question: "What is the project's name?", blocking: false });
    if (!has("start_date") || !has("deadline")) {
      ctx.decide({
        path: "project.start_date/deadline",
        question: "What are the project's start date and real deadline? Tasks are scheduled inside this window and borrow pits, disposal areas, crushing plants and stockpiles occupy it.",
        default: { start_date: fmt(root.get("m_dateBegin")), deadline: fmt(root.get("m_dateDeadline")) },
        blocking: true,
      });
    }
    if (!has("mode")) ctx.decide({ path: "project.mode", question: "Plan (mass balance and haul costs, no time) or schedule (also dates, calendars, crews and production rates)?", options: ["plan", "schedule"], default: MODE_NAMES[ctx.finalMode], blocking: false });
    if (!has("currency")) ctx.decide({ path: "project.currency", question: "Which currency are the costs in?", default: String(root.get("m_strCurrencySign") ?? ""), blocking: false });
    if (!has("length_unit")) ctx.decide({ path: "project.length_unit", question: "Which length unit are the stations in?", default: String(root.get("m_strLengthUnit") ?? ""), blocking: false });
  }
  // linha principal
  const main = mainRoadLine(p);
  const mo = (o.main_road_line ?? {}) as O;
  ctx.item("project.main_road_line", "road_line", main.name, () => {
    if (s(mo, "name") !== undefined) {
      if (!s(mo, "name")!.trim()) throw new CreateError("NAME_CANNOT_BE_EMPTY");
      main.set("m_strName", s(mo, "name")!);
    }
    resetDesc(ctx, main, mo);
    const sb = n(mo, "station_begin"), se = n(mo, "station_end");
    if (sb !== undefined || se !== undefined) setStationSpan(p, main, sb ?? num(main.get("m_nStationBegin")) ?? 0, se ?? num(main.get("m_nStationEnd")) ?? 0);
    else if (ctx.isNew && tasksOnMain) {
      ctx.pendingLocations.add(main.name);
      ctx.decide({
        path: "project.main_road_line",
        question: `What are the start and finish stations of the main road line "${main.name}"? Your tasks on it go from station ${tasksOnMain.min} to ${tasksOnMain.max}.`,
        options: [{ station_begin: Math.floor(tasksOnMain.min), station_end: Math.ceil(tasksOnMain.max) }],
        default: { station_begin: num(main.get("m_nStationBegin")), station_end: num(main.get("m_nStationEnd")) },
        blocking: true,
      });
    }
    if (n(mo, "width") !== undefined) main.set("m_dWidth", n(mo, "width")!);
    else if (ctx.report.base === "empty") main.set("m_dWidth", 0);
    if (ctx.report.base === "empty" && !(mo.fields as O | undefined)?.m_nDirectionality) main.set("m_nDirectionality", 0);
    ctx.applyFields(main, mo.fields, "project.main_road_line");
  });
  // sum task raiz
  const rs = (o.root_sum_task ?? {}) as O;
  const rootSt = rootSumTask(p);
  ctx.item("project.root_sum_task", "sum_task", rootSt.name, () => {
    if (s(rs, "name") !== undefined) rootSt.set("m_strName", s(rs, "name")!);
    resetDesc(ctx, rootSt, rs);
    // raiz nova: zona de construção (`Project::Project`, m_bMassEconomyArea = true) [O]; demais flags false
    const empty = ctx.report.base === "empty";
    const flag = (k: string, member: string, def: boolean) => {
      if (b(rs, k) !== undefined) rootSt.set(member, b(rs, k)!);
      else if (empty) rootSt.set(member, def);
    };
    flag("construction_zone", "m_bMassEconomyArea", true);
    flag("prevent_external_hauls", "m_bPreventExternalHauls", false);
    flag("lock_internal_timing", "m_bLockInternalTiming", false);
    if (s(rs, "comment") !== undefined) rootSt.set("m_strComment", s(rs, "comment")!);
    else if (empty) rootSt.set("m_strComment", "");
  });
}

const fmt = (v: unknown) => (typeof v === "bigint" ? new Date(Number(v) * 1000).toISOString().slice(0, 10) : null);

// =====================================================================================================================
// Unidades e custos de transporte (§4 passos 2–3)
// =====================================================================================================================

export function buildUnits(ctx: Ctx): void {
  const p = ctx.p;
  const u = (ctx.doc.units ?? {}) as O;
  const mu = massUnits(p);
  for (const role of ["cut", "fill", "crush", "haul"] as const) {
    const o = u[role] as O | undefined;
    if (!o) continue;
    ctx.item(`units.${role}`, "unit", s(o, "name"), () => {
      if (mu[role].name !== s(o, "name")) {
        setProjectProperties(p, { unitNames: { [role]: s(o, "name") } });
        ctx.count("updated", "units");
      }
      resetDesc(ctx, mu[role], o);
    });
  }
  (arr(u, "other") ?? []).forEach((o, i) => {
    const path = `units.other[${i}]`;
    ctx.item(path, "unit", s(o, "name"), () => {
      const cur = ctx.find("unit", s(o, "name")!, path);
      if (cur) {
        if (isMassUnit(p, cur)) throw new ObraError([`${path}: "${cur.name}" is a mass unit of the project; set it in units.cut/fill/crush/haul`]);
        setDesc(cur, o);
        ctx.count("updated", "units");
      } else {
        addUnit(p, { name: s(o, "name"), longName: s(o, "description") });
        ctx.count("created", "units");
      }
    });
  });
  const names = ctx.pool("unit").map((x) => x.name);
  const dup = names.filter((x, i) => names.indexOf(x) !== i);
  if (dup.length) throw new ObraError([`units: duplicate unit names (${[...new Set(dup)].join(", ")}); every unit needs its own name`]);
}

export function buildHaulCosts(ctx: Ctx): void {
  const p = ctx.p;
  (arr(ctx.doc, "haul_costs") ?? []).forEach((o, i) => {
    const path = `haul_costs[${i}]`;
    ctx.item(path, "haul_cost", s(o, "name"), () => {
      const cur = ctx.find("haul_cost", s(o, "name")!, path);
      const unit = o.unit !== undefined ? ctx.ref("unit", o.unit, `${path}.unit`) : undefined;
      const points = o.points as [number, number][] | undefined;
      if (!cur && !points) {
        ctx.block({ path: `${path}.points`, question: `What does hauling cost for "${s(o, "name")}"? Give the price per unit at several haul distances (e.g. [[0,0],[500,1.2],[2000,2.5]]).` });
      }
      if (cur) {
        setDesc(cur, o);
        if (unit) cur.set("m_pUnit", unit.oid);
        if (points) {
          cur.setRaw("m_distances", emptyMap());
          for (const [d, v] of points) setPriceAtDistance(cur, d, v);
        }
        ctx.applyFields(cur, o.fields, path);
        ctx.count("updated", "haul_costs");
      } else {
        if (!unit) ctx.applied("haul cost unit: the cut unit", path, massUnits(p).cut.name);
        const pv = addPriceVector(p, { name: s(o, "name"), longName: s(o, "description"), unit, points });
        ctx.applyFields(pv, o.fields, path);
        ctx.count("created", "haul_costs");
      }
    });
  });
}

// =====================================================================================================================
// Tipos, adequação e dependências entre tipos (§4 passos 4–5)
// =====================================================================================================================

/** Que espécies de tarefa usam cada nome de tipo no documento (para inferir a adequação de um tipo novo). */
function typeUsage(ctx: Ctx): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (name: unknown, kind: string) => {
    if (typeof name !== "string") return;
    const k = name.replace(/^(source|destination|task):/, "");
    if (!m.has(k)) m.set(k, new Set());
    m.get(k)!.add(kind);
  };
  for (const t of arr(ctx.doc, "tasks") ?? []) {
    add(t.type, String(t.kind));
    if (t.kind === "soil_replacement") add(t.destination_type, "soil_replacement");
  }
  return m;
}

export function buildTypes(ctx: Ctx): void {
  const p = ctx.p;
  const usage = typeUsage(ctx);
  const srcDocs = arr(ctx.doc, "source_types") ?? [], dstDocs = arr(ctx.doc, "destination_types") ?? [], wtDocs = arr(ctx.doc, "task_types") ?? [];
  const pvs = () => ctx.pool("haul_cost");
  const infer = (name: string, allowed: readonly string[], fallback: string, path: string, what: string): number => {
    const used = [...(usage.get(name) ?? [])].filter((k) => allowed.includes(k));
    const st = used.length === 1 ? used[0]! : fallback;
    ctx.applied(used.length === 1 ? `${what} suitability: from the tasks that use it` : `${what} suitability: ${fallback} (the type sheet's default)`, path, st);
    return allowed.indexOf(st);
  };
  // ---------- passo 1: criar / atualizar ----------
  srcDocs.forEach((o, i) => {
    const path = `source_types[${i}]`;
    const name = s(o, "name")!;
    ctx.item(path, "source_type", name, () => {
      const cur = ctx.find("source_type", name, path);
      const unit = o.unit !== undefined ? ctx.ref("unit", o.unit, `${path}.unit`) : undefined;
      const pv = o.haul_cost !== undefined ? ctx.ref("haul_cost", o.haul_cost, `${path}.haul_cost`) : undefined;
      if (cur) {
        setDesc(cur, o);
        if (s(o, "suitability")) setSuitabilityType(p, cur, SOURCE_SUIT.indexOf(s(o, "suitability") as never));
        if (unit) cur.set("m_pUnit", unit.oid);
        if (pv) cur.set("m_pPriceVector", pv.oid);
        ctx.count("updated", "source_types");
        return;
      }
      if (o.suitable_destinations === undefined && !dstDocs.some((d) => strs(d, "suitable_sources")?.includes(name))) {
        ctx.pend({ path: `${path}.suitable_destinations`, question: `Where may material "${name}" be hauled? List the destination types (fills, disposal areas, crushing plants, stockpiles) that accept it.`, options: ctx.pool("destination_type").map((d) => d.name) });
      }
      let priceVector = pv;
      if (!priceVector) {
        const all = pvs();
        if (all.length === 1) {
          priceVector = all[0];
          ctx.applied("source type haul cost: the only haul cost", path, all[0]!.name);
        } else {
          ctx.pend({
            path: `${path}.haul_cost`,
            question: all.length ? `Which haul cost (price by distance) applies to material "${name}"?` : `There is no haul cost yet: what does hauling "${name}" cost by distance?`,
            ...(all.length ? { options: all.map((x) => x.name), default: all.at(-1)!.name } : {}),
          });
        }
      }
      ctx.checkpoint();
      const st = s(o, "suitability") ? SOURCE_SUIT.indexOf(s(o, "suitability") as never) : infer(name, SOURCE_SUIT, "cut", path, "source type");
      if (!unit) ctx.applied("source type unit: the cut unit", path, massUnits(p).cut.name);
      addSourceLandType(p, { suitability: st, name, longName: s(o, "description"), unit, priceVector });
      if (!o.conversions) {
        ctx.applied("unit conversions 1.0 to the mass units", path);
        ctx.decide({ path: `${path}.conversions`, question: `Material "${name}": 1 ${unit?.name ?? massUnits(p).cut.name} equals how many ccm (compacted), lcm (loose) and t? Without factors ApeX uses 1.0.`, default: 1, blocking: false });
      }
      ctx.count("created", "source_types");
    });
  });
  dstDocs.forEach((o, i) => {
    const path = `destination_types[${i}]`;
    const name = s(o, "name")!;
    ctx.item(path, "destination_type", name, () => {
      const cur = ctx.find("destination_type", name, path);
      const unit = o.unit !== undefined ? ctx.ref("unit", o.unit, `${path}.unit`) : undefined;
      if (cur) {
        setDesc(cur, o);
        if (s(o, "suitability")) setSuitabilityType(p, cur, DEST_SUIT.indexOf(s(o, "suitability") as never));
        if (unit) cur.set("m_pUnit", unit.oid);
        ctx.count("updated", "destination_types");
        return;
      }
      if (o.suitable_sources === undefined && !srcDocs.some((d) => strs(d, "suitable_destinations")?.includes(name))) {
        ctx.block({ path: `${path}.suitable_sources`, question: `Which materials (source types) may be placed in "${name}"?`, options: ctx.pool("source_type").map((d) => d.name) });
      }
      const st = s(o, "suitability") ? DEST_SUIT.indexOf(s(o, "suitability") as never) : infer(name, DEST_SUIT, "fill", path, "destination type");
      if (!unit) ctx.applied("destination type unit: the fill unit", path, massUnits(p).fill.name);
      addDestLandType(p, { suitability: st, name, longName: s(o, "description"), unit });
      ctx.count("created", "destination_types");
    });
  });
  wtDocs.forEach((o, i) => {
    const path = `task_types[${i}]`;
    ctx.item(path, "task_type", s(o, "name"), () => {
      const cur = ctx.find("task_type", s(o, "name")!, path);
      const unit = o.unit !== undefined ? ctx.ref("unit", o.unit, `${path}.unit`) : undefined;
      if (cur) {
        setDesc(cur, o);
        if (unit) cur.set("m_pUnit", unit.oid);
        ctx.applyFields(cur, o.fields, path);
        ctx.count("updated", "task_types");
      } else {
        if (!unit) ctx.applied("task type unit: the last unit of the project", path, ctx.pool("unit").at(-1)?.name);
        const t = addWorkType(p, { name: s(o, "name"), longName: s(o, "description"), unit });
        ctx.applyFields(t, o.fields, path);
        ctx.count("created", "task_types");
      }
    });
  });
  // ---------- passo 2: ligações (todos os tipos já existem) ----------
  srcDocs.forEach((o, i) => {
    const path = `source_types[${i}]`;
    const name = s(o, "name")!;
    if (ctx.skippedNames.get("source_type")?.has(name)) return;
    ctx.item(path, "source_type", name, () => {
      const t = ctx.find("source_type", name, path)!;
      const own = p.get(t.get("m_pUnit") as bigint)!;
      for (const [un, f] of Object.entries((o.conversions ?? {}) as Record<string, number>)) {
        const to = ctx.ref("unit", un, `${path}.conversions.${un}`);
        if (to.oid === own.oid) {
          if (f !== 1) throw new ObraError([`${path}.conversions.${un}: "${un}" is the type's own unit (factor 1)`]);
          continue;
        }
        setConvCoeff(p, t, own, to, f);
      }
      const dests = strs(o, "suitable_destinations");
      if (dests) setSuitableList(ctx, t, dests.map((d, k) => ctx.ref("destination_type", d, `${path}.suitable_destinations[${k}]`)), "source");
      const refined = strs(o, "processed_types");
      if (refined) t.setRaw("m_vpRefinedTypes", refList(refined.map((r, k) => ctx.ref("source_type", r, `${path}.processed_types[${k}]`).oid)));
      const rp = o.processing_costs as Record<string, number> | undefined;
      if (rp) {
        for (const v of Object.values(rp)) if (v < 0) throw new CreateError("NEGATIVE_UNIT_PRICE");
        t.setRaw("m_mRefiningPrices", refMap(Object.entries(rp).map(([d, v]) => [ctx.ref("destination_type", d, `${path}.processing_costs.${d}`).oid, fDbl(v)]), FT.DOUBLE));
      }
      if (n(o, "max_haul_distance") !== undefined) t.set("m_dMaxHaulDistance", n(o, "max_haul_distance")!);
      ctx.applyFields(t, o.fields, path);
    });
  });
  dstDocs.forEach((o, i) => {
    const path = `destination_types[${i}]`;
    const name = s(o, "name")!;
    if (ctx.skippedNames.get("destination_type")?.has(name)) return;
    ctx.item(path, "destination_type", name, () => {
      const t = ctx.find("destination_type", name, path)!;
      const srcs = strs(o, "suitable_sources");
      if (srcs) setSuitableList(ctx, t, srcs.map((d, k) => ctx.ref("source_type", d, `${path}.suitable_sources[${k}]`)), "destination");
      ctx.applyFields(t, o.fields, path);
    });
  });
  // ---------- dependências entre tipos ----------
  (arr(ctx.doc, "type_dependencies") ?? []).forEach((o, i) => {
    const path = `type_dependencies[${i}]`;
    ctx.item(path, "type_dependency", undefined, () => {
      const pred = ctx.ref("type", o.predecessor, `${path}.predecessor`), succ = ctx.ref("type", o.successor, `${path}.successor`);
      const existed = refs(pred.get("m_vpDependencies")).some((x) => p.get(x)?.get("m_pSuccessor") === succ.oid && p.get(x)?.get("m_pPredecessor") === pred.oid);
      addTypeDependency(p, pred, succ, n(o, "delay_days") ?? 0);
      ctx.count(existed ? "updated" : "created", "type_dependencies");
    });
  });
}

/** Lista de adequação de um lado igual à dada (e o outro lado coerente), na ordem dada. */
function setSuitableList(ctx: Ctx, t: Entity, others: Entity[], side: "source" | "destination"): void {
  const p = ctx.p;
  const want = others.map((x) => x.oid);
  for (const o of refs(t.get("m_vpSuitableTypes"))) {
    if (want.includes(o)) continue;
    const x = p.get(o);
    if (x) side === "source" ? setSuitable(p, t, x, false) : setSuitable(p, x, t, false);
  }
  for (const x of others) side === "source" ? setSuitable(p, t, x, true) : setSuitable(p, x, t, true);
  t.setRaw("m_vpSuitableTypes", refList(want));
}

// =====================================================================================================================
// Calendários (§4 passo 6)
// =====================================================================================================================

function weekDays(v: unknown): [WorkDay, WorkDay, WorkDay, WorkDay, WorkDay, WorkDay, WorkDay] {
  return (v as O[]).map((d, i) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(d.start));
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`week[${i}].start must be "hh:mm"`);
    return { begin: Number(m[1]) * 3600 + Number(m[2]) * 60, length: Math.round((d.hours as number) * 3600) };
  }) as [WorkDay, WorkDay, WorkDay, WorkDay, WorkDay, WorkDay, WorkDay];
}

/** Regras do calendário a partir do documento, sobre a base (o próprio calendário ou o primeiro). */
function calendarFromDoc(o: O, path: string, base: CalendarSpec, whole = false): CalendarSpec {
  const spec: CalendarSpec = structuredClone(base);
  if (o.week) spec.week = { flag: spec.week.flag || 1, days: weekDays(o.week) };
  if (o.holidays || o.easter || o.weekday_holidays || whole) {
    const gens: GeneratorSpec[] = [];
    (arr(o, "holidays") ?? []).forEach((h, k) => {
      const from = date(h, "from", `${path}.holidays[${k}]`)!, to = endDate(h, "to", `${path}.holidays[${k}]`)!;
      if (to < from) throw new CreateError("BEGIN_TIME_GREATER_THAN_END_TIME", `${path}.holidays[${k}]`);
      gens.push({ type: "StaticHoliday", name: s(h, "name") ?? "", begin: from, end: to, yearly: b(h, "yearly") ? 1 : 0 });
    });
    for (const e of strs(o, "easter") ?? []) gens.push({ type: "Easter", name: e });
    (arr(o, "weekday_holidays") ?? []).forEach((h, k) => gens.push({ type: "StaticWeekDay", name: s(h, "name") ?? "", date: date(h, "date", `${path}.weekday_holidays[${k}]`)!, weekday: h.weekday as number }));
    spec.generators = gens;
  }
  if (o.exceptions || whole) {
    spec.spans = (arr(o, "exceptions") ?? []).map((x, k) => ({ name: s(x, "name") ?? "", first: date(x, "from", `${path}.exceptions[${k}]`)!, last: date(x, "to", `${path}.exceptions[${k}]`)!, week: { flag: 1, days: weekDays(x.week) } }));
  }
  spec.order = spec.generators.map((_, k) => k);
  return spec;
}

/**
 * Recusa um calendário sem expediente no lugar dele: o motor só o montaria mais tarde (no primeiro cálculo que usa o
 * calendário, por exemplo o atraso de uma dependência) e o erro "No working time" sairia com o caminho errado. É a mesma
 * verificação do comando do calendário (`editCalendar`): montar o `Calendar` a partir das regras.
 */
function assertWorkingTime(spec: CalendarSpec, path: string): void {
  try {
    new Calendar(spec);
  } catch (e) {
    if (e instanceof CalendarError) {
      throw new ObraError([`${path}.week: the calendar has no working time — give at least one weekday with hours > 0 (holidays and exceptions cannot close every day)`]);
    }
    throw e;
  }
}

function writeCalendar(c: Entity, spec: CalendarSpec, path: string): void {
  assertWorkingTime(spec, path);
  const blob = serializeCalendarBlob(spec);
  const has = c.fields.some((f) => f.id === 100 && f.type === FT.BINARY);
  const v: FieldValue = { kind: "bytes", type: FT.BINARY, value: blob };
  c.replaceFields(has ? c.fields.map((f) => (f.id === 100 && f.type === FT.BINARY ? { ...f, value: v } : f)) : [...c.fields, { id: 100, type: FT.BINARY, value: v }]);
}

export function buildCalendars(ctx: Ctx): void {
  const p = ctx.p;
  const docs = arr(ctx.doc, "calendars") ?? [];
  const project = (ctx.doc.project ?? {}) as O;
  const wantedDefault = s(project, "default_calendar") ?? (ctx.report.base === "empty" ? s(docs[0] ?? {}, "name") : undefined);
  // base vazia: o calendário padrão que ficou recebe o calendário padrão do documento
  let reuse = ctx.report.base === "empty" ? defaultCalendar(p) : undefined;
  docs.forEach((o, i) => {
    const path = `calendars[${i}]`;
    const name = s(o, "name")!;
    ctx.item(path, "calendar", name, () => {
      let cur = ctx.find("calendar", name, path);
      if (!cur && reuse && name === wantedDefault) {
        cur = reuse;
        reuse = undefined;
        cur.set("m_strName", name);
        cur.set("m_strLongName", s(o, "description") ?? "");
        writeCalendar(cur, calendarFromDoc(o, path, calendarSpec(cur) ?? constructorCalendarSpec(), true), path);
        ctx.count("updated", "calendars");
        return;
      }
      const empty = ctx.report.base === "empty";
      if (cur) {
        if (empty) cur.set("m_strLongName", s(o, "description") ?? "");
        else setDesc(cur, o);
        writeCalendar(cur, calendarFromDoc(o, path, calendarSpec(cur) ?? constructorCalendarSpec(), empty), path);
        ctx.count("updated", "calendars");
        return;
      }
      if (!empty && (!o.week || !(o.holidays || o.easter || o.weekday_holidays) || !o.exceptions)) {
        ctx.applied("calendar: copy of the first calendar for what is not given (week, holidays, exceptions)", path, calendarsOf(p)[0]?.name ?? "Mon–Fri 07:00 + 8 h");
      }
      const c = addCalendar(p, { name, longName: s(o, "description") });
      writeCalendar(c, calendarFromDoc(o, path, calendarSpec(c) ?? constructorCalendarSpec(), empty), path);
      ctx.count("created", "calendars");
    });
  });
  if (s(project, "default_calendar") !== undefined) {
    ctx.item("project.default_calendar", "calendar", undefined, () => setDefaultCalendar(p, ctx.ref("calendar", s(project, "default_calendar"), "project.default_calendar")));
  }
  if (ctx.isNew && ctx.finalMode !== 0 && !docs.length) {
    const c = defaultCalendar(p);
    ctx.decide({ path: "calendars", question: `The schedule will use the calendar "${c?.name ?? "?"}" of the template (working hours as defined there, no holidays). What are the real working hours and holidays?`, blocking: false });
  }
}

// =====================================================================================================================
// Recursos, transportadores e equipes (§4 passo 6)
// =====================================================================================================================

export function buildResources(ctx: Ctx, deferred: (() => void)[]): void {
  const p = ctx.p;
  (arr(ctx.doc, "resources") ?? []).forEach((o, i) => {
    const path = `resources[${i}]`;
    ctx.item(path, "resource", s(o, "name"), () => {
      let r = ctx.find("resource", s(o, "name")!, path);
      if (r) {
        setDesc(r, o);
        if (n(o, "hourly_cost") !== undefined) r.set("m_dHourPrice", n(o, "hourly_cost")!);
        ctx.count("updated", "resources");
      } else {
        if (n(o, "hourly_cost") === undefined) ctx.applied("resource hourly cost 0", path);
        r = addResource(p, { name: s(o, "name"), longName: s(o, "description"), hourPrice: n(o, "hourly_cost") });
        ctx.count("created", "resources");
      }
      const res = r;
      ctx.applyFields(res, o.fields, path);
      const lim = arr(o, "limits");
      if (lim) deferred.push(() => ctx.item(`${path}.limits`, "resource", undefined, () => res.setRaw("m_mQuantityRestrictions", limitsValue(ctx, lim, `${path}.limits`))));
    });
  });
  (arr(ctx.doc, "haul_resources") ?? []).forEach((o, i) => {
    const path = `haul_resources[${i}]`;
    ctx.item(path, "haul_resource", s(o, "name"), () => {
      const unit = o.unit !== undefined ? ctx.ref("unit", o.unit, `${path}.unit`) : undefined;
      if (unit && !isMassUnit(p, unit)) throw new CreateError("UNIT_MUST_BE_MASS_UNIT");
      const rates = o.rates as [number, number][] | undefined;
      let t = ctx.find("haul_resource", s(o, "name")!, path);
      if (t) {
        setDesc(t, o);
        if (n(o, "capacity") !== undefined) t.set("m_dCapacity", n(o, "capacity")!);
        if (unit) t.set("m_pUnit", unit.oid);
        if (n(o, "hourly_cost") !== undefined) t.set("m_dHourPrice", n(o, "hourly_cost")!);
        if (rates) {
          for (const [d, v] of rates) if (!(d >= 0) || !(v > 0)) throw new ObraError([`${path}.rates: distances ≥ 0 and rates > 0`]);
          t.setRaw("m_mDistanceWorkAchievement", rates.length ? { kind: "map", type: FT.PAIR_CONTAINER, keyType: FT.DOUBLE, valueType: FT.DOUBLE, entries: [...rates].sort((x, y) => x[0] - y[0]).map(([d, v]) => [fDbl(d), fDbl(v)]) } : emptyMap());
        }
        ctx.count("updated", "haul_resources");
      } else {
        if (n(o, "capacity") === undefined) ctx.applied("haul resource capacity: the last haul resource's, else 10 in the haul unit", path);
        t = addTransporter(p, { name: s(o, "name"), longName: s(o, "description"), capacity: n(o, "capacity"), unit, hourPrice: n(o, "hourly_cost"), rates });
        ctx.count("created", "haul_resources");
      }
      const tr = t;
      ctx.applyFields(tr, o.fields, path);
      const lim = arr(o, "limits"), locs = strs(o, "unsuitable_locations"), ints = strs(o, "unsuitable_intersections");
      if (lim || locs || ints) {
        deferred.push(() => ctx.item(path, "haul_resource", undefined, () => {
          if (lim) tr.setRaw("m_mQuantityRestrictions", limitsValue(ctx, lim, `${path}.limits`));
          if (locs || ints) {
            tr.setRaw("m_unsuitableRoutes", refList([
              ...(locs ?? []).map((x, k) => ctx.ref("location", x, `${path}.unsuitable_locations[${k}]`).oid),
              ...(ints ?? []).map((x, k) => ctx.ref("intersection", x, `${path}.unsuitable_intersections[${k}]`).oid),
            ]));
          }
        }));
      }
    });
  });
  (arr(ctx.doc, "crews") ?? []).forEach((o, i) => {
    const path = `crews[${i}]`;
    ctx.item(path, "crew", s(o, "name"), () => {
      const resList = arr(o, "resources");
      const res = resList?.map((x, k) => {
        if (!Number.isInteger(x.count)) throw new ObraError([`${path}.resources[${k}].count: must be an integer`]);
        return [ctx.ref("resource", x.resource, `${path}.resources[${k}].resource`).oid, fInt(x.count as number)] as [bigint, FieldValue];
      });
      const rateList = arr(o, "rates")?.map((x, k) => {
        const rate = x.rate as number, cost = (x.unit_cost as number | undefined) ?? 0;
        if (!(rate > 0)) throw new CreateError("PRODUCTION_RATE_LESS_THAN_OR_EQUAL_ZERO", `${path}.rates[${k}]`);
        if (cost < 0) throw new CreateError("NEGATIVE_UNIT_PRICE", `${path}.rates[${k}]`);
        return [ctx.ref("type", x.type, `${path}.rates[${k}].type`).oid, { kind: "tuple", type: FT.TUPLE, items: [fDbl(rate), fDbl(cost)] } as FieldValue] as [bigint, FieldValue];
      });
      const pcRaw = o.price_calculation;
      let pc: number | undefined;
      if (typeof pcRaw === "string") {
        if (!(pcRaw in PRICE_CALC)) throw new ObraError([`${path}.price_calculation: one of ${Object.keys(PRICE_CALC).join(", ")} or an integer`]);
        pc = PRICE_CALC[pcRaw as keyof typeof PRICE_CALC];
      } else if (typeof pcRaw === "number") {
        if (!Number.isInteger(pcRaw) || pcRaw < 0 || pcRaw > 0xffffffff) throw new ObraError([`${path}.price_calculation: integer ≥ 0`]);
        pc = pcRaw;
      }
      const haul = o.haul_resource !== undefined ? ctx.ref("haul_resource", o.haul_resource, `${path}.haul_resource`) : undefined;
      let g = ctx.find("crew", s(o, "name")!, path);
      if (g) {
        setDesc(g, o);
        ctx.count("updated", "crews");
      } else {
        if (!resList) ctx.applied("crew resources: one of the project's first resource", path, ctx.pool("resource")[0]?.name);
        g = addWorkGroup(p, { name: s(o, "name"), longName: s(o, "description") });
        ctx.count("created", "crews");
      }
      if (res) g.setRaw("m_resources", refMap(res, FT.SINT));
      if (rateList) g.setRaw("m_rates", refMap(rateList, FT.TUPLE));
      if (pc !== undefined) g.set("m_nPriceCalculation", pc);
      if (haul) g.set("m_pHaulResource", haul.oid);
      ctx.applyFields(g, o.fields, path);
    });
  });
}

export { Skip, pairs };
