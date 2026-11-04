/**
 * Valores do modelo: a forma JS de um `FieldValue` do `.dr5` (RD-003) e a volta.
 * O modelo guarda sempre o `FieldValue` original; `decode` só lê. `encode` cria o valor novo de um campo
 * editado, com as regras de gravação do original (string sempre 0x0F, ponteiro sempre 0x18).
 */
import { decodeString, encodeString, FT, type FieldValue } from "@apex/dr5";
import { ModelError } from "./errors.js";

/** Referência a outro objeto: o OID, ou null para o ponteiro nulo (OID 0). */
export type Ref = bigint | null;
export type ModelValue = boolean | number | bigint | string | Uint8Array | Ref | ModelValue[] | [ModelValue, ModelValue][];

const refOf = (oid: bigint): Ref => (oid === 0n ? null : oid);

/** Leitura: bool → boolean, ponteiros → Ref, strings decodificadas, compostos em arrays. */
export function decode(v: FieldValue): ModelValue {
  switch (v.kind) {
    case "int":
      if (v.type === FT.BOOL) return v.value !== 0;
      if (v.type === FT.POINTER32) return refOf(BigInt(v.value));
      return v.value;
    case "bigint":
      return v.type === FT.POINTER64 ? refOf(v.value) : v.value;
    case "float":
      return v.value;
    case "bytes":
      if (v.type === FT.STRING || v.type === FT.WSTRING_OLD) return decodeString(v);
      // 0x12 legada: o original a lê como ponteiro 0x11 (ReadField @0x008f8094)
      if (v.type === FT.REFERENCE_OLD && v.value.length === 4) {
        return refOf(BigInt(new DataView(v.value.buffer, v.value.byteOffset, 4).getUint32(0, true)));
      }
      return v.value;
    case "container":
      return v.items.map(decode);
    case "map":
      return v.entries.map(([k, x]) => [decode(k), decode(x)] as [ModelValue, ModelValue]);
    case "tuple":
      return v.items.map(decode);
  }
}

function bad(msg: string): ModelError {
  return new ModelError("BAD_VALUE", msg);
}

/** Tag atual para gravar um campo cuja tag lida é `tag` (legados viram o tipo atual, como o original grava). */
export function currentTag(tag: number): number {
  if (tag === FT.WSTRING_OLD) return FT.STRING;
  if (tag === FT.POINTER32 || tag === FT.REFERENCE_OLD) return FT.POINTER64;
  return tag;
}

/**
 * Escrita de um escalar ou de uma referência. Compostos usam `encodeContainer` ou um `FieldValue` pronto,
 * porque o tipo dos elementos não sai do valor JS sozinho.
 */
export function encode(tag: number, js: ModelValue): FieldValue {
  const t = currentTag(tag);
  switch (t) {
    case FT.BOOL:
      if (typeof js !== "boolean") throw bad(`esperava boolean para 0x01, recebeu ${typeof js}`);
      return { kind: "int", type: t, value: js ? 1 : 0 };
    case FT.UCHAR: case FT.SCHAR: case FT.USHORT: case FT.SSHORT:
    case FT.UINT: case FT.SINT: case FT.ULONG: case FT.SLONG:
      if (typeof js !== "number" || !Number.isInteger(js)) throw bad(`esperava inteiro para 0x${t.toString(16)}`);
      return { kind: "int", type: t, value: js };
    case FT.UINT64: case FT.SINT64:
      if (typeof js !== "bigint") throw bad(`esperava bigint para 0x${t.toString(16)}`);
      return { kind: "bigint", type: t, value: js };
    case FT.POINTER64:
      if (js !== null && typeof js !== "bigint") throw bad("esperava Ref (bigint ou null)");
      return { kind: "bigint", type: t, value: js ?? 0n };
    case FT.FLOAT: case FT.DOUBLE:
      if (typeof js !== "number") throw bad(`esperava number para 0x${t.toString(16)}`);
      return { kind: "float", type: t, value: js, raw: new Uint8Array(0) };
    case FT.STRING:
      if (typeof js !== "string") throw bad("esperava string");
      return encodeString(js);
    case FT.BINARY:
      if (!(js instanceof Uint8Array)) throw bad("esperava Uint8Array para 0x10");
      return { kind: "bytes", type: t, value: js };
  }
  throw bad(`tipo 0x${t.toString(16)} não é escalar; use encodeContainer ou um FieldValue`);
}

/** Contêiner (0x14) de escalares ou referências do mesmo tipo. */
export function encodeContainer(elemTag: number, items: readonly ModelValue[]): FieldValue {
  const t = currentTag(elemTag);
  return { kind: "container", type: FT.CONTAINER, elemType: items.length === 0 ? null : t, items: items.map((x) => encode(t, x)) };
}
