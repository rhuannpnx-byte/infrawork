/**
 * U-24 (D-024) — prontidão do projeto aberto: o que ainda impede um resultado útil, como decisões pendentes (com a
 * pergunta ao usuário) e avisos. Só regras com base em montagem_obra.md / criacao_objetos.md ou no comportamento do
 * motor:
 * - local com tarefas de massa sem interseção para os demais: sem rota, a massa só anda dentro dele (§3.1 passo 4,
 *   §7; engine/distances.ts liga locais só por interseções) [O];
 * - interseção entre locais diferentes com comprimento 0 (§3.1 passo 4: definir o comprimento real) [O];
 * - tipo de origem em uso sem destino adequado em uso, ou tipo de destino sem origem adequada: o LP não gera cadeia
 *   (criacao_objetos.md §7, MakeHaulChainCandidateSteps) [O];
 * - tarefa com quantidade 0 (existe sem massa, §3.8) [O];
 * - Schedule/Control: tarefa estrita com quantidade e sem equipe com taxa para o tipo → duração 0 ou erro de taxa
 *   (engine/timing.ts productionRate) [O];
 * - depois de um cálculo: sobra sem bota-fora adequado, falta sem jazida adequada (§3.1 passo 6; relatórios mass
 *   surplus/deficit) [O]; calendário padrão sem feriados no Schedule (§6) [I].
 */
import type { Entity, Project } from "@apex/model";
import { crusherRefinedTypes, destLandType, hasSavedMoves, isSuitable, siteUnit, sourceLandType, unmoved } from "@apex/engine";
import { allTasks, calendarSpec, defaultCalendar, projectMode, workPlacesOf } from "./create.js";
import type { PendingDecision } from "./obra-ctx.js";
import { listOf, MODE_NAMES } from "./obra.js";
import { asRef, num, pairs } from "./values.js";

export interface ReadinessReport {
  mode: string;
  calculated: boolean;
  pendingDecisions: PendingDecision[];
  warnings: string[];
  summary: { tasks: Record<string, number>; hauls: number };
  next: string;
}

const STRICT = new Set(["LandCut", "Embankment", "MassExchange", "OtherWorkSite"]);
const SOURCE_TASKS = new Set(["LandCut", "BorrowPit", "MassExchange"]);
const DEST_TASKS = new Set(["Embankment", "WasteLand", "StockPile", "CrushingPlant", "MassExchange"]);
const fmtQ = (x: number) => (Math.round(x * 100) / 100).toLocaleString("en", { maximumFractionDigits: 2 });

