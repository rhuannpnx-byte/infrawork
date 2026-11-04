// U-02: escritor .dr5. CA-RF-002-a (round-trip byte a byte nos 27), registro alterado maior (t2/t3 da
// execução autorizada de 2026-10-11), RN-025 (alcançáveis, ordem, ponteiros), RN-026 (versões gravadas).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalJson, decodeString, Dr5Error, encodeString, readContainer, readDpl, readDr5, readDr5WithPayload,
  WRITE_CLIENT_VERSION, WRITE_FORMAT, writeDpl, writeDr5,
  type Dr5Record, type FieldValue,
} from "../src/index.js";
import { buildDr5, FIXTURES, inBatches, lcg, oracleFiles, sha256 } from "./helpers.js";
import { allTags, payload } from "./synth.js";

const simple = new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")));

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof Dr5Error) return e.code;
    throw e;
  }
  return undefined;
}

/** Troca f100 (m_strName) do objeto `oid`, como os testes t2/t3 da análise. */
function rename(records: readonly Dr5Record[], oid: bigint, name: string): Dr5Record[] {
  return records.map((r) =>
    r.oid !== oid ? r : { ...r, fields: r.fields.map((f) => (f.id === 100 ? { ...f, value: encodeString(name) } : f)) },
  );
}
const nameOf = (r: Dr5Record | undefined) => decodeString(r!.fields.find((f) => f.id === 100)!.value);

describe("CA-RF-002-a: regravação sem alteração é idêntica byte a byte", () => {
  it("example_simple_road_project: SHA-256 cb792052…46bc64, como o t1 da análise", () => {
    const out = writeDr5(readDr5(simple));
    expect(sha256(out)).toBe("cb7920521847e78a03e9e3d397caa1ff87f3fee0f561ef5f243293c8e946bc64");
  });
  for (const { entry, path } of oracleFiles()) {
    it(`${entry.file}: arquivo e payload idênticos`, () => {
      const raw = new Uint8Array(readFileSync(path));
      const { doc, payload: p } = readDr5WithPayload(raw);
      const p2 = writeDpl(doc);
      expect(sha256(p2)).toBe(sha256(p));
      expect(sha256(writeDr5(doc))).toBe(entry.sha256);
      // RN-025: nos arquivos do original tudo é alcançável a partir do Project; podar não muda nada.
      expect(sha256(writeDpl(doc, { reachableFrom: 1n }))).toBe(sha256(p));
    });
  }
});

describe("registro alterado e maior continua legível (t2/t3, abertos no original em 2026-10-11)", () => {
  const doc = readDr5(simple);
  it("t2: LandCut OID 142 'LandCut 1' → 'REA-Cut 1' (mesmo tamanho) reproduz o arquivo aberto no original", () => {
    expect(nameOf(doc.records.find((r) => r.oid === 142n))).toBe("LandCut 1");
    const out = writeDr5({ ...doc, records: rename(doc.records, 142n, "REA-Cut 1") });
    expect(sha256(out)).toBe("4e5f6faa26053140865ad9f0f3a0a8ee570d835f345119ebdd6323964f91aca7");
  });
  it("t3: SumTask OID 37 com nome 16 bytes maior reproduz o arquivo aberto no original; o leitor lê o resto intacto", () => {
    const novo = "REA lab: root sum task renamed (size changed)";
    expect(nameOf(doc.records.find((r) => r.oid === 37n))).toBe("Simple demo of basic features");
    const out = writeDr5({ ...doc, records: rename(doc.records, 37n, novo) });
    expect(sha256(out)).toBe("2a5146897b719d4f836ebb82ee9a6af6debb777425bdd60ddf235ec2fe7800aa");
    const back = readDr5(out);
    const before = doc.records.find((r) => r.oid === 37n)!;
    const after = back.records.find((r) => r.oid === 37n)!;
    expect(nameOf(after)).toBe(novo);
    expect(after.size - before.size).toBe(16);
    // Todos os outros registros têm o mesmo conteúdo (só os offsets depois do OID 37 mudam).
    const strip = (rs: Dr5Record[]) => canonicalJson({ ...doc, records: rs.filter((r) => r.oid !== 37n).map((r) => ({ ...r, offset: 0 })) });
    expect(strip(back.records)).toBe(strip(doc.records));
  });
  it("t4 (versão 80007) não pode ser gravado: o escritor só grava 40038…80006", () => {
    expect(codeOf(() => writeDr5({ ...doc, clientVersion: 80007 }))).toBe("INVALID_DOCUMENT");
  });
  it("double alterado é gravado pelo valor novo (os bytes crus antigos são ignorados)", () => {
    const r = doc.records.find((x) => x.fields.some((f) => f.value.kind === "float" && f.value.type === 0x0d))!;
    const f = r.fields.find((x) => x.value.kind === "float" && x.value.type === 0x0d)!;
    const v = f.value as Extract<FieldValue, { kind: "float" }>;
    const changed = { ...r, fields: r.fields.map((x) => (x === f ? { ...x, value: { ...v, value: 1234.5 } } : x)) };
    const back = readDpl(writeDpl({ ...doc, records: doc.records.map((x) => (x === r ? changed : x)) }));
    expect((back.records.find((x) => x.oid === r.oid)!.fields.find((x) => x.id === f.id)!.value as { value: number }).value).toBe(1234.5);
  });
});

