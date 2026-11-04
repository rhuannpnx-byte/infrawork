/**
 * Cronograma (RF-029, RF-030, RN-001…005, RN-018; D-020: núcleo). Evidência: analises/2026-10-11_dynaroad/handoff/
 * docs/analise_distancias_cronograma.md §2; evidencias/decompilado/distancias_tempo_extra/ (+ reparados/):
 * TC::WorkSite::WorkSite @0x98b460, UpdateTiming @0x98fb10, WorkPlace::SetTiming @0x9efe10,
 * CalculateDurationInSeconds @0x9ef9e0, SetToNextPossibleMorning @0x98fa60,
 * GetEarliestPossibleNonLockedBeginDateFromDependency @0x98d6d0 (REPARADO), GetAccumulatedNonLockedDurations @0x98d190,
 * WorkPlaceHelpers::GetDateAtStation @0x9efbc0, WorkSiteOrderCalculationHelpers::CalculateOrder @0xa0f0d0,
 * FloatCalculator::Calculate @0x9f4620; calendario/ DDL::Date::SetToEndOfDay @0x8ec7b0.
 *
 * - [O] tarefa estrita (corte, aterro, substituição, outras): duração do work place = DoubleToInt64(quantidade ÷ taxa × 3600)
 *   segundos de trabalho, taxa = produção principal da equipe selecionada (envio na origem, recebimento no destino,
 *   "outras" no OtherWorkSite) × m_dWachCoeff; "zero wach" se taxa ≤ 0.
 * - [O] data desejada = início atual da tarefa (GetBeginTime); ASAP → início do projeto; início = max(desejada,
 *   início do projeto, ES das dependências); STT_BEGINNING_OF_DAY → SetToNextPossibleMorning.
 * - [O] work places na ordem do kernel, invertidos se !m_bLow; cada um: SetToBeginOfDay(calendário), SetTiming,
 *   início seguinte = max(início, fim). SetTiming: fim = WS2AS(AS2WS(início) + dur, false), SetToEndOfDay(calendário),
 *   fim ≥ início.
 * - [O] dependências (só com atraso mínimo): FS/FF ancoram no fim do predecessor, SS/SF no início; atraso em dias úteis =
 *   o maior AddWorkDays(…, false) nos dois calendários, senão n × 86400; SF/FF descontam a duração total do sucessor;
 *   BY_STATIONS pelos pares de work places que se cruzam (ver esByStations).
 * - [O] não estritas (jazida, bota-fora, pilha, britagem): datas vindas dos transportes, sem recálculo e sem dependências.
 * - [O U-61f] equipe nula (NullWorkGroup): `NullWorkGroup::GetProductionRate@0x9a86c0` devolve 10 000 000 na unidade do
 *   tipo; a duração sai de DoubleToInt64(q ÷ 1e7 × 3600) (0 s nas 31 "Traffic" do example_area_construction).
 * - [O U-61f] DoubleToInt64 = meio afastado de zero (`tools.ts`); conferido nos 500 work places dos exemplos.
 * - [O] nivelamento (U-07b): só tarefas estritas; laço manhã seguinte → Crew.FindSlot até o slot não mudar (ver leveling.ts);
 *   depois de cada tarefa estrita o uso dos seus work places não travados entra no calculador.
 * - [I] AddResourceUsagesForLockedPlaces (não lido): work places travados das tarefas estritas ocupam os recursos.
 */
import { Calendar, MIN_DATE, parseCalendarBlob } from "@apex/calendar";
import type { Entity, Project, Ref } from "@apex/model";
import { namePred } from "./names.js";
import { doubleToInt64 } from "./tools.js";
import { ResourceUsage, type Crew } from "./leveling.js";

export const STRICT_CLASSES = new Set(["LandCut", "Embankment", "MassExchange", "OtherWorkSite"]);
const DESTINATION_CLASSES = new Set(["Embankment", "WasteLand", "StockPile", "MassExchange", "CrushingPlant"]);
export const DEP = { FINISH_FINISH: 0, START_FINISH: 1, FINISH_START: 2, START_START: 3, BY_STATIONS: 4 } as const;
export const SWGU = { SEND: 1, RECEIVE: 2, OTHER: 8 } as const;
const STT_BEGINNING_OF_DAY = 0;

/** `NullWorkGroup::GetProductionRate@0x9a86c0`: 10 000 000 na unidade do tipo [O]. */
export const NULL_WORK_GROUP_RATE = 10_000_000;

