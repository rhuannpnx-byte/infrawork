/**
 * Escritor do .dr5 (RF-002, RN-025, RN-026; RD-001…003). Inverso exato de readContainer/readDpl:
 * um documento lido e regravado sem alteração produz os mesmos bytes (CA-RF-002-a).
 * Evidência: docs/analise_persistencia_dpl.md §1.1, §1.2, §2.1, §4.1; fn:ArchiveDriver_WriteArchive@0085d2a0;
 * fn:DPL_DiskDriverBase_WriteField@008f8700; fn:DR2Doc_Serialize@004f3f90.
 *
 * O documento vem de código do próprio ApeX ou de um .dr5 lido; mesmo assim o escritor confere tudo o
 * que tornaria o arquivo ilegível para o leitor (tipos de elemento, limites, OIDs) e lança Dr5Error.
 */
import pako from "pako";
import { ARCHIVE_DRIVER_VERSION, OUTER_HEADER_SIZE, OUTER_MAGIC } from "./container.js";
import { Dr5Error, MESSAGES } from "./errors.js";
import {
  FORMAT_OID32, FORMAT_OID64, INNER_MAGIC, MAX_CLIENT_VERSION, MAX_FIELD_SIZE, MAX_NESTING, MIN_CLIENT_VERSION,
} from "./dpl-reader.js";
import { BIGINT_TAGS, BYTES_TAGS, FLOAT_TAGS, FT, INT_TAGS, type Dr5Record, type FieldValue } from "./fields.js";

/** RN-026: o original grava sempre nVer 0x803 e a versão corrente 80006 (D-004). */
export const WRITE_FORMAT = FORMAT_OID64;
export const WRITE_CLIENT_VERSION = MAX_CLIENT_VERSION;
/** RD-001: DR2Doc::Serialize passa nível 1 ao ArchiveDriver (cabeçalho zlib 78 01). */
export const WRITE_ZLIB_LEVEL = 1;
/** Classe `Project` (Registrator<Project>), raiz da serialização (RN-025). */
export const PROJECT_CLASS_ID = 29;

export interface WritableDocument {
  formatVersion: number;
  clientVersion: number;
  records: readonly Dr5Record[];
}

export interface WriteOptions {
  /**
   * RN-025: grava só os objetos alcançáveis por ponteiros a partir deste OID (STORE|FOLLOW_POINTERS).
   * Ponteiro para OID inexistente lança "Unregistered object encountered". Sem a opção, grava todos.
   */
  reachableFrom?: bigint;
}

const invalid = (msg: string, details?: Record<string, unknown>) =>
  new Dr5Error("INVALID_DOCUMENT", `${MESSAGES.INVALID_DOCUMENT} ${msg}`, undefined, details);

class Buf {
  bytes = new Uint8Array(1 << 16);
  view = new DataView(this.bytes.buffer);
  pos = 0;
  reserve(n: number): void {
    if (this.pos + n <= this.bytes.length) return;
    let cap = this.bytes.length * 2;
    while (cap < this.pos + n) cap *= 2;
    const b = new Uint8Array(cap);
    b.set(this.bytes.subarray(0, this.pos));
    this.bytes = b;
    this.view = new DataView(b.buffer);
  }
  u8(v: number): void {
    this.reserve(1);
    this.bytes[this.pos++] = v;
  }
  u32(v: number): void {
    this.reserve(4);
    this.view.setUint32(this.pos, v, true);
    this.pos += 4;
  }
  put(b: Uint8Array): void {
    this.reserve(b.length);
    this.bytes.set(b, this.pos);
    this.pos += b.length;
  }
  result(): Uint8Array {
    return this.bytes.slice(0, this.pos);
  }
}

/** DV-005: identificador u32 exato; DataView.setUint32 truncaria 2^32+29 para 29 (outra classe). */
function checkU32(x: number, what: string): void {
  if (!Number.isInteger(x) || x < 0 || x > 0xffffffff) throw invalid(`${what} ${x} fora de u32.`);
}

