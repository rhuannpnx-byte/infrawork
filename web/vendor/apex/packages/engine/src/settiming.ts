/**
 * Edição de datas e dependências pelos gestos das visões de tempo (U-15: RF-043, RN-047, RN-048). Evidência:
 * analises/2026-10-11_dynaroad/evidencias/visoes/decompilado/tempo_extra/00942c60_WorkSite_SetBeginTime.c,
 * evidencias/decompilado/lacunas/chamadores/00942ff0_WorkSite_SetEndTime.c, decompilado/u07b_dep/
 * DependencyManager::AddDependency @0x9a3260, visoes/decompilado/interacao_extra/ AddDependencyCommand @0x50fa60 e
 * Execute @0x510170, visoes/decompilado/tempo_extra/005a4280_Helpers_DrawTimingConstraints.c;
 * visoes/visao_tempo.md §2.3–§2.4; analise_distancias_cronograma.md §2.7 (ResetTimings).
 *
 * - [O] WorkSite::SetBeginTime @0x942c60: SetWantedStart(data); cada work place passa a começar na data e mantém a
 *   própria duração em segundos de trabalho do calendário da tarefa (fim = WS2AS(AS2WS(data) + dur, false); dur 0 →
 *   fim = data); depois ScheduleManager::ResetTimings (recálculo com recursos). Não grava m_forcedBeginDate.
 * - [I] o work place pulado no laço (`QuantityImportSettings::IsIgnoreQuantitiesOutsideImportedSpans`, getter de 1 byte
 *   dobrado por ICF) é o travado como realizado (`m_bLockedAsActual`).
 * - [O] WorkSite::SetEndTime @0x942ff0: fim < início → BEGIN_TIME_GREATER_THAN_END_TIME; fim → SetToEndOfDay(calendário);
 *   fim = max(fim, início); igual ao atual → nada. Não estrita: cada work place termina no fim pedido e ResetTimings.
 *   Estrita: horas atuais = GetWorkHoursBetween(início, fim atual), novas = (AS2WS(fim) − AS2WS(início)) / 3600; atuais
 *   ≈ 0 → atuais = novas; se as duas > 0, SetWachCoeff(coef × atuais / novas).
 * - [I] GetWorkHoursBetween = segundos de trabalho do calendário da tarefa ÷ 3600; SetWachCoeff recalcula (ResetTimings).
 * - [O] DependencyManager::AddDependency @0x9a3260: dependência do usuário com os argumentos do diálogo (atrasos, dias
 *   úteis, cor, largura, visibilidade em tempo-local/Gantt/mapa), UILayOut com fonte, entra no fim de m_vDependencies,
 *   NotifyDependencyAdded nas duas tarefas e ResetTimings do sucessor. Rótulo "New dependency" (14193 = 0x3771).
 * - [I] UIInfo da dependência: bits 28/30/48 (BIT_DEPENDENCY_VISIBLE_IN_ROAD_TIME/GANTT/MAP_VIEW, mViewVisibilityBits
 *   @0x44b670) como gravados nos exemplos; fonte do UILayOut = cópia da fonte do layout do sucessor.
 * - [I] recusa de dependência circular com a mensagem 14240 (o texto existe no original; onde a checagem acontece não
 *   foi lido).
 * - [I] faixas de restrição do arraste (L-029): os getters de `TimingConstraintCalculator` estão dobrados por ICF; aqui
 *   cinza até o início mais cedo (ou o início atual no redimensionamento), verde/amarelo/vermelho pelos fins mais tarde
 *   livre, total e permitido do FloatCalculator.
 */
import { MAX_DATE, MIN_DATE, type Calendar } from "@apex/calendar";
import { encodeContainer, type Entity, type Project, type Ref } from "@apex/model";
import type { FieldValue } from "@apex/dr5";
import { Scheduler, setToEndOfDay, STRICT_CLASSES } from "./timing.js";
import { deferTiming } from "./postpone.js";

/** Textos do original para as recusas (strings_ui_en.txt). */
export const TIMING_EDIT_MESSAGES = {
  /** 14055 [I: a mensagem mostrada para BEGIN_TIME_GREATER_THAN_END_TIME] */
  BEGIN_TIME_GREATER_THAN_END_TIME: "Start time is later than finish time.",
  /** 14240 */
  CIRCULAR_DEPENDENCY: "The dependency could not be added as it would lead to a circular dependency.",
  /** [P] a própria tarefa é alvo inválido na criação por arraste (ValidateDependencyTargets @0x510700) */
  SAME_TASK: "The dependency could not be added as it would lead to a circular dependency.",
} as const;

