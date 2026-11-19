/**
 * Caminho crítico do plano. O motor do ApeX mede a folga total de cada tarefa até o prazo do contrato; quando o plano
 * termina antes do prazo, até as tarefas que puxam o término ficam com folga (a distância até o prazo), e o critério
 * "folga zero" não marcava nada. Crítica é a tarefa de menor folga total do plano — as que definem o término —, com
 * tolerância de menos de um dia útil: a folga sai em horas, mas o plano é lido em dias, e diferenças de algumas horas
 * vêm do calendário (validado: atrasar uma tarefa com 3 a 6 h a mais de folga empurra o término tanto quanto atrasar
 * a de menor folga). Com o prazo estourado (folga negativa), é crítica toda tarefa sem folga (≤ 0), como no MS Project.
 */
import { jornadaReferencia } from './calendario'
import type { PlanoEntrada } from './tipos'

/** Jornada usada quando o plano não tem calendário. */
const JORNADA_PADRAO_H = 8

/** Folga total (h) de referência: a menor do plano, ou 0 se o prazo estourou; null quando não há tarefa calculada. */
export function limiteCritico(folgas: Iterable<number>): number | null {
  let menor = Infinity
  for (const f of folgas) if (Number.isFinite(f) && f < menor) menor = f
  return Number.isFinite(menor) ? Math.max(0, menor) : null
}

/** Crítica: folga até `toleranciaH` acima do limite (exclusive). */
export function ehCritica(folgaH: number, limite: number | null, toleranciaH: number): boolean {
  return limite !== null && Number.isFinite(folgaH) && folgaH < limite + toleranciaH
}

/** Critério do plano calculado: limite pela menor folga e tolerância de um dia útil do calendário do plano. */
export function criterioCritico(
  e: Pick<PlanoEntrada, 'plano' | 'calendarios'>,
  r: { tarefas: Map<string, { folga_total_h: number }> }
): (folgaH: number) => boolean {
  const limite = limiteCritico([...r.tarefas.values()].map((t) => t.folga_total_h))
  const cal =
    e.calendarios.find((c) => c.id === e.plano.calendario_id) ??
    e.calendarios.find((c) => c.padrao) ??
    e.calendarios[0]
  const jornada = (cal ? jornadaReferencia(cal) : 0) || JORNADA_PADRAO_H
  return (folgaH) => ehCritica(folgaH, limite, jornada)
}
