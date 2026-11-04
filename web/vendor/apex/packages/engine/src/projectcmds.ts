/**
 * Comandos do grupo Project do ribbon (U-52). Evidência: analises/2026-10-11_dynaroad/handoff/docs/
 * motor_controle_u52_u55.md §1 e handoff/funcoes/24_motor_controle/:
 * - "Remove calculated hauls" (36073): `MainFrame::OnProjectClearMoves@0x5c15c0` [O]: Plan → `RemoveAllLPMovesCommand`
 *   (`MoveManager::RemoveAllLPMoves(false)@0x94fa20`: sai todo LPMove não manual); Schedule →
 *   `RemoveAllSchedMovesCommand` (`RemoveAllSchedMoves(false, false)@0x94fb30`: ficam os manuais e os realizados);
 *   Control: o handler não faz nada (comando desabilitado). Rótulo 14425 "Remove haul".
 * - "Rename tasks automatically" (36072): `AutoNameEverythingCommand@0x5bb620`, rótulo 14045, que chama
 *   `ScheduleManager::AutoNameEverything@0x97c410` (split.ts `autoNameEverything`).
 * - "Lock internal timing" (`SumTask::m_bLockInternalTiming`): o motor 5.5.2 não lê a trava [O, varredura do PE: só
 *   `SumTaskBasicInfoPage::FetchData` e `TemplateImporter::GetEquivalent` chamam o getter]; nada a fazer aqui.
 */
import type { Entity, Project, Ref } from "@apex/model";
import { removeLPMove } from "./plan.js";
import { removeSchedMove } from "./schedule.js";
import { autoNameEverything } from "./split.js";

const refs = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is bigint => typeof x === "bigint") : []);

export const PROJECT_CMD = {
  REMOVE_HAUL: "Remove haul", // 14425
  AUTO_RENAME: "Automatic renaming of all tasks.", // 14045
} as const;

/** `MoveManager::RemoveAllLPMoves(bInclManual)@0x94fa20` */
export function removeAllLPMoves(p: Project, inclManual: boolean): number {
  const mm = p.resolve(p.root()!.get("m_pMoveManager") as Ref)!;
  let n = 0;
  for (const m of refs(mm.get("m_vpLPMoves")).map((o) => p.get(o)).filter((e): e is Entity => !!e)) {
    if (!inclManual && m.get("m_bManual") === true) continue;
    removeLPMove(p, mm, m);
    n++;
  }
  return n;
}

/** `MoveManager::RemoveAllSchedMoves(bInclManual, bInclActual)@0x94fb30` */
export function removeAllSchedMoves(p: Project, inclManual: boolean, inclActual: boolean): number {
  const mm = p.resolve(p.root()!.get("m_pMoveManager") as Ref)!;
  let n = 0;
  for (const m of refs(mm.get("m_vpSchedMoves")).map((o) => p.get(o)).filter((e): e is Entity => !!e)) {
    if (!inclManual && m.get("m_bManual") === true) continue;
    if (!inclActual && m.get("m_bActual") === true) continue;
    removeSchedMove(p, mm, m);
    n++;
  }
  return n;
}

/** Remove calculated hauls (36073) no modo `mode` (0 Plan, 1 Schedule, 2 Control); devolve quantos saíram. */
export function removeCalculatedHauls(p: Project, mode: number): number {
  if (mode === 2) return 0; // Control: OnProjectClearMoves não faz nada [O]
  let n = 0;
  p.edit(PROJECT_CMD.REMOVE_HAUL, () => {
    n = mode === 0 ? removeAllLPMoves(p, false) : removeAllSchedMoves(p, false, false);
  });
  return n;
}

/** Rename tasks automatically (36072): um nível "Automatic renaming of all tasks."; devolve quantas tarefas entraram. */
export function renameTasksAutomatically(p: Project): number {
  let n = 0;
  p.edit(PROJECT_CMD.AUTO_RENAME, () => {
    n = autoNameEverything(p);
  });
  return n;
}
