/**
 * Ordem por nome e rótulos de undo (U-61f). Evidência: analises/2026-10-11_dynaroad/evidencias/decompilado/u61f_motor/
 * lote1/ (KernelObjectHelpers::NamePred::operator()@0x930900, HasNameHelpers::NamePred@0x9ed350, Tools::LogicalCompare
 * @0xa13800/@0xa22020, ChangeManager::StartTransaction@0x4ae9c0) e handoff/docs/dialogos_infra.md §5.1.
 *
 * - [O] `KernelObjectHelpers::NamePred(a, b)`: compara os nomes (`std::wstring::compare`, por unidade de código); iguais →
 *   compara as descrições (`GetLongName`, vt+0xc) do mesmo modo; iguais → ordem dos ponteiros; descrições diferentes →
 *   `Tools::LogicalCompare(descA, descB) < 0`; nomes diferentes → `Tools::LogicalCompare(nomeA, nomeB) < 0`.
 * - [O] `Tools::LogicalCompare(wstring)` = `Locale::Collator::Compare(localeInstances.m_collator, a, b)`: um colador de
 *   locale. [P] O ApeX usa `Intl.Collator("en", { numeric: true, sensitivity: "base" })` (ordem "lógica": "Cut 2" antes de
 *   "Cut 10", sem distinguir maiúsculas); empate do colador → OID, no lugar da ordem dos ponteiros (não reproduzível).
 * - [O] `ChangeInfo::MakeUndoText@0x4ae3e0`: alvo vazio → ação; ação vazia → alvo; os dois → `alvo + ": " +
 *   minúsculas(ação)` (`boost::to_lower`). `MakeFullTransactionDescription@0x4ae2c0`: junção com ", " dos textos não
 *   vazios de todas as transações abertas, na ordem de abertura.
 */
import type { Entity, Project } from "@apex/model";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** `Tools::LogicalCompare` [O chamada; P colador]. */
export const logicalCompare = (a: string, b: string): number => collator.compare(a, b);

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byOid = (a: Entity, b: Entity) => (a.oid < b.oid ? -1 : a.oid > b.oid ? 1 : 0);
const longName = (e: Entity) => String(e.get("m_strLongName") ?? "");

/** `KernelObjectHelpers::NamePred::operator()@0x930900` como comparador de ordenação (negativo = a antes de b). */
export function namePred(a: Entity, b: Entity): number {
  if (byCode(a.name, b.name) !== 0) return logicalCompare(a.name, b.name) || byOid(a, b);
  const la = longName(a), lb = longName(b);
  if (byCode(la, lb) !== 0) return logicalCompare(la, lb) || byOid(a, b);
  return byOid(a, b);
}

/** `ChangeInfo::MakeUndoText@0x4ae3e0` [O]. */
export function makeUndoText(target: string, action: string): string {
  if (!target) return action;
  if (!action) return target;
  return `${target}: ${action.toLowerCase()}`;
}

/** `MakeFullTransactionDescription@0x4ae2c0` [O]: textos não vazios, na ordem, unidos por ", ". */
export function fullTransactionDescription(texts: readonly string[]): string {
  return texts.filter((t) => t !== "").join(", ");
}

/** Rótulo de uma transação cujo alvo é o projeto (nome do projeto, `Project::m_strName`) [O mecanismo; I alvo = projeto]. */
export function projectUndoText(p: Project, action: string): string {
  return makeUndoText(String(p.root()?.get("m_strName") ?? ""), action);
}

/** Título do 13031 (`LomSolverDlg`, "Haul Calculation"): a ação da transação do diálogo [O OnInitDialog@0x5aa9d0]. */
export const HAUL_CALCULATION_ACTION = "Haul Calculation";
