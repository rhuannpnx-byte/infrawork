/** Leitura dos valores do modelo (parte sem formatação; a parte regional continua em `packages/app/src/core/values.ts`). */
import { ddlDateToString } from "@apex/dr5";
import type { Entity, ModelValue, Project, Ref } from "@apex/model";

export const refs = (v: ModelValue | undefined): bigint[] => (Array.isArray(v) ? (v as ModelValue[]).filter((x): x is bigint => typeof x === "bigint") : []);
export const asRef = (v: ModelValue | undefined): Ref => (typeof v === "bigint" ? v : null);
export const num = (v: ModelValue | undefined): number | null => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : null);
export const str = (v: ModelValue | undefined): string => (typeof v === "string" ? v : "");
export const bool = (v: ModelValue | undefined): boolean | null => (typeof v === "boolean" ? v : null);

/** Pares de um mapa do modelo (`[chave, valor][]`). */
export function pairs(v: ModelValue | undefined): [ModelValue, ModelValue][] {
  if (!Array.isArray(v)) return [];
  return (v as ModelValue[]).filter((x): x is [ModelValue, ModelValue] => Array.isArray(x) && x.length === 2);
}

export const resolve = (p: Project, v: ModelValue | undefined): Entity | undefined => p.resolve(asRef(v));
export const nameOf = (p: Project, v: ModelValue | undefined): string => resolve(p, v)?.name ?? "";

/** DDL::Date (segundos, sem fuso; RN-022) válida → segundos; ausente, −1 ou fora da faixa → null. */
export function ddlSeconds(v: ModelValue | undefined): number | null {
  const b = typeof v === "bigint" ? v : typeof v === "number" ? BigInt(Math.trunc(v)) : null;
  if (b === null) return null;
  try {
    return ddlDateToString(b) === null ? null : Number(b);
  } catch {
    return null;
  }
}
