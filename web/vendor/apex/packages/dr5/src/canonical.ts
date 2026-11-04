/**
 * Forma canônica do conteúdo DPL, idêntica à de tools/oracle_dpl.py (docs/forma-canonica.md).
 * Serve para provar, por hash, que o leitor TypeScript e o oráculo Python concordam campo a campo.
 */
import type { DplDocument } from "./dpl-reader.js";
import type { FieldValue } from "./fields.js";

type Canon = number | string | null | Canon[];

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function canonValue(v: FieldValue): Canon {
  switch (v.kind) {
    case "int":
      return v.value;
    case "bigint":
      return v.value.toString();
    case "float":
      return hex(v.raw);
    case "bytes":
      return hex(v.value);
    case "container":
      return ["C", v.elemType, v.items.map(canonValue)];
    case "map":
      return ["M", v.keyType, v.valueType, v.entries.map(([k, x]) => [canonValue(k), canonValue(x)])];
    case "tuple":
      return [v.type === 0x17 ? "T" : "V", v.items.map((i) => [i.type, canonValue(i)])];
  }
}

export function canonicalJson(doc: DplDocument): string {
  const obj = {
    fmt: doc.formatVersion,
    client: doc.clientVersion,
    records: doc.records.map((r) => [r.offset, r.size, r.oid.toString(), r.classId, r.fields.map((f) => [f.id, f.type, canonValue(f.value)])]),
    end: [doc.end.offset, doc.end.terminator],
  };
  return JSON.stringify(obj);
}
