/**
 * U-24 (D-024) — montagem da obra, tarefas e o que depende delas: tarefas com tipo, locais, quantidades, equipes e
 * atributos; dependências do usuário; marcos; filtros de visão; datas (montagem_obra.md §4 passos 9–10). Criação
 * pelos comandos de `create.ts` (`addTask`, `addTaskLocation`, `setTaskCrew`, `addDependency`, `addMilestone`…).
 */
import type { FieldValue } from "@apex/dr5";
import type { Entity } from "@apex/model";
import { setBeginTime, setEndTime, STRICT_CLASSES, TimingEditError } from "@apex/engine";
import {
  addDependency, addMilestone, addTask, addTaskLocation, addViewFilter, CreateError, DEPENDENCY_TYPES, projectRoot, removeObjects, rootSumTask, setTaskCrew,
  setTaskSumTask, stationSpan, TASK_KINDS, usagesOf, workPlacesOf, type TaskKind, type WorkPlaceSpec,
} from "./create.js";
import { arr, b, date, n, refList, s, strs } from "./obra-build-data.js";
import { ObraError, type Ctx } from "./obra-ctx.js";
import { LOCAL_STOCKPILE_DEFAULT, USAGE_BY_NAME, USAGE_NAMES, type O } from "./obra.js";
import { asRef, num, pairs, refs } from "./values.js";

/** Tipo exigido por espécie de tarefa (matriz de adequação, criacao_objetos.md §3.3) [O]. */
const NEED: Record<TaskKind, { pool: "source_type" | "destination_type" | "task_type"; suit?: number; dest?: number }> = {
  cut: { pool: "source_type", suit: 0 }, borrow_pit: { pool: "source_type", suit: 2 }, soil_replacement: { pool: "source_type", suit: 1, dest: 1 },
  fill: { pool: "destination_type", suit: 0 }, disposal_area: { pool: "destination_type", suit: 2 }, stockpile: { pool: "destination_type", suit: 3 },
  crushing_plant: { pool: "destination_type", suit: 4 }, task: { pool: "task_type" },
};
const SUIT_LABEL: Record<string, readonly string[]> = {
  source_type: ["cut", "soil_replacement", "borrow_pit"], destination_type: ["fill", "soil_replacement", "disposal_area", "stockpile", "crushing_plant"],
};
/** Uso principal (`WorkSiteHelpers::GetMainSWGU`: outras, senão recebimento, senão envio) e o tipo que a equipe precisa [O]. */
const MAIN_USAGE: Record<string, { usage: number; member: string }> = {
  OtherWorkSite: { usage: 8, member: "m_pWorkType" }, Embankment: { usage: 2, member: "m_pDestLandType" }, MassExchange: { usage: 2, member: "m_pDestLandType" }, LandCut: { usage: 1, member: "m_pSourceLandType" },
};

/** Tipo de uma tarefa: o dado, o atual (atualização) ou o único com a adequação; senão decisão. */
function pickType(ctx: Ctx, o: O, key: "type" | "destination_type", pool: "source_type" | "destination_type" | "task_type", suit: number | undefined, path: string, taskName: string): Entity | undefined {
  if (o[key] !== undefined) {
    const t = ctx.ref("type", o[key], `${path}.${key}`);
    const want = { source_type: "SourceLandType", destination_type: "DestLandType", task_type: "WorkType" }[pool];
    if (t.className !== want || (suit !== undefined && num(t.get("m_nSuitabilityType")) !== suit)) {
      throw new CreateError("INVALID_SUITABILITY", `${path}.${key}: "${t.name}" cannot be used by a ${String(o.kind).replace("_", " ")}${suit !== undefined ? ` (needs a ${pool.replace("_", " ")} with suitability ${SUIT_LABEL[pool]![suit]})` : ""}`);
    }
    return t;
  }
  const cands = ctx.pool(pool).filter((t) => suit === undefined || num(t.get("m_nSuitabilityType")) === suit);
  if (cands.length === 1) {
    ctx.applied(`task ${key.replace("_", " ")}: the only ${pool.replace("_", " ")}${suit !== undefined ? ` with suitability ${SUIT_LABEL[pool]![suit]}` : ""}`, path, cands[0]!.name);
    return cands[0];
  }
  ctx.pend({
    path: `${path}.${key}`,
    question: cands.length
      ? `Which ${pool.replace("_", " ")} (material) is task "${taskName}"?`
      : `No ${pool.replace("_", " ")} with suitability ${suit !== undefined ? SUIT_LABEL[pool]![suit] : ""} exists for task "${taskName}": which material is it (a new type needs its unit, conversions, haul cost and suitable destinations)?`,
    ...(cands.length ? { options: cands.map((t) => t.name) } : {}),
  });
  return undefined;
}

