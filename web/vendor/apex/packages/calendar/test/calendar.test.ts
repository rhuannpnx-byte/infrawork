// U-04: blob do calendário (L-001) e calendário de trabalho (RF-011, RD-019, RNF-007).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readDr5, type Field } from "../../dr5/src/index.js";
import { oracleFiles } from "../../dr5/test/helpers.js";
import {
  addWorkTimeSpan, Calendar, calendarSpan, ddlDateFromParts, findEaster, holidayGenerator, MAX_DATE, normalizeOrder, parseCalendarBlob, serializeCalendarBlob,
  setDefaultWeek, validateWorkDay, type CalendarSpec, type WorkDay,
} from "../src/index.js";

const at = (y: number, m: number, d: number, h = 0, mi = 0) => Number(ddlDateFromParts(y, m, d, h, mi));
const H = 3600;

/** Blobs de calendário (classe 100, f100 tipo 0x10) dos .dr5 disponíveis, por conteúdo. */
function blobs(): Map<string, { bytes: Uint8Array; where: string[] }> {
  const out = new Map<string, { bytes: Uint8Array; where: string[] }>();
  for (const { entry, path } of oracleFiles()) {
    for (const r of readDr5(new Uint8Array(readFileSync(path))).records) {
      if (r.classId !== 100) continue;
      const f = r.fields.find((x: Field) => x.id === 100 && x.type === 0x10);
      if (!f || f.value.kind !== "bytes") continue;
      const key = Buffer.from(f.value.value).toString("hex");
      if (!out.has(key)) out.set(key, { bytes: f.value.value, where: [] });
      out.get(key)!.where.push(`${entry.file}#${r.oid}`);
    }
  }
  return out;
}
const all = blobs();
const byWhere = (s: string) => parseCalendarBlob([...all.values()].find((b) => b.where.some((w) => w.startsWith(s)))!.bytes);

describe("blob do calendário (L-001)", () => {
  it("todos os blobs distintos são lidos até o fim e regravados idênticos", () => {
    expect(all.size).toBe(oracleFiles().length === 27 ? 7 : 1);
    for (const { bytes } of all.values()) expect(serializeCalendarBlob(parseCalendarBlob(bytes))).toEqual(bytes);
  });
  it("padrão de 73 bytes: versão 12, seg–sex 07:00 + 10 h, fim de semana 0 h, sem feriados", () => {
    const c = byWhere("en/default.dr5");
    expect(c.version).toBe(12);
    expect(c.week.days.map((d) => [d.begin, d.length])).toEqual([...Array(5).fill([7 * H, 10 * H]), [7 * H, 0], [7 * H, 0]]);
    expect([c.generators.length, c.spans.length]).toEqual([0, 0]);
  });
  it.skipIf(all.size < 7)("sueco: feriados nomeados e tipos 3, 4 e 5", () => {
    const c = byWhere("sv/default.dr5");
    expect(c.generators.map((g) => `${g.name}:${g.type}`).slice(0, 5)).toEqual(["Jul & Nyår:StaticHoliday", "Midsommar:StaticWeekDay", "Första maj:StaticHoliday", "Nationaldagen:StaticHoliday", "Påsk:Easter"]);
  });
  it("blob truncado ou de outra versão é recusado", () => {
    const b = [...all.values()][0]!.bytes;
    expect(() => parseCalendarBlob(b.subarray(0, 40))).toThrow(/fim inesperado/);
    const v = new Uint8Array(b);
    v[3] = 11;
    expect(() => parseCalendarBlob(v)).toThrow(/versão/);
  });
});

