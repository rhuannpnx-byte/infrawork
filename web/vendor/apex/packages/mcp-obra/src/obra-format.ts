/**
 * Formato dos dados da obra `apex-obra/1` (D-024, U-24): o que um LLM monta a partir dos dados do usuário e entrega a
 * `build_project`, e o que `export_obra` devolve. Dados puros (o relé os serve sem o app): esquema JSON, exemplo
 * compacto, regras e um validador do subconjunto de JSON Schema usado aqui (o app valida a entrada com ele, então a
 * documentação e a validação são o mesmo objeto).
 *
 * Desenho [P] (decisões de projeto do ApeX, registradas no relatório da U-24):
 * - objetos referenciados pelo NOME (nunca por oid); seções na ordem de criação de `montagem_obra.md` §4;
 * - `base: "current"` (padrão): atualiza o projeto aberto por nome (mesmo nome atualiza, nome novo cria, `remove`
 *   apaga explicitamente); depois de `new_project` o projeto aberto é o modelo padrão, cujos tipos, equipes, custos,
 *   calendário e recursos ficam disponíveis por nome, como no original (o projeto novo parte de um template, §1);
 * - `base: "empty"`: o projeto aberto é esvaziado antes (fica só o que todo projeto tem: linha principal, sum task
 *   raiz, as quatro unidades de massa, calendário padrão); é o que `export_obra` usa, para a volta ser sem perdas
 *   qualquer que seja o projeto aberto;
 * - campos que o original preenche sozinho (§5) são opcionais e a montagem informa os padrões aplicados; dados sem
 *   padrão (§6) faltando viram decisões pendentes;
 * - `fields`: saída de emergência por objeto, membro → valor na codificação de `get_objects` (sem referências).
 *
 * Textos em inglês (vocabulário do original), como o restante do catálogo. Nenhum nome do produto original aqui.
 */
import type { JsonSchema } from "./catalog.js";

export const OBRA_FORMAT = "apex-obra/1";

const S = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: "string", description, ...extra });
const N = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: "number", description, ...extra });
const I = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: "integer", description, ...extra });
const B = (description: string): JsonSchema => ({ type: "boolean", description });
const A = (items: JsonSchema, description: string): JsonSchema => ({ type: "array", items, description });
const O = (properties: Record<string, JsonSchema>, required: string[] = [], description?: string): JsonSchema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
  ...(description ? { description } : {}),
});
const NAME = S("Name shown in ApeX; other objects refer to this object by it. Unique within its kind.", { minLength: 1 } as Partial<JsonSchema>);
const DESC = S("Long name / description.");
const DATE = (what: string) => S(`${what}: "YYYY-MM-DD" (a whole day) or "YYYY-MM-DD hh:mm[:ss]".`);
const REF = (what: string) => S(`${what} (name).`);
const NUM_MAP = (description: string): JsonSchema => ({ type: "object", additionalProperties: { type: "number" }, description });
const FIELDS: JsonSchema = {
  type: "object",
  additionalProperties: true,
  description: "Escape hatch: member name → value in the get_objects encoding, applied after the named keys. Scalars only (no {\"ref\":…}); use it only for members the named keys do not cover (see get_class_schema).",
};
const WEEK: JsonSchema = {
  type: "array",
  minItems: 7,
  maxItems: 7,
  items: O({ start: S("Start of the working day, \"hh:mm\"."), hours: N("Working hours (0 = day off).", { minimum: 0, maximum: 24 }) }, ["start", "hours"]),
  description: "Monday … Sunday.",
};
const LIMITS = A(O({ sum_task: REF("Sum task (zone) the limit applies to"), max: N("Maximum number used at the same time", { minimum: 0 }) }, ["sum_task", "max"]), "Usage limits per sum task (resource leveling).");
const PLACE = O({ location: REF("Road line or area"), station: N("Station on it (areas span 0…1)") }, ["location", "station"]);

