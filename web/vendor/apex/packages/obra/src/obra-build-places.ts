/**
 * U-24 (D-024) — montagem da obra, locais e WBS: road lines, áreas (e pais), interseções com o comprimento real,
 * usage breaks, verificação de rotas (local com tarefas de massa sem interseção = sem transporte, montagem_obra.md
 * §3.1 passo 4 e §7) e sum tasks (§4 passos 7–8). Criação pelos comandos de `create.ts`.
 */
import { MAX_DATE, MIN_DATE } from "@apex/calendar";
import type { Entity } from "@apex/model";
import {
  addArea, addRoadConnection, addRoadLine, addSumTask, addUsageBreak, CreateError, mainRoadLine, removeObjects, rootSumTask, setStationSpan, setSumTaskParent, stationSpan,
} from "./create.js";
import { arr, b, date, n, refList, s } from "./obra-build-data.js";
import { ObraError, type Ctx } from "./obra-ctx.js";
import type { O } from "./obra.js";
import { asRef, num, refs } from "./values.js";

const setDesc = (e: Entity, o: O) => {
  const d = s(o, "description");
  if (d !== undefined) e.set("m_strLongName", d);
};

/** Pai de uma área ou road line (m_pAreaParent + m_sAreaChildren/m_sRoadLineChildren do pai) [O membros]. */
function setAreaParent(ctx: Ctx, child: Entity, parent: Entity | null): void {
  const p = ctx.p;
  for (let x: Entity | undefined = parent ?? undefined, k = 0; x && k < 1000; x = p.resolve(asRef(x.get("m_pAreaParent"))), k++) {
    if (x.oid === child.oid) throw new CreateError("WANTED_AREA_PARENT_IS_CHILD");
  }
  const list = child.className === "Area" ? "m_sAreaChildren" : "m_sRoadLineChildren";
  const old = p.resolve(asRef(child.get("m_pAreaParent")));
  if (old?.oid === parent?.oid) return;
  if (old) old.setRaw(list, refList(refs(old.get(list)).filter((o) => o !== child.oid)));
  child.set("m_pAreaParent", parent?.oid ?? null);
  if (parent) parent.setRaw(list, refList([...refs(parent.get(list)).filter((o) => o !== child.oid), child.oid]));
}

/** Janela de uma interseção ou usage break: STATIC (1) nas pontas dadas, dentro de MinDate…MaxDate [O tipos]. */
function setWindow(e: Entity, from: bigint | undefined, to: bigint | undefined, path: string): void {
  const lo = BigInt(MIN_DATE), hi = BigInt(MAX_DATE);
  if (from !== undefined && (from < lo || from > hi)) throw new ObraError([`${path}: date out of range`]);
  if (to !== undefined && (to < lo || to > hi)) throw new ObraError([`${path}: date out of range`]);
  if (from !== undefined && to !== undefined && to < from) throw new CreateError("BEGIN_TIME_GREATER_THAN_END_TIME", path);
  if (from !== undefined) {
    e.set("m_beginTimingType", 1);
    e.set("m_beginDate", from);
  }
  if (to !== undefined) {
    e.set("m_endTimingType", 1);
    e.set("m_endDate", to);
  }
}

