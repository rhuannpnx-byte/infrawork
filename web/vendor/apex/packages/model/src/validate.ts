/**
 * Validações de entrada (RN-029, núcleo). Mensagens copiadas da string table do original
 * (analises/2026-10-11_dynaroad/evidencias/strings_ui_en.txt, ids entre parênteses) [O].
 * As condições exatas (`>` e `===`) são [I]: a evidência mostra a mensagem, não a comparação, e onde cada
 * validação é aplicada na interface não foi lido [D]; a ligação com os diálogos é da U-13.
 */
export const VALIDATION_MESSAGES = {
  START_AFTER_FINISH: "Start station is greater than finish station.", // 14052
  LOCATION_ZERO_LENGTH: "Location cannot be zero length.", // 14370
  ROAD_LINE_ZERO_LENGTH: "Road line cannot be zero length.", // 14574
  TASK_LOCATIONS_INTERSECT: "Task locations cannot intersect.", // 14758
  CENTER_AFTER_FINISH: "Center station is greater than finish station.", // 14839
} as const;

/** Tolerâncias numéricas observadas (RN-029, RNF-006; docs/analise_otimizacao_schedule.md §7, §11.5) [O]. */
export const TOLERANCES = {
  /** quantidade livre */
  FREE_AMOUNT: 0.01,
  /** hora livre */
  FREE_HOUR: 0.001,
  /** total de transporte; negativos */
  HAUL_TOTAL: 0.1,
  /** erro de quantidade/taxa */
  AMOUNT_RATE_ERROR: -0.1,
} as const;

export type ValidationMessage = (typeof VALIDATION_MESSAGES)[keyof typeof VALIDATION_MESSAGES];

/** Faixa de estacas de uma localização de tarefa (Location f206/f208) ou de uma road line (f300/f301). */
export function checkStationSpan(begin: number, end: number): ValidationMessage | null {
  return begin > end ? VALIDATION_MESSAGES.START_AFTER_FINISH : null;
}

export function checkCenterStation(center: number, end: number): ValidationMessage | null {
  return center > end ? VALIDATION_MESSAGES.CENTER_AFTER_FINISH : null;
}

export function checkLocationLength(begin: number, end: number): ValidationMessage | null {
  return checkStationSpan(begin, end) ?? (begin === end ? VALIDATION_MESSAGES.LOCATION_ZERO_LENGTH : null);
}

export function checkRoadLineLength(begin: number, end: number): ValidationMessage | null {
  return checkStationSpan(begin, end) ?? (begin === end ? VALIDATION_MESSAGES.ROAD_LINE_ZERO_LENGTH : null);
}

/**
 * Localizações de tarefas na mesma road line não podem se sobrepor. Encostar (fim de uma = início da outra)
 * não conta como interseção [I].
 */
export function checkTaskLocations(spans: readonly { roadLine: bigint | null; begin: number; end: number }[]): ValidationMessage | null {
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i]!, b = spans[j]!;
      if (a.roadLine !== null && a.roadLine === b.roadLine && a.begin < b.end && b.begin < a.end) {
        return VALIDATION_MESSAGES.TASK_LOCATIONS_INTERSECT;
      }
    }
  }
  return null;
}
