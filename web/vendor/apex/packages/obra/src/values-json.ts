/**
 * Valores de campo ↔ JSON para as ferramentas MCP de objetos (D-024, U-22): `get_objects` mostra, `set_object_fields`
 * e `create_object` recebem. A codificação está descrita em `VALUE_ENCODING` (@apex/mcp). Sem DOM.
 *
 * Na leitura o tipo vem do próprio `FieldValue`; na escrita vem do campo existente (o modelo) ou do dicionário, e
 * contêineres e mapas novos pedem os tipos dos elementos (`type`, `key`, `value`), porque o JSON não os carrega.
 */
import { ddlDateFromParts, ddlDateInRange, ddlDateToString, decodeString, encodeString, FT, type FieldValue } from "@apex/dr5";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}

/** Nomes de tipo aceitos na entrada. */
export const TYPE_BY_NAME: Readonly<Record<string, number>> = {
  bool: FT.BOOL, uint8: FT.UCHAR, int8: FT.SCHAR, uint16: FT.USHORT, int16: FT.SSHORT, uint32: FT.UINT, int32: FT.SINT,
  ulong: FT.ULONG, long: FT.SLONG, uint64: FT.UINT64, int64: FT.SINT64, float: FT.FLOAT, double: FT.DOUBLE,
  string: FT.STRING, binary: FT.BINARY, ref: FT.POINTER64,
};
export const typeName = (tag: number): string => Object.entries(TYPE_BY_NAME).find(([, t]) => t === tag)?.[0]
  ?? ({ [FT.CONTAINER]: "container", [FT.PAIR_CONTAINER]: "map", [FT.TUPLE]: "tuple", [FT.VARIANT]: "variant", [FT.POINTER32]: "ref", [FT.REFERENCE_OLD]: "ref", [FT.WSTRING_OLD]: "string" } as Record<number, string>)[tag]
  ?? `0x${tag.toString(16)}`;

const MAX_INLINE_BYTES = 1024;
const isRefTag = (t: number) => t === FT.POINTER64 || t === FT.POINTER32 || t === FT.REFERENCE_OLD;

const b64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function int64Json(v: bigint): Json {
  const out: { [k: string]: Json } = { int64: v.toString() };
  // datas (segundos desde 1970, sem fuso) entre 1900 e 2200 ganham o texto
  if (v >= -2208988800n && v <= 7258118400n && ddlDateInRange(v)) out.date = ddlDateToString(v);
  return out;
}

/** Leitura: `FieldValue` → JSON. */
export function fieldToJson(v: FieldValue): Json {
  switch (v.kind) {
    case "int":
      if (v.type === FT.BOOL) return v.value !== 0;
      if (v.type === FT.POINTER32) return v.value === 0 ? null : { ref: String(v.value) };
      return v.value;
    case "bigint":
      if (v.type === FT.POINTER64) return v.value === 0n ? null : { ref: v.value.toString() };
      return int64Json(v.value);
    case "float":
      return Number.isFinite(v.value) ? v.value : String(v.value);
    case "bytes":
      if (v.type === FT.STRING || v.type === FT.WSTRING_OLD) return decodeString(v);
      if (v.type === FT.REFERENCE_OLD && v.value.length === 4) {
        const o = new DataView(v.value.buffer, v.value.byteOffset, 4).getUint32(0, true);
        return o === 0 ? null : { ref: String(o) };
      }
      return v.value.length <= MAX_INLINE_BYTES ? { base64: b64(v.value) } : { bytes: v.value.length };
    case "container":
      return v.items.map(fieldToJson);
    case "map":
      return { map: v.entries.map(([k, x]) => [fieldToJson(k), fieldToJson(x)]) };
    case "tuple":
      return v.type === FT.VARIANT ? { variant: v.items.map(fieldToJson) } : { tuple: v.items.map(fieldToJson) };
  }
}

const isObj = (j: Json): j is { [k: string]: Json } => typeof j === "object" && j !== null && !Array.isArray(j);