export function buildLocations(ctx: Ctx): void {
  const p = ctx.p;
  const parents: (() => void)[] = [];
  (arr(ctx.doc, "road_lines") ?? []).forEach((o, i) => {
    const path = `road_lines[${i}]`;
    const name = s(o, "name")!;
    ctx.item(path, "road_line", name, () => {
      let rl = ctx.find("road_line", name, path);
      const sb = n(o, "station_begin"), se = n(o, "station_end");
      if (rl) {
        setDesc(rl, o);
        if (sb !== undefined || se !== undefined) setStationSpan(p, rl, sb ?? num(rl.get("m_nStationBegin")) ?? 0, se ?? num(rl.get("m_nStationEnd")) ?? 0);
        if (n(o, "width") !== undefined) rl.set("m_dWidth", n(o, "width")!);
        ctx.count("updated", "road_lines");
      } else {
        if (sb === undefined || se === undefined) {
          ctx.block({ path: `${path}.station_begin/station_end`, question: `What are the start and finish stations of road line "${name}"?` });
        }
        rl = addRoadLine(p, { name, longName: s(o, "description"), begin: sb, end: se, width: n(o, "width") });
        ctx.count("created", "road_lines");
      }
      const r = rl;
      ctx.applyFields(r, o.fields, path);
      if (o.parent_area !== undefined) parents.push(() => ctx.item(`${path}.parent_area`, "road_line", undefined, () => setAreaParent(ctx, r, ctx.ref("area", o.parent_area, `${path}.parent_area`))));
    });
  });
  (arr(ctx.doc, "areas") ?? []).forEach((o, i) => {
    const path = `areas[${i}]`;
    const name = s(o, "name")!;
    ctx.item(path, "area", name, () => {
      let a = ctx.find("area", name, path);
      if (a) {
        setDesc(a, o);
        ctx.count("updated", "areas");
      } else {
        a = addArea(p, { name, longName: s(o, "description") });
        ctx.count("created", "areas");
      }
      const ar = a;
      ctx.applyFields(ar, o.fields, path);
      if (o.parent_area !== undefined) parents.push(() => ctx.item(`${path}.parent_area`, "area", undefined, () => setAreaParent(ctx, ar, ctx.ref("area", o.parent_area, `${path}.parent_area`))));
    });
  });
  for (const f of parents) f();
  const names = ctx.pool("location").map((x) => x.name);
  const dup = names.filter((x, i) => names.indexOf(x) !== i);
  if (dup.length) throw new ObraError([`road_lines/areas: duplicate location names (${[...new Set(dup)].join(", ")}); road lines and areas share one name space`]);
}