describe("calendário padrão: AS2WS / WS2AS (RNF-007)", () => {
  const cal = new Calendar(byWhere("en/default.dr5"));
  const mon = at(2015, 3, 30); // segunda
  it("10 h de trabalho por dia útil; fim de semana não conta", () => {
    expect(cal.AS2WS(mon + 17 * H) - cal.AS2WS(mon + 7 * H)).toBe(10 * H);
    expect(cal.AS2WS(mon + 12 * H) - cal.AS2WS(mon)).toBe(5 * H);
    const sat = at(2015, 4, 4);
    expect(cal.AS2WS(sat + 12 * H)).toBe(cal.AS2WS(sat));
    expect(cal.AS2WS(at(2015, 4, 6, 7)) - cal.AS2WS(at(2015, 4, 3, 17))).toBe(0); // sex 17:00 → seg 07:00
    expect(cal.AS2WS(at(2015, 4, 6, 7)) - cal.AS2WS(mon + 7 * H)).toBe(5 * 10 * H);
  });
  it("monótona e WS2AS ∘ AS2WS = identidade dentro do expediente", () => {
    let prev = -Infinity;
    for (let t = mon - 3 * 86400; t < mon + 30 * 86400; t += 1777) {
      const w = cal.AS2WS(t);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
      if (cal.isWorkTime(t)) {
        expect(cal.WS2AS(w, true)).toBe(t);
        expect(cal.WS2AS(w, false)).toBe(t);
      }
    }
  });
  it("WS numa folga: início do próximo expediente ou fim do anterior", () => {
    const w = cal.AS2WS(mon + 20 * H);
    expect(cal.WS2AS(w, true)).toBe(at(2015, 3, 31, 7));
    expect(cal.WS2AS(w, false)).toBe(mon + 17 * H);
  });
  it("AddWorkDays: sex 17:00 + 1 → seg 17:00 (fim) ou ter 07:00 (início); qua 12:00 + 0,5 → qua 17:00", () => {
    const fri = at(2015, 3, 27, 17);
    expect(cal.addWorkDays(fri, 1, false)).toBe(at(2015, 3, 30, 17));
    expect(cal.addWorkDays(fri, 1, true)).toBe(at(2015, 3, 31, 7));
    expect(cal.addWorkDays(at(2015, 4, 1, 12), 0.5, false)).toBe(at(2015, 4, 1, 17));
    expect(cal.addWorkDays(mon + 7 * H, 2.5, false)).toBe(at(2015, 4, 1, 12));
  });
  it("Grow até 2999 e erro depois de GetMaxDate", () => {
    const t = at(2999, 12, 30, 9);
    expect(cal.AS2WS(t)).toBeGreaterThan(cal.AS2WS(mon));
    expect(() => cal.AS2WS(MAX_DATE + 86400 * 400)).toThrow(/2999/);
  });
});

describe.skipIf(all.size < 7)("feriados e exceções de jornada dos exemplos", () => {
  const noWork = (cal: Calendar, y: number, m: number, d: number) => cal.AS2WS(at(y, m, d, 23, 59)) - cal.AS2WS(at(y, m, d));
  it("sueco (Mallkalender): Första maj anual, Semester 2012 não anual, Jul & Nyår atravessa o ano", () => {
    const cal = new Calendar(byWhere("sv/default.dr5"));
    expect(noWork(cal, 2015, 5, 1)).toBe(0); // sexta, 1º de maio
    expect(noWork(cal, 2015, 5, 4)).toBe(10 * H);
    expect(noWork(cal, 2012, 7, 2)).toBe(0); // Semester 2012
    expect(noWork(cal, 2013, 7, 2)).toBe(0); // Semester 2013
    expect(noWork(cal, 2016, 7, 4)).toBe(10 * H); // não há Semester 2016
    expect(noWork(cal, 2006, 12, 27)).toBe(0); // Jul & Nyår 24/12–02/01
    expect(noWork(cal, 2007, 1, 2)).toBe(0);
    expect(noWork(cal, 2007, 1, 3)).toBe(10 * H);
    expect(cal.ignoredGenerators).toEqual([]); // U-38: Easter e StaticWeekDay aplicados (L-036)
  });
  it("francês com intempéries: período anual 08/12–28/02 e exceção '2 postes' (07:00 + 16 h) no verão de 2009", () => {
    const cal = new Calendar(byWhere("fr/default.dr5#510"));
    expect(noWork(cal, 2010, 1, 15)).toBe(0);
    expect(noWork(cal, 2010, 3, 1)).toBe(10 * H);
    expect(noWork(cal, 2009, 6, 1)).toBe(16 * H);
    expect(noWork(cal, 2009, 8, 31)).toBe(10 * H);
    expect(noWork(cal, 2009, 7, 14)).toBe(16 * H); // a exceção sobrescreve o feriado (FillVectors: spans por último)
  });
  it("AddWorkDays em dois calendários (8 h × 10 h) — base de CA-RN-003", () => {
    const sv = new Calendar(byWhere("sv/tutorial-template.dr5"));
    const def = new Calendar(byWhere("en/default.dr5"));
    const t = at(2015, 3, 30, 12);
    expect(sv.spec.week.days[0]).toEqual({ begin: 7 * H, length: 8 * H });
    expect(def.addWorkDays(t, 2, false)).toBe(at(2015, 4, 1, 12));
    expect(sv.addWorkDays(t, 2, false)).toBe(at(2015, 4, 1, 12));
  });
});

