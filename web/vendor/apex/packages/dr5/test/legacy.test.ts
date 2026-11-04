// CA-RF-001-c: arquivos antigos (70017/70018) com strings UTF-16 e mapas int -> double.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { className, decodeString, dump, FT, readDr5 } from "../src/index.js";
import { ORACLE_DIR, oracleDirAvailable } from "./helpers.js";

const OLD = ["de/default.dr5", "de/example_area_construction.dr5", "de/example_interchange.dr5", "de/example_simple_road_project.dr5"];

describe.runIf(oracleDirAvailable())("CA-RF-001-c: arquivos alemães antigos", () => {
  it("de/default.dr5: versão 70018 e strings 0x16 decodificadas sem NUL", () => {
    const doc = readDr5(readFileSync(join(ORACLE_DIR, "de/default.dr5")));
    expect(doc.clientVersion).toBe(70018);
    const cal = doc.records.find((r) => className(r.classId) === "Calendar")!;
    const name = cal.fields.find((f) => f.id === 100 && f.type === FT.WSTRING_OLD)!;
    const s = decodeString(name.value);
    expect(s.length).toBeGreaterThan(0);
    expect(s).not.toContain("\0");
  });

  it("Transporter f303 existe como mapa nos arquivos antigos (a conversão de chave é da U-03)", () => {
    const maps = OLD.map((f) => readDr5(readFileSync(join(ORACLE_DIR, f))))
      .flatMap((d) => d.records.filter((r) => r.classId === 41))
      .flatMap((r) => r.fields.filter((f) => f.id === 303 && f.value.kind === "map"));
    expect(maps.length).toBeGreaterThan(0);
  });

  it("campos sem nome nos antigos são só os legados documentados (classe 157 e SourceLandType f406)", () => {
    for (const f of OLD) {
      const doc = readDr5(readFileSync(join(ORACLE_DIR, f)));
      const unnamed = new Set<string>();
      let cls = "";
      for (const line of dump(doc).text.split("\n")) {
        const m = /^@0x[0-9a-f]+ size=\d+ oid=\d+ class=(\d+)/.exec(line);
        if (m) cls = m[1]!;
        const fm = /^ {3}f(\d+)\s+(\(desconhecido\)|\?\S*)/.exec(line);
        if (fm) unnamed.add(`${cls}:${fm[1]}`);
      }
      for (const k of unnamed) expect(k.startsWith("157:") || k === "48:406", `${f} ${k}`).toBe(true);
    }
  });
});