export function buildIntersections(ctx: Ctx): void {
  const p = ctx.p;
  const docs = arr(ctx.doc, "intersections") ?? [];
  const docCount = new Map<string, number>();
  for (const o of docs) docCount.set(String(o.name), (docCount.get(String(o.name)) ?? 0) + 1);
  docs.forEach((o, i) => {
    const path = `intersections[${i}]`;
    const name = s(o, "name") ?? "";
    ctx.item(path, "intersection", name || undefined, () => {
      const end = (k: "from" | "to") => {
        const e = o[k] as O;
        const loc = ctx.ref("location", e.location, `${path}.${k}.location`);
        return { location: loc, station: e.station as number };
      };
      const from = end("from"), to = end("to");
      // sem nome: sempre uma interseção nova (não há como achá-la depois) [P]
      const same = name ? ctx.pool("intersection").filter((x) => x.name === name) : [];
      if (same.length > 1 || (same.length === 1 && (docCount.get(name) ?? 0) > 1)) throw new ObraError([`${path}: several intersections are named "${name}"; give them distinct names to update them`]);
      let cur = same[0];
      const length = n(o, "length");
      if (cur) {
        const place = (v: unknown) => p.resolve(asRef(v as bigint | null));
        const pf = place(cur.get("m_pPlaceFrom")), pt = place(cur.get("m_pPlaceTo"));
        const moved = pf?.get("m_pRoadLine") !== from.location.oid || num(pf?.get("m_dStation")) !== from.station || pt?.get("m_pRoadLine") !== to.location.oid || num(pt?.get("m_dStation")) !== to.station;
        if (moved) {
          removeObjects(p, [cur]);
          cur = undefined;
        } else {
          setDesc(cur, o);
          if (length !== undefined) {
            if (length < 0) throw new CreateError("DISTANCE_CANNOT_BE_NEGATIVE");
            cur.set("m_dDistance", length);
          }
          if (b(o, "bidirectional") !== undefined) cur.set("m_bBidirectional", b(o, "bidirectional")!);
          ctx.count("updated", "intersections");
        }
      }
      if (!cur) {
        if (length === undefined) {
          if (from.location.oid !== to.location.oid) {
            ctx.block({
              path: `${path}.length`,
              question: `What is the real driving length of intersection${name ? ` "${name}"` : ""} between "${from.location.name}" (station ${from.station}) and "${to.location.name}" (station ${to.station}), including detours? Without it the link has no length.`,
            });
          }
          ctx.applied("intersection length 0 (both ends on the same location)", path);
          ctx.warn(`${path}: intersection${name ? ` "${name}"` : ""} joins two stations of "${from.location.name}" with length 0`);
        }
        if (b(o, "bidirectional") === undefined) ctx.applied("intersection: bidirectional, always open", path);
        cur = addRoadConnection(p, { name, longName: s(o, "description"), from, to, distance: length ?? 0, bidirectional: b(o, "bidirectional") });
        ctx.count("created", "intersections");
      }
      setWindow(cur, date(o, "open_from", path), date(o, "open_until", path), path);
      ctx.applyFields(cur, o.fields, path);
    });
  });
  (arr(ctx.doc, "usage_breaks") ?? []).forEach((o, i) => {
    const path = `usage_breaks[${i}]`;
    const name = s(o, "name")!;
    ctx.item(path, "usage_break", name, () => {
      const loc = o.location !== undefined ? ctx.ref("location", o.location, `${path}.location`) : mainRoadLine(p);
      if (o.location === undefined) ctx.applied("usage break location: the main road line", path, loc.name);
      const cur = refs(loc.get("m_usageBreaks")).map((x) => p.get(x)).find((x) => x?.name === name);
      const sb = n(o, "station_begin"), se = n(o, "station_end");
      const from = date(o, "from", path), to = date(o, "to", path);
      if (cur) {
        setDesc(cur, o);
        if (sb !== undefined || se !== undefined) {
          const bb = sb ?? num(cur.get("m_nStationBegin")) ?? 0, ee = se ?? num(cur.get("m_nStationEnd")) ?? 0;
          const span = stationSpan(loc);
          if (bb > ee) throw new CreateError("BEGIN_STATION_GREATER_THAN_END_STATION");
          if (bb < span.min || ee > span.max) throw new CreateError("USAGE_BREAK_IS_OUT_OF_STATION_SPAN_RANGE");
          cur.set("m_nStationBegin", bb);
          cur.set("m_nStationEnd", ee);
        }
        setWindow(cur, from, to, path);
        ctx.applyFields(cur, o.fields, path);
        ctx.count("updated", "usage_breaks");
        return;
      }
      if (sb === undefined || se === undefined) ctx.block({ path: `${path}.station_begin/station_end`, question: `Between which stations of "${loc.name}" is usage break "${name}"?` });
      if (from === undefined || to === undefined) ctx.applied("usage break window: the whole project", path);
      const u = addUsageBreak(p, { name, longName: s(o, "description"), roadLine: loc, begin: sb, end: se, from, to });
      ctx.applyFields(u, o.fields, path);
      ctx.count("created", "usage_breaks");
    });
  });
}

/**
 * Locais com tarefas de massa (todas menos "task") sem interseção que os ligue aos outros: sem rota, não há transporte
 * (montagem_obra.md §3.1 passo 4, §7; o grafo de distâncias só liga locais por interseções, engine/distances.ts) [O].
 * Decisão NÃO bloqueante [P]: um local isolado pode se equilibrar sozinho (no exemplo de áreas, as áreas A–E não têm
 * interseção e o original calcula os transportes dentro de cada uma); o usuário confirma.
 */
