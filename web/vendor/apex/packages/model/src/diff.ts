/**
 * Diferença entre dois estados do mesmo projeto, por OID (U-13).
 *
 * O motor roda num Web Worker sobre uma cópia do projeto (carregada do `.apex.json`); a thread principal guarda o
 * `Project` com o undo (RN-027). O worker captura o estado antes do cálculo, roda o motor na cópia e devolve só o
 * que mudou: objetos criados, removidos e alterados (com a lista nova de campos). A thread principal aplica tudo
 * num único `p.edit(<rótulo>)`, então o cálculo inteiro é um nível de undo, como no original (Controller::Invoke).
 *
 * Cada objeto alterado ou removido leva o hash dos campos de antes (`base`); se o projeto da thread principal
 * mudou nesse objeto enquanto o worker calculava, a aplicação recusa com DIFF_CONFLICT e nada é alterado.
 */
import type { Field } from "@apex/dr5";
import { ModelError } from "./errors.js";
import { fieldsKey } from "./native-json.js";
import type { Project } from "./project.js";
import { sha256 } from "./sha256.js";

export interface ProjectState {
  objects: Map<bigint, { classId: number; key: string }>;
}

export interface ProjectDiff {
  created: { oid: bigint; classId: number; fields: Field[] }[];
  removed: { oid: bigint; base: string }[];
  changed: { oid: bigint; base: string; fields: Field[] }[];
}

const utf8 = new TextEncoder();
const hashKey = (key: string) => sha256(utf8.encode(key));

/** Estado de todos os objetos (classe e chave estável dos campos), para comparar depois. */
export function captureState(p: Project): ProjectState {
  const objects = new Map<bigint, { classId: number; key: string }>();
  for (const e of p.entities()) objects.set(e.oid, { classId: e.classId, key: fieldsKey(e.fields) });
  return { objects };
}

/** O que mudou em `p` desde `before`, em ordem crescente de OID. */
export function diffSince(before: ProjectState, p: Project): ProjectDiff {
  const diff: ProjectDiff = { created: [], removed: [], changed: [] };
  const seen = new Set<bigint>();
  const byOid = (a: { oid: bigint }, b: { oid: bigint }) => (a.oid < b.oid ? -1 : a.oid > b.oid ? 1 : 0);
  for (const e of p.entities()) {
    seen.add(e.oid);
    const old = before.objects.get(e.oid);
    if (!old) {
      diff.created.push({ oid: e.oid, classId: e.classId, fields: structuredClone(e.fields) });
      continue;
    }
    if (old.classId !== e.classId) {
      // mesmo OID com outra classe: remoção seguida de criação
      diff.removed.push({ oid: e.oid, base: hashKey(old.key) });
      diff.created.push({ oid: e.oid, classId: e.classId, fields: structuredClone(e.fields) });
      continue;
    }
    if (fieldsKey(e.fields) !== old.key) diff.changed.push({ oid: e.oid, base: hashKey(old.key), fields: structuredClone(e.fields) });
  }
  for (const [oid, old] of before.objects) if (!seen.has(oid)) diff.removed.push({ oid, base: hashKey(old.key) });
  diff.created.sort(byOid);
  diff.removed.sort(byOid);
  diff.changed.sort(byOid);
  return diff;
}

export function isEmptyDiff(d: ProjectDiff): boolean {
  return d.created.length === 0 && d.removed.length === 0 && d.changed.length === 0;
}

/**
 * Aplica a diferença dentro de um `p.edit` já aberto. Confere tudo antes de alterar qualquer objeto; uma
 * diferença que não casa com o estado atual lança DIFF_CONFLICT (e o `edit` desfaz o nível parcial).
 */
export function applyDiff(p: Project, diff: ProjectDiff): void {
  const conflict = (msg: string) => new ModelError("DIFF_CONFLICT", msg);
  const removedNow = new Set<bigint>();
  for (const r of diff.removed) {
    const e = p.get(r.oid);
    if (!e) throw conflict(`OID ${r.oid} a remover não existe`);
    if (hashKey(fieldsKey(e.fields)) !== r.base) throw conflict(`OID ${r.oid} mudou desde o início do cálculo`);
    removedNow.add(r.oid);
  }
  for (const c of diff.changed) {
    const e = p.get(c.oid);
    if (!e) throw conflict(`OID ${c.oid} a alterar não existe`);
    if (hashKey(fieldsKey(e.fields)) !== c.base) throw conflict(`OID ${c.oid} mudou desde o início do cálculo`);
  }
  for (const c of diff.created) if (p.get(c.oid) && !removedNow.has(c.oid)) throw conflict(`OID ${c.oid} a criar já existe`);

  for (const r of diff.removed) p.remove(p.get(r.oid)!);
  for (const c of diff.changed) p.get(c.oid)!.replaceFields(structuredClone(c.fields));
  for (const c of diff.created) p.createAt(c.oid, c.classId, structuredClone(c.fields));
}