interface WpPlan {
  spec: WorkPlaceSpec;
  extraSource?: number | undefined;
  extraDest?: number | undefined;
  start?: bigint | undefined;
  finish?: bigint | undefined;
}

function planWorkPlaces(ctx: Ctx, o: O, kind: TaskKind, path: string, taskName: string): WpPlan[] | undefined {
  const docs = arr(o, "work_places");
  if (!docs) return undefined;
  const locs = ctx.pool("location");
  return docs.map((w, j) => {
    const wpath = `${path}.work_places[${j}]`;
    let loc: Entity | undefined;
    if (w.location !== undefined) {
      loc = ctx.ref("location", w.location, `${wpath}.location`);
      if (ctx.pendingLocations.has(loc.name)) ctx.blockedBy(`the stations of "${loc.name}" are pending`);
    } else if (locs.length === 1) {
      loc = locs[0];
      if (ctx.pendingLocations.has(loc!.name)) ctx.blockedBy(`the stations of "${loc!.name}" are pending`);
      ctx.applied("work place location: the only location of the project", wpath, loc!.name);
    } else {
      ctx.pend({ path: `${wpath}.location`, question: `On which road line or area is task "${taskName}"${docs.length > 1 ? ` (part ${j + 1})` : ""}?`, options: locs.map((x) => x.name) });
    }
    const area = loc?.className === "Area";
    let sb = n(w, "station_begin"), se = n(w, "station_end");
    if (loc && (sb === undefined || se === undefined)) {
      if (area) {
        const sp = stationSpan(loc);
        sb ??= sp.min;
        se ??= sp.max;
        ctx.applied("area work place: stations 0…1 (areas have no stations)", wpath);
      } else {
        ctx.pend({ path: `${wpath}.station_begin/station_end`, question: `Between which stations of "${loc.name}" is task "${taskName}"${docs.length > 1 ? ` (part ${j + 1})` : ""}?` });
      }
    }
    if (n(w, "station_center") === undefined && sb !== undefined && se !== undefined) ctx.applied("work place center of gravity: midpoint", wpath);
    const q = n(w, "quantity"), sq = n(w, "source_quantity"), dq = n(w, "destination_quantity");
    const unlimited = kind === "crushing_plant" || kind === "stockpile";
    if (kind === "soil_replacement") {
      if (q === undefined && (sq === undefined || dq === undefined)) ctx.pend({ path: `${wpath}.quantity`, question: `How much is removed and placed by soil replacement "${taskName}"${docs.length > 1 ? ` (part ${j + 1})` : ""}?` });
    } else if (q === undefined) {
      if (unlimited) {
        ctx.applied(`${kind.replace("_", " ")} capacity 0 = unlimited`, wpath);
        ctx.decide({ path: `${wpath}.quantity`, question: `What is the capacity of ${kind.replace("_", " ")} "${taskName}"? 0 means unlimited.`, default: 0, blocking: false });
      } else {
        const what = kind === "borrow_pit" ? "the usable volume of borrow pit" : kind === "disposal_area" ? "the capacity of disposal area" : kind === "task" ? "the quantity of task" : "the quantity of";
        ctx.pend({ path: `${wpath}.quantity`, question: `What is ${what} "${taskName}"${docs.length > 1 ? ` (part ${j + 1})` : ""}, in the unit of its type?` });
      }
    }
    const plan: WpPlan = {
      spec: {
        ...(loc ? { location: loc } : {}), begin: sb, center: n(w, "station_center"), end: se, distance: n(w, "distance"),
        quantity: q ?? (kind === "soil_replacement" ? undefined : 0), source: kind === "soil_replacement" ? sq : undefined, destination: kind === "soil_replacement" ? dq : undefined,
      },
      start: date(w, "start", wpath), finish: date(w, "finish", wpath),
    };
    if (kind !== "soil_replacement") {
      if (sq !== undefined) plan.extraSource = sq;
      if (dq !== undefined) plan.extraDest = dq;
    }
    return plan;
  });
}

