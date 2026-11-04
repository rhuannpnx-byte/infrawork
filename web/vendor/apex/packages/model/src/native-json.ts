/**
 * Formato nativo `.apex.json` (D-009/D-012 com o nome de D-014): JSON legível, versionado, sem perda e com
 * hash de integridade. Converte `.dr5 → .apex.json → .dr5` byte a byte (CA da U-03).
 *
 *   { "format": "apex-project", "schema": 1,
 *     "dr5": { "formatVersion": 2051, "clientVersion": 80006 },
 *     "objects": [ { "oid": "1", "class": 29, "className": "Project",
 *                    "fields": [ [id, tag, valor, "m_strName"], ... ] } ],
 *     "sha256": "<SHA-256 do JSON acima sem esta chave>" }
 *
 * Valor por tipo: inteiros → número; 64 bits → string decimal; real → número, ou {"raw": hex} se o número não
 * reproduz os bytes (NaN com payload, −0, infinitos); string → {"s": texto}, ou {"hex"} se o texto não
 * reproduz os bytes; blob → {"hex"}; contêiner → {"e": tag|null, "items": [...]}; mapa → {"k", "v",
 * "entries": [[a, b]...]}; tupla e variant → {"items": [[tag, valor]...]}. O 4º item do campo (nome) é só
 * para leitura humana e é ignorado na carga.
 */
import { className, fieldName, FT, MAX_NESTING, PROJECT_CLASS_ID, type Field, type FieldValue } from "@apex/dr5";
import { ModelError } from "./errors.js";
import type { Project } from "./project.js";
import { sha256 } from "./sha256.js";

export const NATIVE_FORMAT = "apex-project";
export const NATIVE_SCHEMA = 1;

type J = null | boolean | number | string | J[] | { [k: string]: J };

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function unhex(s: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/.test(s)) throw new ModelError("NATIVE_FORMAT", "hex inválido");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
const utf8 = new TextEncoder();
const utf8d = new TextDecoder("utf-8", { fatal: true });
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

function stringBytes(tag: number, s: string): Uint8Array {
  if (tag === FT.STRING) {
    const b = utf8.encode(s);
    const out = new Uint8Array(b.length + 1);
    out.set(b);
    return out;
  }
  const out = new Uint8Array(s.length * 2 + 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return out;
}
function stringOf(tag: number, b: Uint8Array): string | undefined {
  try {
    if (tag === FT.STRING) return b.length > 0 && b[b.length - 1] === 0 ? utf8d.decode(b.subarray(0, -1)) : undefined;
    if (b.length % 2 || b.length < 2 || b[b.length - 1] !== 0 || b[b.length - 2] !== 0) return undefined;
    let s = "";
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < b.length - 2; i += 2) s += String.fromCharCode(dv.getUint16(i, true));
    return s;
  } catch {
    return undefined;
  }
}

function floatBytes(size: number, v: number): Uint8Array {
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  size === 4 ? dv.setFloat32(0, v, true) : dv.setFloat64(0, v, true);
  return b;
}

function valueToJson(v: FieldValue): J {
  switch (v.kind) {
    case "int":
      return v.value;
    case "bigint":
      return v.value.toString();
    case "float": {
      const size = v.type === FT.FLOAT ? 4 : 8;
      const raw = v.raw.length === size ? v.raw : floatBytes(size, v.value);
      const plain = Number.isFinite(v.value) && !Object.is(v.value, -0) && eq(floatBytes(size, v.value), raw);
      return plain ? v.value : { raw: hex(raw) };
    }
    case "bytes": {
      if (v.type === FT.STRING || v.type === FT.WSTRING_OLD) {
        const s = stringOf(v.type, v.value);
        if (s !== undefined && eq(stringBytes(v.type, s), v.value)) return { s };
      }
      return { hex: hex(v.value) };
    }
    case "container":
      return { e: v.elemType, items: v.items.map(valueToJson) };
    case "map":
      return { k: v.keyType, v: v.valueType, entries: v.entries.map(([a, b]) => [valueToJson(a), valueToJson(b)]) };
    case "tuple":
      return { items: v.items.map((x) => [x.type, valueToJson(x)]) };
  }
}

