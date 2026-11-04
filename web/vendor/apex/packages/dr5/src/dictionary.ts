/**
 * Nomes de classe e de campo (RD-005). A chave real é (classe, id, tipo) (RD-004): o mesmo id
 * pode existir com tipos diferentes no mesmo objeto.
 */
import { CLASS_NAMES, FIELD_ROWS } from "./dictionary.generated.js";
import { FT } from "./fields.js";

const byKey = new Map<string, string>();
const byId = new Map<string, Set<string>>();
for (const [cls, fid, tag, member] of FIELD_ROWS) {
  byKey.set(`${cls}:${fid}:${tag}`, member);
  const k = `${cls}:${fid}`;
  if (!byId.has(k)) byId.set(k, new Set());
  byId.get(k)!.add(member);
}

export function className(classId: number): string | undefined {
  return CLASS_NAMES.get(classId);
}

/** Todas as classes do dicionário: [id, nome], em ordem de id. */
export function classList(): [number, string][] {
  return [...CLASS_NAMES].sort((a, b) => a[0] - b[0]);
}

/** Tipos legados são lidos com o nome do tipo atual: 0x16→0x0F, 0x11/0x12→0x18 (RD-003). */
const LEGACY_ALIAS: Readonly<Record<number, number>> = { [FT.WSTRING_OLD]: FT.STRING, [FT.POINTER32]: FT.POINTER64, [FT.REFERENCE_OLD]: FT.POINTER64 };

export interface FieldName {
  name: string;
  /** true se o nome veio da chave exata (classe, id, tipo) ou do alias legado. */
  exact: boolean;
}

export function fieldName(classId: number, fieldId: number, type: number): FieldName | undefined {
  const exact = byKey.get(`${classId}:${fieldId}:${type}`);
  if (exact !== undefined) return { name: exact, exact: true };
  const alias = LEGACY_ALIAS[type];
  if (alias !== undefined) {
    const a = byKey.get(`${classId}:${fieldId}:${alias}`);
    if (a !== undefined) return { name: a, exact: true };
  }
  const any = byId.get(`${classId}:${fieldId}`);
  if (any) return { name: "?" + [...any].sort().join("/"), exact: false };
  return undefined;
}

/**
 * Chave de membro: o identificador inicial do nome da tabela, sem anotações
 * ("m_pLayOut (via temporario)" → "m_pLayOut", "m_info.m_bBold" → "m_info.m_bBold").
 * Linhas sem identificador (variáveis locais, legado SiteLink) não têm chave.
 */
export function memberKey(member: string): string | undefined {
  return /^[A-Za-z_][A-Za-z0-9_.]*/.exec(member)?.[0];
}

const byClassName = new Map<string, number>();
for (const [id, name] of CLASS_NAMES) byClassName.set(name, id);
const byMember = new Map<string, { id: number; tag: number }[]>();
for (const [cls, fid, tag, member] of FIELD_ROWS) {
  const key = memberKey(member);
  if (key === undefined || tag === null) continue;
  const k = `${cls}:${key}`;
  if (!byMember.has(k)) byMember.set(k, []);
  byMember.get(k)!.push({ id: fid, tag });
}

/** Número da classe pelo nome (`Registrator<T>`), ex.: "Project" → 29. */
export function classIdByName(name: string): number | undefined {
  return byClassName.get(name);
}

/**
 * (id, tag) possíveis de um membro, na ordem da tabela. Um membro pode ter mais de um: o tipo legado e o
 * atual no mesmo id (ex.: RoadLine m_dWidth 0x07 antes de 50008 e 0x0d depois) ou dois ids.
 */
export function fieldsOfMember(classId: number, key: string): readonly { id: number; tag: number }[] {
  return byMember.get(`${classId}:${key}`) ?? [];
}

/** Chaves de membro conhecidas de uma classe. */
export function memberKeys(classId: number): string[] {
  const out = new Set<string>();
  for (const [cls, , tag, member] of FIELD_ROWS) {
    const key = memberKey(member);
    if (cls === classId && key !== undefined && tag !== null) out.add(key);
  }
  return [...out];
}