describe("RN-025: alcançáveis, ordem crescente e ponteiros", () => {
  const doc = readDr5(simple);
  it("objeto órfão é descartado com reachableFrom = Project; sem a opção é gravado", () => {
    const orphan: Dr5Record = { offset: 0, size: 0, oid: 99_999n, classId: 4, fields: [{ id: 100, type: 0x0f, value: encodeString("órfão") }] };
    const records = [...doc.records, orphan];
    expect(readDpl(writeDpl({ ...doc, records })).records).toHaveLength(578);
    expect(readDpl(writeDpl({ ...doc, records }, { reachableFrom: 1n })).records).toHaveLength(577);
  });
  it("ponteiro para OID inexistente → 'Unregistered object encountered' ao podar", () => {
    const records = doc.records.map((r) => (r.oid !== 1n ? r : { ...r, fields: [...r.fields, { id: 9999, type: 0x18, value: { kind: "bigint" as const, type: 0x18, value: 123_456n } }] }));
    expect(codeOf(() => writeDpl({ ...doc, records }, { reachableFrom: 1n }))).toBe("UNREGISTERED_OBJECT");
  });
  it("registros fora de ordem saem em ordem crescente de OID; OID repetido é recusado", () => {
    const shuffled = [...doc.records].reverse();
    expect(sha256(writeDr5({ ...doc, records: shuffled }))).toBe(sha256(simple));
    expect(codeOf(() => writeDpl({ ...doc, records: [...doc.records, doc.records[5]!] }))).toBe("INVALID_DOCUMENT");
  });
});

describe("RN-026 e RD-001: cabeçalhos gravados", () => {
  it("documento novo usa 0x803 e 80006; contêiner com magic, 0x1000 e zlib 78 01", () => {
    expect([WRITE_FORMAT, WRITE_CLIENT_VERSION]).toEqual([0x803, 80006]);
    const out = writeDr5({ formatVersion: WRITE_FORMAT, clientVersion: WRITE_CLIENT_VERSION, records: [] });
    expect(new TextDecoder().decode(out.subarray(0, 27))).toBe("DSSDPL's ArchiveDriver File");
    expect([...out.subarray(27, 0x23)]).toEqual([0x1a, 0x00, 0x00, 0x10, 0x00, 0x00, 0x78, 0x01]);
    const p = readContainer(out).payload;
    expect([...p.subarray(p.length - 8)]).toEqual([0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff]);
    expect(readDr5(out)).toMatchObject({ formatVersion: 0x803, clientVersion: 80006, records: [] });
  });
  it("arquivos antigos (70017/70018) regravados sem alteração mantêm a versão própria", () => {
    const old = payload(0x803, allTags(true), 70017);
    expect(writeDpl(readDpl(old))).toEqual(old);
  });
  it("versões e formatos fora da faixa são recusados", () => {
    for (const [fmt, client] of [[0x804, 80006], [0x803, 40037], [0x803, 80007]] as const) {
      expect(codeOf(() => writeDpl({ formatVersion: fmt, clientVersion: client, records: [] }))).toBe("INVALID_DOCUMENT");
    }
  });
});