function refFrom(j: Json): bigint {
  if (j === null) return 0n;
  const s = isObj(j) ? j.ref : j;
  if (typeof s === "string" && /^\d+$/.test(s)) return BigInt(s);
  if (typeof s === "number" && Number.isSafeInteger(s) && s >= 0) return BigInt(s);
  throw new ValueError(`expected a reference {"ref":"<oid>"} or null, got ${JSON.stringify(j)}`);
}

/** "AAAA-MM-DD[ hh:mm[:ss]]" → DDL::Date (sem fuso, RD-022). */
export function parseDate(s: string): bigint {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s.trim());
  if (!m) throw new ValueError(`expected a date "YYYY-MM-DD[ hh:mm[:ss]]", got "${s}"`);
  const [y, mo, d, h, mi, se] = m.slice(1).map((x) => (x === undefined ? 0 : Number(x))) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) throw new ValueError(`invalid date "${s}"`);
  return ddlDateFromParts(y, mo, d, h, mi, se);
}

function int64From(j: Json): bigint {
  if (isObj(j)) {
    if (typeof j.date === "string") return parseDate(j.date);
    if (typeof j.int64 === "string" && /^-?\d+$/.test(j.int64)) return BigInt(j.int64);
  }
  if (typeof j === "string" && /^-?\d+$/.test(j)) return BigInt(j);
  if (typeof j === "number" && Number.isSafeInteger(j)) return BigInt(j);
  throw new ValueError(`expected a 64-bit integer {"int64":"…"} or {"date":"YYYY-MM-DD hh:mm"}, got ${JSON.stringify(j)}`);
}

const INT_RANGE: Record<number, [number, number]> = {
  [FT.UCHAR]: [0, 255], [FT.SCHAR]: [-128, 127], [FT.USHORT]: [0, 65535], [FT.SSHORT]: [-32768, 32767],
  [FT.UINT]: [0, 4294967295], [FT.SINT]: [-2147483648, 2147483647], [FT.ULONG]: [0, 4294967295], [FT.SLONG]: [-2147483648, 2147483647],
};

/** Escalar ou referência com a tag dada (já no tipo atual de gravação). */
export function scalarFromJson(tag: number, j: Json): FieldValue {
  switch (tag) {
    case FT.BOOL:
      if (typeof j !== "boolean") throw new ValueError(`expected boolean, got ${JSON.stringify(j)}`);
      return { kind: "int", type: tag, value: j ? 1 : 0 };
    case FT.UCHAR: case FT.SCHAR: case FT.USHORT: case FT.SSHORT: case FT.UINT: case FT.SINT: case FT.ULONG: case FT.SLONG: {
      const [lo, hi] = INT_RANGE[tag]!;
      if (typeof j !== "number" || !Number.isInteger(j) || j < lo || j > hi) throw new ValueError(`expected an integer in [${lo}, ${hi}], got ${JSON.stringify(j)}`);
      return { kind: "int", type: tag, value: j };
    }
    case FT.UINT64: case FT.SINT64:
      return { kind: "bigint", type: tag, value: int64From(j) };
    case FT.FLOAT: case FT.DOUBLE:
      if (typeof j !== "number" || !Number.isFinite(j)) throw new ValueError(`expected a finite number, got ${JSON.stringify(j)}`);
      return { kind: "float", type: tag, value: j, raw: new Uint8Array(0) };
    case FT.STRING:
      if (typeof j !== "string") throw new ValueError(`expected a string, got ${JSON.stringify(j)}`);
      return encodeString(j);
    case FT.BINARY:
      if (!isObj(j) || typeof j.base64 !== "string") throw new ValueError(`expected {"base64":"…"}`);
      return { kind: "bytes", type: tag, value: unb64(j.base64) };
    case FT.POINTER64:
      return { kind: "bigint", type: tag, value: refFrom(j) };
  }
  throw new ValueError(`type ${typeName(tag)} is not a scalar`);
}

/** Tag de gravação atual (legados viram o tipo atual, como o original grava). */
const current = (t: number): number => (t === FT.WSTRING_OLD ? FT.STRING : isRefTag(t) ? FT.POINTER64 : t);

