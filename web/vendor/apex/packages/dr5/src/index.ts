/** @apex/dr5 — leitura (U-01) e escrita (U-02) do formato .dr5. */
import { readContainer, type ContainerInfo } from "./container.js";
import { readDpl, type DplDocument, type DplOptions } from "./dpl-reader.js";

export * from "./errors.js";
export * from "./fields.js";
export * from "./container.js";
export * from "./dpl-reader.js";
export * from "./dpl-writer.js";
export * from "./date.js";
export * from "./dictionary.js";
export { canonicalJson } from "./canonical.js";
export { dump, type DumpStats } from "./dump.js";

export interface Dr5Document extends DplDocument {
  container: ContainerInfo;
}

export interface ReadOptions extends DplOptions {
  maxPayloadBytes?: number;
}

/** RF-001: abre um .dr5 (contêiner zlib + payload DPL). Entrada não confiável (RNF-004). */
export function readDr5(file: Uint8Array, opts: ReadOptions = {}): Dr5Document {
  const { info, payload } = readContainer(file, opts.maxPayloadBytes);
  return { container: info, ...readDpl(payload, opts) };
}

/** Variante que devolve também o payload descomprimido (para comparação com dumps). */
export function readDr5WithPayload(file: Uint8Array, opts: ReadOptions = {}): { doc: Dr5Document; payload: Uint8Array } {
  const { info, payload } = readContainer(file, opts.maxPayloadBytes);
  return { doc: { container: info, ...readDpl(payload, opts) }, payload };
}
