/**
 * Dias de calendário e dias úteis usados pela janela do projeto (RN-031, primitivas — D-018) e pelas
 * dependências (RN-003). Evidência: analises/2026-10-11_dynaroad/evidencias/decompilado/{calendario,distancias_tempo}/.
 */
import { DAY, type Calendar } from "./calendar.js";

/** DDL::SetToBeginOfCalendarDay @008ec480: 00:00 do dia. */
export function beginOfCalendarDay(t: number): number {
  return t - (((t % DAY) + DAY) % DAY);
}

/** DDL::SetToEndOfCalendarDay @008ec6d0: 00:00 do dia seguinte (fim exclusivo); meia-noite exata não muda. */
export function endOfCalendarDay(t: number): number {
  const r = ((t % DAY) + DAY) % DAY;
  return r === 0 ? t : t - r + DAY;
}

/** DDL::Date::IsWorkDay @008ec180: o dia tem algum segundo de trabalho (AS2WS(00:00 + 86399) > AS2WS(00:00)). */
export function isWorkDay(cal: Calendar, t: number): boolean {
  const d = beginOfCalendarDay(t);
  return cal.AS2WS(d + DAY - 1) - cal.AS2WS(d) > 0;
}

/**
 * DDL::Calendar::GetWorkDaysBetween @008e9df0. Recua o fim, dia a dia, até um dia útil (sem passar do
 * início); conta os períodos de trabalho inteiros entre os dois instantes (dois pontos por período) e soma a
 * fração dos períodos das pontas. Negativo se o fim ficar antes do início.
 * [I] as frações (operandos dos `_ltod3`) = parte do período dentro do intervalo ÷ duração do período, como
 * no AddWorkDays.
 */
export function getWorkDaysBetween(cal: Calendar, a: number, b: number): number {
  let d = b;
  while (!isWorkDay(cal, d) && a < d) d -= DAY;
  if (a === d) return 0;
  const sign = d < a ? -1 : 1;
  const lo = Math.min(a, d), hi = Math.max(a, d);
  return sign * cal.workDaysSpan(lo, hi);
}

export const BEGIN_TIME_GREATER_THAN_END_TIME = "BEGIN_TIME_GREATER_THAN_END_TIME";

export class TimeSpanError extends Error {
  constructor(readonly code: typeof BEGIN_TIME_GREATER_THAN_END_TIME, at: string) {
    super(`${code} (${at})`);
    this.name = "TimeSpanError";
  }
}

/**
 * ScheduleManager::ValidateCalendarDayBasedTimeSpan @009809b0 (+ CheckCalendarDayBasedTimeSpanTiming @0097c9a0):
 * normaliza um período "por dia" de marco, interrupção ou interseção dentro da janela [pBegin, pEnd] do projeto.
 * - início → 00:00 do dia, limitado à janela; fim → 00:00 do dia seguinte, limitado à janela;
 * - se ficarem iguais, abre um dia para o lado com espaço (fim + 1 dia se faltar ≥ 1 dia até o fim do projeto,
 *   senão início − 1 dia se houver ≥ 1 dia desde o início) [I: os operandos dos `_ltod3` são essas distâncias];
 * - com os dois lados validados: fim antes do início, fora da janela ou menos de 1 dia → BEGIN_TIME_GREATER_THAN_END_TIME.
 */
export function validateCalendarDayBasedTimeSpan(
  pBegin: number, pEnd: number, begin: number, end: number, validateBegin: boolean, validateEnd: boolean,
): { begin: number; end: number } {
  const clamp = (t: number) => Math.min(Math.max(t, pBegin), pEnd);
  if (validateBegin) begin = clamp(beginOfCalendarDay(begin));
  if (validateEnd) end = clamp(endOfCalendarDay(end));
  if (begin === end) {
    if (validateEnd && (pEnd - end) / DAY >= 1) end += DAY;
    else if (validateBegin && (begin - pBegin) / DAY >= 1) begin -= DAY;
  }
  if (validateBegin && validateEnd) {
    if (end < begin) throw new TimeSpanError(BEGIN_TIME_GREATER_THAN_END_TIME, "fim antes do início");
    const inside = begin >= pBegin && begin <= pEnd && end >= pBegin && end <= pEnd;
    if (!inside) throw new TimeSpanError(BEGIN_TIME_GREATER_THAN_END_TIME, "fora da janela do projeto");
    if ((end - begin) / DAY < 1) throw new TimeSpanError(BEGIN_TIME_GREATER_THAN_END_TIME, "menos de 1 dia");
  }
  return { begin, end };
}