const WORK_PLACE = O({
  location: REF("Road line or area of this part. Required when the project has more than one location"),
  station_begin: N("Start station. Required on road lines (areas: default 0)."),
  station_center: N("Center of gravity of the mass (default: midpoint)."),
  station_end: N("Finish station. Required on road lines (areas: default 1)."),
  distance: N("Offset from the road line to the work place, in length units (default 0).", { minimum: 0 }),
  quantity: N("Quantity in the unit of the task's type: cut volume (cut, borrow pit), fill volume (fill, disposal area), capacity (stockpile, crushing plant: 0 = unlimited), amount (task). Required except for stockpiles and crushing plants.", { minimum: 0 }),
  source_quantity: N("Soil replacement: quantity removed (default: quantity).", { minimum: 0 }),
  destination_quantity: N("Soil replacement: quantity placed (default: quantity).", { minimum: 0 }),
  start: DATE("Exact start of this part (normally omitted: ApeX schedules it)"),
  finish: DATE("Exact finish of this part (normally omitted)"),
});

const TASK = O({
  kind: S("Task kind.", { enum: ["cut", "fill", "soil_replacement", "borrow_pit", "disposal_area", "crushing_plant", "stockpile", "task"] }),
  name: S("Task name (default: automatic '<type> [road line] N'). Needed when dependencies or milestones refer to the task."),
  description: DESC,
  type: REF("Source type (cut, borrow pit, soil replacement), destination type (fill, disposal area, stockpile, crushing plant) or task type (task)"),
  destination_type: REF("Soil replacement only: destination type"),
  sum_task: REF("Parent sum task (default: the root)"),
  calendar: REF("Calendar of the task (default: the project's default calendar)"),
  work_places: { ...A(WORK_PLACE, "Parts of the task along stations (they may not overlap). Only cut, fill, soil replacement and task accept more than one."), minItems: 1 },
  crews: O({ send: { type: ["string", "null"], description: "Crew that excavates/loads (cut, borrow pit, soil replacement, crushing plant, stockpile); null = no crew." }, receive: { type: ["string", "null"], description: "Crew that places (fill, disposal area, soil replacement, crushing plant, stockpile)." }, other: { type: ["string", "null"], description: "Crew of a task (other work)." } }, [], "Crew per usage (default: the first crew with a production rate for the task's type, else no crew)."),
  rate_coefficient: N("Multiplier of the crew's production rate (default 1.0).", { exclusiveMinimum: 0 } as Partial<JsonSchema>),
  priority: I("Scheduling priority, higher first (default 500).", { minimum: 0 }),
  asap: B("Schedule as soon as possible (default false: keeps its start)."),
  start_side: S("Station where the work starts (default low).", { enum: ["low", "high"] }),
  start_at_beginning_of_day: B("Start at the beginning of a working day (default false)."),
  start: DATE("Planned start (default: project start). For borrow pits, disposal areas, stockpiles and crushing plants: start of the operating window"),
  finish: DATE("Borrow pits, disposal areas, stockpiles and crushing plants: end of the operating window (default: deadline)"),
  start_constraint: O({ type: S("earliest = no earlier than; exact = exactly at.", { enum: ["earliest", "exact"] }), date: DATE("Date") }, ["type", "date"]),
  finish_constraint: O({ type: S("latest = no later than; exact = exactly at.", { enum: ["latest", "exact"] }), date: DATE("Date") }, ["type", "date"]),
  derive_predecessors_from_types: B("Create automatic by-stations dependencies from type dependencies (default true)."),
  local_stockpile: B("Use a local stockpile (default false; crushing plants: true)."),
  local_stockpile_extra_days: I("Extra days of the local stockpile (default 5; crushing plants: 0).", { minimum: 0 }),
  must_use: B("Borrow pit: its quantity must be used (default false)."),
  must_fill: B("Disposal area: its quantity must be filled (default false)."),
  delivery_contract: B("Borrow pit: material delivered by contract (default false)."),
  source_unit_price: N("Cost per unit at the source side (default 0).", { minimum: 0 }),
  destination_unit_price: N("Cost per unit at the destination side (default 0).", { minimum: 0 }),
  auto_name: B("Keep the name automatic (renamed when type or road line change). Default: false when a name is given."),
  comment: S("Comment."),
  fields: FIELDS,
}, ["kind"]);

