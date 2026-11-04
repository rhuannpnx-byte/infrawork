/**
 * Leitor do payload DPL "DSSDPL File" (RD-002, RD-003, RD-004).
 * Evidência: docs/analise_persistencia_dpl.md §1.2, §2; fn:DPL_DiskDriverBase_Read@008f7ae0;
 * fn:DPL_DiskDriverBase_ReadField@008f8000.
 *
 * Leitura defensiva: o .dr5 não tem checksum (RNF-004), então todo tamanho é conferido contra
 * os bytes restantes antes de alocar ou avançar.
 */
import { Dr5Error, MESSAGES } from "./errors.js";
import {
  BIGINT_TAGS, BYTES_TAGS, FLOAT_TAGS, FT, INT_TAGS, REMOVED_TAGS,
  type Dr5Record, type Field, type FieldValue,
} from "./fields.js";

export const INNER_MAGIC = new TextEncoder().encode("DSSDPL File\x1a\x00");
export const INNER_HEADER_SIZE = 0x15;
export const FORMAT_OID32 = 0x802;
export const FORMAT_OID64 = 0x803;
/** RN-026: Utils::GetMinFileVersion @0x008f9f30 = 40038; GetCurrentFileVersion @0x008f9e30 = 80006. */
export const MIN_CLIENT_VERSION = 40038;
export const MAX_CLIENT_VERSION = 80006;
/** Limite do original: "Too large field encountered" acima de 0x1FFFFFFF. */
export const MAX_FIELD_SIZE = 0x1fffffff;
/**
 * Limite defensivo do sistema novo (RNF-004, DV-001): contêineres, mapas, tuplas e variants
 * aninhados além disto são recusados com Dr5Error em vez de estourar a pilha. Os 27 exemplos
 * chegam a 2 níveis. O comportamento do original com aninhamento extremo é [D].
 */
export const MAX_NESTING = 64;
const TERMINATOR = 0xffffffff;

export interface DplOptions {
  minClientVersion?: number;
  maxClientVersion?: number;
}

export interface DplDocument {
  /** nVer: 0x802 (OID 32 bits) ou 0x803 (OID 64 bits). */
  formatVersion: number;
  /** nClientVersion: versão do esquema da aplicação (80006 nos arquivos atuais). */
  clientVersion: number;
  records: Dr5Record[];
  /** Offset do terminador (u32 < 5) e o valor lido em seguida (0xFFFFFFFF). */
  end: { offset: number; terminator: number };
  /** Bytes após o terminador (o original os ignora). */
  trailingBytes: number;
}