function checkType(v: FieldValue, expected: number): void {
  if (v.type !== expected) throw invalid(`elemento do tipo 0x${v.type.toString(16)} onde se esperava 0x${expected.toString(16)}.`);
}

/** Corpo de um valor, sem o byte de tipo (WriteField com bWriteType = false). */
function writeValue(b: Buf, v: FieldValue, depth: number): void {
  const t = v.type;
  switch (v.kind) {
    case "int": {
      const spec = INT_TAGS[t];
      if (!spec) throw invalid(`tipo inteiro inválido 0x${t.toString(16)}.`);
      const [size, signed] = spec;
      const lo = signed ? -(2 ** (size * 8 - 1)) : 0;
      const hi = signed ? 2 ** (size * 8 - 1) - 1 : 2 ** (size * 8) - 1;
      if (!Number.isInteger(v.value) || v.value < lo || v.value > hi) throw invalid(`valor ${v.value} fora do tipo 0x${t.toString(16)}.`);
      b.reserve(size);
      if (size === 1) signed ? b.view.setInt8(b.pos, v.value) : b.view.setUint8(b.pos, v.value);
      else if (size === 2) signed ? b.view.setInt16(b.pos, v.value, true) : b.view.setUint16(b.pos, v.value, true);
      else signed ? b.view.setInt32(b.pos, v.value, true) : b.view.setUint32(b.pos, v.value, true);
      b.pos += size;
      return;
    }
    case "bigint": {
      const signed = BIGINT_TAGS[t];
      if (signed === undefined) throw invalid(`tipo de 64 bits inválido 0x${t.toString(16)}.`);
      const ok = signed ? BigInt.asIntN(64, v.value) === v.value : BigInt.asUintN(64, v.value) === v.value;
      if (!ok) throw invalid(`valor ${v.value} fora do tipo 0x${t.toString(16)}.`);
      b.reserve(8);
      signed ? b.view.setBigInt64(b.pos, v.value, true) : b.view.setBigUint64(b.pos, v.value, true);
      b.pos += 8;
      return;
    }
    case "float": {
      const size = FLOAT_TAGS[t];
      if (size === undefined) throw invalid(`tipo real inválido 0x${t.toString(16)}.`);
      // Bytes crus quando ainda representam o valor (preserva NaN com payload e −0); senão, codifica o valor.
      if (v.raw.length === size && Object.is(decodeFloat(v.raw, size), size === 4 ? Math.fround(v.value) : v.value)) {
        b.put(v.raw);
        return;
      }
      b.reserve(size);
      size === 4 ? b.view.setFloat32(b.pos, v.value, true) : b.view.setFloat64(b.pos, v.value, true);
      b.pos += size;
      return;
    }
    case "bytes":
      if (!BYTES_TAGS.has(t)) throw invalid(`tipo de tamanho variável inválido 0x${t.toString(16)}.`);
      if (v.value.length > MAX_FIELD_SIZE) throw new Dr5Error("TOO_LARGE_FIELD", MESSAGES.TOO_LARGE_FIELD, undefined, { size: v.value.length });
      b.u32(v.value.length);
      b.put(v.value);
      return;
  }
  if (depth >= MAX_NESTING) throw new Dr5Error("NESTING_TOO_DEEP", MESSAGES.NESTING_TOO_DEEP, undefined, { maxNesting: MAX_NESTING });
  const d = depth + 1;
  switch (v.kind) {
    case "container":
      // RD-003: n; o tipo do elemento só antes do 1º elemento e omitido se n = 0.
      if (t !== FT.CONTAINER) throw invalid(`contêiner com tipo 0x${t.toString(16)} (esperado 0x14).`); // DV-006
      b.u32(v.items.length);
      if (v.items.length === 0) return;
      if (v.elemType === null) throw invalid("contêiner com elementos sem tipo de elemento.");
      b.u8(v.elemType);
      for (const x of v.items) {
        checkType(x, v.elemType);
        writeValue(b, x, d);
      }
      return;
    case "map": {
      // RD-003: n; tipo da chave e do valor só antes do 1º par.
      if (t !== FT.PAIR_CONTAINER) throw invalid(`mapa com tipo 0x${t.toString(16)} (esperado 0x15).`); // DV-006
      b.u32(v.entries.length);
      if (v.entries.length === 0) return;
      if (v.keyType === null || v.valueType === null) throw invalid("mapa com pares sem tipo de chave ou valor.");
      v.entries.forEach(([k, x], i) => {
        checkType(k, v.keyType!);
        checkType(x, v.valueType!);
        if (i === 0) b.u8(v.keyType!);
        writeValue(b, k, d);
        if (i === 0) b.u8(v.valueType!);
        writeValue(b, x, d);
      });
      return;
    }
    case "tuple":
      // Cada subcampo com o próprio tipo; variant tem n = 2 (WriteField case 0x19).
      if (t !== FT.TUPLE && t !== FT.VARIANT) throw invalid(`tipo de tupla inválido 0x${t.toString(16)}.`);
      // DV-006: WriteField case 0x19 grava sempre dois subcampos ([07 which] + [tipo valor]).
      if (t === FT.VARIANT && v.items.length !== 2) throw invalid(`variant com ${v.items.length} subcampos (o original grava 2).`);
      b.u32(v.items.length);
      for (const x of v.items) {
        b.u8(x.type);
        writeValue(b, x, d);
      }
      return;
  }
}

