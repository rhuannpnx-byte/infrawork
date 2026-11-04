// Correções da V-015 (validador da U-03): DV-010 migração do UISettingsContainer, DV-011 referência antiga
// de Entity no undo, DV-012 .apex.json hostil (hash recalculado).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FT, readDr5, writeContainer, type FieldValue } from "../../dr5/src/index.js";
import { FIXTURES, oracleFiles } from "../../dr5/test/helpers.js";
import { migrateToCurrent, Project } from "../src/index.js";

const simple = new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")));
const load = () => Project.fromDr5(readDr5(simple));
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

describe("DV-010: UISettingsContainer f200 map<int,bool> → map<int,variant> abaixo de 80005", () => {
  const de = oracleFiles().filter((f) => f.entry.client < 80005);
  const en = oracleFiles().find((f) => f.entry.file === "en/default.dr5");
  it.skipIf(de.length === 0 || !en)("DE migrados ficam com a forma dos 80006 nativos (en/default OIDs 16 e 22)", () => {
    const native = readDr5(new Uint8Array(readFileSync(en!.path)));
    const ref = native.records.find((r) => r.oid === 16n)!.fields.find((f) => f.id === 200)!.value as Extract<FieldValue, { kind: "map" }>;
    expect([ref.keyType, ref.valueType]).toEqual([FT.SINT, FT.VARIANT]);
    for (const { path } of de) {
      const raw = new Uint8Array(readFileSync(path));
      const before = readDr5(raw);
      const p = Project.fromDr5(before);
      const r = migrateToCurrent(p);
      expect(r.settingsConverted).toBe(before.records.filter((x) => x.classId === 143 && x.fields.some((f) => f.id === 200 && f.value.kind === "map" && f.value.valueType === FT.BOOL)).length);
      const back = readDr5(writeContainer(p.toDpl()));
      for (const rec of back.records.filter((x) => x.classId === 143)) {
        const m = rec.fields.find((f) => f.id === 200)?.value as Extract<FieldValue, { kind: "map" }> | undefined;
        if (!m || m.entries.length === 0) continue;
        expect([m.keyType, m.valueType]).toEqual([FT.SINT, FT.VARIANT]);
        const old = before.records.find((x) => x.oid === rec.oid)!.fields.find((f) => f.id === 200)!.value as Extract<FieldValue, { kind: "map" }>;
        m.entries.forEach(([k, v], i) => {
          expect(k).toEqual(old.entries[i]![0]);
          expect(v).toMatchObject({ kind: "tuple", type: FT.VARIANT, items: [{ type: FT.SINT, value: 0 }, { type: FT.BOOL, value: (old.entries[i]![1] as { value: number }).value }] });
        });
      }
    }
  });
});

describe("DV-011: referência antiga de Entity", () => {
  it("editar um objeto removido é recusado (STALE_ENTITY) e não entra na pilha", () => {
    const p = load();
    const e = p.get(142n)!;
    p.edit("remove", () => p.remove(e));
    expect(codeOf(() => p.edit("edita removido", () => e.set("m_strName", "x")))).toBe("STALE_ENTITY");
    expect(p.undoNames()).toEqual(["remove"]);
    expect(p.get(142n)).toBeUndefined();
  });
  it("undo de remove devolve a mesma instância: a referência guardada continua editável", () => {
    const p = load();
    const e = p.get(142n)!;
    p.edit("remove", () => p.remove(e));
    p.undo();
    expect(p.get(142n)).toBe(e);
    p.edit("renomeia", () => e.set("m_strName", "pela referência antiga"));
    expect(p.get(142n)!.name).toBe("pela referência antiga");
  });
  it("criar → undo → redo devolve a mesma instância", () => {
    const p = load();
    const u = p.edit("cria", () => p.create("Unit"));
    p.undo();
    p.redo();
    expect(p.get(u.oid)).toBe(u);
  });
});

describe("DV-012: .apex.json hostil com SHA-256 recalculado", () => {
  const base = JSON.parse(load().toNativeJson());
  const rehash = (o: Record<string, unknown>) => {
    const { sha256: _, ...rest } = o;
    return JSON.stringify({ ...rest, sha256: createHash("sha256").update(JSON.stringify(rest)).digest("hex") });
  };
  const mutate = (fn: (o: { objects: { oid: unknown; class: unknown; fields: unknown[] }[] }) => void) => {
    const o = structuredClone(base);
    fn(o);
    return rehash(o);
  };
  const cases: [string, string][] = [
    ["fields não é array", mutate((o) => (o.objects[0]!.fields = "x" as unknown as unknown[]))],
    ["objects não é array", mutate((o) => ((o as unknown as { objects: unknown }).objects = {}))],
    ["items não é array", mutate((o) => (o.objects[0]!.fields[5] = [205, 20, { e: 24, items: 3 }]))],
    ["oid não numérico", mutate((o) => (o.objects[1]!.oid = "abc"))],
    ["oid 0", mutate((o) => (o.objects[1]!.oid = "0"))],
    ["oid acima de u64", mutate((o) => (o.objects[1]!.oid = "18446744073709551616"))],
    ["OID duplicado", mutate((o) => (o.objects[2]!.oid = o.objects[1]!.oid))],
    ["sem Project", mutate((o) => (o.objects = o.objects.filter((x) => x.class !== 29)))],
    ["inteiro fracionário em u32", mutate((o) => o.objects[0]!.fields.push([999, 6, 1.5]))],
    ["u8 fora da faixa", mutate((o) => o.objects[0]!.fields.push([999, 2, 256]))],
    ["variant com 3", mutate((o) => o.objects[0]!.fields.push([999, 0x19, { items: [[7, 0], [1, 1], [1, 0]] }]))],
    ["aninhamento de 5000", (() => {
      // montado como texto: o JSON.stringify do próprio teste estouraria a pilha com 5000 níveis
      const o = structuredClone(base);
      o.objects[0]!.fields.push([999, 0x17, "__FUNDO__"]);
      const { sha256: _, ...rest } = o;
      const deep = '{"items":[[23,'.repeat(5000) + '{"items":[[1,1]]}' + "]]}".repeat(5000);
      const body = JSON.stringify(rest).replace('"__FUNDO__"', deep);
      return body.slice(0, -1) + `,"sha256":"${createHash("sha256").update(body).digest("hex")}"}`;
    })()],
  ];
  for (const [name, text] of cases) {
    it(`${name} → NATIVE_FORMAT`, () => expect(codeOf(() => Project.fromNativeJson(text))).toBe("NATIVE_FORMAT"));
  }
  it("bool com byte 7 é aceito, como o leitor .dr5 aceita o byte cru (ida e volta sem perda)", () => {
    const p = Project.fromNativeJson(mutate((o) => o.objects[0]!.fields.push([999, 1, 7])));
    expect(p.root()!.fields.at(-1)!.value).toEqual({ kind: "int", type: 1, value: 7 });
  });
});