describe("sintéticos e entradas que o leitor não aceitaria", () => {
  for (const [fmt, oid64] of [[0x802, false], [0x803, true]] as const) {
    it(`0x${fmt.toString(16)} com as 23 tags: payload regravado idêntico`, () => {
      const p = payload(fmt, allTags(oid64));
      expect(writeDpl(readDpl(p))).toEqual(p);
      expect(writeDpl(readDpl(readContainer(buildDr5(p)).payload))).toEqual(p);
    });
  }
  const base = { formatVersion: 0x803, clientVersion: 80006 };
  const rec = (value: FieldValue, type = value.type, oid = 1n): Dr5Record => ({ offset: 0, size: 0, oid, classId: 29, fields: [{ id: 1, type, value }] });
  it("elemento de contêiner com tipo diferente do declarado", () => {
    const v: FieldValue = { kind: "container", type: 0x14, elemType: 0x07, items: [{ kind: "int", type: 0x06, value: 1 }] };
    expect(codeOf(() => writeDpl({ ...base, records: [rec(v)] }))).toBe("INVALID_DOCUMENT");
  });
  it("inteiro fora do tipo, tipo do campo diferente do valor, OID fora do formato 0x802", () => {
    expect(codeOf(() => writeDpl({ ...base, records: [rec({ kind: "int", type: 0x02, value: 256 })] }))).toBe("INVALID_DOCUMENT");
    expect(codeOf(() => writeDpl({ ...base, records: [rec({ kind: "int", type: 0x07, value: 1 }, 0x06)] }))).toBe("INVALID_DOCUMENT");
    expect(codeOf(() => writeDpl({ ...base, formatVersion: 0x802, records: [rec({ kind: "int", type: 0x07, value: 1 }, 0x07, 2n ** 32n)] }))).toBe("INVALID_DOCUMENT");
  });
  it("DV-005: classe e id de campo fora de u32 são recusados (não truncados)", () => {
    const ok: FieldValue = { kind: "int", type: 0x07, value: 1 };
    for (const classId of [2 ** 32 + 29, -1, 1.5, NaN]) {
      expect(codeOf(() => writeDpl({ ...base, records: [{ ...rec(ok), classId }] }))).toBe("INVALID_DOCUMENT");
    }
    for (const id of [2 ** 32 + 100, -1, 0.5]) {
      expect(codeOf(() => writeDpl({ ...base, records: [{ ...rec(ok), fields: [{ id, type: 0x07, value: ok }] }] }))).toBe("INVALID_DOCUMENT");
    }
    const edge = readDpl(writeDpl({ ...base, records: [{ ...rec(ok), classId: 0xffffffff, fields: [{ id: 0, type: 0x07, value: ok }] }] }));
    expect(edge.records[0]).toMatchObject({ classId: 0xffffffff, fields: [{ id: 0 }] });
  });
  it("DV-006: tag do composto conferida; variant só com 2 subcampos", () => {
    const one: FieldValue = { kind: "int", type: 0x07, value: 1 };
    const bad: FieldValue[] = [
      { kind: "container", type: 0x99 as 0x14, elemType: 0x07, items: [one] },
      { kind: "container", type: 0x15 as 0x14, elemType: null, items: [] },
      { kind: "map", type: 0x14 as 0x15, keyType: 0x07, valueType: 0x07, entries: [[one, one]] },
      { kind: "tuple", type: 0x19, items: [one, one, one] },
      { kind: "tuple", type: 0x19, items: [] },
    ];
    for (const v of bad) {
      const r = rec(v, 0x99);
      r.fields[0]!.type = v.type; // o tipo do campo acompanha o valor; o erro precisa vir da conferência do composto
      expect(codeOf(() => writeDpl({ ...base, records: [r] }))).toBe("INVALID_DOCUMENT");
    }
    const variant: FieldValue = { kind: "tuple", type: 0x19, items: [one, { kind: "float", type: 0x0d, value: 7, raw: new Uint8Array(0) }] };
    expect(readDpl(writeDpl({ ...base, records: [rec(variant)] })).records[0]!.fields[0]!.value).toMatchObject({ type: 0x19, items: [{ value: 1 }, { value: 7 }] });
  });
  it("DV-007: referência legada 0x12 conta como ponteiro na poda", () => {
    const legacy: FieldValue = { kind: "bytes", type: 0x12, value: Uint8Array.of(2, 0, 0, 0) };
    const records = [rec(legacy), { offset: 0, size: 0, oid: 2n, classId: 4, fields: [] }];
    expect(readDpl(writeDpl({ ...base, records }, { reachableFrom: 1n })).records.map((r) => r.oid)).toEqual([1n, 2n]);
    const dangling = [rec({ kind: "bytes", type: 0x12, value: Uint8Array.of(9, 0, 0, 0) })];
    expect(codeOf(() => writeDpl({ ...base, records: dangling }, { reachableFrom: 1n }))).toBe("UNREGISTERED_OBJECT");
  });
  it("aninhamento acima de 64 também é recusado na escrita", () => {
    let v: FieldValue = { kind: "int", type: 0x01, value: 1 };
    for (let i = 0; i < 65; i++) v = { kind: "tuple", type: 0x17, items: [v] };
    expect(codeOf(() => writeDpl({ ...base, records: [rec(v)] }))).toBe("NESTING_TOO_DEEP");
  });
  it("fuzz: todo payload mutado que o leitor aceita (ordenado, sem sobra) é regravado idêntico", async () => {
    // DV-008: default.dr5 (52 KB, 5× mais barato que o example_simple) e lotes de 25 com pausa.
    const p0 = readContainer(new Uint8Array(readFileSync(join(FIXTURES, "default.dr5")))).payload;
    const rnd = lcg(2026);
    let compared = 0;
    await inBatches(300, 25, () => {
      const p = new Uint8Array(p0);
      const flips = 1 + Math.floor(rnd() * 4);
      for (let k = 0; k < flips; k++) p[0x15 + Math.floor(rnd() * (p.length - 0x15))] = Math.floor(rnd() * 256);
      let doc;
      try {
        doc = readDpl(p);
      } catch (e) {
        if (e instanceof Dr5Error) return;
        throw e;
      }
      const oids = doc.records.map((r) => r.oid);
      const sorted = oids.every((o, j) => j === 0 || oids[j - 1]! < o) && oids.every((o) => o > 0n);
      const cleanEnd = new DataView(p.buffer).getUint32(doc.end.offset, true) === 0 && doc.trailingBytes === 0;
      const fieldTypesMatch = doc.records.every((r) => r.fields.every((f) => f.value.type === f.type));
      if (!sorted || !cleanEnd || !fieldTypesMatch) return;
      let out: Uint8Array;
      try {
        out = writeDpl(doc);
      } catch (e) {
        // valores que o leitor aceita mas o escritor recusa (ex.: elemType incoerente) não entram na comparação
        if (e instanceof Dr5Error && e.code === "INVALID_DOCUMENT") return;
        throw e;
      }
      expect(sha256(out)).toBe(sha256(p));
      compared++;
    });
    expect(compared).toBeGreaterThan(50);
  });
});