export class TimingError extends Error {
  constructor(readonly code: "ZERO_WACH" | "NO_CREW_FOR_USAGE" | "NO_CALENDAR", message: string) {
    super(message);
    this.name = "TimingError";
  }
}

const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
const big = (v: unknown) => (typeof v === "bigint" ? Number(v) : undefined);
const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);

/** DDL::Date::SetToEndOfDay(cal) @0x8ec7b0. */
export function setToEndOfDay(cal: Calendar, t: number): number {
  const a = cal.WS2AS(cal.AS2WS(t) + 1, false);
  return cal.WS2AS(cal.AS2WS(a) - 1, false);
}
/** DDL::Date::SetToBeginOfDay(cal) [I]: o próximo instante de trabalho (WS2AS(AS2WS(t), true)). */
export function setToBeginOfDay(cal: Calendar, t: number): number {
  return cal.WS2AS(cal.AS2WS(t), true);
}
/** TC::anon::SetToNextPossibleMorning @0x98fa60: passou do início da jornada do dia → mesmo horário no dia seguinte. */
export function setToNextPossibleMorning(cal: Calendar, t: number): number {
  const day = Math.floor(t / 86400);
  const begin = cal.spec.week.days[(((day + 3) % 7) + 7) % 7]!.begin;
  const diff = t - day * 86400 - begin;
  return diff > 0 ? t + 86400 - diff : t;
}
const addWorkSeconds = (cal: Calendar, t: number, s: number, atWorkBegin: boolean) => (s !== 0 ? cal.WS2AS(cal.AS2WS(t) + s, atWorkBegin) : t);

export interface WP {
  entity: Entity;
  begin: number;
  end: number;
  stationBegin: number;
  stationEnd: number;
  amount: number;
  locked: boolean;
}
export interface Site {
  entity: Entity;
  strict: boolean;
  low: boolean;
  calendar: Calendar;
  rate: number;
  wps: WP[];
  crew: Crew;
}

export interface SchedulerOptions {
  /** AllowedTimingsOptimizer @0x9fd510: equipe adequada de maior taxa, taxa × max(coef, 1), ASAP. */
  optimistic?: boolean;
  /** início desejado por tarefa (PackSchedule: início do projeto); sem valor → início atual. */
  wanted?: Map<bigint, number>;
}

export interface TimingResult {
  /** datas calculadas por work place */
  workPlaces: Map<bigint, { begin: number; end: number }>;
  /** ordem de cálculo das tarefas estritas */
  order: bigint[];
}

export class Scheduler {
  readonly sites = new Map<bigint, Site>();
  private readonly calendars = new Map<bigint, Calendar>();
  readonly projectStart: number;
  readonly projectEnd: number;
  private readonly sumTaskOfSite = new Map<bigint, bigint>();

  constructor(
    readonly project: Project,
    private readonly opts: SchedulerOptions = {},
  ) {
    for (const st of project.byClass("SumTask")) {
      const c = project.resolve(st.get("m_pWorkSiteContainer") as Ref);
      if (!c) continue;
      for (const k of ["m_vpLandCuts", "m_vpEmbankments", "m_vpMassExchanges", "m_vpBorrowPits", "m_vpWasteLands", "m_vpStockPiles", "m_vpCrushingPlants", "m_vpOtherWorkSites"])
        for (const o of refs(c.get(k))) this.sumTaskOfSite.set(o, st.oid);
    }
    const root = project.root()!;
    this.projectStart = big(root.get("m_dateBegin")) ?? MIN_DATE;
    this.projectEnd = big(root.get("m_dateDeadline")) ?? Number.MAX_SAFE_INTEGER;
    for (const e of project.entities()) {
      if (!STRICT_CLASSES.has(e.className) && !["BorrowPit", "WasteLand", "StockPile", "CrushingPlant"].includes(e.className)) continue;
      const strict = STRICT_CLASSES.has(e.className);
      const calendar = this.calendarOf(e);
      const rate = strict ? (opts.optimistic ? this.optimisticRate(e) : this.productionRate(e)) : 0;
      const wps = refs(e.get("m_vpWorkPlaces")).map((o) => project.get(o)).filter((w): w is Entity => !!w).map((w) => this.workPlace(e, w));
      this.sites.set(e.oid, { entity: e, strict, low: e.get("m_bLow") !== false, calendar, rate, wps, crew: this.crewOf(e) });
    }
  }