/** Faixas aceitas por tipo inteiro (as mesmas do escritor .dr5). Bool aceita o byte cru 0…255, como o leitor. */
const INT_RANGE: Readonly<Record<number, readonly [number, number]>> = {
  0x01: [0, 255], 0x02: [0, 255], 0x03: [-128, 127], 0x04: [0, 65535], 0x05: [-32768, 32767],
  0x06: [0, 2 ** 32 - 1], 0x07: [-(2 ** 31), 2 ** 31 - 1], 0x08: [0, 2 ** 32 - 1], 0x09: [-(2 ** 31), 2 ** 31 - 1], 0x11: [0, 2 ** 32 - 1],
};
const BIG_RANGE: Readonly<Record<number, readonly [bigint, bigint]>> = {
  0x0a: [0n, 2n ** 64n - 1n], 0x0b: [-(2n ** 63n), 2n ** 63n - 1n], 0x18: [0n, 2n ** 64n - 1n],
};
const fmt = (msg: string) => new ModelError("NATIVE_FORMAT", msg);
const obj = (j: J, what: string): { [k: string]: J } => {
  if (j === null || typeof j !== "object" || Array.isArray(j)) throw fmt(`${what}: esperava objeto`);
  return j;
};
const arr = (j: J | undefined, what: string): J[] => {
  if (!Array.isArray(j)) throw fmt(`${what}: esperava array`);
  return j;
};
const tagOf = (j: J | undefined, what: string): number => {
  if (typeof j !== "number" || !Number.isInteger(j) || j < 0 || j > 255) throw fmt(`${what}: tag inválida`);
  return j;
};
const tagOrNull = (j: J | undefined, what: string): number | null => (j === null ? null : tagOf(j, what));

/** DV-012: o .apex.json é entrada não confiável (o SHA-256 prova integridade, não autoria). */
function valueFromJson(tag: number, j: J, depth: number): FieldValue {
  const r = INT_RANGE[tag];
  if (r) {
    if (typeof j !== "number" || !Number.isInteger(j) || j < r[0] || j > r[1]) throw fmt(`valor ${JSON.stringify(j)} fora do tipo 0x${tag.toString(16)}`);
    return { kind: "int", type: tag, value: j };
  }
  const br = BIG_RANGE[tag];
  if (br) {
    if (typeof j !== "string" || !/^-?\d{1,20}$/.test(j)) throw fmt(`esperava string decimal para 0x${tag.toString(16)}`);
    const v = BigInt(j);
    if (v < br[0] || v > br[1]) throw fmt(`valor ${j} fora do tipo 0x${tag.toString(16)}`);
    return { kind: "bigint", type: tag, value: v };
  }
  if (tag === FT.FLOAT || tag === FT.DOUBLE) {
    const size = tag === FT.FLOAT ? 4 : 8;
    if (typeof j === "number") {
      if (size === 4 && Math.fround(j) !== j) throw fmt(`real ${j} não cabe em float`);
      return { kind: "float", type: tag, value: j, raw: floatBytes(size, j) };
    }
    const raw = unhex(String(obj(j, "real").raw));
    if (raw.length !== size) throw fmt("real com tamanho errado");
    const dv = new DataView(raw.buffer);
    return { kind: "float", type: tag, value: size === 4 ? dv.getFloat32(0, true) : dv.getFloat64(0, true), raw };
  }
  if (tag === FT.STRING || tag === FT.WSTRING_OLD || tag === FT.BINARY || tag === FT.REFERENCE_OLD) {
    const o = obj(j, "bytes");
    if (typeof o.s === "string" && (tag === FT.STRING || tag === FT.WSTRING_OLD)) return { kind: "bytes", type: tag, value: stringBytes(tag, o.s) };
    if (typeof o.hex === "string") return { kind: "bytes", type: tag, value: unhex(o.hex) };
    throw fmt("bytes sem s/hex");
  }
  if (depth >= MAX_NESTING) throw fmt(`aninhamento acima de ${MAX_NESTING}`);
  const d = depth + 1;
  const o = obj(j, "composto");
  if (tag === FT.CONTAINER) {
    const e = tagOrNull(o.e, "contêiner");
    const items = arr(o.items, "contêiner.items");
    if (e === null && items.length > 0) throw fmt("contêiner com itens sem tipo");
    return { kind: "container", type: FT.CONTAINER, elemType: e, items: items.map((x) => valueFromJson(e!, x, d)) };
  }
  if (tag === FT.PAIR_CONTAINER) {
    const k = tagOrNull(o.k, "mapa.k"), v = tagOrNull(o.v, "mapa.v");
    const entries = arr(o.entries, "mapa.entries");
    if ((k === null || v === null) && entries.length > 0) throw fmt("mapa com pares sem tipo");
    return {
      kind: "map", type: FT.PAIR_CONTAINER, keyType: k, valueType: v,
      entries: entries.map((pp) => {
        const pair = arr(pp, "mapa.par");
        if (pair.length !== 2) throw fmt("par de mapa sem 2 itens");
        return [valueFromJson(k!, pair[0]!, d), valueFromJson(v!, pair[1]!, d)] as [FieldValue, FieldValue];
      }),
    };
  }
  if (tag === FT.TUPLE || tag === FT.VARIANT) {
    const items = arr(o.items, "tupla.items");
    if (tag === FT.VARIANT && items.length !== 2) throw fmt("variant sem 2 subcampos");
    return {
      kind: "tuple", type: tag,
      items: items.map((x) => {
        const it = arr(x, "tupla.item");
        if (it.length !== 2) throw fmt("item de tupla sem [tag, valor]");
        return valueFromJson(tagOf(it[0], "tupla.item"), it[1]!, d);
      }),
    };
  }
  throw fmt(`tipo 0x${tag.toString(16)} desconhecido`);
}

