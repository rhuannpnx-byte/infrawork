/**
 * U-24 (D-024) — `buildObra`: monta (ou atualiza) o projeto aberto a partir de um documento `apex-obra/1`, tudo ou
 * nada, num único nível de undo. Ordem das seções = ordem de criação de montagem_obra.md §4. Cada objeto passa pelos
 * comandos de `create.ts` (U-23), com as validações e mensagens do original.
 *
 * - Documento inválido (esquema de `@apex/mcp`), referência inexistente ou recusa do domínio → `ObraError`; nada muda.
 * - Dado sem padrão implícito faltando (§6) → decisão pendente; com uma bloqueante nada é montado, salvo
 *   `allowPending` (o resto é montado, sem esses itens e o que depende deles).
 * - `dryRun` → mesmo relatório, nada muda (o nível de undo é desfeito).
 * [P] base "empty" esvazia o projeto aberto com a remoção em cascata (`removeObjects`) dentro do mesmo nível.
 */
import type { Entity, Project } from "@apex/model";
import { OBRA_SCHEMA, validateJson } from "@apex/mcp";
import { allTasks, calendarsOf, defaultCalendar, mainRoadLine, massUnits, projectMode, projectRoot, removeObjects, rootSumTask, takeTimingWarning } from "./create.js";
import { buildCalendars, buildHaulCosts, buildProject, buildResources, buildTypes, buildUnits } from "./obra-build-data.js";
import { buildIntersections, buildLocations, buildSumTasks, checkRoutes } from "./obra-build-places.js";
import { applyDates, buildDependencies, buildFilters, buildTasks } from "./obra-build-tasks.js";
import { Ctx, ObraError, type BuildReport, type LookupKind } from "./obra-ctx.js";
import { listOf, MODE_NAMES, type O } from "./obra.js";
import { asRef, refs } from "./values.js";

export { ObraError, type BuildReport } from "./obra-ctx.js";

export interface BuildOptions {
  dryRun?: boolean;
  allowPending?: boolean;
  /** rótulo do nível de undo (o MCP usa "MCP: Build project") */
  label?: string;
}

class Rollback extends Error {}

/** Classe do modelo → espécie do relatório. */
const KIND_OF: Record<string, string> = {
  LandCut: "tasks", Embankment: "tasks", MassExchange: "tasks", BorrowPit: "tasks", WasteLand: "tasks", StockPile: "tasks", CrushingPlant: "tasks", OtherWorkSite: "tasks",
  SumTask: "sum_tasks", RoadLine: "road_lines", Area: "areas", RoadConnection: "intersections", UsageBreak: "usage_breaks", SourceLandType: "source_types",
  DestLandType: "destination_types", WorkType: "task_types", Unit: "units", PriceVector: "haul_costs", Calendar: "calendars", Resource: "resources",
  Transporter: "haul_resources", WorkGroup: "crews", Milestone: "milestones", ViewFilter: "view_filters", Dependency: "dependencies", TypeDependency: "type_dependencies",
  IdentifiedResource: "identified_resources", MovableWorkPlace: "work_places", OtherWorkPlace: "work_places",
};

function countRemoved(ctx: Ctx, removed: { class: string }[]): void {
  for (const r of removed) ctx.count("removed", KIND_OF[r.class] ?? r.class);
}

/** Nomes repetidos dentro de uma seção: referência ambígua, recusada antes de montar. */
function semanticChecks(doc: O): void {
  const errors: string[] = [];
  const dup = (path: string, list: unknown) => {
    if (!Array.isArray(list)) return;
    const names = list.map((x) => (x as O)?.name).filter((x): x is string => typeof x === "string" && x !== "");
    const d = [...new Set(names.filter((x, i) => names.indexOf(x) !== i))];
    if (d.length) errors.push(`${path}: duplicate names ${d.map((x) => `"${x}"`).join(", ")} (names identify objects; make them unique)`);
  };
  for (const k of ["haul_costs", "source_types", "destination_types", "task_types", "calendars", "resources", "haul_resources", "crews", "sum_tasks", "tasks", "milestones", "view_filters"]) dup(k, doc[k]);
  dup("units.other", (doc.units as O | undefined)?.other);
  dup("road_lines/areas", [...((doc.road_lines as unknown[]) ?? []), ...((doc.areas as unknown[]) ?? [])]);
  if (doc.base === "empty" && Array.isArray(doc.remove) && doc.remove.length) errors.push('remove: only used with base "current" (base "empty" already clears the project)');
  if (errors.length) throw new ObraError(errors);
}