/** Valida e grava um local de tarefa existente (mesmas regras de `Location@009ba990`, create.ts) [O]. */
function updateLocation(ctx: Ctx, wp: Entity, w: WorkPlaceSpec): void {
  const p = ctx.p;
  const loc = p.resolve(asRef(wp.get("m_pLocation")))!;
  const rl = w.location ?? p.get(loc.get("m_pRoadLine") as bigint)!;
  const sp = stationSpan(rl);
  const bb = w.begin ?? sp.min, ee = w.end ?? sp.max, c = w.center ?? (bb + ee) * 0.5, d = w.distance ?? 0;
  if (bb === ee) throw new CreateError("ZERO_LENGTH_LOCATION");
  if (bb > ee) throw new CreateError("BEGIN_STATION_GREATER_THAN_END_STATION");
  if (c > ee) throw new CreateError("CENTER_STATION_GREATER_THAN_END_STATION");
  if (c < bb) throw new CreateError("CENTER_STATION_SMALLER_THAN_BEGIN_STATION");
  if (bb < sp.min) throw new CreateError("BEGIN_STATION_SMALLER_THAN_LOCATION_BEGIN_STATION");
  if (ee > sp.max) throw new CreateError("END_STATION_GREATER_THAN_LOCATION_END_STATION");
  if (d < 0) throw new CreateError("DISTANCE_CANNOT_BE_NEGATIVE");
  loc.set("m_pRoadLine", rl.oid);
  loc.set("m_dStationBegin", bb);
  loc.set("m_dStationCOG", c);
  loc.set("m_dStationEnd", ee);
  loc.set("m_dDistance", d);
}

function setAmounts(t: Entity, wp: Entity, plan: WpPlan): void {
  const w = plan.spec, cls = t.className;
  const q = w.quantity ?? 0;
  for (const v of [w.quantity, w.source, w.destination, plan.extraSource, plan.extraDest]) if (v !== undefined && !(v >= 0)) throw new CreateError("NEGATIVE_AMOUNT");
  if (cls === "OtherWorkSite") wp.set("m_dAmount", q);
  else if (cls === "MassExchange") {
    wp.set("m_dSourceAmount", w.source ?? q);
    wp.set("m_dDestinationAmount", w.destination ?? q);
  } else {
    const src = ["LandCut", "BorrowPit"].includes(cls);
    wp.set(src ? "m_dSourceAmount" : "m_dDestinationAmount", q);
    if (plan.extraSource !== undefined) wp.set("m_dSourceAmount", plan.extraSource);
    if (plan.extraDest !== undefined) wp.set("m_dDestinationAmount", plan.extraDest);
  }
}

/** Troca os work places de uma tarefa existente: atualiza no lugar, remove os que sobram, acrescenta os novos. */
function replaceWorkPlaces(ctx: Ctx, t: Entity, plans: WpPlan[]): void {
  const p = ctx.p;
  const old = workPlacesOf(p, t);
  plans.forEach((pl, k) => {
    if (k < old.length) {
      updateLocation(ctx, old[k]!, pl.spec);
      setAmounts(t, old[k]!, pl);
    }
  });
  if (old.length > plans.length) removeObjects(p, old.slice(plans.length));
  for (const pl of plans.slice(old.length)) addTaskLocation(p, t, pl.spec);
  // ordem e cruzamento (WorkSite::AddWorkPlace: lista ordenada, sem cruzar) [O/I]
  const span = (w: Entity) => {
    const l = p.resolve(asRef(w.get("m_pLocation")))!;
    return { rl: l.get("m_pRoadLine") as bigint, b: num(l.get("m_dStationBegin")) ?? 0, e: num(l.get("m_dStationEnd")) ?? 0 };
  };
  const now = workPlacesOf(p, t).sort((a, c) => {
    const x = span(a), y = span(c);
    return x.rl === y.rl ? x.b - y.b : x.rl < y.rl ? -1 : 1;
  });
  for (let i = 1; i < now.length; i++) {
    const x = span(now[i - 1]!), y = span(now[i]!);
    if (x.rl === y.rl && y.b < x.e) throw new CreateError("WORK_PLACES_CANNOT_INTERSECT");
  }
  t.setRaw("m_vpWorkPlaces", refList(now.map((w) => w.oid)));
}