/** Chave estável de uma lista de campos (Trim do undo e comparações). */
export function fieldsKey(fields: readonly Field[]): string {
  return JSON.stringify(fields.map((f) => [f.id, f.type, valueToJson(f.value)]));
}

function body(p: Project, ui?: NativeUi): { [k: string]: J } {
  const objects: J[] = [];
  for (const e of p.entities()) {
    objects.push({
      oid: e.oid.toString(),
      class: e.classId,
      className: className(e.classId) ?? null,
      fields: e.fields.map((f) => {
        const n = fieldName(e.classId, f.id, f.type);
        return n ? [f.id, f.type, valueToJson(f.value), n.name] : [f.id, f.type, valueToJson(f.value)];
      }),
    });
  }
  const b: { [k: string]: J } = { format: NATIVE_FORMAT, schema: NATIVE_SCHEMA, dr5: { formatVersion: p.formatVersion, clientVersion: p.clientVersion }, objects };
  if (ui !== undefined) b.ui = JSON.parse(JSON.stringify(ui)) as J; // só valores JSON
  return b;
}

/**
 * Estado de interface guardado junto do projeto (RF-062, U-13): subdocumento `ui`, separado de `objects` para não
 * contaminar o cálculo; entra no SHA-256 como o resto. O carregador do projeto o ignora; quem quer lê com `readNativeUi`.
 */
export type NativeUi = { [k: string]: unknown };

/** Texto do `.apex.json` (um objeto por linha, para diff legível). */
export function toNativeJson(p: Project, ui?: NativeUi): string {
  const b = body(p, ui);
  const digest = sha256(utf8.encode(JSON.stringify(b)));
  const objects = (b.objects as J[]).map((o) => "    " + JSON.stringify(o)).join(",\n");
  const uiLine = b.ui === undefined ? "" : `,\n  "ui": ${JSON.stringify(b.ui)}`;
  return `{\n  "format": ${JSON.stringify(NATIVE_FORMAT)},\n  "schema": ${NATIVE_SCHEMA},\n  "dr5": ${JSON.stringify(b.dr5)},\n  "objects": [\n${objects}\n  ]${uiLine},\n  "sha256": "${digest}"\n}\n`;
}

