/**
 * Dump nomeado legível (apex inspect). Mesmo layout de linhas do parser de referência
 * (handoff/parser/dpl_nomeado.py); a equivalência campo a campo é provada pela forma canônica,
 * não por este texto.
 */
import { ddlDateInRange, ddlDateToString } from "./date.js";
import { className, fieldName } from "./dictionary.js";
import type { DplDocument } from "./dpl-reader.js";
import { decodeString, FT, TYPE_NAMES, type FieldValue } from "./fields.js";

export interface DumpStats {
  objects: number;
  fields: number;
  unnamedFields: number;
}

export function dump(doc: DplDocument, title = ""): { text: string; stats: DumpStats } {
  const oidClass = new Map<bigint, number>();
  for (const r of doc.records) oidClass.set(r.oid, r.classId);

  const ref = (oid: bigint): string => {
    if (oid === 0n) return "null";
    const c = oidClass.get(oid);
    return `-> OID ${oid} (${c === undefined ? "ausente" : className(c) ?? `classe ${c}`})`;
  };
  const show = (v: FieldValue): string => {
    switch (v.kind) {
      case "int":
        if (v.type === FT.POINTER32) return ref(BigInt(v.value));
        if (v.type === FT.ULONG) return `ulong:0x${v.value.toString(16).padStart(8, "0")}`;
        return String(v.value);
      case "bigint":
        if (v.type === FT.POINTER64) return ref(v.value);
        if (v.type === FT.SINT64) {
          // DV-002: i64 fora dos anos 1…9999 é aceito pelo leitor; o dump mostra o valor cru,
          // como o dpl_nomeado.py da análise ('i64:<valor>').
          if (v.value !== -1n && !ddlDateInRange(v.value)) return `'i64:${v.value}'`;
          const s = ddlDateToString(v.value);
          return s === null ? "'Date:nula'" : `'Date:${s}'`;
        }
        return v.value.toString();
      case "float":
        return String(v.value);
      case "bytes": {
        if (v.type === FT.STRING || v.type === FT.WSTRING_OLD) return JSON.stringify(decodeString(v));
        const pdf = v.value[0] === 0x25 && v.value[1] === 0x50 && v.value[2] === 0x44 && v.value[3] === 0x46 ? " %PDF" : "";
        const head = Array.from(v.value.subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
        return `'BLOB[${v.value.length}]${pdf}:${head}'`;
      }
      case "container": {
        const items = v.items.slice(0, 12).map(show);
        if (v.items.length > 12) items.push(`...(${v.items.length})`);
        return `[${items.join(", ")}]`;
      }
      case "map": {
        const items = v.entries.slice(0, 12).map(([k, x]) => `${show(k)}: ${show(x)}`);
        if (v.entries.length > 12) items.push(`...(${v.entries.length})`);
        return `{${items.join(", ")}}`;
      }
      case "tuple":
        return `(${v.type === FT.VARIANT ? "variant, " : ""}${v.items.map(show).join(", ")})`;
    }
  };

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push(`# formato DPL 0x${doc.formatVersion.toString(16)} (${doc.formatVersion === 0x803 ? "OID 64 bits" : "OID 32 bits"}), versao do cliente ${doc.clientVersion}`);
  let fields = 0, unnamed = 0;
  for (const r of doc.records) {
    lines.push(`@0x${r.offset.toString(16)} size=${r.size} oid=${r.oid} class=${r.classId} ${className(r.classId) ?? "?"}`);
    for (const f of r.fields) {
      fields++;
      const n = fieldName(r.classId, f.id, f.type);
      if (!n || !n.exact) unnamed++;
      const name = (n?.name ?? "(desconhecido)").slice(0, 44);
      lines.push(`   f${String(f.id).padEnd(4)} ${name.padEnd(44)} [${f.type.toString(16).padStart(2, "0")} ${TYPE_NAMES[f.type] ?? "?"}] ${show(f.value)}`);
    }
  }
  lines.push(`@0x${doc.end.offset.toString(16)} FIM (terminador 0x${doc.end.terminator.toString(16).padStart(8, "0")})`);
  return { text: lines.join("\n") + "\n", stats: { objects: doc.records.length, fields, unnamedFields: unnamed } };
}