  /**
   * WorkSite::GetCalendar: o próprio ou o padrão do projeto (m_bUseDefaultCalendar) [I]. L-014 (U-38): sem calendário
   * (f205 ausente ou nulo) usa o padrão — o original não tem reserva e falharia ao carregar [P].
   */
  calendarOf(site: Entity): Calendar {
    const root = this.project.root()!;
    const def = this.project.resolve(root.get("m_pCalendarManager") as Ref)?.get("m_pDefaultCalendar");
    const own = site.get("m_bUseDefaultCalendar") === false ? site.get("m_pCalendar") : (def ?? site.get("m_pCalendar"));
    const ref = (typeof own === "bigint" ? own : def) as bigint | undefined;
    if (typeof ref !== "bigint") throw new TimingError("NO_CALENDAR", `${site.className} ${site.oid} sem calendário`);
    let c = this.calendars.get(ref);
    if (!c) {
      const blob = this.project.get(ref)?.fields.find((f) => f.id === 100 && f.type === 0x10);
      if (!blob || blob.value.kind !== "bytes") throw new TimingError("NO_CALENDAR", `calendário ${ref} sem blob`);
      c = new Calendar(parseCalendarBlob(blob.value.value));
      this.calendars.set(ref, c);
    }
    return c;
  }

  /** TC::Crew::Crew(ws, 0xb) @0x9fce90: equipes com uso envio/recebimento/outras e recursos identificados. */
  private crewOf(site: Entity): Crew {
    return this.crewFor(site, SWGU.SEND | SWGU.RECEIVE | SWGU.OTHER);
  }

  /** sum task da tarefa: m_pSumTaskParent ou a que a lista no WorkSiteContainer [I]. */
  sumTaskOf(site: Entity): bigint | undefined {
    const own = site.get("m_pSumTaskParent");
    return typeof own === "bigint" ? own : this.sumTaskOfSite.get(site.oid);
  }

  /** TC::Crew(ws, flags): equipes selecionadas com o uso na máscara (1 envio, 2 recebimento, 8 outro). */
  crewFor(site: Entity, MASK: number): Crew {
    const sumTask = this.sumTaskOf(site);
    const items: Crew["items"] = [];
    for (const [u, g] of (site.get("m_cSelectedSubWorkGroups") as [unknown, unknown][] | undefined) ?? []) {
      if ((num(u) & MASK) === 0) continue;
      for (const [r, n] of (this.project.resolve(g as Ref)?.get("m_resources") as [unknown, unknown][] | undefined) ?? [])
        if (typeof r === "bigint") items.push({ sumTask, resource: r, count: num(n) });
    }
    const identified: bigint[] = [];
    for (const [u, r] of (site.get("m_mIdentifiedResources") as [unknown, unknown][] | undefined) ?? [])
      if ((num(u) & MASK) !== 0 && typeof r === "bigint") identified.push(r);
    return { items, identified };
  }

  /** Resource::GetQuantityRestriction(r, sumTask) [I]: valor de m_mQuantityRestrictions para a sum task, senão 0. */
  private restriction(resource: bigint, sumTask: bigint): number {
    const m = this.project.get(resource)?.get("m_mQuantityRestrictions") as [unknown, unknown][] | undefined;
    return num(m?.find(([k]) => k === sumTask)?.[1]);
  }