export function checkRoutes(ctx: Ctx): void {
  const p = ctx.p;
  const hosts = new Map<string, string[]>(); // local → caminhos das tarefas de massa
  const only = ctx.pool("location").length === 1 ? ctx.pool("location")[0]!.name : undefined;
  (arr(ctx.doc, "tasks") ?? []).forEach((t, i) => {
    if (t.kind === "task") return;
    (arr(t, "work_places") ?? [{}]).forEach((w) => {
      const loc = s(w, "location") ?? only;
      if (loc) hosts.set(loc, [...(hosts.get(loc) ?? []), `tasks[${i}]`]);
    });
  });
  if (ctx.report.base === "current") {
    for (const t of ctx.pool("task")) {
      if (t.className === "OtherWorkSite") continue;
      for (const w of refs(t.get("m_vpWorkPlaces"))) {
        const loc = p.resolve(asRef(p.get(w)?.get("m_pLocation")));
        const rl = p.resolve(asRef(loc?.get("m_pRoadLine")));
        if (rl && !hosts.has(rl.name)) hosts.set(rl.name, []);
      }
    }
  }
  // pontas de interseções que ficaram de fora já têm a sua decisão (o comprimento)
  const skippedInts = ctx.skippedNames.get("intersection") ?? new Set<string>();
  const covered = new Set((arr(ctx.doc, "intersections") ?? []).filter((x) => skippedInts.has(String(x.name))).flatMap((x) => [String((x.from as O)?.location), String((x.to as O)?.location)]));
  const locs = [...hosts.keys()].filter((nm) => !covered.has(nm)).map((nm) => ctx.find("location", nm, "tasks")).filter((e): e is Entity => !!e);
  if (locs.length < 2) return;
  // componentes ligados por interseções
  const parent = new Map<bigint, bigint>();
  const find = (x: bigint): bigint => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const rc of ctx.pool("intersection")) {
    const a = asRef(p.resolve(asRef(rc.get("m_pPlaceFrom")))?.get("m_pRoadLine")), c = asRef(p.resolve(asRef(rc.get("m_pPlaceTo")))?.get("m_pRoadLine"));
    if (a === null || c === null) continue;
    parent.set(find(a), find(c));
  }
  const groups = new Map<bigint, Entity[]>();
  for (const l of locs) groups.set(find(l.oid), [...(groups.get(find(l.oid)) ?? []), l]);
  if (groups.size < 2) return;
  const main = mainRoadLine(p);
  const primary = groups.get(find(main.oid))?.length ? find(main.oid) : [...groups].sort((x, y) => y[1].length - x[1].length)[0]![0];
  for (const [g, members] of groups) {
    if (g === primary) continue;
    for (const l of members) {
      ctx.decide({
        path: `intersections (${l.name})`,
        question: `"${l.name}" has cut/fill/pit/disposal tasks but no intersection links it to the other locations: its masses can only move inside it. Is that right, or where does it connect (road line and station, station on "${l.name}") and what is the real length of that link?`,
        options: [...groups.get(primary)!].map((x) => x.name),
        blocking: false,
      });
    }
  }
}

export function buildSumTasks(ctx: Ctx): void {
  const p = ctx.p;
  const root = rootSumTask(p);
  const later: (() => void)[] = [];
  (arr(ctx.doc, "sum_tasks") ?? []).forEach((o, i) => {
    const path = `sum_tasks[${i}]`;
    const name = s(o, "name")!;
    ctx.item(path, "sum_task", name, () => {
      if (name === root.name) throw new ObraError([`${path}: "${name}" is the root sum task; set it in project.root_sum_task`]);
      let st = ctx.find("sum_task", name, path);
      const parentName = s(o, "parent");
      const parentNow = parentName !== undefined ? ctx.find("sum_task", parentName, `${path}.parent`) : root;
      if (st) {
        setDesc(st, o);
        ctx.count("updated", "sum_tasks");
      } else {
        if (parentName === undefined) ctx.applied("sum task parent: the root", path, root.name);
        st = addSumTask(p, { name, longName: s(o, "description"), parent: parentNow ?? root });
        ctx.count("created", "sum_tasks");
      }
      const sum = st;
      if (b(o, "construction_zone") !== undefined) sum.set("m_bMassEconomyArea", b(o, "construction_zone")!);
      if (b(o, "prevent_external_hauls") !== undefined) sum.set("m_bPreventExternalHauls", b(o, "prevent_external_hauls")!);
      if (b(o, "lock_internal_timing") !== undefined) sum.set("m_bLockInternalTiming", b(o, "lock_internal_timing")!);
      if (s(o, "comment") !== undefined) sum.set("m_strComment", s(o, "comment")!);
      ctx.applyFields(sum, o.fields, path);
      if (parentName !== undefined) later.push(() => ctx.item(`${path}.parent`, "sum_task", undefined, () => setSumTaskParent(p, sum, ctx.ref("sum_task", parentName, `${path}.parent`))));
    });
  });
  for (const f of later) f();
}
