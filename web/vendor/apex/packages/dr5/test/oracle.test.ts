// CA-RF-001-a: os 27 .dr5 da instalação são lidos e concordam campo a campo com o oráculo Python.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, dump, readDr5WithPayload } from "../src/index.js";
import { oracleDirAvailable, oracleFiles, sha256 } from "./helpers.js";

const files = oracleFiles();

describe("CA-RF-001-a: leitura dos .dr5 de exemplo contra o oráculo", () => {
  it("encontra os oráculos (27 com a análise disponível, 2 só com fixtures)", () => {
    expect(files.length).toBe(oracleDirAvailable() ? 27 : 2);
  });

  for (const { entry, path } of files) {
    it(`${entry.file}: ${entry.objects} objetos, ${entry.fields} campos, forma canônica idêntica`, () => {
      const raw = readFileSync(path);
      expect(sha256(raw)).toBe(entry.sha256);
      const { doc, payload } = readDr5WithPayload(raw);
      expect(payload.length).toBe(entry.payload_len);
      expect(sha256(payload)).toBe(entry.payload_sha256);
      expect(doc.formatVersion).toBe(entry.fmt);
      expect(doc.clientVersion).toBe(entry.client);
      expect(doc.records.length).toBe(entry.objects);
      expect(doc.records.reduce((n, r) => n + r.fields.length, 0)).toBe(entry.fields);
      expect([doc.end.offset, doc.end.terminator]).toEqual(entry.end);
      expect(doc.trailingBytes).toBe(0);
      expect(sha256(canonicalJson(doc))).toBe(entry.canonical_sha256);
      // RD-002: objetos em ordem crescente de OID; Project é o OID 1 (classe 29).
      const oids = doc.records.map((r) => r.oid);
      expect(oids.every((o, i) => i === 0 || o > oids[i - 1]!)).toBe(true);
      expect(doc.records[0]).toMatchObject({ oid: 1n, classId: 29 });
      // RD-005: 100% dos campos nomeados nos arquivos 80006.
      if (doc.clientVersion === 80006) expect(dump(doc).stats.unnamedFields).toBe(0);
    });
  }
});
