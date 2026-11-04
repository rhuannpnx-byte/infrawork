// CA-RF-001-b e robustez: versões fora da faixa, cabeçalhos e corpos corrompidos (RNF-004).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Dr5Error, readContainer, readDpl, readDr5 } from "../src/index.js";
import { buildDr5, FIXTURES, inBatches, lcg } from "./helpers.js";

const original = new Uint8Array(readFileSync(join(FIXTURES, "example_simple_road_project.dr5")));
const payload = readContainer(original).payload;

function expectCode(fn: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, `esperava ${code}`).toBeInstanceOf(Dr5Error);
  expect((thrown as Dr5Error).code).toBe(code);
}
function withU32(src: Uint8Array, off: number, v: number): Uint8Array {
  const b = new Uint8Array(src);
  new DataView(b.buffer).setUint32(off, v, true);
  return b;
}

describe("CA-RF-001-b: faixa de versões e cabeçalhos", () => {
  it("versão de cliente 80007 é recusada como mais nova (como o teste t4 no original)", () => {
    expectCode(() => readDr5(buildDr5(withU32(payload, 17, 80007))), "FILE_TOO_NEW");
  });
  it("versão 40037 é recusada como mais antiga; 40038 e 80006 são aceitas", () => {
    expectCode(() => readDr5(buildDr5(withU32(payload, 17, 40037))), "FILE_TOO_OLD");
    expect(readDr5(buildDr5(withU32(payload, 17, 40038))).clientVersion).toBe(40038);
    expect(readDr5(buildDr5(withU32(payload, 17, 80006))).clientVersion).toBe(80006);
  });
  it("nVer fora de {0x802, 0x803} é cabeçalho corrompido", () => {
    expectCode(() => readDr5(buildDr5(withU32(payload, 13, 0x804))), "BAD_INNER_HEADER");
  });
  it("magic interno alterado é cabeçalho corrompido", () => {
    const p = new Uint8Array(payload);
    p[3] = 0x58;
    expectCode(() => readDr5(buildDr5(p)), "BAD_INNER_HEADER");
  });
  it("magic externo e versão do driver são exigidos exatamente", () => {
    const a = new Uint8Array(original);
    a[5] = 0x58;
    expectCode(() => readDr5(a), "BAD_OUTER_HEADER");
    expectCode(() => readDr5(withU32(original, 29, 0x1001)), "BAD_DRIVER_VERSION");
    expectCode(() => readDr5(original.subarray(0, 20)), "BAD_OUTER_HEADER");
  });
  it("stream zlib corrompido", () => {
    const a = new Uint8Array(original);
    a[0x21] = 0x00;
    a[0x22] = 0x00;
    expectCode(() => readDr5(a), "ZLIB_ERROR");
  });
});

describe("corpo corrompido", () => {
  it("payload truncado", () => {
    expectCode(() => readDpl(payload.subarray(0, payload.length - 8)), "UNEXPECTED_FILE_ENDING");
    expectCode(() => readDpl(payload.subarray(0, 0x15 + 10)), "UNEXPECTED_END");
  });
  it("terminador diferente de 0xFFFFFFFF", () => {
    expectCode(() => readDpl(withU32(payload, payload.length - 4, 0)), "UNEXPECTED_FILE_ENDING");
  });
  it("tag de tipo inválida e tags removidas", () => {
    // 1º campo do 1º registro: u32 size + u64 oid + u32 class + u32 id → tag
    const at = 0x15 + 4 + 8 + 4 + 4;
    for (const t of [0x00, 0x0e, 0x13, 0x1a, 0xff]) {
      const p = new Uint8Array(payload);
      p[at] = t;
      expectCode(() => readDpl(p), "INVALID_FIELD_TYPE");
    }
  });
  it("registro maior que 0x1FFFFFFF", () => {
    expectCode(() => readDpl(withU32(payload, 0x15, 0x20000000)), "TOO_LARGE_FIELD");
  });
  it("tamanho de registro que não fecha com os campos", () => {
    const size = new DataView(payload.buffer, payload.byteOffset).getUint32(0x15, true);
    expect(() => readDpl(withU32(payload, 0x15, size - 1))).toThrow(Dr5Error);
  });
  it("fuzz: 300 mutações aleatórias (rodada longa em tools/fuzz-dr5.ts) só lançam Dr5Error ou leem com sucesso", async () => {
    // DV-008: default.dr5 (52 KB) e lotes de 25 com pausa, para não travar o worker do Vitest sob carga.
    const base = readContainer(new Uint8Array(readFileSync(join(FIXTURES, "default.dr5")))).payload;
    const rnd = lcg(12345);
    let errors = 0;
    await inBatches(300, 25, () => {
      const p = new Uint8Array(base);
      const flips = 1 + Math.floor(rnd() * 4);
      for (let k = 0; k < flips; k++) p[0x15 + Math.floor(rnd() * (p.length - 0x15))] = Math.floor(rnd() * 256);
      try {
        readDpl(p);
      } catch (e) {
        if (!(e instanceof Dr5Error)) throw e;
        errors++;
      }
    });
    expect(errors).toBeGreaterThan(0);
  });
});
