import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pako from "pako";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const FIXTURES = join(ROOT, "fixtures");
/** Oráculos: os .dr5 da instalação analisada, lidos por caminho (D-007). Nunca copiados. */
export const ORACLE_DIR = process.env.APEX_ORACLES ?? resolve(ROOT, "../../../analises/2026-10-11_dynaroad/alvo/Data");

export interface OracleEntry {
  file: string;
  sha256: string;
  payload_len: number;
  payload_sha256: string;
  fmt: number;
  client: number;
  objects: number;
  fields: number;
  end: [number, number];
  canonical_sha256: string;
}
export const ORACLE: OracleEntry[] = JSON.parse(readFileSync(join(FIXTURES, "golden/dpl-oracle.json"), "utf8")).files;

export const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

export const oracleDirAvailable = () => existsSync(ORACLE_DIR) && readdirSync(ORACLE_DIR).length > 0;

/** Arquivos de oráculo disponíveis: os 2 fixtures sempre; os 27 se ORACLE_DIR existir. */
export function oracleFiles(): { entry: OracleEntry; path: string }[] {
  const out: { entry: OracleEntry; path: string }[] = [];
  for (const entry of ORACLE) {
    const full = join(ORACLE_DIR, entry.file);
    if (existsSync(full)) out.push({ entry, path: full });
    else if (entry.file.startsWith("en/")) {
      const fx = join(FIXTURES, entry.file.slice(3));
      if (existsSync(fx)) out.push({ entry, path: fx });
    }
  }
  return out;
}

/** Monta um .dr5 a partir de um payload, com o cabeçalho do original e zlib nível 1. */
export function buildDr5(payload: Uint8Array): Uint8Array {
  const h = readFileSync(join(FIXTURES, "default.dr5")).subarray(0, 0x21);
  const z = pako.deflate(payload, { level: 1 });
  const out = new Uint8Array(h.length + z.length);
  out.set(h, 0);
  out.set(z, h.length);
  return out;
}

/**
 * Fuzz em lotes (DV-008): entre um lote e outro devolve o controle ao laço de eventos, para o worker
 * do Vitest responder às suas chamadas mesmo com a máquina carregada. Um laço síncrono de dezenas
 * de segundos fazia o Vitest abortar com "Timeout calling onTaskUpdate" sem nenhuma asserção falha.
 */
export async function inBatches(total: number, batch: number, body: (i: number) => void): Promise<void> {
  for (let i = 0; i < total; i++) {
    body(i);
    if ((i + 1) % batch === 0) await new Promise<void>((r) => setImmediate(r));
  }
}

/** Gerador congruente linear com semente fixa (mesmas mutações em toda execução). */
export function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32;
}