/** Work place criado/atualizado para cada plano (a lista da tarefa é ordenada por local e estaca). */
function matchWorkPlaces(ctx: Ctx, t: Entity, plans: WpPlan[]): (Entity | undefined)[] {
  const p = ctx.p;
  const wps = workPlacesOf(p, t);
  return plans.map((pl) => wps.find((w) => {
    const l = p.resolve(asRef(w.get("m_pLocation")))!;
    const rl = pl.spec.location?.oid ?? (l.get("m_pRoadLine") as bigint);
    return l.get("m_pRoadLine") === rl && num(l.get("m_dStationBegin")) === (pl.spec.begin ?? stationSpan(p.get(rl)!).min);
  }));
}

function buildTask(ctx: Ctx, o: O, path: string): void {
  const p = ctx.p;
  const kind = o.kind as TaskKind;
  const cls = TASK_KINDS[kind];
  const name = s(o, "name");
  const label = name ?? `(${kind.replace("_", " ")} ${path})`;
  const cur = name ? ctx.find("task", name, path) : undefined;
  if (cur && cur.className !== cls) throw new ObraError([`${path}: task "${name}" exists as a ${cur.className}; remove it first (remove: [{kind: "task", name}])`]);
  const need = NEED[kind];
  // tipos
  let type: Entity | undefined, destType: Entity | undefined;
  if (!cur || o.type !== undefined) type = pickType(ctx, o, "type", need.pool, need.suit, path, label);
  if (kind === "soil_replacement" && (!cur || o.destination_type !== undefined)) destType = pickType(ctx, o, "destination_type", "destination_type", need.dest, path, label);
  // locais e quantidades
  let plans = planWorkPlaces(ctx, o, kind, path, label);
  if (!plans && !cur) {
    ctx.pend({ path: `${path}.work_places`, question: `Where is task "${label}" (road line or area, start and finish stations) and what is its quantity?` });
    plans = [];
  }
  // equipe no modo Schedule: tarefa estrita com quantidade precisa de equipe com taxa para o tipo
  const mu = MAIN_USAGE[cls];
  const crewsDoc = (o.crews ?? {}) as Record<string, string | null>;
  if (!cur && ctx.finalMode !== 0 && mu && type && STRICT_CLASSES.has(cls)) {
    const mainType = mu.member === "m_pDestLandType" && destType ? destType : type;
    const given = crewsDoc[USAGE_NAMES[mu.usage]!];
    const qty = (plans ?? []).some((pl) => (pl.spec.quantity ?? pl.spec.destination ?? 0) > 0);
    const rated = ctx.pool("crew").filter((g) => pairs(g.get("m_rates")).some(([k]) => k === mainType.oid));
    if (given === undefined && qty && rated.length === 0) {
      ctx.pend({
        path: `${path}.crews.${USAGE_NAMES[mu.usage]}`,
        question: `In the schedule, which crew does task "${label}" use and at what production rate (quantity per hour) for type "${mainType.name}"? No crew has a rate for it, so the task would get no duration.`,
      });
    }
  }
  ctx.checkpoint();
  // criação ou atualização
  const sumTask = o.sum_task !== undefined ? ctx.ref("sum_task", o.sum_task, `${path}.sum_task`) : undefined;
  let t: Entity;
  if (cur) {
    t = cur;
    if (type) t.set(kind === "task" ? "m_pWorkType" : need.pool === "source_type" ? "m_pSourceLandType" : "m_pDestLandType", type.oid);
    if (destType) t.set("m_pDestLandType", destType.oid);
    if (sumTask) setTaskSumTask(p, t, sumTask);
    if (s(o, "description") !== undefined) t.set("m_strLongName", s(o, "description")!);
    if (plans) replaceWorkPlaces(ctx, t, plans);
    ctx.count("updated", "tasks");
  } else {
    if (!sumTask) ctx.applied("task parent sum task: the root", path, rootSumTask(p).name);
    if (!name) ctx.applied("task name: automatic '<type> [road line] N'", path);
    t = addTask(p, { kind, type, destType, sumTask: sumTask ?? rootSumTask(p), name, longName: s(o, "description"), comment: s(o, "comment"), workPlaces: plans!.map((pl) => pl.spec) });
    ctx.count("created", "tasks");
    ctx.count("created", "work_places", plans!.length);
    if (["borrow_pit", "disposal_area", "crushing_plant", "stockpile"].includes(kind) && s(o, "start") === undefined) ctx.applied("operating window: project start to deadline", path);
  }
  // quantidades fora da regra de addTask e datas exatas
  const wpOf = matchWorkPlaces(ctx, t, plans ?? []);
  (plans ?? []).forEach((pl, j) => {
    const wp = wpOf[j];
    if (!wp) return;
    if (!cur && (pl.extraSource !== undefined || pl.extraDest !== undefined)) setAmounts(t, wp, pl);
    if (pl.start !== undefined || pl.finish !== undefined) ctx.exactDates.push({ wp, ...(pl.start !== undefined ? { start: pl.start } : {}), ...(pl.finish !== undefined ? { finish: pl.finish } : {}) });
  });
  // atributos
  if (o.calendar !== undefined) {
    t.set("m_pCalendar", ctx.ref("calendar", o.calendar, `${path}.calendar`).oid);
    t.set("m_bUseDefaultCalendar", false);
  }
  const setIf = (k: string, member: string, conv: (v: never) => unknown = (v) => v) => {
    if (o[k] === undefined) return;
    if (!t.members().includes(member)) throw new ObraError([`${path}.${k}: not applicable to a ${kind.replace("_", " ")}`]);
    t.set(member, conv(o[k] as never) as never);
  };
  if (n(o, "rate_coefficient") !== undefined && !(n(o, "rate_coefficient")! > 0)) throw new CreateError("PRODUCTION_RATE_COEFFICIENT_LESS_THAN_OR_EQUAL_ZERO");
  setIf("rate_coefficient", "m_dWachCoeff");
  setIf("priority", "m_nSchedulingPriority");
  setIf("asap", "m_bASAP");
  setIf("start_side", "m_bLow", (v: string) => v !== "high");
  setIf("start_at_beginning_of_day", "m_nStartTimeType", (v: boolean) => (v ? 1 : 0));
  setIf("derive_predecessors_from_types", "m_bDerivePredecessorsFromTypes");
  if (o.local_stockpile !== undefined || o.local_stockpile_extra_days !== undefined) {
    if (!LOCAL_STOCKPILE_DEFAULT[cls]) throw new ObraError([`${path}: local stockpiles exist only on cuts, fills and crushing plants`]);
  }
  setIf("local_stockpile", "m_bLocalStockPile");
  setIf("local_stockpile_extra_days", "m_nLocalStockPileExtraDays");
  setIf("must_use", "m_bMustUse");
  setIf("must_fill", "m_bMustFill");
  setIf("delivery_contract", "m_bDeliveryContract");
  setIf("source_unit_price", "m_dSourceUnitPrice");
  setIf("destination_unit_price", "m_dDestinationUnitPrice");
  if (s(o, "comment") !== undefined) t.set("m_strComment", s(o, "comment")!);
  if (b(o, "auto_name") !== undefined) t.set("m_bAutoName", b(o, "auto_name")!);
  for (const [k, typeKey, dateKey] of [["start_constraint", "m_forcedBeginConstraint", "m_forcedBeginDate"], ["finish_constraint", "m_forcedEndConstraint", "m_forcedEndDate"]] as const) {
    const c = o[k] as O | undefined;
    if (!c) continue;
    const v = date(c, "date", `${path}.${k}`)!;
    t.set(typeKey, c.type === "exact" ? 2 : 1);
    t.set(dateKey, v);
  }
  // equipes por uso (aba Resources do diálogo da tarefa, `setTaskCrew`)
  for (const [u, g] of Object.entries(crewsDoc)) {
    const usage = USAGE_BY_NAME[u as keyof typeof USAGE_BY_NAME];
    if (!usagesOf(t).includes(usage)) throw new ObraError([`${path}.crews.${u}: a ${kind.replace("_", " ")} has no '${u}' crew (it has ${usagesOf(t).map((x) => USAGE_NAMES[x]).join(", ")})`]);
    const crew = g === null ? p.resolve(asRef(projectRoot(p).get("m_pNullWorkGroup")))! : ctx.ref("crew", g, `${path}.crews.${u}`);
    setTaskCrew(p, t, crew, usage);
  }
  if (!cur) {
    for (const [u, g] of pairs(t.get("m_cSelectedSubWorkGroups"))) {
      const un = USAGE_NAMES[num(u) ?? 0];
      if (!un || crewsDoc[un] !== undefined) continue;
      const ge = p.resolve(asRef(g));
      ctx.applied(`task ${un} crew: the first crew with a production rate for the task's type, else no crew`, path, !ge || ge.className === "NullWorkGroup" ? "no crew" : ge.name);
    }
  }
  ctx.applyFields(t, o.fields, path);
  // datas da tarefa (aplicadas no fim, depois de todas as tarefas e dependências)
  const start = date(o, "start", path), finish = date(o, "finish", path);
  if (finish !== undefined && STRICT_CLASSES.has(cls)) throw new ObraError([`${path}.finish: only borrow pits, disposal areas, stockpiles and crushing plants have a finish; the others get it from quantity and rate`]);
  if (start !== undefined || finish !== undefined) ctx.taskDates.push({ task: t, path, ...(start !== undefined ? { start } : {}), ...(finish !== undefined ? { finish } : {}) });
  ctx.tasksByPath.set(path, t);
}