class Cursor {
  pos = 0;
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  need(n: number): void {
    if (n < 0 || this.pos + n > this.bytes.length) {
      throw new Dr5Error("UNEXPECTED_END", MESSAGES.UNEXPECTED_END, this.pos);
    }
  }
  u8(): number {
    this.need(1);
    return this.bytes[this.pos++]!;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  take(n: number): Uint8Array {
    this.need(n);
    const b = this.bytes.slice(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
}

function checkTag(t: number, at: number): void {
  const removed = REMOVED_TAGS[t];
  if (removed !== undefined) throw new Dr5Error("INVALID_FIELD_TYPE", removed, at, { tag: t });
  if (t > FT.VARIANT || t === 0x13 || (t === 0x0e)) {
    throw new Dr5Error("INVALID_FIELD_TYPE", MESSAGES.INVALID_FIELD_TYPE, at, { tag: t });
  }
}

/** Contagem de elementos: cada elemento ocupa ao menos 1 byte, então n > restantes é corrupção. */
function count(c: Cursor): number {
  const at = c.pos;
  const n = c.u32();
  if (n > c.bytes.length - c.pos) throw new Dr5Error("UNEXPECTED_END", MESSAGES.UNEXPECTED_END, at, { count: n });
  return n;
}

function readValue(c: Cursor, t: number, depth = 0): FieldValue {
  const at = c.pos - 1;
  checkTag(t, at);
  const intSpec = INT_TAGS[t];
  if (intSpec) {
    const [size, signed] = intSpec;
    c.need(size);
    let v: number;
    if (size === 1) v = signed ? c.view.getInt8(c.pos) : c.view.getUint8(c.pos);
    else if (size === 2) v = signed ? c.view.getInt16(c.pos, true) : c.view.getUint16(c.pos, true);
    else v = signed ? c.view.getInt32(c.pos, true) : c.view.getUint32(c.pos, true);
    c.pos += size;
    return { kind: "int", type: t, value: v };
  }
  const bigSigned = BIGINT_TAGS[t];
  if (bigSigned !== undefined) {
    c.need(8);
    const v = bigSigned ? c.view.getBigInt64(c.pos, true) : c.view.getBigUint64(c.pos, true);
    c.pos += 8;
    return { kind: "bigint", type: t, value: v };
  }
  const floatSize = FLOAT_TAGS[t];
  if (floatSize !== undefined) {
    c.need(floatSize);
    const v = floatSize === 4 ? c.view.getFloat32(c.pos, true) : c.view.getFloat64(c.pos, true);
    return { kind: "float", type: t, value: v, raw: c.take(floatSize) };
  }
  if (BYTES_TAGS.has(t)) {
    const lenAt = c.pos;
    const n = c.u32();
    if (n > MAX_FIELD_SIZE) throw new Dr5Error("TOO_LARGE_FIELD", MESSAGES.TOO_LARGE_FIELD, lenAt, { size: n });
    return { kind: "bytes", type: t, value: c.take(n) };
  }
  if (depth >= MAX_NESTING) throw new Dr5Error("NESTING_TOO_DEEP", MESSAGES.NESTING_TOO_DEEP, at, { maxNesting: MAX_NESTING });
  const d = depth + 1;
  if (t === FT.CONTAINER) {
    // O tipo do elemento só aparece antes do 1º elemento e é omitido se n = 0 (RD-003).
    const n = count(c);
    if (n === 0) return { kind: "container", type: FT.CONTAINER, elemType: null, items: [] };
    const et = c.u8();
    const items: FieldValue[] = [];
    for (let i = 0; i < n; i++) items.push(readValue(c, et, d));
    return { kind: "container", type: FT.CONTAINER, elemType: et, items };
  }
  if (t === FT.PAIR_CONTAINER) {
    // Tipos da chave e do valor só antes do 1º par (RD-003).
    const n = count(c);
    if (n === 0) return { kind: "map", type: FT.PAIR_CONTAINER, keyType: null, valueType: null, entries: [] };
    const kt = c.u8();
    const k0 = readValue(c, kt, d);
    const vt = c.u8();
    const v0 = readValue(c, vt, d);
    const entries: [FieldValue, FieldValue][] = [[k0, v0]];
    for (let i = 1; i < n; i++) entries.push([readValue(c, kt, d), readValue(c, vt, d)]);
    return { kind: "map", type: FT.PAIR_CONTAINER, keyType: kt, valueType: vt, entries };
  }
  if (t === FT.TUPLE || t === FT.VARIANT) {
    // Cada subcampo traz o próprio tipo; variant tem n = 2 ([07 which] + [tipo valor]).
    const n = count(c);
    const items: FieldValue[] = [];
    for (let i = 0; i < n; i++) items.push(readValue(c, c.u8(), d));
    return { kind: "tuple", type: t, items };
  }
  throw new Dr5Error("INVALID_FIELD_TYPE", MESSAGES.INVALID_FIELD_TYPE, at, { tag: t });
}

export function readDpl(payload: Uint8Array, opts: DplOptions = {}): DplDocument {
  const minV = opts.minClientVersion ?? MIN_CLIENT_VERSION;
  const maxV = opts.maxClientVersion ?? MAX_CLIENT_VERSION;
  const c = new Cursor(payload);
  if (payload.length < INNER_HEADER_SIZE) throw new Dr5Error("BAD_INNER_HEADER", MESSAGES.BAD_INNER_HEADER, 0);
  for (let i = 0; i < INNER_MAGIC.length; i++) {
    if (payload[i] !== INNER_MAGIC[i]) throw new Dr5Error("BAD_INNER_HEADER", MESSAGES.BAD_INNER_HEADER, i);
  }
  c.pos = INNER_MAGIC.length;
  const formatVersion = c.u32();
  if (formatVersion !== FORMAT_OID32 && formatVersion !== FORMAT_OID64) {
    throw new Dr5Error("BAD_INNER_HEADER", MESSAGES.BAD_INNER_HEADER, INNER_MAGIC.length, { formatVersion });
  }
  const clientVersion = c.u32();
  // RN-026: FileTooOldException / FileTooNewException.
  if (clientVersion < minV) {
    throw new Dr5Error("FILE_TOO_OLD", MESSAGES.FILE_TOO_OLD, 17, { fileVersion: clientVersion, minVersion: minV, maxVersion: maxV });
  }
  if (clientVersion > maxV) {
    throw new Dr5Error("FILE_TOO_NEW", MESSAGES.FILE_TOO_NEW, 17, { fileVersion: clientVersion, minVersion: minV, maxVersion: maxV });
  }
  const oid64 = formatVersion === FORMAT_OID64;
  const records: Dr5Record[] = [];
  for (;;) {
    const start = c.pos;
    if (c.pos + 4 > payload.length) throw new Dr5Error("UNEXPECTED_FILE_ENDING", MESSAGES.UNEXPECTED_FILE_ENDING, start);
    const size = c.u32();
    if (size < 5) {
      // Fim: u32 < 5 (gravado 0) seguido de u32 0xFFFFFFFF; não há CRC real (RD-002).
      if (c.pos + 4 > payload.length) throw new Dr5Error("UNEXPECTED_FILE_ENDING", MESSAGES.UNEXPECTED_FILE_ENDING, start);
      const terminator = c.u32();
      if (terminator !== TERMINATOR) {
        throw new Dr5Error("UNEXPECTED_FILE_ENDING", MESSAGES.UNEXPECTED_FILE_ENDING, start, { terminator });
      }
      return { formatVersion, clientVersion, records, end: { offset: start, terminator }, trailingBytes: payload.length - c.pos };
    }
    if (size > MAX_FIELD_SIZE) throw new Dr5Error("TOO_LARGE_FIELD", MESSAGES.TOO_LARGE_FIELD, start, { size });
    const end = start + size;
    if (end > payload.length) throw new Dr5Error("UNEXPECTED_END", MESSAGES.UNEXPECTED_END, start, { size });
    const sub = new Cursor(payload.subarray(0, end));
    sub.pos = c.pos;
    const oid = oid64 ? (sub.need(8), sub.view.getBigUint64(sub.pos, true)) : BigInt(sub.view.getUint32(sub.pos, true));
    sub.pos += oid64 ? 8 : 4;
    const classId = sub.u32();
    const fields: Field[] = [];
    while (sub.pos < end) {
      const id = sub.u32();
      const type = sub.u8();
      fields.push({ id, type, value: readValue(sub, type) });
    }
    if (sub.pos !== end) throw new Dr5Error("MISALIGNED_RECORD", MESSAGES.MISALIGNED_RECORD, start, { expectedEnd: end, actualEnd: sub.pos });
    records.push({ offset: start, size, oid, classId, fields });
    c.pos = end;
  }
}
