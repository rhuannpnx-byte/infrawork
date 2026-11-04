// U-07b: RN-031 aplicada (janela do projeto). Cenários sobre o example_simple; os exemplos não têm marcos nem
// interrupções com data.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TimeSpanError } from "@apex/calendar";
import { readDr5 } from "../../dr5/src/index.js";
import { FIXTURES } from "../../dr5/test/helpers.js";
import { Project, type Entity } from "../../model/src/index.js";
import { setProjectWindow } from "../src/index.js";

const DAY = 86400;
const load = () => Project.fromDr5(readDr5(new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")))));
const n = (v: unknown) => Number(v as bigint);
const D = (s: string) => Date.parse(s + "Z") / 1000;

describe("RN-031 janela do projeto", () => {
  it("marco: normalizado para início/fim de dia e preso à nova janela", () => {
    const p = load();
    let m!: Entity;
    p.edit("marco", () => {
      m = p.create("Milestone");
      m.set("m_beginDate", BigInt(D("2016-08-10T10:30:00")));
      m.set("m_endDate", BigInt(D("2016-12-20T15:00:00")));
    });
    const root = p.root()!;
    setProjectWindow(p, n(root.get("m_dateBegin")), D("2016-12-31T00:00:00"));
    expect([n(m.get("m_beginDate")), n(m.get("m_endDate"))]).toEqual([D("2016-08-10T00:00:00"), D("2016-12-21T00:00:00")]);
    setProjectWindow(p, D("2016-09-01T00:00:00"), D("2016-12-15T00:00:00"));
    expect([n(m.get("m_beginDate")), n(m.get("m_endDate"))]).toEqual([D("2016-09-01T00:00:00"), D("2016-12-15T00:00:00")]);
    expect(n(root.get("m_dateDeadline"))).toBe(D("2016-12-15T00:00:00"));
  });
  it("span que não cabe: lança BEGIN_TIME_GREATER_THAN_END_TIME e nada muda", () => {
    const p = load();
    p.edit("marco", () => {
      const m = p.create("Milestone");
      m.set("m_beginDate", BigInt(D("2016-08-10T00:00:00")));
      m.set("m_endDate", BigInt(D("2016-08-12T00:00:00")));
    });
    const root = p.root()!;
    const before = [root.get("m_dateBegin"), root.get("m_dateDeadline")];
    // janela que termina antes do marco começar: o marco vira [fim, fim] e não sobra 1 dia
    expect(() => setProjectWindow(p, D("2016-07-01T00:00:00"), D("2016-07-01T12:00:00"))).toThrow(TimeSpanError);
    expect([root.get("m_dateBegin"), root.get("m_dateDeadline")]).toEqual(before);
  });
  it("interrupção por data é validada; permanente e por tarefa não", () => {
    const p = load();
    const mk = (bt: number, et: number) => {
      let u!: Entity;
      p.edit("interrupção", () => {
        u = p.create("UsageBreak");
        u.set("m_beginTimingType", bt);
        u.set("m_endTimingType", et);
        u.set("m_beginDate", BigInt(D("2016-01-05T08:00:00")));
        u.set("m_endDate", BigInt(D("2016-08-05T08:00:00")));
      });
      return u;
    };
    const byDate = mk(1, 1), perm = mk(0, 1), endTask = mk(1, 2);
    const root = p.root()!;
    setProjectWindow(p, n(root.get("m_dateBegin")), n(root.get("m_dateDeadline")) + DAY); // sem mudança nada roda [O]
    const start = n(root.get("m_dateBegin"));
    expect([n(byDate.get("m_beginDate")), n(byDate.get("m_endDate"))]).toEqual([start, D("2016-08-06T00:00:00")]);
    expect(n(perm.get("m_beginDate"))).toBe(D("2016-01-05T08:00:00"));
    expect([n(endTask.get("m_beginDate")), n(endTask.get("m_endDate"))]).toEqual([start, D("2016-08-05T08:00:00")]);
  });
  it("U-54 (L-038, SetTimeSpan@0x9136b0): tarefas não estritas pelas datas dos work places; fim com (prazo antigo, fim)", () => {
    const p = load();
    const root = p.root()!;
    const start = n(root.get("m_dateBegin")), end = n(root.get("m_dateDeadline"));
    const near = p.get(254n)!, far = p.get(1595n)!; // WasteLand (256) e CrushingPlant (1601)
    p.edit("datas", () => {
      p.get(256n)!.set("pDVar2", BigInt(start));
      p.get(256n)!.set("m_endTime", BigInt(end - 30 * DAY)); // termina antes do prazo antigo: recebe o novo fim [O PUSH]
      p.get(1601n)!.set("pDVar2", BigInt(start + 30 * DAY));
      p.get(1601n)!.set("m_endTime", BigInt(end + 20 * DAY)); // muito depois do prazo: fica
      near.set("m_forcedBeginDate", BigInt(start + 99 * DAY)); // as forçadas não são lidas nem gravadas
    });
    setProjectWindow(p, start - 7 * DAY, end + 7 * DAY);
    const span = (o: bigint) => [n(p.get(o)!.get("pDVar2")), n(p.get(o)!.get("m_endTime"))] as const;
    expect(span(256n)[0]).toBeLessThan(start - 7 * DAY + DAY);
    expect(span(256n)[1]).toBeGreaterThan(end + 5 * DAY); // fim do último dia útil até o novo prazo
    expect(span(256n)[1]).toBeLessThan(end + 8 * DAY);
    expect(span(1601n)[1]).toBeGreaterThanOrEqual(end + 20 * DAY - DAY);
    expect(span(1601n)[0]).toBeGreaterThanOrEqual(start + 29 * DAY);
    expect(n(near.get("m_forcedBeginDate"))).toBe(start + 99 * DAY);
    expect(n(root.get("m_dateBegin"))).toBe(start - 7 * DAY);
    p.undo();
    expect(n(root.get("m_dateBegin"))).toBe(start);
    expect(span(256n)).toEqual([start, end - 30 * DAY]);
    void far;
  });
  it("U-54: datas levadas ao início do dia; menos de 1 dia lança; sem mudança não abre nível", () => {
    const p = load();
    const root = p.root()!;
    const start = n(root.get("m_dateBegin")), end = n(root.get("m_dateDeadline"));
    const levels = p.undoNames().length;
    setProjectWindow(p, start + 3600, end + 7200);
    expect(p.undoNames().length).toBe(levels);
    expect(() => setProjectWindow(p, start, start + 3600)).toThrow(TimeSpanError);
  });
});