  /** WorkSiteHelpers::GetMainSWGU @0x9293e0: outras, senão recebimento, senão envio. */
  mainUsage(site: Entity): number {
    const sel = (site.get("m_cSelectedSubWorkGroups") as [unknown, unknown][] | undefined) ?? [];
    for (const u of [SWGU.OTHER, SWGU.RECEIVE, SWGU.SEND]) if (sel.some(([k, g]) => k === u && typeof g === "bigint")) return u;
    throw new TimingError("NO_CREW_FOR_USAGE", `Usage does not seem to be other/receive/send (${site.className} ${site.oid})`);
  }
  /** tipos da tarefa para o uso (virtual +0x30) [I]: envio → tipo de origem, recebimento → destino, outras → tipo de trabalho. */
  typesFor(site: Entity, usage: number): bigint[] {
    const k = usage === SWGU.SEND ? "m_pSourceLandType" : usage === SWGU.RECEIVE ? "m_pDestLandType" : "m_pWorkType";
    const t = site.get(k);
    return typeof t === "bigint" ? [t] : [];
  }
  private groupRate(g: Entity | undefined, type: bigint): number {
    if (!g || g.className === "NullWorkGroup") return 0; // [I] equipe nula não tem taxa
    const r = (g.get("m_rates") as [unknown, unknown][] | undefined)?.find(([t]) => t === type);
    return Array.isArray(r?.[1]) ? num((r![1] as unknown[])[0]) : 0;
  }
  /** WorkSite::IsSuitable(g, uso) @0x9404b0: equipe nula sempre; senão alguma taxa para um tipo do uso [I: virtual +0x20 = tem taxa]. */
  isSuitableGroup(site: Entity, g: Entity, usage: number): boolean {
    if (g.className === "NullWorkGroup") return true;
    const rates = (g.get("m_rates") as [unknown, unknown][] | undefined) ?? [];
    return this.typesFor(site, usage).some((t) => rates.some(([k]) => k === t));
  }
  /** anon::ChooseBest @0x9fd730: parte da selecionada no uso principal; troca por uma adequada de taxa estritamente maior. */
  chooseBest(site: Entity): Entity | undefined {
    const usage = this.mainUsage(site);
    const sel = (site.get("m_cSelectedSubWorkGroups") as [unknown, unknown][]).find(([u]) => u === usage)!;
    let best = this.project.resolve(sel[1] as Ref);
    const groups = [...this.project.byClass("WorkGroup"), ...this.project.byClass("NullWorkGroup")].filter((g) => this.isSuitableGroup(site, g, usage));
    for (const t of this.typesFor(site, usage)) for (const g of groups) if (this.groupRate(best, t) < this.groupRate(g, t)) best = g;
    return best;
  }
  /** AllowedTimingsOptimizer: taxa da melhor equipe × max(m_dWachCoeff, 1); equipe nula → ∞ (duração 0) [I]. */
  private optimisticRate(site: Entity): number {
    const best = this.chooseBest(site);
    if (!best) return Infinity;
    if (best.className === "NullWorkGroup") return NULL_WORK_GROUP_RATE * Math.max(num(site.get("m_dWachCoeff"), 1), 1); // [O] 1e7
    const t = this.typesFor(site, this.mainUsage(site))[0];
    const rate = (t === undefined ? 0 : this.groupRate(best, t)) * Math.max(num(site.get("m_dWachCoeff"), 1), 1);
    if (!(rate > 0)) throw new TimingError("ZERO_WACH", `zero wach (${site.className} ${site.oid} "${site.name}")`);
    return rate;
  }

  /** GetMainWach (+0x38) × m_dWachCoeff; equipe nula → ∞ (duração 0) [I]. */
  private productionRate(site: Entity): number {
    const other = site.className === "OtherWorkSite";
    const dest = DESTINATION_CLASSES.has(site.className);
    const usage = other ? SWGU.OTHER : dest ? SWGU.RECEIVE : SWGU.SEND;
    const type = site.get(other ? "m_pWorkType" : dest ? "m_pDestLandType" : "m_pSourceLandType");
    const sel = (site.get("m_cSelectedSubWorkGroups") as [unknown, unknown][] | undefined)?.find(([u]) => u === usage);
    if (!sel) throw new TimingError("NO_CREW_FOR_USAGE", `no crew for usage (${site.className} ${site.oid})`);
    const wg = this.project.resolve(sel[1] as Ref);
    // U-61f (AL-MOT-26): `NullWorkGroup::GetProductionRate@0x9a86c0` = 10 000 000 na unidade do tipo [O] (não zero nem ∞)
    if (wg?.className === "NullWorkGroup") return NULL_WORK_GROUP_RATE * num(site.get("m_dWachCoeff"), 1);
    const r = (wg?.get("m_rates") as [unknown, unknown][] | undefined)?.find(([t]) => t === type);
    const rate = (Array.isArray(r?.[1]) ? num((r![1] as unknown[])[0]) : 0) * num(site.get("m_dWachCoeff"), 1);
    if (!(rate > 0)) throw new TimingError("ZERO_WACH", `zero wach (${site.className} ${site.oid} "${site.name}")`);
    return rate;
  }

  private workPlace(site: Entity, w: Entity): WP {
    const loc = this.project.resolve(w.get("m_pLocation") as Ref);
    const other = site.className === "OtherWorkSite";
    const amount = other ? num(w.get("m_dAmount")) : DESTINATION_CLASSES.has(site.className) ? num(w.get("m_dDestinationAmount")) : num(w.get("m_dSourceAmount"));
    const beginField = w.fields.find((f) => f.id === 209 && f.value.kind === "bigint");
    return {
      entity: w,
      begin: beginField && beginField.value.kind === "bigint" ? Number(beginField.value.value) : 0,
      end: big(w.get("m_endTime")) ?? 0,
      stationBegin: num(loc?.get("m_dStationBegin")),
      stationEnd: num(loc?.get("m_dStationEnd")),
      amount,
      locked: w.get("m_bLockedAsActual") === true,
    };
  }