export class TimingEditError extends Error {
  constructor(readonly code: keyof typeof TIMING_EDIT_MESSAGES) {
    super(TIMING_EDIT_MESSAGES[code]);
    this.name = "TimingEditError";
  }
}

const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);
const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
const date = (v: unknown) => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : 0);

export const workPlacesOf = (p: Project, ws: Entity): Entity[] => refs(ws.get("m_vpWorkPlaces")).map((o) => p.get(o)).filter((w): w is Entity => !!w);
/** início do work place (f209 `pDVar2`) e fim (f210 `m_endTime`) */
export const wpBegin = (w: Entity) => date(w.get("pDVar2"));
export const wpEnd = (w: Entity) => date(w.get("m_endTime"));
const locked = (w: Entity) => w.get("m_bLockedAsActual") === true;

/** WorkSite::GetBeginTime/GetEndTime: menor início e maior fim dos work places. */
export function siteSpan(p: Project, ws: Entity): { begin: number; end: number } | undefined {
  const wps = workPlacesOf(p, ws);
  if (wps.length === 0) return undefined;
  return { begin: Math.min(...wps.map(wpBegin)), end: Math.max(...wps.map(wpEnd)) };
}

/** ScheduleManager::ResetTimings @0x97ec40: recálculo com restrição de recursos; `wanted` = SetWantedStart. */
export function resetTimings(p: Project, wanted?: Map<bigint, number>): void {
  if (deferTiming(p, "timing", wanted)) return; // InfraWork: adiador de montagem em lote (postpone.ts)
  const s = new Scheduler(p, wanted ? { wanted } : {});
  s.write(s.calculate(true));
}

/** WorkSite::SetBeginTime @0x942c60 (RN-047). Deve rodar dentro de `Project.edit`. */
export function setBeginTime(p: Project, ws: Entity, at: number): void {
  const cal = new Scheduler(p).calendarOf(ws);
  const wps = workPlacesOf(p, ws);
  for (const w of wps) {
    if (locked(w)) continue;
    const dur = cal.AS2WS(wpEnd(w)) - cal.AS2WS(wpBegin(w));
    const end = dur !== 0 ? cal.WS2AS(cal.AS2WS(at) + dur, false) : at;
    w.set("pDVar2", BigInt(at));
    w.set("m_endTime", BigInt(end));
  }
  if (wps.length > 0) resetTimings(p, new Map([[ws.oid, at]]));
}

/**
 * `SumTask::SetBeginTime@0x949360` [O `tarefa_dialogo.md` §5]: cada tarefa da sum task mantém a distância ao início
 * do bloco, medida em horas de trabalho do próprio calendário, e os work places mantêm a duração; depois
 * `ResetTimings` com os inícios desejados. [I] as tarefas são as de todos os níveis abaixo da sum task.
 */
export function setTasksBeginTime(p: Project, tasks: readonly Entity[], at: number): void {
  const spans = tasks.map((t) => ({ t, s: siteSpan(p, t) })).filter((x): x is { t: Entity; s: { begin: number; end: number } } => !!x.s);
  if (spans.length === 0) return;
  const begin = Math.min(...spans.map((x) => x.s.begin));
  const sched = new Scheduler(p);
  const wanted = new Map<bigint, number>();
  for (const { t, s } of spans) {
    const cal = sched.calendarOf(t);
    const start = cal.WS2AS(cal.AS2WS(at) + (cal.AS2WS(s.begin) - cal.AS2WS(begin)), true);
    for (const w of workPlacesOf(p, t)) {
      if (locked(w)) continue;
      const dur = cal.AS2WS(wpEnd(w)) - cal.AS2WS(wpBegin(w));
      w.set("pDVar2", BigInt(start));
      w.set("m_endTime", BigInt(dur !== 0 ? cal.WS2AS(cal.AS2WS(start) + dur, false) : start));
    }
    wanted.set(t.oid, start);
  }
  resetTimings(p, wanted);
}

