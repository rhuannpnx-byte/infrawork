/**
 * Pack schedule (RF-031, RN-006; D-020/U-07b). Evidência: analises/2026-10-11_dynaroad/evidencias/decompilado/
 * distancias_tempo/ ScheduleManager::PackSchedule @0x97ea00, AllowedTimingsOptimizer @0x9fd510;
 * distancias_tempo_extra/ anon::ChooseBest @0x9fd730, lote2/ TotalFloatCmp @0x97bc20; u07b/ anon::Less @0x97ba40,
 * WorkSite::IsSuitable @0x9404b0, WorkSiteHelpers::GetMainSWGU @0x9293e0.
 *
 * - [O] CPM otimista: todas as tarefas ASAP, taxa da equipe adequada de maior taxa × max(coef, 1), sem recursos; folgas.
 * - [O] ordenação estável de todas as tarefas (ordem do WorkSiteContainer) pelo fim total mais tarde
 *   (WS2AS(AS2WS(latestTotalStart) + dur, false)); empate: menor duração; empate: Less.
 * - [O] Less: road lines diferentes → nome da road line; senão estaca inicial menor; senão tipos (lexicográfico por
 *   nome) se diferentes; senão nome da tarefa.
 * - [O] do fim para o início: prioridade 10, 20, 30…; início desejado = início do projeto; ResetTimings (com recursos).
 * - [I] road line da tarefa = a do local do primeiro work place; estaca inicial = menor início dos work places;
 *   tarefa não estrita entra na ordenação com as datas atuais e sem dependências (RN-018).
 */
import type { Entity, Project, Ref } from "@apex/model";
import { projectUndoText } from "./names.js";
import { Scheduler, type Site, type TimingResult } from "./timing.js";

/** Rótulo do `PackScheduleCommand` (string 14584) [O]. */
export const PACK_SCHEDULE_ACTION = "Pack schedule";

const CONTAINER_ORDER = ["m_vpLandCuts", "m_vpEmbankments", "m_vpMassExchanges", "m_vpBorrowPits", "m_vpWasteLands", "m_vpStockPiles", "m_vpCrushingPlants", "m_vpOtherWorkSites"];
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface PackResult {
  priorities: Map<bigint, number>;
  result: TimingResult;
}

function workSitesInContainerOrder(p: Project, sched: Scheduler): bigint[] {
  const c = p.resolve(p.root()!.get("m_pWSContainer") as Ref);
  const out: bigint[] = [];
  if (c) for (const k of CONTAINER_ORDER) for (const o of (c.get(k) as unknown[] | undefined) ?? []) if (typeof o === "bigint" && sched.sites.has(o)) out.push(o);
  for (const o of sched.sites.keys()) if (!out.includes(o)) out.push(o);
  return out;
}

function roadLineAndStation(p: Project, s: Site): [Entity | undefined, number] {
  const first = s.wps[0];
  const loc = first ? p.resolve(first.entity.get("m_pLocation") as Ref) : undefined;
  const rl = loc ? p.resolve(loc.get("m_pRoadLine") as Ref) : undefined;
  return [rl, s.wps.length ? Math.min(...s.wps.map((w) => w.stationBegin)) : 0];
}

function typeNames(p: Project, e: Entity): string[] {
  return ["m_pSourceLandType", "m_pDestLandType", "m_pWorkType"].map((k) => e.get(k)).filter((x): x is bigint => typeof x === "bigint").map((o) => p.get(o)?.name ?? "");
}

/** anon::Less @0x97ba40 como comparador (-1/0/1). */
function less(p: Project, a: Site, b: Site): number {
  const [ra, sa] = roadLineAndStation(p, a), [rb, sb] = roadLineAndStation(p, b);
  if (ra !== rb) return cmpStr(ra?.name ?? "", rb?.name ?? "");
  if (Math.abs(sa - sb) > 1e-9) return sa < sb ? -1 : 1;
  const ta = typeNames(p, a.entity), tb = typeNames(p, b.entity);
  if (ta.join("\u0000") !== tb.join("\u0000")) {
    for (let i = 0; i < Math.min(ta.length, tb.length); i++) if (ta[i] !== tb[i]) return cmpStr(ta[i]!, tb[i]!);
    return ta.length - tb.length;
  }
  return cmpStr(a.entity.name, b.entity.name);
}

/** ScheduleManager::PackSchedule @0x97ea00: grava prioridades e datas num nível de undo "Pack schedule". */
export function packSchedule(project: Project): PackResult {
  const opt = new Scheduler(project, { optimistic: true });
  const order = opt.order();
  opt.calculate(false);
  const all = [...order, ...[...opt.sites.keys()].filter((o) => !order.includes(o))];
  const floats = opt.floats(all);
  const key = new Map<bigint, { finish: number; dur: number }>();
  for (const [oid, s] of opt.sites) {
    const dur = opt.nonLockedDuration(s);
    const lts = floats.get(oid)!.latestTotalStart;
    key.set(oid, { finish: dur !== 0 ? s.calendar.WS2AS(s.calendar.AS2WS(lts) + dur, false) : lts, dur });
  }
  const sorted = workSitesInContainerOrder(project, opt).sort((a, b) => {
    const ka = key.get(a)!, kb = key.get(b)!;
    return ka.finish - kb.finish || ka.dur - kb.dur || less(project, opt.sites.get(a)!, opt.sites.get(b)!);
  });
  const priorities = new Map<bigint, number>();
  const wanted = new Map<bigint, number>();
  let prio = 10;
  for (let i = sorted.length - 1; i >= 0; i--, prio += 10) {
    priorities.set(sorted[i]!, prio);
    wanted.set(sorted[i]!, opt.projectStart);
  }
  let result!: TimingResult;
  // U-61f: `PackScheduleCommand@0x5bb840` = SimpleCommand(14584 "Pack schedule", alvo = projeto) via Controller::Invoke →
  // nível "<projeto>: pack schedule" (MakeUndoText) [O]; `MainFrame::OnPackSchedule@0x5c13b0` é síncrono, sem diálogo [O]
  project.edit(projectUndoText(project, PACK_SCHEDULE_ACTION), () => {
    for (const [oid, pr] of priorities) project.get(oid)!.set("m_nSchedulingPriority", pr);
    const s = new Scheduler(project, { wanted });
    result = s.calculate(true);
    s.write(result);
  });
  return { priorities, result };
}