function decodeFloat(raw: Uint8Array, size: number): number {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  return size === 4 ? dv.getFloat32(0, true) : dv.getFloat64(0, true);
}

function pointersOf(v: FieldValue, out: bigint[]): void {
  if (v.kind === "bigint" && v.type === FT.POINTER64) out.push(v.value);
  else if (v.kind === "int" && v.type === FT.POINTER32) out.push(BigInt(v.value));
  // DV-007: 0x12 legada vira 0x11 na leitura do original (@0x008f8094); com 4 bytes, é um OID u32 LE.
  else if (v.kind === "bytes" && v.type === FT.REFERENCE_OLD && v.value.length === 4) {
    out.push(BigInt(new DataView(v.value.buffer, v.value.byteOffset, 4).getUint32(0, true)));
  }
  else if (v.kind === "container" || v.kind === "tuple") for (const x of v.items) pointersOf(x, out);
  else if (v.kind === "map") for (const [k, x] of v.entries) pointersOf(k, out), pointersOf(x, out);
}

/**
 * RN-025: OIDs alcançáveis a partir de `root` seguindo ponteiros 0x18/0x11 e a referência legada 0x12
 * (0 = nulo), e os OIDs
 * apontados que não existem no documento (na leitura o original os torna nulos).
 */
export function reachability(records: readonly Dr5Record[], root: bigint): { reached: Set<bigint>; missing: Set<bigint> } {
  const byOid = new Map(records.map((r) => [r.oid, r]));
  const seen = new Set<bigint>();
  const missing = new Set<bigint>();
  const stack = [root];
  while (stack.length > 0) {
    const oid = stack.pop()!;
    if (seen.has(oid) || missing.has(oid)) continue;
    const r = byOid.get(oid);
    if (!r) {
      missing.add(oid);
      continue;
    }
    seen.add(oid);
    for (const f of r.fields) {
      const ptrs: bigint[] = [];
      pointersOf(f.value, ptrs);
      for (const p of ptrs) if (p !== 0n && !seen.has(p)) stack.push(p);
    }
  }
  return { reached: seen, missing };
}

/** Como `reachability`, mas um ponteiro sem objeto lança "Unregistered object encountered" (escrita). */
export function reachableOids(records: readonly Dr5Record[], root: bigint): Set<bigint> {
  const { reached, missing } = reachability(records, root);
  const first = missing.values().next();
  if (!first.done) throw new Dr5Error("UNREGISTERED_OBJECT", MESSAGES.UNREGISTERED_OBJECT, undefined, { oid: first.value, missing: missing.size });
  return reached;
}