describe("calendário sem expediente", () => {
  it("'No working time'", () => {
    const empty: CalendarSpec = { version: 12, week: { flag: 1, days: Array.from({ length: 7 }, () => ({ begin: 0, length: 0 })) as CalendarSpec["week"]["days"] }, generators: [], order: [], spans: [] };
    expect(() => new Calendar(empty)).toThrow("No working time");
  });
});

// ---------- U-38: geradores (L-036) e edição (`calendario_dialogos.md` §5–§7) ----------

const week = (len: number, begin = 25200): WorkDay[] => [0, 1, 2, 3, 4].map(() => ({ begin, length: len })).concat([{ begin, length: 0 }, { begin, length: 0 }]);
const spec = (extra: Partial<CalendarSpec> = {}): CalendarSpec => ({ version: 12, week: { flag: 1, days: week(10 * H) as CalendarSpec["week"]["days"] }, generators: [], order: [], spans: [], ...extra });
const dayWork = (cal: Calendar, y: number, m: number, d: number) => cal.AS2WS(at(y, m, d, 23, 59)) - cal.AS2WS(at(y, m, d));

describe("U-38: geradores Easter, StaticWeekDay e feriado anual", () => {
  it("FindEaster: Páscoa 2016-03-27, 2017-04-16, 2018-04-01 (dias depois de 21/03)", () => {
    expect([2016, 2017, 2018].map(findEaster)).toEqual([6, 26, 11]);
  });
  it("Easter apaga sexta-feira santa, domingo, segunda e a Ascensão (P+39)", () => {
    const cal = new Calendar(spec({ generators: [{ type: "Easter", name: "Easter" }], order: [0] }));
    expect(dayWork(cal, 2016, 3, 25)).toBe(0); // sexta-feira santa
    expect(dayWork(cal, 2016, 3, 28)).toBe(0); // segunda de Páscoa
    expect(dayWork(cal, 2016, 3, 29)).toBe(10 * H);
    expect(dayWork(cal, 2016, 5, 5)).toBe(0); // Ascensão
    expect(dayWork(cal, 2017, 4, 14)).toBe(0);
    expect(dayWork(cal, 2018, 5, 10)).toBe(0);
  });
  it("StaticWeekDay: o dia da semana em dd/mm ou depois, todo ano (hora gravada ignorada)", () => {
    // Midsommar: sexta (4) a partir de 19/06
    const cal = new Calendar(spec({ generators: [{ type: "StaticWeekDay", name: "Midsommar", date: BigInt(at(2004, 6, 19, 14, 58)), weekday: 4 }], order: [0] }));
    expect(dayWork(cal, 2016, 6, 24)).toBe(0);
    expect(dayWork(cal, 2016, 6, 17)).toBe(10 * H);
    expect(dayWork(cal, 2017, 6, 23)).toBe(0);
    expect(dayWork(cal, 2018, 6, 22)).toBe(0);
  });
  it("feriado anual preserva a DURAÇÃO: 28/02–01/03/2016 (3 dias, com 29/02) em 2017 vai até 02/03", () => {
    const g = holidayGenerator("H", at(2016, 2, 28), at(2016, 3, 1), true);
    const cal = new Calendar(spec({ generators: [g], order: [0] }));
    expect(dayWork(cal, 2017, 2, 28)).toBe(0); // terça
    expect(dayWork(cal, 2017, 3, 1)).toBe(0);
    expect(dayWork(cal, 2017, 3, 2)).toBe(0); // a mesma data final (01/03) deixaria esta quinta útil
    expect(dayWork(cal, 2017, 3, 3)).toBe(10 * H);
  });
  it("lista de ordem: gerador fora dela é descartado (UnSerialize)", () => {
    const s = spec({ generators: [holidayGenerator("A", at(2016, 3, 1), at(2016, 3, 1), false), holidayGenerator("B", at(2016, 3, 2), at(2016, 3, 2), false)], order: [1] });
    const cal = new Calendar(s);
    expect(dayWork(cal, 2016, 3, 1)).toBe(10 * H);
    expect(dayWork(cal, 2016, 3, 2)).toBe(0);
    expect(normalizeOrder(s).generators.map((g) => g.name)).toEqual(["B"]);
  });
  it("exceção de jornada: dia −1 mantém o estado anterior (semana menos feriados); dia definido vence o feriado", () => {
    const days = week(16 * H, 21600);
    days[0] = { begin: 0, length: -1 }; // segunda não definida
    const s = spec({ generators: [holidayGenerator("H", at(2016, 3, 7), at(2016, 3, 8), false)], order: [0], spans: [calendarSpan("2 postes", at(2016, 3, 1), at(2016, 3, 31), days)] });
    const cal = new Calendar(s);
    expect(dayWork(cal, 2016, 3, 7)).toBe(0); // segunda −1: continua o feriado
    expect(dayWork(cal, 2016, 3, 14)).toBe(10 * H); // segunda −1: semana padrão
    expect(dayWork(cal, 2016, 3, 8)).toBe(16 * H); // terça definida vence o feriado
  });
});