export function checkReadiness(p: Project): ReadinessReport {
  const decisions: PendingDecision[] = [];
  const warnings: string[] = [];
  let seq = 0;
  const decide = (d: Omit<PendingDecision, "id">) => decisions.push({ id: `R${++seq}`, ...d });
  const mode = projectMode(p);
  const tasks = allTasks(p);
  const locOf = (w: Entity) => p.resolve(asRef(p.resolve(asRef(w.get("m_pLocation")))?.get("m_pRoadLine")));
  const nameOf = (v: unknown) => p.resolve(asRef(v as bigint | null))?.name ?? "?";

  // ---------- rotas ----------
  const massLocs = new Map<bigint, Entity>();
  for (const t of tasks) if (t.className !== "OtherWorkSite") for (const w of workPlacesOf(p, t)) {
    const l = locOf(w);
    if (l) massLocs.set(l.oid, l);
  }
  const parent = new Map<bigint, bigint>();
  const find = (x: bigint): bigint => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const rc of listOf(p, "m_vpRoadConnections")) {
    const a = p.resolve(asRef(rc.get("m_pPlaceFrom"))), b = p.resolve(asRef(rc.get("m_pPlaceTo")));
    const la = asRef(a?.get("m_pRoadLine")), lb = asRef(b?.get("m_pRoadLine"));
    if (la === null || lb === null) continue;
    parent.set(find(la), find(lb));
    if (la !== lb && (num(rc.get("m_dDistance")) ?? 0) === 0 && (massLocs.has(la) || massLocs.has(lb))) {
      decide({ path: `intersection ${rc.name ? `"${rc.name}"` : `${nameOf(la)}–${nameOf(lb)}`}`, question: `The intersection between "${nameOf(la)}" (station ${num(a?.get("m_dStation"))}) and "${nameOf(lb)}" (station ${num(b?.get("m_dStation"))}) has length 0. What is its real driving length?`, blocking: false });
    }
  }
  if (massLocs.size > 1) {
    const groups = new Map<bigint, Entity[]>();
    for (const l of massLocs.values()) groups.set(find(l.oid), [...(groups.get(find(l.oid)) ?? []), l]);
    if (groups.size > 1) {
      const main = asRef(p.root()?.get("m_pMainRoadLine"));
      const primary = main !== null && groups.has(find(main)) ? find(main) : [...groups].sort((x, y) => y[1].length - x[1].length)[0]![0];
      for (const [g, ls] of groups) if (g !== primary) for (const l of ls) {
        decide({ path: `location "${l.name}"`, question: `"${l.name}" has cut/fill/pit/disposal tasks but no intersection links it to the other locations: its masses only move inside it. Is that right, or where does it connect and with what real length?`, blocking: false });
      }
    }
  }

  // ---------- adequação dos materiais em uso ----------
  const srcInUse = new Map<bigint, Entity>(), dstInUse = new Map<bigint, Entity>();
  for (const t of tasks) {
    if (SOURCE_TASKS.has(t.className)) {
      const s = sourceLandType(p, t);
      if (s) srcInUse.set(s.oid, s);
    }
    if (DEST_TASKS.has(t.className)) {
      const d = destLandType(p, t);
      if (d) dstInUse.set(d.oid, d);
    }
    // a britagem produz os tipos refinados (`CrushingPlantHelpers::GetRefinedTypes`) [O]
    if (t.className === "CrushingPlant") for (const r of crusherRefinedTypes(p, t)) srcInUse.set(r.oid, r);
  }
  for (const s of srcInUse.values()) {
    if (![...dstInUse.values()].some((d) => isSuitable(s, d))) {
      const users = tasks.filter((t) => SOURCE_TASKS.has(t.className) && sourceLandType(p, t)?.oid === s.oid).map((t) => t.name);
      decide({ path: `source type "${s.name}"`, question: `Material "${s.name}" (tasks ${users.join(", ")}) cannot go anywhere: no fill, disposal area, stockpile or crushing plant uses a destination type it is suitable for. Which destination should take it (add a disposal area, or make it suitable for a fill type)?`, blocking: true });
    }
  }
  for (const d of dstInUse.values()) {
    if (![...srcInUse.values()].some((s) => isSuitable(s, d))) {
      const users = tasks.filter((t) => DEST_TASKS.has(t.className) && destLandType(p, t)?.oid === d.oid).map((t) => t.name);
      decide({ path: `destination type "${d.name}"`, question: `"${d.name}" (tasks ${users.join(", ")}) cannot receive any material in use: no cut or borrow pit has a source type suitable for it. Where does its material come from?`, blocking: true });
    }
  }

  // ---------- quantidades ----------
  const zero = tasks.filter((t) => !["StockPile", "CrushingPlant"].includes(t.className) && workPlacesOf(p, t).every((w) => (num(w.get(t.className === "OtherWorkSite" ? "m_dAmount" : SOURCE_TASKS.has(t.className) ? "m_dSourceAmount" : "m_dDestinationAmount")) ?? 0) === 0));
  if (zero.length) decide({ path: "tasks", question: `These tasks have quantity 0 and move or produce nothing: ${zero.map((t) => t.name).join(", ")}. What are their quantities?`, blocking: false });

  // ---------- equipes no Schedule ----------
  if (mode !== 0) {
    for (const t of tasks) {
      if (!STRICT.has(t.className)) continue;
      const qty = workPlacesOf(p, t).some((w) => (num(w.get(t.className === "OtherWorkSite" ? "m_dAmount" : t.className === "LandCut" ? "m_dSourceAmount" : "m_dDestinationAmount")) ?? 0) > 0);
      if (!qty) continue;
      const usage = t.className === "OtherWorkSite" ? 8 : t.className === "LandCut" ? 1 : 2;
      const member = usage === 8 ? "m_pWorkType" : usage === 1 ? "m_pSourceLandType" : "m_pDestLandType";
      const type = p.resolve(asRef(t.get(member)));
      const crew = p.resolve(asRef(pairs(t.get("m_cSelectedSubWorkGroups")).find(([u]) => u === usage)?.[1] as bigint | null | undefined));
      const rate = crew && crew.className !== "NullWorkGroup" ? num((pairs(crew.get("m_rates")).find(([k]) => k === type?.oid)?.[1] as number[] | undefined)?.[0]) ?? 0 : 0;
      if (!(rate > 0)) {
        decide({ path: `task "${t.name}"`, question: `In the schedule, task "${t.name}" has no crew with a production rate for type "${type?.name ?? "?"}", so it gets no duration. Which crew does it use, at what rate (quantity per hour)?`, blocking: true });
      }
    }
    const cal = defaultCalendar(p);
    const spec = cal ? calendarSpec(cal) : undefined;
    if (spec && spec.generators.length === 0 && spec.spans.length === 0) {
      decide({ path: `calendar "${cal!.name}"`, question: `The default calendar "${cal!.name}" has no holidays or exceptions. Are there holidays or periods with other working hours?`, blocking: false });
    }
  }

  // ---------- depois do cálculo ----------
  const kind = mode === 0 ? "plan" : "schedule";
  const calculated = hasSavedMoves(p, kind);
  const hauls = calculated ? p.byClass(mode === 0 ? "LPMove" : "SchedMove").length : 0;
  if (!calculated) warnings.push(`No hauls calculated in ${MODE_NAMES[mode]} mode yet: call calculate_hauls, read the reports and check again.`);
  else {
    const unitName = (u: bigint | null) => (u === null ? "" : p.get(u)?.name ?? "");
    const surplus: { t: Entity; q: number; u: string; at: number }[] = [], deficit: { t: Entity; q: number; u: string; at: number }[] = [];
    for (const t of tasks) {
      const src = t.className === "LandCut" || t.className === "MassExchange", dst = t.className === "Embankment" || t.className === "MassExchange";
      if (!src && !dst) continue;
      for (const [side, list] of [[true, surplus], [false, deficit]] as const) {
        if (side ? !src : !dst) continue;
        let q = 0, at = 0;
        for (const w of workPlacesOf(p, t)) {
          const x = unmoved(p, w, side, mode);
          if (x > 1e-6) {
            q += x;
            at = num(p.resolve(asRef(w.get("m_pLocation")))?.get("m_dStationCOG")) ?? 0;
          }
        }
        if (q > 1e-6) list.push({ t, q, u: unitName(siteUnit(p, t, side)), at });
      }
    }
    const disposals = tasks.filter((t) => t.className === "WasteLand");
    const pits = tasks.filter((t) => t.className === "BorrowPit");
    /** componente (interseções) de cada tarefa: com destino adequado só em outro componente, falta a rota */
    const comps = (t: Entity) => new Set(workPlacesOf(p, t).map((w) => locOf(w)).filter((l): l is Entity => !!l).map((l) => find(l.oid)));
    const reach = (a: Entity, b: Entity) => [...comps(a)].some((c) => comps(b).has(c));
    for (const s of surplus) {
      const mat = sourceLandType(p, s.t);
      const fit = disposals.filter((d) => mat && destLandType(p, d) && isSuitable(mat, destLandType(p, d)!));
      const ok = fit.length > 0;
      const routed = fit.some((d) => reach(s.t, d));
      decide({
        path: `task "${s.t.name}"`,
        question: ok && !routed
          ? `${fmtQ(s.q)} ${s.u} of "${s.t.name}" (${mat?.name ?? "?"}) stay unmoved: the suitable disposal area${fit.length > 1 ? "s" : ""} (${fit.map((d) => d.name).join(", ")}) cannot be reached — no intersection links the locations. Is that intended, or how do they connect?`
          : ok
          ? `${fmtQ(s.q)} ${s.u} of "${s.t.name}" (${mat?.name ?? "?"}) stay unmoved although a suitable disposal area exists: is its capacity, distance or time window enough?`
          : `${fmtQ(s.q)} ${s.u} of "${s.t.name}" (${mat?.name ?? "?"}) stay unmoved and no disposal area accepts this material. Where should the surplus go (a disposal area near station ${s.at}, with which capacity in the fill unit)?`,
        blocking: !ok,
      });
    }
    for (const d of deficit) {
      const mat = destLandType(p, d.t);
      const fit = pits.filter((b) => mat && sourceLandType(p, b) && isSuitable(sourceLandType(p, b)!, mat));
      const ok = fit.length > 0;
      const routed = fit.some((b) => reach(b, d.t));
      decide({
        path: `task "${d.t.name}"`,
        question: ok && !routed
          ? `${fmtQ(d.q)} ${d.u} of "${d.t.name}" (${mat?.name ?? "?"}) stay unfilled: the suitable borrow pit${fit.length > 1 ? "s" : ""} (${fit.map((x) => x.name).join(", ")}) cannot be reached — no intersection links the locations. Is that intended, or how do they connect?`
          : ok
          ? `${fmtQ(d.q)} ${d.u} of "${d.t.name}" (${mat?.name ?? "?"}) stay unfilled although a suitable borrow pit exists: is its quantity, distance or time window enough?`
          : `${fmtQ(d.q)} ${d.u} of "${d.t.name}" (${mat?.name ?? "?"}) stay unfilled and no borrow pit supplies a suitable material. Where does the missing material come from (a borrow pit near station ${d.at}, with which volume and material)?`,
        blocking: !ok,
      });
    }
  }

  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.className] = (counts[t.className] ?? 0) + 1;
  const blocking = decisions.filter((d) => d.blocking).length;
  return {
    mode: MODE_NAMES[mode] ?? String(mode),
    calculated,
    pendingDecisions: decisions,
    warnings,
    summary: { tasks: counts, hauls },
    next: decisions.length
      ? `Ask the user the ${decisions.length} pending decision(s)${blocking ? ` (${blocking} blocking)` : ""}; apply the answers with build_project (base current) or the create_* tools, recalculate and check again.`
      : calculated ? "Nothing pending. Review the reports with the user." : "Calculate the hauls, then check again.",
  };
}