/** base "empty": tira tudo o que é removível; ficam linha principal, raiz, unidades de massa, calendário padrão. */
function clearProject(ctx: Ctx): void {
  const p = ctx.p;
  const root = projectRoot(p);
  const keep = new Set<bigint>([mainRoadLine(p).oid, rootSumTask(p).oid, ...Object.values(massUnits(p)).map((u) => u.oid)]);
  const def = defaultCalendar(p);
  if (def) keep.add(def.oid);
  // áreas que contêm a linha principal (a remoção as recusaria: IsMainRoadLineEndangered) ficam
  for (let a = p.resolve(asRef(mainRoadLine(p).get("m_pAreaParent"))); a && !keep.has(a.oid); a = p.resolve(asRef(a.get("m_pAreaParent")))) keep.add(a.oid);
  const mainSchedule = asRef(root.get("m_pMainSchedule"));
  const victims: Entity[] = [
    ...allTasks(p), ...listOf(p, "m_vpMilestones"), ...listOf(p, "m_vpViewFilters").filter((f) => f.oid !== mainSchedule && f.className === "ViewFilter"),
    ...p.byClass("SumTask"), ...listOf(p, "m_vpRoadConnections"),
    ...[...listOf(p, "m_vpRoadLines"), ...listOf(p, "m_vpAreas")].flatMap((l) => refs(l.get("m_usageBreaks")).map((o) => p.get(o)).filter((e): e is Entity => !!e)),
    ...listOf(p, "m_vpRoadLines"), ...listOf(p, "m_vpAreas"), ...listOf(p, "m_vpWorkGroups"), ...listOf(p, "m_vpTransporters"), ...p.byClass("IdentifiedResource"),
    ...listOf(p, "m_vpResources"), ...calendarsOf(p), ...listOf(p, "m_vpWorkTypes"), ...listOf(p, "m_vpDestLandTypes"), ...listOf(p, "m_vpSourceLandTypes"),
    ...listOf(p, "m_vpPriceVectors"), ...listOf(p, "m_vpUnits"),
  ].filter((e, i, a) => !keep.has(e.oid) && a.indexOf(e) === i);
  if (!victims.length) return;
  const r = removeObjects(p, victims);
  countRemoved(ctx, r.removed);
}

const REMOVE_KIND: Record<string, LookupKind> = {
  task: "task", sum_task: "sum_task", road_line: "road_line", area: "area", intersection: "intersection", source_type: "source_type", destination_type: "destination_type",
  task_type: "task_type", unit: "unit", haul_cost: "haul_cost", calendar: "calendar", resource: "resource", haul_resource: "haul_resource", crew: "crew", milestone: "milestone", view_filter: "view_filter",
};

/** base "current": `remove` com a cascata do original (`RemoveCommand`, criacao_objetos.md §11). */
function removals(ctx: Ctx): void {
  const p = ctx.p;
  const list = (ctx.doc.remove as O[] | undefined) ?? [];
  if (!list.length) return;
  const targets: Entity[] = [];
  list.forEach((o, i) => {
    const path = `remove[${i}]`;
    const kind = String(o.kind);
    let e: Entity | undefined;
    if (kind === "dependency") {
      const pred = ctx.ref("task", o.predecessor, `${path}.predecessor`), succ = ctx.ref("task", o.successor, `${path}.successor`);
      e = p.byClass("Dependency").find((d) => d.get("m_pPredecessor") === pred.oid && d.get("m_pSuccessor") === succ.oid && d.get("m_bUserGenerated") === true);
    } else if (kind === "usage_break") {
      e = [...listOf(p, "m_vpRoadLines"), ...listOf(p, "m_vpAreas")].flatMap((l) => refs(l.get("m_usageBreaks")).map((x) => p.get(x))).find((x) => x?.name === o.name);
    } else {
      e = typeof o.name === "string" ? ctx.find(REMOVE_KIND[kind]!, o.name, path) : undefined;
    }
    if (!e) throw new ObraError([`${path}: no ${kind.replace("_", " ")} ${kind === "dependency" ? `from "${String(o.predecessor)}" to "${String(o.successor)}"` : `named "${String(o.name)}"`}`]);
    targets.push(e);
  });
  try {
    countRemoved(ctx, removeObjects(p, targets).removed);
  } catch (e) {
    throw new ObraError([`remove: ${(e as Error).message}${(e as { hint?: string }).hint ? ` (${(e as { hint?: string }).hint})` : ""}`]);
  }
}