  /** CalculateDurationInSeconds @0x9ef9e0. */
  duration(s: Site, w: WP): number {
    if (s.strict && !w.locked) return s.rate === Infinity ? 0 : doubleToInt64((w.amount / s.rate) * 3600); // DoubleToInt64 [O]
    return s.calendar.AS2WS(w.end) - s.calendar.AS2WS(w.begin);
  }
  /** TC::WorkSite::GetNonLockedAsActualDurationWS. */
  nonLockedDuration(s: Site): number {
    return s.wps.reduce((a, w) => a + (w.locked ? 0 : this.duration(s, w)), 0);
  }
  private ordered(s: Site): WP[] {
    return s.low ? s.wps.slice() : s.wps.slice().reverse();
  }
  private siteBegin(s: Site): number {
    return Math.min(...s.wps.map((w) => w.begin));
  }
  private siteEnd(s: Site): number {
    return Math.max(...s.wps.map((w) => w.end));
  }

  private dependencies(succ: bigint): Entity[] {
    return this.project.byClass("Dependency").filter((d) => d.get("m_pSuccessor") === succ && d.get("m_bHasMinDelay") === true);
  }

  private addDelay(d: Entity, pred: Site, succ: Site, t: number): number {
    const n = num(d.get("m_nDelayMin"));
    if (d.get("m_bIsDelayWorkDays") === true) return Math.max(succ.calendar.addWorkDays(t, n, false), pred.calendar.addWorkDays(t, n, false));
    return t + n * 86400;
  }

  /** WorkPlaceHelpers::GetDateAtStation @0x9efbc0. */
  private dateAtStation(pred: Site, w: WP, station: number, atWorkBegin: boolean): number | undefined {
    if (station < w.stationBegin || w.stationEnd < station) return undefined;
    const dws = pred.calendar.AS2WS(w.end) - pred.calendar.AS2WS(w.begin);
    let frac = 1;
    const len = w.stationEnd - w.stationBegin;
    if (len > 0) frac = (pred.low ? station - w.stationBegin : w.stationEnd - station) / len;
    return addWorkSeconds(pred.calendar, w.begin, doubleToInt64(frac * dws), atWorkBegin); // DoubleToInt64 [O]
  }

  /** ES de uma dependência BY_STATIONS (REPARADO @0x98d6d0). */
  private esByStations(d: Entity, pred: Site, succ: Site): number {
    let best = MIN_DATE;
    const list = this.ordered(succ);
    const acc = [0];
    for (const w of list.slice(0, -1)) acc.push(acc[acc.length - 1]! + this.duration(succ, w));
    succ.wps.forEach((S, idx) => {
      if (S.locked) return;
      const len = S.stationEnd - S.stationBegin;
      const sec = len !== 0 ? this.duration(succ, S) / len : 0;
      for (const P of pred.wps) {
        if (!(S.stationBegin <= P.stationEnd && P.stationBegin <= S.stationEnd)) continue;
        for (const st of [Math.max(P.stationBegin, S.stationBegin), Math.min(P.stationEnd, S.stationEnd)]) {
          const dp = this.dateAtStation(pred, P, st, false);
          if (dp === undefined) continue;
          const off = doubleToInt64((succ.low ? S.stationBegin - st : st - S.stationEnd) * sec);
          const a = addWorkSeconds(succ.calendar, this.addDelay(d, pred, succ, dp), off, false);
          const b = this.addDelay(d, pred, succ, addWorkSeconds(succ.calendar, dp, off, false));
          const c = Math.max(a, b);
          const k = acc[idx] ?? 0;
          best = Math.max(best, k !== 0 ? succ.calendar.WS2AS(succ.calendar.AS2WS(c) - k, true) : c);
        }
      }
    });
    return best;
  }