/** Subdocumento `ui` de um `.apex.json` (sem conferir o resto); undefined se ausente ou malformado. */
export function readNativeUi(text: string): NativeUi | undefined {
  try {
    const top = JSON.parse(text) as unknown;
    if (top === null || typeof top !== "object" || Array.isArray(top)) return undefined;
    const ui = (top as { ui?: unknown }).ui;
    return ui !== null && typeof ui === "object" && !Array.isArray(ui) ? (ui as NativeUi) : undefined;
  } catch {
    return undefined;
  }
}

/** Carrega um `.apex.json`, conferindo esquema, SHA-256 e a forma de tudo (DV-012). */
export function fromNativeJson(text: string, ProjectClass: new (fmt: number, client: number) => Project): Project {
  try {
    return load(text, ProjectClass);
  } catch (e) {
    if (e instanceof ModelError) throw e;
    // rede de segurança: nenhuma exceção crua sai do carregador
    throw fmt(`estrutura inválida: ${(e as Error).message}`);
  }
}

function load(text: string, ProjectClass: new (fmt: number, client: number) => Project): Project {
  let parsed: J;
  try {
    parsed = JSON.parse(text) as J;
  } catch (e) {
    throw fmt(`JSON inválido: ${(e as Error).message}`);
  }
  const top = obj(parsed, "documento");
  if (top.format !== NATIVE_FORMAT) throw fmt(`formato ${String(top.format)} não é ${NATIVE_FORMAT}`);
  if (top.schema !== NATIVE_SCHEMA) throw fmt(`esquema ${String(top.schema)} não suportado (esperado ${NATIVE_SCHEMA})`);
  const { sha256: claimed, ...rest } = top;
  const digest = sha256(utf8.encode(JSON.stringify(rest)));
  if (claimed !== digest) throw new ModelError("INTEGRITY", `SHA-256 não confere: arquivo ${String(claimed)}, conteúdo ${digest}`);
  const dr5 = obj(top.dr5 as J, "dr5");
  const fv = dr5.formatVersion, cv = dr5.clientVersion;
  if (typeof fv !== "number" || typeof cv !== "number" || !Number.isInteger(fv) || !Number.isInteger(cv)) throw fmt("dr5.formatVersion/clientVersion inválidos");
  const p = new ProjectClass(fv, cv);
  let hasProject = false;
  for (const o of arr(top.objects, "objects")) {
    const x = obj(o, "objeto");
    if (typeof x.oid !== "string" || !/^[1-9]\d{0,19}$/.test(x.oid) || BigInt(x.oid) > 2n ** 64n - 1n) throw fmt(`OID inválido: ${JSON.stringify(x.oid)}`);
    const oid = BigInt(x.oid);
    if (p.get(oid)) throw fmt(`OID ${oid} duplicado`);
    const cls = x.class;
    if (typeof cls !== "number" || !Number.isInteger(cls) || cls < 0 || cls > 0xffffffff) throw fmt(`classe inválida no OID ${oid}`);
    if (cls === PROJECT_CLASS_ID) hasProject = true;
    const fields: Field[] = arr(x.fields, `OID ${oid}.fields`).map((f) => {
      const ff = arr(f, `OID ${oid}.campo`);
      const id = ff[0], tag = tagOf(ff[1], `OID ${oid}.campo`);
      if (typeof id !== "number" || !Number.isInteger(id) || id < 0 || id > 0xffffffff) throw fmt(`id de campo inválido no OID ${oid}`);
      if (ff.length < 3) throw fmt(`campo sem valor no OID ${oid}`);
      return { id, type: tag, value: valueFromJson(tag, ff[2]!, 0) };
    });
    p.insert(oid, cls, fields);
  }
  if (!hasProject) throw fmt("documento sem objeto Project (classe 29)");
  return p;
}
