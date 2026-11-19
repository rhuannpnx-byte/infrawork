/**
 * Caminho crítico do plano. O motor do ApeX mede a folga total de cada tarefa até o prazo do contrato; quando o plano
 * termina antes do prazo, até as tarefas que puxam o término ficam com folga (a distância até o prazo), e o critério
 * "folga zero" não marcava nada. Crítico é a tarefa de menor folga total do plano: as que definem o término. Com o
 * prazo estourado (folga negativa), é crítica toda tarefa sem folga (≤ 0), como no MS Project.
 */

/** Diferença de folga, em horas, que ainda conta como a mesma cadeia (arredondamento dos calendários). */
export const TOLERANCIA_CRITICO_H = 1

/** Folga total (h) até a qual a tarefa é crítica; null quando não há tarefa com folga calculada. */
export function limiteCritico(folgas: Iterable<number>): number | null {
  let menor = Infinity
  for (const f of folgas) if (Number.isFinite(f) && f < menor) menor = f
  return Number.isFinite(menor) ? Math.max(0, menor) : null
}

export function ehCritica(folgaH: number, limite: number | null): boolean {
  return limite !== null && Number.isFinite(folgaH) && folgaH <= limite + TOLERANCIA_CRITICO_H
}

/** Atalho para o resultado do motor: o limite das tarefas calculadas (indireto fica de fora, não tem folga). */
export function limiteCriticoDe(r: {
  tarefas: Map<string, { folga_total_h: number }>
}): number | null {
  return limiteCritico([...r.tarefas.values()].map((t) => t.folga_total_h))
}