  /** GetEarliestPossibleNonLockedBeginDateFromDependencies @0x98d5a0 (RN-003). */
  earliestStart(succOid: bigint): number {
    const succ = this.sites.get(succOid)!;
    let best = MIN_DATE;
    const total = this.ordered(succ).reduce((a, w) => a + (w.locked ? 0 : this.duration(succ, w)), 0);
    for (const d of this.dependencies(succOid)) {
      const pred = this.sites.get(d.get("m_pPredecessor") as bigint);
      if (!pred || pred.entity.oid === succOid || !pred.strict || !succ.strict) continue; // não estritas: sem dependências (RN-018)
      const type = num(d.get("m_nType"));
      if (type === DEP.BY_STATIONS) {
        best = Math.max(best, this.esByStations(d, pred, succ));
        continue;
      }
      let t = type === DEP.FINISH_START || type === DEP.FINISH_FINISH ? this.siteEnd(pred) : this.siteBegin(pred);
      t = this.addDelay(d, pred, succ, t);
      if (type === DEP.START_FINISH || type === DEP.FINISH_FINISH) t = addWorkSeconds(succ.calendar, t, -total, true);
      best = Math.max(best, t);
    }
    return best;
  }

  /** WorkSiteOrderCalculationHelpers::CalculateOrder @0xa0f0d0: Kahn; entre os livres, maior prioridade e depois o nome (RN-002). */
  order(): bigint[] {
    const strict = [...this.sites.values()].filter((s) => s.strict);
    const indeg = new Map(strict.map((s) => [s.entity.oid, 0]));
    const next = new Map<bigint, bigint[]>();
    for (const d of this.project.byClass("Dependency")) {
      const a = d.get("m_pPredecessor") as bigint, b = d.get("m_pSuccessor") as bigint;
      if (indeg.has(a) && indeg.has(b) && a !== b) {
        indeg.set(b, indeg.get(b)! + 1);
        next.set(a, [...(next.get(a) ?? []), b]);
      }
    }
    // PriorityComp@0xa0ef80: maior prioridade; empate por `KernelObjectHelpers::NamePred` (L-008, P-7) [O]
    const cmp = (a: Site, b: Site) => num(b.entity.get("m_nSchedulingPriority")) - num(a.entity.get("m_nSchedulingPriority")) || namePred(a.entity, b.entity);
    const ready = strict.filter((s) => indeg.get(s.entity.oid) === 0);
    const out: bigint[] = [];
    while (ready.length > 0) {
      ready.sort(cmp);
      const s = ready.shift()!;
      out.push(s.entity.oid);
      for (const t of next.get(s.entity.oid) ?? []) {
        indeg.set(t, indeg.get(t)! - 1);
        if (indeg.get(t) === 0) ready.push(this.sites.get(t)!);
      }
    }
    return out;
  }

  /** TC::TimingCalculator::CalculateTimings(constrained) @0x9f7990 (RN-004); constrained = nivelamento por recursos. */
  calculate(constrained = true): TimingResult {
    const order = this.order();
    const usage = new ResourceUsage(constrained, (r, st) => this.restriction(r, st), (st) => {
      const p = this.project.get(st)?.get("m_pParent");
      return typeof p === "bigint" ? p : undefined;
    });
    for (const s of this.sites.values()) if (s.strict) for (const w of s.wps) if (w.locked) usage.addCrew(s.crew, w.begin, w.end);
    for (const oid of order) {
      const s = this.sites.get(oid)!;
      this.updateTiming(s, usage);
      for (const w of this.ordered(s)) if (!w.locked) usage.addCrew(s.crew, w.begin, w.end);
    }
    // L-016 (U-54) [O]: ResetTimings@0x97ec40 cria um site para todas as tarefas e UpdateTiming@0x98fb10 roda também nas
    // não estritas: início = max(desejada, início do projeto, ES), STT, sem FindSlot; cada work place mantém as horas de
    // trabalho e é encadeado. Sem dependências nem uso de recursos, então a posição delas na ordem não muda nada.
    for (const s of this.sites.values()) if (!s.strict) this.updateTiming(s, usage);
    const workPlaces = new Map<bigint, { begin: number; end: number }>();
    for (const s of this.sites.values()) for (const w of s.wps) workPlaces.set(w.entity.oid, { begin: w.begin, end: w.end });
    return { workPlaces, order };
  }