/** WorkSite::SetEndTime @0x942ff0 (RN-047). Deve rodar dentro de `Project.edit`. */
export function setEndTime(p: Project, ws: Entity, at: number): void {
  const span = siteSpan(p, ws);
  if (!span) return;
  if (at < span.begin) throw new TimingEditError("BEGIN_TIME_GREATER_THAN_END_TIME");
  const cal = new Scheduler(p).calendarOf(ws);
  const end = Math.max(setToEndOfDay(cal, at), span.begin);
  if (end === span.end) return;
  if (!STRICT_CLASSES.has(ws.className)) {
    for (const w of workPlacesOf(p, ws)) if (!locked(w)) w.set("m_endTime", BigInt(end));
    resetTimings(p);
    return;
  }
  let cur = (cal.AS2WS(span.end) - cal.AS2WS(span.begin)) / 3600;
  const next = (cal.AS2WS(end) - cal.AS2WS(span.begin)) / 3600;
  if (Math.abs(cur) < 1e-9) cur = next;
  if (cur > 0 && next > 0) {
    ws.set("m_dWachCoeff", (num(ws.get("m_dWachCoeff"), 1) * cur) / next);
    resetTimings(p);
  }
}

// ---------- dependência do usuário (RN-048) ----------

/** `DependencyDlg::DependencyArgs` (End @0x50ff00). */
export interface DependencyArgs {
  hasMinDelay: boolean;
  minDelay: number;
  hasMaxDelay: boolean;
  maxDelay: number;
  workDays: boolean;
  /** COLORREF 0x00BBGGRR */
  color: number;
  lineWidth: number;
  visibleTD: boolean;
  visibleGantt: boolean;
  visibleMap: boolean;
}

/**
 * Valor inicial de `DependencyDlg::m_lastArgs` (estático em `.data` @0x285504c) [O U-32, `dependencia_dialogo.md` §1]:
 * mínimo 0 em dias corridos, sem máximo, vermelho (COLORREF 0x0000FF), 1 px, visível nas três visões.
 */
export const DEFAULT_DEPENDENCY_ARGS: Readonly<DependencyArgs> = {
  hasMinDelay: true, minDelay: 0, hasMaxDelay: false, maxDelay: 0, workDays: false, color: 0x0000ff, lineWidth: 1,
  visibleTD: true, visibleGantt: true, visibleMap: true,
};

/** [I] o sucessor já alcança o predecessor pelas dependências existentes (qualquer tipo). */
export function wouldCreateCycle(p: Project, pred: bigint, succ: bigint): boolean {
  if (pred === succ) return true;
  const next = new Map<bigint, bigint[]>();
  for (const d of p.byClass("Dependency")) {
    const a = d.get("m_pPredecessor"), b = d.get("m_pSuccessor");
    if (typeof a === "bigint" && typeof b === "bigint") next.set(a, [...(next.get(a) ?? []), b]);
  }
  const seen = new Set<bigint>([succ]);
  const stack = [succ];
  while (stack.length) {
    const o = stack.pop()!;
    for (const t of next.get(o) ?? []) {
      if (t === pred) return true;
      if (!seen.has(t)) {
        seen.add(t);
        stack.push(t);
      }
    }
  }
  return false;
}

const boolMap = (entries: [number, boolean][]): FieldValue => ({
  kind: "map", type: 0x15, keyType: 7, valueType: 1,
  entries: entries.map(([k, b]) => [{ kind: "int", type: 7, value: k }, { kind: "int", type: 1, value: b ? 1 : 0 }]),
});
const emptyMap = (): FieldValue => ({ kind: "map", type: 0x15, keyType: null, valueType: null, entries: [] });

/** DependencyManager::AddDependency @0x9a3260 com IsUserGenerated = true. Deve rodar dentro de `Project.edit`. */
export function addUserDependency(p: Project, pred: Entity, succ: Entity, type: number, args: DependencyArgs = DEFAULT_DEPENDENCY_ARGS): Entity {
  if (pred.oid === succ.oid) throw new TimingEditError("SAME_TASK");
  if (wouldCreateCycle(p, pred.oid, succ.oid)) throw new TimingEditError("CIRCULAR_DEPENDENCY");
  const ui = p.create("UIInfo");
  ui.set("m_strName", "");
  ui.set("m_strLongName", "");
  ui.set("m_pUIInfo", null);
  ui.setRaw("m_mBool", boolMap([[28, args.visibleTD], [30, args.visibleGantt], [48, args.visibleMap]]));
  ui.setRaw("m_mDouble", emptyMap());
  ui.setRaw("m_mInt", emptyMap());
  const lay = p.create("UILayOut");
  lay.set("m_strName", "");
  lay.set("m_strLongName", "");
  lay.set("m_pUIInfo", null);
  lay.set("m_color", args.color);
  lay.set("m_nLineWidth", args.lineWidth);
  const font = p.resolve(p.resolve(succ.get("m_pLayOut") as Ref)?.get("m_pFont") as Ref);
  if (font) lay.set("m_pFont", p.create(font.classId, structuredClone(font.fields)).oid);
  const d = p.create("Dependency");
  d.set("m_strName", "");
  d.set("m_strLongName", "");
  d.set("m_pUIInfo", ui.oid);
  d.set("m_bUserGenerated", true);
  d.set("m_pPredecessor", pred.oid);
  d.set("m_pSuccessor", succ.oid);
  d.set("m_nDelayMin", args.minDelay);
  d.set("m_nDelayMax", args.maxDelay);
  d.set("m_nType", type);
  d.set("m_pUILayOut", lay.oid);
  d.set("m_bIsDelayWorkDays", args.workDays);
  d.set("m_bHasMinDelay", args.hasMinDelay);
  d.set("m_bHasMaxDelay", args.hasMaxDelay);
  const mgr = p.resolve(succ.get("m_pDependencyManager") as Ref) ?? p.resolve(p.root()!.get("m_pDependencyManager") as Ref);
  if (mgr) mgr.setRaw("m_vDependencies", encodeContainer(0x18, [...refs(mgr.get("m_vDependencies")), d.oid]));
  for (const ws of [pred, succ]) ws.setRaw("m_vpDependencies", encodeContainer(0x18, [...refs(ws.get("m_vpDependencies")), d.oid]));
  resetTimings(p);
  return d;
}

