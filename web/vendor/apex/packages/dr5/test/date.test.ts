// CA-RD-022: DDL::Date em segundos Unix sem fuso; dia 0 = quinta-feira; −1 = sem data.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ddlDateFromParts, ddlDateToString, ddlHour, ddlWeekDay, readDr5 } from "../src/index.js";
import { FIXTURES } from "./helpers.js";

describe("CA-RD-022: datas", () => {
  it("0 é 1970-01-01 00:00, quinta-feira (DDL::WeekDay THU = 3)", () => {
    expect(ddlDateToString(0n)).toBe("1970-01-01 00:00");
    expect(ddlWeekDay(0n)).toBe(3);
    expect(ddlDateFromParts(1970, 1, 1)).toBe(0n);
  });
  it("−1 é sem data", () => {
    expect(ddlDateToString(-1n)).toBeNull();
  });
  it("Fliegel–Van Flandern coincide com o calendário gregoriano de 1970 a 2100", () => {
    for (let y = 1970; y <= 2100; y += 7) {
      for (const m of [1, 2, 3, 7, 12]) {
        for (const d of [1, 15, 28]) {
          expect(ddlDateFromParts(y, m, d, 13, 45, 7)).toBe(BigInt(Date.UTC(y, m - 1, d, 13, 45, 7) / 1000));
        }
      }
    }
    expect(ddlHour(ddlDateFromParts(2016, 7, 20, 17))).toBe(17);
  });
  it("Project f228/f229 de en/default.dr5 = 2015-03-25 e 2017-03-25", () => {
    const doc = readDr5(readFileSync(join(FIXTURES, "default.dr5")));
    const project = doc.records[0]!;
    const date = (id: number): bigint => {
      const f = project.fields.find((x) => x.id === id && x.type === 0x0b);
      return f && f.value.kind === "bigint" ? f.value.value : -2n;
    };
    expect(date(228)).toBe(ddlDateFromParts(2015, 3, 25));
    expect(date(229)).toBe(ddlDateFromParts(2017, 3, 25));
    expect(ddlDateToString(date(228))).toBe("2015-03-25 00:00");
  });
});
