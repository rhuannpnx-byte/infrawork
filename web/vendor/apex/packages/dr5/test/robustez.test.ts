// Correções da V-002: DV-001 (aninhamento), DV-002 (data fora do alcance), sintéticos 0x802/0x803
// com as 23 tags (recomendação da V-002) e códigos de saída da CLI (RNF-004).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ddlDateInRange, ddlDateToString, decodeString, Dr5Error, dump, MAX_NESTING, readDpl, readDr5,
  type FieldValue,
} from "../src/index.js";
import { buildDr5, ROOT } from "./helpers.js";
import { CLI_TEST_TIMEOUT, runApex } from "../../../tools/vitest/apex-cli.js";
import { allTags, cat, field, i32, nested, payload, record, repeat, u32 } from "./synth.js";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof Dr5Error) return e.code;
    throw e;
  }
  return undefined;
}

describe("DV-001: aninhamento profundo vira Dr5Error", () => {
  for (const kind of ["tuple", "container"] as const) {
    it(`${kind}: ${MAX_NESTING} níveis são lidos; ${MAX_NESTING + 1}, 20.000 e 200.000 são recusados`, () => {
      expect(readDpl(nested(kind, MAX_NESTING)).records).toHaveLength(1);
      for (const d of [MAX_NESTING + 1, 20_000, 200_000]) expect(codeOf(() => readDpl(nested(kind, d)))).toBe("NESTING_TOO_DEEP");
    });
  }
  it("mapa com valor aninhado também conta", () => {
    // map(1){ int 1 : tuple(1){ tuple(1){ ... bool } } } com 200 tuplas
    const t = repeat(cat(Uint8Array.of(0x17), u32(1)), 200, Uint8Array.of(0x01, 0x01));
    const map = cat(u32(1), Uint8Array.of(0x07), i32(1), t);
    const deep = payload(0x803, [record(1, 29, [field(1, 0x15, map)], true)]);
    expect(codeOf(() => readDr5(buildDr5(deep)))).toBe("NESTING_TOO_DEEP");
  });
});

describe("DV-002: i64 fora dos anos 1…9999", () => {
  it("ddlDateInRange e ddlDateToString nos limites", () => {
    expect(ddlDateToString(-62135596800n)).toBe("0001-01-01 00:00");
    expect(ddlDateToString(253402300799n)).toBe("9999-12-31 23:59");
    expect(ddlDateInRange(253402300800n)).toBe(false);
    expect(ddlDateInRange(-62135596801n)).toBe(false);
    expect(() => ddlDateToString(2n ** 62n)).toThrow(RangeError);
    expect(ddlDateToString(32503679999n)).toBe("2999-12-31 23:59"); // maior data dos 27 exemplos
  });
  it("o dump mostra 'i64:<valor>' como o dpl_nomeado.py, sem lançar", () => {
    const text = dump(readDpl(payload(0x803, allTags(true)))).text;
    expect(text).toContain(`'i64:${2n ** 62n}'`);
    expect(text).toContain("'Date:nula'");
    expect(text).toContain("'Date:2015-03-25 00:00'");
  });
});

describe("sintéticos com as 23 tags (0x802 e 0x803)", () => {
  for (const [fmt, oid64] of [[0x802, false], [0x803, true]] as const) {
    it(`formato 0x${fmt.toString(16)}`, () => {
      const doc = readDr5(buildDr5(payload(fmt, allTags(oid64))));
      expect(doc.formatVersion).toBe(fmt);
      expect(doc.records.map((r) => [r.oid, r.classId])).toEqual([[1n, 29], [2n, 157]]);
      const f = new Map(doc.records[0]!.fields.map((x) => [x.id, x.value]));
      const v = (id: number): FieldValue => f.get(id)!;
      const n = (id: number) => (v(id) as { value: unknown }).value;
      expect(decodeString(v(100) as Extract<FieldValue, { kind: "bytes" }>)).toBe("Olá ação ü 中文");
      expect(decodeString(v(101) as Extract<FieldValue, { kind: "bytes" }>)).toBe("wide ÄÖ ✓");
      expect([n(102), n(104), n(105), n(106), n(107)]).toEqual([1, 255, -128, 65535, -32768]);
      expect([n(108), n(109), n(110), n(111)]).toEqual([0xffffffff, -123456, 0xdeadbeef, -1]);
      expect([n(112), n(113), n(114), n(115)]).toEqual([2n ** 64n - 1n, -1n, 1427241600n, 2n ** 62n]);
      expect(n(116)).toBeCloseTo(0.1, 7);
      expect(n(118)).toBe(1e16);
      expect(Number.isNaN(n(121))).toBe(true);
      expect(v(124).kind).toBe("bytes");
      expect([n(125), n(127), n(128)]).toEqual([2, 2n, 0n]);
      expect(v(126)).toMatchObject({ kind: "bytes", type: 0x12 });
      expect(v(130)).toMatchObject({ kind: "container", elemType: null, items: [] });
      expect(v(131)).toMatchObject({ kind: "container", elemType: 7, items: [{ value: 0 }, { value: 1 }, { value: 2 }] });
      expect(v(132)).toMatchObject({ items: [{ kind: "container", elemType: 0x0d, items: [{ value: 1 }, { value: 2.5 }] }, { kind: "container", items: [] }] });
      expect(v(133)).toMatchObject({ kind: "map", entries: [] });
      expect(v(134)).toMatchObject({ kind: "map", keyType: 7, valueType: 0x0d, entries: [[{ value: 5 }, { value: 0.25 }], [{ value: 6 }, { value: 9 }]] });
      expect(v(136)).toMatchObject({ kind: "tuple", type: 0x17, items: [{ value: 1 }, { kind: "bytes", type: 0x0f }] });
      expect(v(137)).toMatchObject({ kind: "tuple", type: 0x19, items: [{ value: 1 }, { value: 7 }] });
    });
  }
});

describe("CLI apex inspect: códigos de saída sem pilha crua", { timeout: CLI_TEST_TIMEOUT }, () => {
  const dir = mkdtempSync(join(tmpdir(), "apex-cli-"));
  const run = (file: string) => runApex("inspect", file, "--summary");
  it("aninhamento de 20.000 níveis → exit 2 NESTING_TOO_DEEP", async () => {
    const f = join(dir, "aninhado.dr5");
    writeFileSync(f, buildDr5(nested("tuple", 20_000)));
    const r = await run(f);
    expect(r.code).toBe(2);
    expect(r.err).toContain("erro NESTING_TOO_DEEP");
    expect(r.err).not.toMatch(/\n\s+at /);
  });
  it("data 2^62 → exit 0 com resumo", async () => {
    const f = join(dir, "synth64.dr5");
    writeFileSync(f, buildDr5(payload(0x803, allTags(true))));
    const r = await run(f);
    expect(r.code).toBe(0);
    expect(r.err).toContain("objetos 2 campos 31");
  });
  it("DV-004: falha ao gravar -o cita a saída, não a entrada → exit 1", async () => {
    const input = join(ROOT, "fixtures/default.dr5");
    const out = join(dir, "pasta-inexistente", "x.txt");
    const r = await runApex("inspect", input, "-o", out);
    expect(r.code).toBe(1);
    expect(r.err).toContain(`erro ENOENT: não foi possível gravar ${out}`);
    expect(r.err).not.toContain("não foi possível ler");
  });
  it("arquivo ausente → exit 1", async () => {
    const r = await run(join(dir, "nao-existe.dr5"));
    expect(r.code).toBe(1);
    expect(r.err).toContain("erro ENOENT");
  });
});