// ---------- faixas de restrição do arraste (RN-041, L-029) ----------

export interface TimingBands {
  /** cinza no arraste de mover: (−∞, início mais cedo) — início do projeto e predecessores */
  earliestStart: number;
  /**
   * U-61d: `anonymous::GetEarliestStartHard@0x9ceb40` [O] = max(início do projeto, início mais cedo pelas dependências);
   * `GetEarliestStartSoft@0x9cebc0` [O] = max(hard, início dos marcos que incluem a tarefa, data forçada de início).
   * `DrawTimingConstraints@0x5a4280` (getters de `Float` dobrados pelo ICF sobre o `TimingConstraintCalculator`:
   * +8 = hard, +16 = soft): ao mover, cinza até hard e vermelho (hard, soft) se hard < soft.
   */
  earliestStartHard: number;
  earliestStartSoft: number;
  /** cinza no redimensionamento: (−∞, início atual) [O] */
  currentStart: number;
  /** verde: (fim mais tarde livre, fim mais tarde total) */
  latestFreeFinish: number;
  /** amarelo: (fim mais tarde total, fim mais tarde permitido) */
  latestTotalFinish: number;
  /** vermelho: (fim mais tarde permitido, +∞) — prazo, marcos, datas forçadas */
  latestAllowedFinish: number;
}

/** `TimingConstraintCalculator(site, project)` criado no OnLButtonDown @0x507370 [I: limites, L-029]. */
export function timingBands(p: Project, ws: Entity): TimingBands | undefined {
  let s: Scheduler;
  try {
    s = new Scheduler(p);
  } catch {
    return undefined;
  }
  const site = s.sites.get(ws.oid);
  if (!site || !site.strict || site.wps.length === 0) return undefined;
  const f = s.floats(s.order()).get(ws.oid);
  const begin = Math.min(...site.wps.map((w) => w.begin));
  const dur = s.nonLockedDuration(site);
  const cal: Calendar = site.calendar;
  const finish = (start: number) => Math.min(MAX_DATE, Math.max(MIN_DATE, cal.WS2AS(cal.AS2WS(start) + dur, false)));
  const hard = Math.max(s.projectStart, s.earliestStart(ws.oid));
  // `GetMilestoneConstraints`: o maior início dos marcos que incluem a tarefa; `GetForcedBeginDate` se há restrição [O]
  let soft = hard;
  for (const m of p.byClass("Milestone")) {
    const b = m.get("m_beginDate");
    const bd = typeof b === "bigint" ? Number(b) : typeof b === "number" ? b : undefined;
    if (bd !== undefined && s.isInMilestone(m, site)) soft = Math.max(soft, bd);
  }
  const fbc = ws.get("m_forcedBeginConstraint"), fb = ws.get("m_forcedBeginDate");
  if (typeof fbc === "number" && fbc !== 0 && (typeof fb === "bigint" || typeof fb === "number")) soft = Math.max(soft, Number(fb));
  return {
    earliestStart: hard,
    earliestStartHard: hard,
    earliestStartSoft: soft,
    currentStart: f?.currentStart ?? begin,
    latestFreeFinish: finish(f?.latestFreeStart ?? begin),
    latestTotalFinish: finish(f?.latestTotalStart ?? begin),
    latestAllowedFinish: s.latestAllowedFinish(site).date,
  };
}