describe("U-38: edição do calendário", () => {
  it("ValidateWorkDay: −1 fica (início 0); duração presa a [0, 86399]; o início recua", () => {
    expect(validateWorkDay(5000, -1)).toEqual({ begin: 0, length: -1 });
    expect(validateWorkDay(80000, 20000)).toEqual({ begin: 66399, length: 20000 });
    expect(validateWorkDay(100, -5)).toEqual({ begin: 100, length: 0 });
    expect(validateWorkDay(0, 99999)).toEqual({ begin: 0, length: 86399 });
  });
  it("semana sem nenhum dia > 0 não é aplicada", () => {
    const s = spec();
    expect(setDefaultWeek(s, Array.from({ length: 7 }, () => ({ begin: 0, length: 0 })))).toBe(false);
    expect(s.week.days[0]!.length).toBe(10 * H);
  });
  it("AddWorkTimeSpan: N dentro de E (sem cobrir) parte E em três; N igual a E só renomeia; todos −1 → nada", () => {
    const e = week(10 * H);
    const n: WorkDay[] = Array.from({ length: 7 }, () => ({ begin: 0, length: -1 }));
    n[0] = { begin: 21600, length: 12 * H }; // só segunda definida
    const s = spec({ spans: [calendarSpan("E", at(2016, 3, 1), at(2016, 3, 31), e)] });
    addWorkTimeSpan(s, calendarSpan("N", at(2016, 3, 10), at(2016, 3, 20), n));
    expect(s.spans.map((x) => [x.name, new Date(Number(x.first) * 1000).getUTCDate(), new Date(Number(x.last) * 1000).getUTCDate()])).toEqual([
      ["E", 1, 9], ["E N", 10, 20], ["E", 21, 31],
    ]);
    expect(s.spans[1]!.week.days[0]).toEqual({ begin: 21600, length: 12 * H });
    expect(s.spans[1]!.week.days[1]).toEqual(e[1]);
    addWorkTimeSpan(s, calendarSpan("Outro nome", at(2016, 3, 1), at(2016, 3, 9), e));
    expect(s.spans[0]!.name).toBe("Outro nome");
    const before = JSON.stringify(s.spans, (_k, v) => (typeof v === "bigint" ? String(v) : v));
    addWorkTimeSpan(s, calendarSpan("X", at(2016, 4, 1), at(2016, 4, 2), Array.from({ length: 7 }, () => ({ begin: 0, length: -1 }))));
    expect(JSON.stringify(s.spans, (_k, v) => (typeof v === "bigint" ? String(v) : v))).toBe(before);
  });
  it("AddWorkTimeSpan com a mesma semana (same7) só estende as datas de E; jornada efetiva = aplicar N por último", () => {
    const e = week(10 * H);
    const s = spec({ spans: [calendarSpan("E", at(2016, 3, 1), at(2016, 3, 10), e)] });
    addWorkTimeSpan(s, calendarSpan("N", at(2016, 3, 5), at(2016, 3, 20), e));
    expect(s.spans).toHaveLength(1);
    expect(new Date(Number(s.spans[0]!.last) * 1000).getUTCDate()).toBe(20);
  });
});