export function buildTasks(ctx: Ctx): void {
  (arr(ctx.doc, "tasks") ?? []).forEach((o, i) => {
    const path = `tasks[${i}]`;
    ctx.item(path, "task", s(o, "name"), () => buildTask(ctx, o, path));
  });
}

const DEP_NAMES = Object.keys(DEPENDENCY_TYPES) as (keyof typeof DEPENDENCY_TYPES)[];

export function buildDependencies(ctx: Ctx): void {
  const p = ctx.p;
  const dm = p.resolve(asRef(projectRoot(p).get("m_pDependencyManager")));
  // cada dependência existente casa com uma só entrada do documento: duas entradas iguais = duas dependências [P]
  const used = new Set<bigint>();
  (arr(ctx.doc, "dependencies") ?? []).forEach((o, i) => {
    const path = `dependencies[${i}]`;
    ctx.item(path, "dependency", undefined, () => {
      const pred = ctx.ref("task", o.predecessor, `${path}.predecessor`), succ = ctx.ref("task", o.successor, `${path}.successor`);
      const typeName = (s(o, "type") ?? "finish_start") as keyof typeof DEPENDENCY_TYPES;
      if (!DEP_NAMES.includes(typeName)) throw new ObraError([`${path}.type: one of ${DEP_NAMES.join(", ")}`]);
      if (o.type === undefined) ctx.applied("dependency type finish_start", path);
      const min = o.min_delay_days === null ? null : n(o, "min_delay_days") ?? 0;
      if (o.min_delay_days === undefined) ctx.applied("dependency minimum delay 0 calendar days, no maximum", path);
      const max = o.max_delay_days === undefined || o.max_delay_days === null ? null : n(o, "max_delay_days")!;
      const args = { hasMinDelay: min !== null, minDelay: min ?? 0, hasMaxDelay: max !== null, maxDelay: max ?? 0, workDays: b(o, "work_days") ?? false };
      const cur = refs(dm?.get("m_vDependencies")).map((x) => p.get(x)).find((d) => d && !used.has(d.oid) && d.get("m_bUserGenerated") === true && d.get("m_pPredecessor") === pred.oid && d.get("m_pSuccessor") === succ.oid);
      if (cur) {
        used.add(cur.oid);
        if (args.hasMaxDelay && args.hasMinDelay && args.minDelay > args.maxDelay) throw new CreateError("MIN_DELAY_GREATER_THAN_MAX_DELAY");
        cur.set("m_nType", DEPENDENCY_TYPES[typeName]);
        cur.set("m_bHasMinDelay", args.hasMinDelay);
        cur.set("m_nDelayMin", args.minDelay);
        cur.set("m_bHasMaxDelay", args.hasMaxDelay);
        cur.set("m_nDelayMax", args.maxDelay);
        cur.set("m_bIsDelayWorkDays", args.workDays);
        ctx.applyFields(cur, o.fields, path);
        ctx.count("updated", "dependencies");
        return;
      }
      const d = addDependency(p, pred, succ, DEPENDENCY_TYPES[typeName], args);
      used.add(d.oid);
      ctx.applyFields(d, o.fields, path);
      ctx.count("created", "dependencies");
    });
  });
}