/** Payload DPL ("DSSDPL File"): cabeçalho, registros em ordem crescente de OID, terminador 0 + 0xFFFFFFFF. */
export function writeDpl(doc: WritableDocument, opts: WriteOptions = {}): Uint8Array {
  const { formatVersion: fmt, clientVersion: client } = doc;
  if (fmt !== FORMAT_OID32 && fmt !== FORMAT_OID64) throw invalid(`nVer 0x${fmt.toString(16)} inválido.`);
  if (!Number.isInteger(client) || client < MIN_CLIENT_VERSION || client > MAX_CLIENT_VERSION) {
    throw invalid(`versão de cliente ${client} fora de ${MIN_CLIENT_VERSION}…${MAX_CLIENT_VERSION}.`);
  }
  let records = [...doc.records];
  if (opts.reachableFrom !== undefined) {
    const keep = reachableOids(records, opts.reachableFrom);
    records = records.filter((r) => keep.has(r.oid));
  }
  // RN-025: o MementoManager guarda os objetos num std::map<u64,Object>, então saem em ordem crescente e únicos.
  records.sort((a, b) => (a.oid < b.oid ? -1 : a.oid > b.oid ? 1 : 0));
  const oidMax = fmt === FORMAT_OID64 ? 2n ** 64n - 1n : 2n ** 32n - 1n;
  const b = new Buf();
  b.put(INNER_MAGIC);
  b.u32(fmt);
  b.u32(client);
  records.forEach((r, i) => {
    if (i > 0 && records[i - 1]!.oid === r.oid) throw invalid(`OID ${r.oid} duplicado.`);
    if (r.oid < 1n || r.oid > oidMax) throw invalid(`OID ${r.oid} fora do formato 0x${fmt.toString(16)}.`);
    const start = b.pos;
    b.u32(0); // nSize: gravado 0 e corrigido no fim (*(u32*)m_pBuf = m_nBufPos)
    if (fmt === FORMAT_OID64) {
      b.reserve(8);
      b.view.setBigUint64(b.pos, r.oid, true);
      b.pos += 8;
    } else b.u32(Number(r.oid));
    checkU32(r.classId, "classe");
    b.u32(r.classId);
    for (const f of r.fields) {
      checkU32(f.id, "id de campo");
      b.u32(f.id);
      b.u8(f.type);
      checkType(f.value, f.type);
      writeValue(b, f.value, 0);
    }
    const size = b.pos - start;
    if (size > MAX_FIELD_SIZE) throw new Dr5Error("TOO_LARGE_FIELD", MESSAGES.TOO_LARGE_FIELD, undefined, { oid: r.oid, size });
    b.view.setUint32(start, size, true);
  });
  b.u32(0); // nEndOfObjects
  b.u32(0xffffffff); // nCrc fixo: não há checksum (RD-002)
  return b.result();
}

/** Contêiner externo: magic de 29 bytes, 0x1000 e zlib (nível 1 por padrão, como o original). */
export function writeContainer(payload: Uint8Array, level: number = WRITE_ZLIB_LEVEL): Uint8Array {
  if (!Number.isInteger(level) || level < 1 || level > 9) throw invalid(`nível zlib ${level} fora de 1…9.`);
  const z = pako.deflate(payload, { level: level as 1 });
  const out = new Uint8Array(OUTER_HEADER_SIZE + z.length);
  out.set(OUTER_MAGIC, 0);
  new DataView(out.buffer).setUint32(OUTER_MAGIC.length, ARCHIVE_DRIVER_VERSION, true);
  out.set(z, OUTER_HEADER_SIZE);
  return out;
}

/** RF-002: grava o .dr5 completo. */
export function writeDr5(doc: WritableDocument, opts: WriteOptions & { level?: number } = {}): Uint8Array {
  return writeContainer(writeDpl(doc, opts), opts.level);
}
