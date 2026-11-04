/**
 * Tipos de campo DPL (RD-003). Evidência: docs/analise_persistencia_dpl.md §2.2
 * (enum DPL::MementoManager::FieldType, DPL::anon::Type2Size @0x008f8490, switch de ReadField).
 */
export const FT = {
  BOOL: 0x01,
  UCHAR: 0x02,
  SCHAR: 0x03,
  USHORT: 0x04,
  SSHORT: 0x05,
  UINT: 0x06,
  SINT: 0x07,
  ULONG: 0x08,
  SLONG: 0x09,
  UINT64: 0x0a,
  SINT64: 0x0b,
  FLOAT: 0x0c,
  DOUBLE: 0x0d,
  STRING: 0x0f,
  BINARY: 0x10,
  POINTER32: 0x11,
  REFERENCE_OLD: 0x12,
  CONTAINER: 0x14,
  PAIR_CONTAINER: 0x15,
  WSTRING_OLD: 0x16,
  TUPLE: 0x17,
  POINTER64: 0x18,
  VARIANT: 0x19,
} as const;

/** Tags que existiam e foram removidas: o original lança "old FT_*" (RD-003). */
export const REMOVED_TAGS: Readonly<Record<number, string>> = { 0x00: "old FT_NOTHING", 0x0e: "old FT_POD", 0x13: "old FT_PAIR" };

export const TYPE_NAMES: Readonly<Record<number, string>> = {
  0x01: "bool", 0x02: "u8", 0x03: "i8", 0x04: "u16", 0x05: "i16", 0x06: "uint", 0x07: "int", 0x08: "ulong",
  0x09: "long", 0x0a: "u64", 0x0b: "i64", 0x0c: "float", 0x0d: "double", 0x0f: "string", 0x10: "blob",
  0x11: "ref32", 0x12: "ref(legado)", 0x14: "container", 0x15: "map", 0x16: "wstring", 0x17: "tuple",
  0x18: "ref", 0x19: "variant",
};

/** Inteiros de tamanho fixo cabem em number: [tamanho, com sinal]. */
export const INT_TAGS: Readonly<Record<number, readonly [number, boolean]>> = {
  0x01: [1, false], 0x02: [1, false], 0x03: [1, true], 0x04: [2, false], 0x05: [2, true],
  0x06: [4, false], 0x07: [4, true], 0x08: [4, false], 0x09: [4, true], 0x11: [4, false],
};
/** Inteiros de 64 bits viram bigint (OIDs e DDL::Date podem passar de 2^53). */
export const BIGINT_TAGS: Readonly<Record<number, boolean>> = { 0x0a: false, 0x0b: true, 0x18: false };
export const FLOAT_TAGS: Readonly<Record<number, number>> = { 0x0c: 4, 0x0d: 8 };
/** Tamanho variável: u32 n + n bytes, guardados crus. */
export const BYTES_TAGS: ReadonlySet<number> = new Set([0x0f, 0x10, 0x12, 0x16]);

export type FieldValue =
  | { kind: "int"; type: number; value: number }
  | { kind: "bigint"; type: number; value: bigint }
  | { kind: "float"; type: number; value: number; raw: Uint8Array }
  | { kind: "bytes"; type: number; value: Uint8Array }
  | { kind: "container"; type: 0x14; elemType: number | null; items: FieldValue[] }
  | { kind: "map"; type: 0x15; keyType: number | null; valueType: number | null; entries: [FieldValue, FieldValue][] }
  | { kind: "tuple"; type: 0x17 | 0x19; items: FieldValue[] };

export interface Field {
  id: number;
  type: number;
  value: FieldValue;
}

export interface Dr5Record {
  /** Offset do registro no payload descomprimido. */
  offset: number;
  /** Tamanho declarado, incluindo o próprio u32 (RD-002). */
  size: number;
  oid: bigint;
  classId: number;
  fields: Field[];
}

const utf8 = new TextDecoder("utf-8", { fatal: false });
const utf16 = new TextDecoder("utf-16le", { fatal: false });

/** Codifica texto como o original grava hoje: 0x0F, UTF-8 com NUL final (RD-003). */
export function encodeString(s: string): FieldValue {
  const b = new TextEncoder().encode(s);
  const value = new Uint8Array(b.length + 1);
  value.set(b);
  return { kind: "bytes", type: FT.STRING, value };
}

/** Decodifica um campo de texto: 0x0F UTF-8 com NUL, 0x16 UTF-16LE com NUL (RD-003). */
export function decodeString(v: FieldValue): string {
  if (v.kind !== "bytes" || (v.type !== FT.STRING && v.type !== FT.WSTRING_OLD)) {
    throw new TypeError(`campo não é string (tipo 0x${v.type.toString(16)})`);
  }
  const s = v.type === FT.STRING ? utf8.decode(v.value) : utf16.decode(v.value);
  return s.replace(/\0+$/u, "");
}