export function buildFilters(ctx: Ctx): void {
  const p = ctx.p;
  const tasks = (o: O, k: string, path: string) => strs(o, k)?.map((x, j) => ctx.ref("task", x, `${path}.${k}[${j}]`));
  const ents = (o: O, k: string, kind: "type" | "resource", path: string) => strs(o, k)?.map((x, j) => ctx.ref(kind, x, `${path}.${k}[${j}]`));
  const container = (es: Entity[]): FieldValue => refList(es.map((e) => e.oid));
  (arr(ctx.doc, "milestones") ?? []).forEach((o, i) => {
    const path = `milestones[${i}]`;
    ctx.item(path, "milestone", s(o, "name"), () => {
      const from = date(o, "from", path), to = date(o, "to", path);
      const inc = tasks(o, "tasks", path), exc = tasks(o, "excluded_tasks", path), ty = ents(o, "types", "type", path), rs = ents(o, "resources", "resource", path);
      let m = ctx.find("milestone", s(o, "name")!, path);
      if (m) {
        if (s(o, "description") !== undefined) m.set("m_strLongName", s(o, "description")!);
        if (from !== undefined) m.set("m_beginDate", from);
        if (to !== undefined) m.set("m_endDate", to);
        if (inc) m.setRaw("m_spIncludedWorkSites", container(inc));
        ctx.count("updated", "milestones");
      } else {
        if (from === undefined || to === undefined) ctx.applied("milestone window: the whole project", path);
        m = addMilestone(p, { name: s(o, "name"), longName: s(o, "description"), begin: from, end: to, tasks: inc });
        ctx.count("created", "milestones");
      }
      if (exc) m.setRaw("m_spExcludedWorkSites", container(exc));
      if (ty) {
        m.setRaw("m_spWorkSiteTypes", container(ty));
        m.set("m_bWorkSiteTypeFilteringEnabled", true);
      }
      if (rs) {
        m.setRaw("m_spResources", container(rs));
        m.set("m_bResourceFilteringEnabled", true);
      }
      ctx.applyFields(m, o.fields, path);
    });
  });
  (arr(ctx.doc, "view_filters") ?? []).forEach((o, i) => {
    const path = `view_filters[${i}]`;
    ctx.item(path, "view_filter", s(o, "name"), () => {
      const inc = tasks(o, "tasks", path), ty = ents(o, "types", "type", path), rs = ents(o, "resources", "resource", path);
      const f = ctx.find("view_filter", s(o, "name")!, path);
      if (f) {
        if (s(o, "description") !== undefined) f.set("m_strLongName", s(o, "description")!);
        if (inc) f.setRaw("m_spIncludedWorkSites", container(inc));
        if (ty) f.setRaw("m_spWorkSiteTypes", container(ty));
        if (rs) f.setRaw("m_spResources", container(rs));
        ctx.count("updated", "view_filters");
      } else {
        addViewFilter(p, { name: s(o, "name"), longName: s(o, "description"), tasks: inc, types: ty, resources: rs });
        ctx.count("created", "view_filters");
      }
    });
  });
}