  private updateTiming(s: Site, usage: ResourceUsage): void {
    if (s.wps.length === 0) return;
    const asap = this.opts.optimistic === true || s.entity.get("m_bASAP") === true;
    const wanted = asap ? this.projectStart : (this.opts.wanted?.get(s.entity.oid) ?? this.siteBegin(s));
    let start = Math.max(wanted, Math.max(this.projectStart, this.earliestStart(s.entity.oid)));
    const dur = this.ordered(s).reduce((a, w) => a + (w.locked ? 0 : this.duration(s, w)), 0);
    for (;;) {
      if (num(s.entity.get("m_nStartTimeType")) === STT_BEGINNING_OF_DAY) start = setToNextPossibleMorning(s.calendar, start);
      if (!s.strict) break;
      const slot = usage.findSlot(s.crew, start, dur, s.calendar);
      if (slot === start) break;
      start = slot;
    }
    for (const w of this.ordered(s)) {
      if (w.locked) continue;
      start = setToBeginOfDay(s.calendar, start);
      const dur = this.duration(s, w);
      w.begin = start;
      let end = addWorkSeconds(s.calendar, start, dur, false);
      end = setToEndOfDay(s.calendar, end);
      w.end = Math.max(end, start);
      start = Math.max(start, w.end);
    }
  }

  /** Grava as datas calculadas nos work places (f209 início, f210 fim) num nível de undo. */
  apply(result: TimingResult): void {
    this.project.edit("Recalculate schedule", () => this.write(result));
  }
  /** grava as datas dentro de uma edição já aberta. */
  write(result: TimingResult): void {
    for (const [oid, { begin, end }] of result.workPlaces) {
      const w = this.project.get(oid)!;
      if (big(w.get("pDVar2")) !== begin) w.set("pDVar2", BigInt(begin));
      if (big(w.get("m_endTime")) !== end) w.set("m_endTime", BigInt(end));
    }
  }

  // ---------- folga (RN-005) ----------

  /**
   * WorkSiteFilter::IsWorkSitePresent @0x976ef0 (marcos): incluída → sim; excluída → não; depois os filtros habilitados:
   * estaca (algum work place cruza a faixa do filtro na mesma road line), recurso (algum recurso das equipes
   * selecionadas está no filtro) e tipo (algum tipo da tarefa está no filtro, ou a tarefa não tem tipo). Sem filtro
   * nenhum → não. [I] forma de m_mLocations (sem amostra): mapa road line → (início, fim).
   */
  isInMilestone(m: Entity, site: Site): boolean {
    const oid = site.entity.oid;
    if (refs(m.get("m_spIncludedWorkSites")).includes(oid)) return true;
    if (refs(m.get("m_spExcludedWorkSites")).includes(oid)) return false;
    let ok = false;
    if (m.get("m_bStationSpanFilteringEnabled") === true) {
      const spans = (m.get("m_mLocations") as [unknown, unknown][] | undefined) ?? [];
      const hit = site.wps.some((w) => {
        const loc = this.project.resolve(w.entity.get("m_pLocation") as Ref);
        const rl = loc?.get("m_pRoadLine");
        return spans.some(([k, v]) => k === rl && Array.isArray(v) && num(v[0]) <= w.stationEnd && w.stationBegin <= num(v[1]));
      });
      if (!hit) return false;
      ok = true;
    }
    if (m.get("m_bResourceFilteringEnabled") === true) {
      const wanted = new Set(refs(m.get("m_spResources")));
      const crews = ((site.entity.get("m_cSelectedSubWorkGroups") as [unknown, unknown][] | undefined) ?? []).map(([, g]) => this.project.resolve(g as Ref));
      const hit = crews.some((g) => ((g?.get("m_resources") as [unknown, unknown][] | undefined) ?? []).some(([r, n]) => wanted.has(r as bigint) && num(n) > 0));
      if (!hit) return false;
      ok = true;
    }
    if (m.get("m_bWorkSiteTypeFilteringEnabled") === true) {
      const types = ["m_pSourceLandType", "m_pDestLandType", "m_pWorkType"].map((k) => site.entity.get(k)).filter((x): x is bigint => typeof x === "bigint");
      if (types.length === 0) return true;
      const allowed = new Set(refs(m.get("m_spWorkSiteTypes")));
      return types.some((t) => allowed.has(t));
    }
    return ok;
  }

