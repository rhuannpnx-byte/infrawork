// U-04: primitivas de dias úteis e da janela do projeto (RN-031 parte do calendário, D-018).
import { describe, expect, it } from "vitest";
import {
  beginOfCalendarDay, Calendar, ddlDateFromParts, endOfCalendarDay, getWorkDaysBetween, isWorkDay,
  validateCalendarDayBasedTimeSpan, type CalendarSpec,
} from "../src/index.js";

const at = (y: number, m: number, d: number, h = 0, mi = 0) => Number(ddlDateFromParts(y, m, d, h, mi));
const H = 3600, DAY = 86400;
const week = (len: number): CalendarSpec["week"] => ({
  flag: 1,
  days: [...Array(5).fill({ begin: 7 * H, length: len }), { begin: 7 * H, length: 0 }, { begin: 7 * H, length: 0 }] as CalendarSpec["week"]["days"],
});
const cal = new Calendar({ version: 12, week: week(10 * H), generators: [], order: [], spans: [] });

describe("dias de calendário (SetToBegin/EndOfCalendarDay)", () => {
  it("início = 00:00; fim = 00:00 do dia seguinte; meia-noite exata não muda", () => {
    expect(beginOfCalendarDay(at(2015, 3, 30, 13, 20))).toBe(at(2015, 3, 30));
    expect(endOfCalendarDay(at(2015, 3, 30, 13, 20))).toBe(at(2015, 3, 31));
    expect(endOfCalendarDay(at(2015, 3, 30))).toBe(at(2015, 3, 30));
  });
});

describe("IsWorkDay e GetWorkDaysBetween", () => {
  it("dia útil = há algum segundo de trabalho", () => {
    expect(isWorkDay(cal, at(2015, 3, 30, 3))).toBe(true);
    expect(isWorkDay(cal, at(2015, 4, 4, 12))).toBe(false); // sábado
  });
  it("dias inteiros, frações das pontas, sinal e fim recuado para dia útil", () => {
    expect(getWorkDaysBetween(cal, at(2015, 3, 30, 7), at(2015, 4, 2, 7))).toBe(3);
    expect(getWorkDaysBetween(cal, at(2015, 3, 30, 12), at(2015, 3, 31, 12))).toBe(1);
    expect(getWorkDaysBetween(cal, at(2015, 3, 30, 7), at(2015, 3, 30, 12))).toBe(0.5);
    expect(getWorkDaysBetween(cal, at(2015, 4, 2, 7), at(2015, 3, 30, 7))).toBe(-3);
    // fim no sábado recua até a sexta, que é dia útil
    expect(getWorkDaysBetween(cal, at(2015, 3, 30, 7), at(2015, 4, 4, 12))).toBe(getWorkDaysBetween(cal, at(2015, 3, 30, 7), at(2015, 4, 3, 12)));
    expect(getWorkDaysBetween(cal, at(2015, 3, 30, 7), at(2015, 3, 30, 7))).toBe(0);
  });
  it("menos de 1 dia útil entre a borda do projeto e uma data (critério de UpdateProjectTimingDependentWorkSitesTiming)", () => {
    expect(getWorkDaysBetween(cal, at(2015, 3, 27, 12), at(2015, 3, 30, 6))).toBe(0.5); // meia sexta
    expect(getWorkDaysBetween(cal, at(2015, 3, 27, 7), at(2015, 3, 30, 6))).toBe(1); // a sexta inteira
    expect(getWorkDaysBetween(cal, at(2015, 3, 27, 12), at(2015, 3, 30, 6)) < 1).toBe(true);
  });
});

describe("ValidateCalendarDayBasedTimeSpan (RN-031)", () => {
  const pb = at(2015, 3, 25), pe = at(2017, 3, 25);
  it("normaliza para dias inteiros e limita à janela", () => {
    expect(validateCalendarDayBasedTimeSpan(pb, pe, at(2016, 1, 10, 9), at(2016, 1, 12, 15), true, true)).toEqual({ begin: at(2016, 1, 10), end: at(2016, 1, 13) });
    expect(validateCalendarDayBasedTimeSpan(pb, pe, at(2014, 1, 1), at(2015, 4, 2, 1), true, true)).toEqual({ begin: pb, end: at(2015, 4, 3) });
  });
  it("período vazio vira 1 dia para o lado com espaço", () => {
    expect(validateCalendarDayBasedTimeSpan(pb, pe, at(2016, 1, 10), at(2016, 1, 10), true, true)).toEqual({ begin: at(2016, 1, 10), end: at(2016, 1, 11) });
    expect(validateCalendarDayBasedTimeSpan(pb, pe, pe, pe + 3600, true, true)).toEqual({ begin: pe - DAY, end: pe });
  });
  it("fim antes do início → BEGIN_TIME_GREATER_THAN_END_TIME; só um lado validado não confere", () => {
    expect(() => validateCalendarDayBasedTimeSpan(pb, pe, at(2016, 2, 1), at(2016, 1, 1), true, true)).toThrow("BEGIN_TIME_GREATER_THAN_END_TIME");
    expect(validateCalendarDayBasedTimeSpan(pb, pe, at(2016, 2, 1, 5), at(2016, 1, 1), true, false)).toEqual({ begin: at(2016, 2, 1), end: at(2016, 1, 1) });
  });
});