/** Esquema JSON do documento `apex-obra/1`. */
export const OBRA_SCHEMA: JsonSchema & { type: "object" } = {
  type: "object",
  description: "ApeX project data (\"obra\"): everything needed to build a project, by name.",
  required: ["format"],
  additionalProperties: false,
  properties: {
    format: S(`Always "${OBRA_FORMAT}".`, { enum: [OBRA_FORMAT] }),
    base: S("current (default): update the open project by name — same name updates, new name creates. empty: clear the open project first (keeps only the main road line, root sum task, the four mass units and the default calendar).", { enum: ["current", "empty"] }),
    remove: A(O({
      kind: S("Kind of object.", { enum: ["task", "sum_task", "road_line", "area", "intersection", "usage_break", "source_type", "destination_type", "task_type", "unit", "haul_cost", "calendar", "resource", "haul_resource", "crew", "milestone", "view_filter", "dependency"] }),
      name: S("Name (dependency: not used)."),
      predecessor: S("Dependency: predecessor task."),
      successor: S("Dependency: successor task."),
    }, ["kind"]), "base current only: objects to remove first, with the original's cascade (e.g. a type takes its tasks along)."),
    notes: A({ type: "string" }, "Free notes (ignored by the build; export_obra lists here what it could not export)."),
    project: O({
      name: S("Project name."), description: DESC, client: S("Client."), planner: S("Planner."),
      start_date: DATE("Project start"), deadline: DATE("Project deadline"),
      mode: S("plan (hauls without time), schedule (hauls and schedule) or control (actuals).", { enum: ["plan", "schedule", "control"] }),
      currency: S("Currency sign, e.g. \"BRL\"."), length_unit: S("Length unit, e.g. \"m\"."),
      control_date: DATE("Control date (control mode)"),
      default_calendar: REF("Default calendar"),
      main_road_line: O({ name: S("Name of the main road line."), description: DESC, station_begin: I("Start station (integer)."), station_end: I("Finish station (integer)."), width: N("Road width.", { minimum: 0 }), fields: FIELDS }),
      root_sum_task: O({ name: S("Name of the root sum task (the project in the WBS)."), description: DESC, construction_zone: B("Mass economy area (default true for the root)."), prevent_external_hauls: B(""), lock_internal_timing: B(""), comment: S("") }),
      fields: FIELDS,
    }),
    units: O({
      cut: O({ name: NAME, description: DESC }, ["name"], "Unit of cut (solid) volumes, e.g. bcm."),
      fill: O({ name: NAME, description: DESC }, ["name"], "Unit of fill (compacted) volumes, e.g. ccm."),
      crush: O({ name: NAME, description: DESC }, ["name"], "Unit of crushing, e.g. t."),
      haul: O({ name: NAME, description: DESC }, ["name"], "Unit of hauled (loose) volumes, e.g. lcm."),
      other: A(O({ name: NAME, description: DESC }, ["name"]), "Other units (m2, d, …)."),
    }, [], "The four mass units always exist and are renamed here; other units are created."),
    haul_costs: A(O({ name: NAME, description: DESC, unit: REF("Unit the price refers to (default: cut unit)"), points: A({ type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, "[[distance, price per unit], …], interpolated linearly."), fields: FIELDS }, ["name"]), "Haul costs (price by haul distance)."),
    source_types: A(O({
      name: NAME, description: DESC,
      suitability: S("Which task kind may use it.", { enum: ["cut", "soil_replacement", "borrow_pit"] }),
      unit: REF("Unit (default: cut unit)"),
      haul_cost: REF("Haul cost"),
      conversions: NUM_MAP("Unit name → factor: 1 unit of this type = factor × that unit (default 1.0 for the mass units)."),
      suitable_destinations: A({ type: "string" }, "Destination types this material may be hauled to (sets both sides)."),
      processed_types: A({ type: "string" }, "Source types a crushing plant makes from it."),
      processing_costs: NUM_MAP("Destination type name → processing cost per unit."),
      max_haul_distance: N("Maximum haul distance (0 = no limit).", { minimum: 0 }),
      fields: FIELDS,
    }, ["name"]), "Materials produced by cuts and borrow pits."),
    destination_types: A(O({
      name: NAME, description: DESC,
      suitability: S("Which task kind may use it.", { enum: ["fill", "soil_replacement", "disposal_area", "stockpile", "crushing_plant"] }),
      unit: REF("Unit (default: fill unit)"),
      suitable_sources: A({ type: "string" }, "Source types it accepts (sets both sides)."),
      fields: FIELDS,
    }, ["name"]), "What fills, disposal areas, stockpiles and crushing plants receive."),
    task_types: A(O({ name: NAME, description: DESC, unit: REF("Unit (default: the last unit)"), fields: FIELDS }, ["name"]), "Types of other work (paving, bridges, …)."),
    type_dependencies: A(O({ predecessor: REF("Predecessor type"), successor: REF("Successor type"), delay_days: I("Delay in days (default 0).") }, ["predecessor", "successor"]), "Tasks of the successor type follow tasks of the predecessor type where they share stations."),
    calendars: A(O({
      name: NAME, description: DESC,
      week: WEEK,
      holidays: A(O({ name: S("Name."), from: DATE("First day"), to: DATE("Last day"), yearly: B("Repeats every year.") }, ["from", "to"]), "Non-working periods."),
      easter: A({ type: "string" }, "Names of Easter holiday generators."),
      weekday_holidays: A(O({ name: S("Name."), date: DATE("Date"), weekday: I("0 = Monday … 6 = Sunday", { minimum: 0, maximum: 6 }) }, ["date", "weekday"]), "Holidays on a given weekday."),
      exceptions: A(O({ name: S("Name."), from: DATE("First day"), to: DATE("Last day"), week: WEEK }, ["from", "to", "week"]), "Periods with other working hours."),
    }, ["name"]), "Calendars (schedule). A new calendar without week copies the first calendar."),
    resources: A(O({ name: NAME, description: DESC, hourly_cost: N("Cost per hour (default 0).", { minimum: 0 }), limits: LIMITS, fields: FIELDS }, ["name"]), "Machines and workers (schedule)."),
    haul_resources: A(O({
      name: NAME, description: DESC,
      capacity: N("Load capacity (> 0).", { exclusiveMinimum: 0 } as Partial<JsonSchema>),
      unit: REF("Mass unit of the capacity (default: haul unit)"),
      hourly_cost: N("Cost per hour (default 0).", { minimum: 0 }),
      rates: A({ type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, "[[haul distance, quantity per hour], …]."),
      limits: LIMITS,
      unsuitable_locations: A({ type: "string" }, "Road lines or areas it cannot drive on."),
      unsuitable_intersections: A({ type: "string" }, "Intersections it cannot use."),
      fields: FIELDS,
    }, ["name"]), "Trucks (schedule)."),
    crews: A(O({
      name: NAME, description: DESC,
      resources: A(O({ resource: REF("Resource"), count: N("How many", { minimum: 0 }) }, ["resource", "count"]), "Resources with counts (default: one of the project's first resource)."),
      rates: A(O({ type: REF("Type"), rate: N("Production rate, quantity per hour (> 0).", { exclusiveMinimum: 0 } as Partial<JsonSchema>), unit_cost: N("Cost per unit (default 0).", { minimum: 0 }) }, ["type", "rate"]), "Production rates per type."),
      price_calculation: { type: ["string", "integer"], description: "Cost basis: resources (hourly costs), quantities (unit costs), both, none; or the raw integer. Default both." },
      haul_resource: REF("Haul resource that carries its cut masses"),
      fields: FIELDS,
    }, ["name"]), "Crews (schedule): resources and production rates per type."),
    road_lines: A(O({ name: NAME, description: DESC, station_begin: I("Start station (integer)."), station_end: I("Finish station (integer)."), width: N("Road width.", { minimum: 0 }), parent_area: REF("Area it belongs to"), fields: FIELDS }, ["name"]), "Road lines other than the main one."),
    areas: A(O({ name: NAME, description: DESC, parent_area: REF("Parent area"), fields: FIELDS }, ["name"]), "Areas (locations without stations: pits, disposal sites, structures)."),
    intersections: A(O({
      name: S("Name (optional; needed to update or refer to the intersection later)."), description: DESC, from: PLACE, to: PLACE,
      length: N("Real driving length of the link, including detours.", { minimum: 0 }),
      bidirectional: B("Usable both ways (default true)."),
      open_from: DATE("Usable from (default: always)"), open_until: DATE("Usable until (default: always)"),
      fields: FIELDS,
    }, ["from", "to"]), "Haul route links between locations. Without them masses cannot move between road lines and areas."),
    usage_breaks: A(O({ name: NAME, description: DESC, location: REF("Road line (default: main)"), station_begin: I("Start station."), station_end: I("Finish station."), from: DATE("Start (default: project start)"), to: DATE("End (default: deadline)"), fields: FIELDS }, ["name"]), "Station ranges hauls cannot pass during a time window."),
    sum_tasks: A(O({ name: NAME, description: DESC, parent: REF("Parent sum task (default: root)"), construction_zone: B("Mass economy area: hauls are optimized inside it first (default false)."), prevent_external_hauls: B("No hauls across its border (default false)."), lock_internal_timing: B("Default false."), comment: S("Comment."), fields: FIELDS }, ["name"]), "WBS groups and construction zones."),
    tasks: A(TASK, "Cuts, fills, borrow pits, disposal areas, crushing plants, stockpiles and other work."),
    dependencies: A(O({
      predecessor: REF("Predecessor task"), successor: REF("Successor task"),
      type: S("Default finish_start.", { enum: ["finish_start", "start_start", "finish_finish", "start_finish", "by_stations"] }),
      min_delay_days: { type: ["integer", "null"], description: "Minimum delay in days (default 0; null = no minimum)." },
      max_delay_days: { type: ["integer", "null"], description: "Maximum delay in days (default: none)." },
      work_days: B("Delays in work days (default false: calendar days)."),
      fields: FIELDS,
    }, ["predecessor", "successor"]), "User dependencies between tasks."),
    milestones: A(O({
      name: NAME, description: DESC, from: DATE("Window start (default: project start)"), to: DATE("Milestone date / window end (default: deadline)"),
      tasks: A({ type: "string" }, "Tasks that must fit in the window."), excluded_tasks: A({ type: "string" }, "Tasks excluded."),
      types: A({ type: "string" }, "Include tasks of these types."), resources: A({ type: "string" }, "Include tasks using these resources."),
      fields: FIELDS,
    }, ["name"]), "Milestones (schedule)."),
    view_filters: A(O({ name: NAME, description: DESC, tasks: A({ type: "string" }, "Tasks."), types: A({ type: "string" }, "Types."), resources: A({ type: "string" }, "Resources.") }, ["name"]), "Named selections for views and reports."),
  },
};

/** Exemplo compacto (o que um LLM manda depois de `new_project`, sobre o modelo padrão). */
export const OBRA_EXAMPLE = {
  format: OBRA_FORMAT,
  project: { name: "BR-000 km 10–14", client: "DNIT", start_date: "2027-03-01", deadline: "2027-12-17", mode: "plan", currency: "BRL", length_unit: "m", main_road_line: { name: "Main road line", station_begin: 0, station_end: 4000 } },
  haul_costs: [{ name: "Soil BR", unit: "bcm", points: [[0, 0], [500, 1.2], [2000, 2.5]] }],
  source_types: [
    { name: "Soil 1st cat.", suitability: "cut", haul_cost: "Soil BR", conversions: { ccm: 0.85, lcm: 1.25 }, suitable_destinations: ["Landfill", "Land Disposal"] },
    { name: "Borrow soil", suitability: "borrow_pit", haul_cost: "Soil BR", conversions: { ccm: 0.9 }, suitable_destinations: ["Landfill"] },
  ],
  areas: [{ name: "Borrow pit A" }],
  intersections: [{ name: "Access A", from: { location: "Main road line", station: 2500 }, to: { location: "Borrow pit A", station: 0.5 }, length: 800 }],
  tasks: [
    { kind: "cut", name: "Cut 0+000", type: "Soil 1st cat.", work_places: [{ location: "Main road line", station_begin: 0, station_end: 600, quantity: 45000 }] },
    { kind: "fill", name: "Fill 0+600", type: "Landfill", work_places: [{ location: "Main road line", station_begin: 600, station_end: 1400, quantity: 52000 }] },
    { kind: "borrow_pit", name: "Pit A", type: "Borrow soil", work_places: [{ location: "Borrow pit A", quantity: 30000 }] },
  ],
  dependencies: [{ predecessor: "Cut 0+000", successor: "Fill 0+600", type: "start_start", min_delay_days: 5 }],
};

/** Regras do formato (vão no `get_obra_format` e no recurso `apex://obra/format`). */
export const OBRA_RULES: readonly string[] = [
  `Send one JSON object with "format": "${OBRA_FORMAT}". Sections are optional; give them in the order of the schema (it is the creation order). Unknown keys are refused.`,
  "Objects refer to each other by name, never by oid. Names must be unique within their kind. A type name that exists in two kinds can be written \"source:<name>\", \"destination:<name>\" or \"task:<name>\".",
  "base \"current\" (default) updates the open project: an object with an existing name is updated (only the keys you give change; lists you give replace the old list), a new name creates the object, \"remove\" deletes first. After new_project the open project is the default template: its units (bcm, ccm, t, lcm, m2, d), haul costs (Earth, Rock, Aggregate), source and destination types, task types, calendar, resources, haul resources and crews can be used by name (read them with get_project_summary / read_sheet).",
  "base \"empty\" clears the open project first; export_obra uses it so that building an exported obra reproduces the project.",
  "Leave out what the original fills in by itself (automatic task names, center station at the midpoint, distance 0, priority 500, rate coefficient 1.0, start at the low station, ASAP off, default calendar, first suitable crew, finish-start dependencies with 0 days, bidirectional intersections, whole-project windows for pits, disposal areas, crushing plants and stockpiles). The build report lists every default it applied, for the user to review.",
  "Never invent data the user did not give: deadline, stations of road lines and work places, quantities, real lengths of intersections, material suitability, capacities, haul costs, crews and production rates. Leave them out and the build returns them as pendingDecisions with a question for the user; nothing is built while a blocking decision is open (unless allow_pending, which builds the rest without those items).",
  "Units: quantities are in the unit of the task's type (cut and borrow pit types: cut unit, e.g. bcm; fill, disposal: fill unit, e.g. ccm). Convert the user's figures or set the type's conversions; do not mix units.",
  "Stations are in length units along the road line; road line begin/end are integers. Areas have no stations (0…1); connect each area to a road line with an intersection and its real length, otherwise no haul reaches it.",
  "Dates are \"YYYY-MM-DD\" (whole day) or \"YYYY-MM-DD hh:mm[:ss]\", without time zone.",
  "Always call build_project with dry_run true first: it validates, lists the defaults it would apply and the pending decisions, and changes nothing. Then ask the user the decisions, fix the data and build. The whole build is one undo level (\"MCP: Build project\").",
];

/** Texto do recurso `apex://obra/format` e do `get_obra_format`. */
export function obraFormatText(): string {
  return [
    `# ApeX project data format (${OBRA_FORMAT})`,
    "",
    "## Rules",
    ...OBRA_RULES.map((r) => `- ${r}`),
    "",
    "## Example",
    "```json",
    JSON.stringify(OBRA_EXAMPLE, null, 1),
    "```",
    "",
    "## JSON Schema",
    "```json",
    JSON.stringify(OBRA_SCHEMA),
    "```",
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------------
// Validador do subconjunto de JSON Schema usado acima (type, enum, properties, required, additionalProperties, items,
// minItems/maxItems, minimum/maximum/exclusiveMinimum, minLength). Erros com o caminho (`tasks[2].work_places[0]`).
// ---------------------------------------------------------------------------------------------------------------------

type SchemaX = JsonSchema & { exclusiveMinimum?: number; minLength?: number; minItems?: number; maxItems?: number };

const typeOf = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
function matchesType(v: unknown, t: string): boolean {
  if (t === "integer") return typeof v === "number" && Number.isInteger(v);
  if (t === "number") return typeof v === "number" && Number.isFinite(v);
  return typeOf(v) === t;
}

/** Valida `value` contra `schema`; devolve a lista de erros (vazia = válido), no máximo `max`. */
export function validateJson(schema: JsonSchema, value: unknown, path = "", max = 50): string[] {
  const errors: string[] = [];
  const at = (p: string) => p || "(root)";
  const walk = (s: SchemaX, v: unknown, p: string): void => {
    if (errors.length >= max) return;
    if (s.type) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => matchesType(v, t))) {
        errors.push(`${at(p)}: expected ${types.join(" or ")}, got ${typeOf(v)}`);
        return;
      }
    }
    if (s.enum && !s.enum.includes(v as string | number)) errors.push(`${at(p)}: must be one of ${s.enum.map((x) => JSON.stringify(x)).join(", ")}`);
    if (typeof v === "number") {
      if (s.minimum !== undefined && v < s.minimum) errors.push(`${at(p)}: must be ≥ ${s.minimum}`);
      if (s.maximum !== undefined && v > s.maximum) errors.push(`${at(p)}: must be ≤ ${s.maximum}`);
      if (s.exclusiveMinimum !== undefined && !(v > s.exclusiveMinimum)) errors.push(`${at(p)}: must be > ${s.exclusiveMinimum}`);
    }
    if (typeof v === "string" && s.minLength !== undefined && v.trim().length < s.minLength) errors.push(`${at(p)}: must not be empty`);
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) errors.push(`${at(p)}: needs at least ${s.minItems} item(s)`);
      if (s.maxItems !== undefined && v.length > s.maxItems) errors.push(`${at(p)}: at most ${s.maxItems} item(s)`);
      if (s.items) v.forEach((x, i) => walk(s.items as SchemaX, x, `${p}[${i}]`));
    } else if (v !== null && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const r of s.required ?? []) if (o[r] === undefined) errors.push(`${at(p)}: missing "${r}"`);
      for (const [k, x] of Object.entries(o)) {
        const sub = s.properties?.[k];
        const child = p ? `${p}.${k}` : k;
        if (sub) walk(sub as SchemaX, x, child);
        else if (s.additionalProperties === false) errors.push(`${at(p)}: unknown key "${k}"${s.properties ? ` (allowed: ${Object.keys(s.properties).join(", ")})` : ""}`);
        else if (typeof s.additionalProperties === "object") walk(s.additionalProperties as SchemaX, x, child);
      }
    }
  };
  walk(schema as SchemaX, value, path);
  return errors;
}
