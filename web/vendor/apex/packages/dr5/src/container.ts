/**
 * Camada externa do .dr5 (RD-001).
 * Evidência: docs/analise_persistencia_dpl.md §1.1; fn:ArchiveDriver_ReadArchive@0085d1a0.
 *   0x00  "DSSDPL's ArchiveDriver File" 0x1A 0x00   29 bytes, comparados por strcmp
 *   0x1D  u32 LE nArchiveDriverVersion = 0x1000      igualdade exata
 *   0x21  stream zlib único até o fim do arquivo
 */
import pako from "pako";
import { Dr5Error, MESSAGES } from "./errors.js";

export const OUTER_MAGIC = new TextEncoder().encode("DSSDPL's ArchiveDriver File\x1a\x00");
export const ARCHIVE_DRIVER_VERSION = 0x1000;
export const OUTER_HEADER_SIZE = 0x21;
/** Limite defensivo do sistema novo para o payload descomprimido (o maior exemplo tem 1,2 MB). */
export const DEFAULT_MAX_PAYLOAD = 256 * 1024 * 1024;

export interface ContainerInfo {
  driverVersion: number;
  /** Byte FLG do cabeçalho zlib (0x01 = nível 1, o que o original grava). */
  zlibHeader: [number, number];
  compressedLength: number;
}

export function readContainer(
  file: Uint8Array,
  maxPayload = DEFAULT_MAX_PAYLOAD,
): { info: ContainerInfo; payload: Uint8Array } {
  if (file.length < OUTER_HEADER_SIZE + 2) throw new Dr5Error("BAD_OUTER_HEADER", MESSAGES.BAD_OUTER_HEADER, 0);
  for (let i = 0; i < OUTER_MAGIC.length; i++) {
    if (file[i] !== OUTER_MAGIC[i]) throw new Dr5Error("BAD_OUTER_HEADER", MESSAGES.BAD_OUTER_HEADER, i);
  }
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const driverVersion = view.getUint32(OUTER_MAGIC.length, true);
  if (driverVersion !== ARCHIVE_DRIVER_VERSION) {
    throw new Dr5Error("BAD_DRIVER_VERSION", MESSAGES.BAD_DRIVER_VERSION, OUTER_MAGIC.length, { driverVersion });
  }
  const compressed = file.subarray(OUTER_HEADER_SIZE);
  const inflator = new pako.Inflate();
  let total = 0;
  const chunks: Uint8Array[] = [];
  inflator.onData = (chunk: Uint8Array) => {
    total += chunk.length;
    if (total > maxPayload) throw new Dr5Error("PAYLOAD_TOO_LARGE", MESSAGES.PAYLOAD_TOO_LARGE, undefined, { maxPayload });
    chunks.push(chunk);
  };
  inflator.push(compressed, true);
  if (inflator.err) {
    throw new Dr5Error("ZLIB_ERROR", MESSAGES.ZLIB_ERROR, OUTER_HEADER_SIZE, { zlib: inflator.msg });
  }
  const payload = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    payload.set(c, off);
    off += c.length;
  }
  return {
    info: { driverVersion, zlibHeader: [compressed[0] ?? 0, compressed[1] ?? 0], compressedLength: compressed.length },
    payload,
  };
}