function tagFromName(n: Json | undefined, what: string): number {
  if (typeof n !== "string" || TYPE_BY_NAME[n] === undefined) throw new ValueError(`give "${what}" as one of ${Object.keys(TYPE_BY_NAME).join("|")}`);
  return TYPE_BY_NAME[n]!;
}

/**
 * Escrita: JSON → `FieldValue` para um membro com a tag do dicionário `memberTag`. `template` é o valor atual do
 * campo, se existir: dá os tipos dos elementos de contêineres, mapas e tuplas.
 */
export function jsonToField(memberTag: number, j: Json, template?: FieldValue): FieldValue {
  const tag = current(memberTag);
  if (tag === FT.CONTAINER) {
    const items = Array.isArray(j) ? j : isObj(j) && Array.isArray(j.items) ? j.items : null;
    if (!items) throw new ValueError(`expected an array (container), got ${JSON.stringify(j)}`);
    let elem: number | null = isObj(j) && j.type !== undefined ? tagFromName(j.type, "type") : template?.kind === "container" ? template.elemType : null;
    if (elem === null && items.length) {
      if (items.every((x) => x === null || (isObj(x) && "ref" in x))) elem = FT.POINTER64;
      else if (items.every((x) => typeof x === "string")) elem = FT.STRING;
      else if (items.every((x) => typeof x === "boolean")) elem = FT.BOOL;
      else throw new ValueError(`container element type unknown: give {"items":[…],"type":"double|int32|…"}`);
    }
    if (elem === null) return { kind: "container", type: FT.CONTAINER, elemType: null, items: [] };
    const e = current(elem);
    return { kind: "container", type: FT.CONTAINER, elemType: e, items: items.map((x) => scalarFromJson(e, x)) };
  }
  if (tag === FT.PAIR_CONTAINER) {
    const entries = isObj(j) && Array.isArray(j.map) ? j.map : null;
    if (!entries) throw new ValueError(`expected {"map":[[key,value],…]}, got ${JSON.stringify(j)}`);
    const t = template?.kind === "map" ? template : undefined;
    const k = isObj(j) && j.key !== undefined ? tagFromName(j.key, "key") : (t?.keyType ?? null);
    const v = isObj(j) && j.value !== undefined ? tagFromName(j.value, "value") : (t?.valueType ?? null);
    if (entries.length === 0) return { kind: "map", type: FT.PAIR_CONTAINER, keyType: null, valueType: null, entries: [] };
    if (k === null || v === null) throw new ValueError(`map key/value types unknown: give {"map":[…],"key":"…","value":"…"}`);
    const tupleTemplate = t?.entries.find(([, x]) => x.kind === "tuple")?.[1];
    return {
      kind: "map", type: FT.PAIR_CONTAINER, keyType: current(k), valueType: current(v),
      entries: entries.map((pair) => {
        if (!Array.isArray(pair) || pair.length !== 2) throw new ValueError(`map entries are [key, value] pairs`);
        return [jsonToField(k, pair[0]!), jsonToField(v, pair[1]!, tupleTemplate)] as [FieldValue, FieldValue];
      }),
    };
  }
  if (tag === FT.TUPLE || tag === FT.VARIANT) {
    const items = isObj(j) && Array.isArray(j.tuple) ? j.tuple : isObj(j) && Array.isArray(j.variant) ? j.variant : null;
    if (!items) throw new ValueError(`expected {"tuple":[…]}`);
    if (template?.kind !== "tuple" || template.items.length !== items.length) throw new ValueError(`tuple element types unknown: only existing tuples with the same arity can be set`);
    return { kind: "tuple", type: template.type, items: items.map((x, i) => jsonToField(template.items[i]!.type, x, template.items[i])) };
  }
  return scalarFromJson(tag, j);
}

/** JSON com bigint como texto (resultado das ferramentas). */
export const toJsonText = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x instanceof Uint8Array ? { bytes: x.length } : x));