/**
 * Datas pedidas: primeiro as da tarefa (`WorkSite::SetBeginTime/SetEndTime`, que recalculam o cronograma como o
 * gesto na visão), depois as exatas dos work places, gravadas como dadas e sem recálculo (o estado exportado).
 */
export function applyDates(ctx: Ctx): void {
  const p = ctx.p;
  for (const d of ctx.taskDates) {
    ctx.item(d.path, "task", undefined, () => {
      try {
        if (d.start !== undefined) setBeginTime(p, d.task, Number(d.start));
        if (d.finish !== undefined) setEndTime(p, d.task, Number(d.finish));
      } catch (e) {
        if (e instanceof TimingEditError) throw new CreateError("BEGIN_TIME_GREATER_THAN_END_TIME", "start/finish");
        throw e;
      }
    });
  }
  for (const d of ctx.exactDates) {
    const start = d.start ?? (d.wp.get("pDVar2") as bigint | undefined), finish = d.finish ?? (d.wp.get("m_endTime") as bigint | undefined);
    if (start !== undefined && finish !== undefined && finish < start) throw new ObraError([`work place of "${p.get(d.wp.get("m_pWorkSite") as bigint)?.name}": finish before start`]);
    if (d.start !== undefined) d.wp.set("pDVar2", d.start);
    if (d.finish !== undefined) d.wp.set("m_endTime", d.finish);
  }
}
