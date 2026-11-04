/**
 * Janela do projeto (RN-031 aplicada; D-018, D-020/U-07b). Primitivas em @apex/calendar (workdays.ts). Evidência:
 * analises/2026-10-11_dynaroad/evidencias/decompilado/u07b/ ScheduleManager::UpdateProjectTimingDependentObjectTiming
 * @0x980430, UpdateProjectTimingDependentWorkSitesTiming @0x9807c0, ValidateCalendarDayBasedTimeSpan @0x9809b0,
 * CheckCalendarDayBasedTimeSpanTiming @0x97c9a0; u07b_vt/ Milestone::ValidateTiming @0x982430,
 * HasVariantTiming::ValidateTiming @0x973810.
 *
 * - [O] marcos: ValidateCalendarDayBasedTimeSpan(início, fim, true, true).
 * - [O] interrupções (usage breaks) de todas as road lines e áreas, e conexões não permanentes: se o tipo de data do
 *   início ≠ 0, valida com início/fim "por data" quando o tipo respectivo = 1 e grava só esses lados.
 * - [O ASM, U-54/L-038] `Project::SetTimeSpan@0x9136b0`: as duas datas vão ao início do dia; menos de 1 dia →
 *   BEGIN_TIME_GREATER_THAN_END_TIME; sem mudança, nada. Antes de gravar a janela nova (com as datas antigas no projeto),
 *   `UpdateProjectTimingDependentWorkSitesTiming@0x9807c0` nas tarefas da máscara 0x78 (jazida, bota-fora, pilha,
 *   britagem): lê as datas da tarefa (`HasTiming::GetBeginTime/GetEndTime` = work places, não as forçadas);
 *   `GetWorkDaysBetween(cal, inícioAntigo, inícioTarefa) < 1` → `SetBeginTime(novoInício)`;
 *   `GetWorkDaysBetween(cal, prazoAntigo, fimTarefa) < 1` → `SetEndTime(novoFim)` (ordem do PUSH: toda tarefa que
 *   termina antes do prazo antigo, ou até 1 dia útil depois, recebe o novo fim). [I] os setters são os de
 *   `HasSettableTiming` (engine/settiming.ts), P-4.
 * - [O] depois: grava a janela; marcos, usage breaks de todas as road lines e áreas e conexões não permanentes
 *   (`UpdateProjectTimingDependentObjectTiming@0x980430`); `ResetTimings`.
 * - [O] qualquer span que não caiba (fim antes do início, fora da janela, menos de 1 dia) lança
 *   BEGIN_TIME_GREATER_THAN_END_TIME; aqui a mudança inteira é desfeita (um nível de undo).
 */
import { BEGIN_TIME_GREATER_THAN_END_TIME, getWorkDaysBetween, TimeSpanError, validateCalendarDayBasedTimeSpan } from "@apex/calendar";
import type { Entity, Project } from "@apex/model";
import { resetTimings, siteSpan, workPlacesOf, wpBegin, wpEnd } from "./settiming.js";
import { Scheduler, setToEndOfDay } from "./timing.js";

const NON_STRICT = ["BorrowPit", "WasteLand", "StockPile", "CrushingPlant"];
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const big = (v: unknown) => (typeof v === "bigint" ? Number(v) : undefined);

function validateObject(e: Entity, pBegin: number, pEnd: number, byDateBegin: boolean, byDateEnd: boolean): void {
  const b = big(e.get("m_beginDate")), en = big(e.get("m_endDate"));
  if (b === undefined || en === undefined) return;
  const r = validateCalendarDayBasedTimeSpan(pBegin, pEnd, b, en, byDateBegin, byDateEnd);
  if (byDateBegin && r.begin !== b) e.set("m_beginDate", BigInt(r.begin));
  if (byDateEnd && r.end !== en) e.set("m_endDate", BigInt(r.end));
}

const DAY = 86400;
const beginOfDay = (t: number) => Math.floor(t / DAY) * DAY;

/** `Project::SetTimeSpan@0x9136b0` num nível de undo "Project timing", revalidando o que depende da janela. */
export function setProjectWindow(p: Project, begin: number, end: number): void {
  const b = beginOfDay(begin), e = beginOfDay(end);
  if ((e - b) / DAY < 1) throw new TimeSpanError(BEGIN_TIME_GREATER_THAN_END_TIME, "project");
  const root = p.root()!;
  if (big(root.get("m_dateBegin")) === b && big(root.get("m_dateDeadline")) === e) return;
  p.edit("Project timing", () => {
    const sched = new Scheduler(p);
    const oldBegin = sched.projectStart, oldEnd = sched.projectEnd;
    // `Postponer` [O]: os setters não recalculam na hora; o ResetTimings do fim usa os inícios desejados
    const wanted = new Map<bigint, number>();
    for (const cls of NON_STRICT)
      for (const ws of p.byClass(cls)) {
        const span = siteSpan(p, ws);
        if (!span) continue;
        const cal = sched.calendarOf(ws);
        const free = workPlacesOf(p, ws).filter((w) => w.get("m_bLockedAsActual") !== true);
        if (getWorkDaysBetween(cal, oldBegin, span.begin) < 1) {
          // WorkSite::SetBeginTime@0x942c60: cada work place mantém as horas de trabalho [O settiming.ts]
          for (const w of free) {
            const dur = cal.AS2WS(wpEnd(w)) - cal.AS2WS(wpBegin(w));
            w.set("pDVar2", BigInt(b));
            w.set("m_endTime", BigInt(dur !== 0 ? cal.WS2AS(cal.AS2WS(b) + dur, false) : b));
          }
          wanted.set(ws.oid, b);
        }
        const now = siteSpan(p, ws)!;
        if (getWorkDaysBetween(cal, oldEnd, now.end) < 1) {
          // WorkSite::SetEndTime@0x942ff0 das não estritas: o fim de cada work place vai ao fim do dia [O settiming.ts]
          if (e < now.begin) throw new TimeSpanError(BEGIN_TIME_GREATER_THAN_END_TIME, ws.name);
          const at = Math.max(setToEndOfDay(cal, e), now.begin);
          for (const w of free) w.set("m_endTime", BigInt(at));
        }
      }
    root.set("m_dateBegin", BigInt(b));
    root.set("m_dateDeadline", BigInt(e));
    for (const m of p.byClass("Milestone")) validateObject(m, b, e, true, true);
    for (const x of [...p.byClass("UsageBreak"), ...p.byClass("RoadConnection")]) {
      const bt = num(x.get("m_beginTimingType")), et = num(x.get("m_endTimingType"));
      if (bt === 0) continue; // permanente (conexão) ou sem data no início: HasVariantTiming::ValidateTiming não faz nada
      validateObject(x, b, e, bt === 1, et === 1);
    }
    resetTimings(p, wanted);
  });
}