  /** FloatCalculator::GetLatestAllowedFinish @0x9f4db0. */
  latestAllowedFinish(site: Site): { date: number; constraint: "TC_DEADLINE" | "TC_MILESTONE" | "TC_FORCED_START" | "TC_FORCED_FINISH" } {
    let r = { date: this.projectEnd, constraint: "TC_DEADLINE" as "TC_DEADLINE" | "TC_MILESTONE" | "TC_FORCED_START" | "TC_FORCED_FINISH" };
    for (const m of this.project.byClass("Milestone")) {
      if (!this.isInMilestone(m, site)) continue;
      const end = big(m.get("m_endDate"));
      if (end !== undefined && end <= r.date) r = { date: end, constraint: "TC_MILESTONE" };
    }
    const e = site.entity;
    if (num(e.get("m_forcedBeginConstraint")) === 2) { // SCT_EXACT_START
      const fb = big(e.get("m_forcedBeginDate"))!;
      const dur = this.ordered(site).reduce((a, w) => a + (w.locked ? 0 : this.duration(site, w)), 0);
      const t = dur === 0 ? fb : site.calendar.WS2AS(site.calendar.AS2WS(fb) + dur, false);
      if (t <= r.date) r = { date: t, constraint: "TC_FORCED_START" };
    }
    const fc = num(e.get("m_forcedEndConstraint"));
    if (fc === 1 || fc === 2) { // FCT_LATEST_FINISH, FCT_EXACT_FINISH
      const fe = big(e.get("m_forcedEndDate"))!;
      if (fe <= r.date) r = { date: fe, constraint: "TC_FORCED_FINISH" };
    }
    return r;
  }

  /**
   * FloatCalculator::Calculate @0x9f4620 (RN-005): ordem inversa; LS = WS2AS(AS2WS(LF) − dur, true); LS < início atual →
   * tudo = início atual; senão livre/total pelo mínimo sobre os sucessores (com atraso mínimo e não travados).
   * Folga total = latestTotalStart − currentStart; livre = latestFreeStart − currentStart.
   */
  floats(order: bigint[]): Map<bigint, { currentStart: number; latestFreeStart: number; latestTotalStart: number; constraint: string }> {
    const out = new Map<bigint, { currentStart: number; latestFreeStart: number; latestTotalStart: number; constraint: string }>();
    for (const oid of [...order].reverse()) {
      const site = this.sites.get(oid)!;
      const cur = this.siteBegin(site);
      const lf = this.latestAllowedFinish(site);
      if (site.wps.length > 0 && site.wps.every((w) => w.locked)) {
        out.set(oid, { currentStart: cur, latestFreeStart: cur, latestTotalStart: cur, constraint: lf.constraint });
        continue;
      }
      const dur = this.ordered(site).reduce((a, w) => a + (w.locked ? 0 : this.duration(site, w)), 0);
      const ls = site.calendar.WS2AS(site.calendar.AS2WS(lf.date) - dur, true);
      if (ls < cur) {
        out.set(oid, { currentStart: cur, latestFreeStart: cur, latestTotalStart: cur, constraint: lf.constraint });
        continue;
      }
      let free = ls, total = ls;
      for (const d of site.strict ? this.project.byClass("Dependency") : []) {
        if (d.get("m_pPredecessor") !== oid || d.get("m_bHasMinDelay") !== true) continue;
        const succ = this.sites.get(d.get("m_pSuccessor") as bigint);
        if (!succ || !succ.strict || succ.wps.every((w) => w.locked)) continue;
        const esDep = this.earliestFromOne(d, site, succ);
        const pc = site.calendar, sc = succ.calendar;
        free = Math.min(free, pc.WS2AS(pc.AS2WS(cur) + (pc.AS2WS(this.siteBegin(succ)) - pc.AS2WS(esDep)), true));
        const st = out.get(succ.entity.oid)?.latestTotalStart ?? this.siteBegin(succ);
        total = Math.min(total, sc.WS2AS(sc.AS2WS(cur) + (sc.AS2WS(st) - sc.AS2WS(esDep)), true));
      }
      out.set(oid, { currentStart: cur, latestFreeStart: free, latestTotalStart: total, constraint: lf.constraint });
    }
    return out;
  }

  /** ES do sucessor por uma única dependência. */
  private earliestFromOne(d: Entity, pred: Site, succ: Site): number {
    const type = num(d.get("m_nType"));
    if (type === DEP.BY_STATIONS) return this.esByStations(d, pred, succ);
    const total = this.ordered(succ).reduce((a, w) => a + (w.locked ? 0 : this.duration(succ, w)), 0);
    let t = type === DEP.FINISH_START || type === DEP.FINISH_FINISH ? this.siteEnd(pred) : this.siteBegin(pred);
    t = this.addDelay(d, pred, succ, t);
    if (type === DEP.START_FINISH || type === DEP.FINISH_FINISH) t = addWorkSeconds(succ.calendar, t, -total, true);
    return t;
  }
}
