/**
 * InfraWork (vendor, acréscimo): adiador de cálculo para montagem em lote — o `TimingCalculationPostponer` do original
 * (ScheduleManager::ResetTimings só marca sujo enquanto há postponer; o destrutor do mais externo recalcula uma vez).
 * No ApeX o adiador vive no app (`core/postponer.ts`, ligado a `Project.onSettle`); aqui ele fica no motor para que os
 * comandos de criação (`@apex/obra`), chamados em sequência por um construtor, não recalculem o cronograma a cada
 * objeto: dentro de `postponeTiming`, `resetTimings` e `applyAutoDependencies` só marcam o que falta e acumulam os
 * inícios desejados; no fim, roda uma vez cada (dependências automáticas antes das datas, como o postponer do app).
 * Fora de `postponeTiming` nada muda.
 */
import type { Project } from "@apex/model";

interface Pending {
  timing: boolean;
  autodeps: boolean;
  wanted: Map<bigint, number>;
}

const state = new Map<Project, { depth: number; pending: Pending }>();

/** Se há adiador ativo no projeto, registra o pedido e devolve true (o chamador não calcula agora). */
export function deferTiming(p: Project, kind: "timing" | "autodeps", wanted?: Map<bigint, number>): boolean {
  const s = state.get(p);
  if (!s) return false;
  if (kind === "timing") s.pending.timing = true;
  else s.pending.autodeps = true;
  if (wanted) for (const [k, v] of wanted) s.pending.wanted.set(k, v);
  return true;
}

/**
 * Roda `fn` com o cálculo adiado e, ao sair do mais externo, aplica o que ficou pendente com `flush` (o chamador passa
 * as funções do motor para não haver import circular): `autodeps()` e depois `timing(wanted)`.
 */
export function postponeTiming<T>(p: Project, fn: () => T, flush: { autodeps: () => void; timing: (wanted: Map<bigint, number>) => void }): T {
  let s = state.get(p);
  if (!s) state.set(p, (s = { depth: 0, pending: { timing: false, autodeps: false, wanted: new Map() } }));
  s.depth++;
  let ok = false;
  try {
    const r = fn();
    ok = true;
    return r;
  } finally {
    s.depth--;
    if (s.depth === 0) {
      const pending = s.pending;
      state.delete(p);
      if (ok) {
        if (pending.autodeps) flush.autodeps();
        if (pending.timing || pending.autodeps) flush.timing(pending.wanted);
      }
    }
  }
}