/** Estacas dos work places na linha principal (para sugerir as estacas dela quando faltam). */
function mainRange(ctx: Ctx): { min: number; max: number } | null {
  const doc = ctx.doc;
  const mainName = ((doc.project as O | undefined)?.main_road_line as O | undefined)?.name ?? mainRoadLine(ctx.p).name;
  const onlyMain = !(doc.road_lines as unknown[] | undefined)?.length && !(doc.areas as unknown[] | undefined)?.length && (ctx.report.base === "empty" || ctx.pool("location").length === 1);
  let min = Infinity, max = -Infinity;
  for (const t of (doc.tasks as O[] | undefined) ?? []) {
    for (const w of (t.work_places as O[] | undefined) ?? []) {
      if (w.location === mainName || (w.location === undefined && onlyMain)) {
        for (const k of ["station_begin", "station_end"]) if (typeof w[k] === "number") {
          min = Math.min(min, w[k] as number);
          max = Math.max(max, w[k] as number);
        }
        if (!Number.isFinite(min)) min = max = 0;
      }
    }
  }
  return Number.isFinite(min) ? { min, max } : null;
}

function run(ctx: Ctx): void {
  if (ctx.report.base === "empty") clearProject(ctx);
  else removals(ctx);
  buildProject(ctx, mainRange(ctx));
  buildUnits(ctx);
  buildHaulCosts(ctx);
  buildTypes(ctx);
  buildCalendars(ctx);
  const deferred: (() => void)[] = [];
  buildResources(ctx, deferred);
  buildLocations(ctx);
  buildIntersections(ctx);
  checkRoutes(ctx);
  buildSumTasks(ctx);
  for (const f of deferred) f();
  buildTasks(ctx);
  buildDependencies(ctx);
  buildFilters(ctx);
  applyDates(ctx);
  const mode = (ctx.doc.project as O | undefined)?.mode;
  if (typeof mode === "string") projectRoot(ctx.p).set("m_nMode", MODE_NAMES.indexOf(mode as never));
}

/** Monta o documento sobre o projeto aberto. Lança `ObraError` (nada muda) ou devolve o relatório. */
export function buildObra(p: Project, raw: unknown, opts: BuildOptions = {}): BuildReport {
  const errors = validateJson(OBRA_SCHEMA, raw);
  if (errors.length) throw new ObraError(errors);
  const doc = raw as O;
  semanticChecks(doc);
  const base = (doc.base as "current" | "empty" | undefined) ?? "current";
  const root = projectRoot(p);
  const isNew = base === "empty" || (root.name === "" && allTasks(p).length === 0);
  const modeName = (doc.project as O | undefined)?.mode;
  const finalMode = typeof modeName === "string" ? MODE_NAMES.indexOf(modeName as never) : projectMode(p);
  const ctx = new Ctx(p, doc, base, opts.dryRun === true, isNew, finalMode);
  const levels = p.undoNames().length, top = p.undoNames().at(-1);
  let committed = false;
  try {
    p.edit(opts.label ?? "Build project", () => {
      run(ctx);
      const blocking = ctx.report.pendingDecisions.some((d) => d.blocking);
      if (opts.dryRun || (blocking && !opts.allowPending)) throw new Rollback();
    });
    committed = true;
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  const r = ctx.report;
  const tw = takeTimingWarning(p);
  if (tw) r.warnings.push(tw);
  r.built = committed && (p.undoNames().length !== levels || p.undoNames().at(-1) !== top);
  const undo = p.undoNames().at(-1);
  if (r.built && undo) r.undo = undo;
  const blocking = r.pendingDecisions.filter((d) => d.blocking).length;
  const open = r.pendingDecisions.length - blocking;
  r.next = opts.dryRun
    ? blocking
      ? `Dry run, nothing changed. ${blocking} blocking decision(s): ask the user (do not answer them yourself), update the data and dry-run again.`
      : "Dry run, nothing changed. Show the user the applied defaults that matter" + (open ? " and the non-blocking decisions" : "") + ", then call build_project without dry_run."
    : !committed
      ? `Nothing was built: ${blocking} blocking decision(s). Ask the user, update the data and call build_project again (dry_run first), or pass allow_pending to build the rest without those items.`
      : `Built as one undo level${r.undo ? ` ("${r.undo}")` : ""}. Next: calculate_hauls, get_report mass-summary / mass-surplus / mass-deficit, then check_readiness.` + (r.pendingDecisions.length ? " Bring the pending decisions to the user." : "");
  return r;
}
