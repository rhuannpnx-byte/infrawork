// Formatação e parsing de posições espaciais em rodovias.
//
// Armazenamento sempre em METROS (numeric no DB). Display + entrada de usuário
// em 3 unidades:
//
//   km:     '2+508,50'      ↔ 2508.50 m   (KM full + metros + decimal)
//   m:      '2508,50'       ↔ 2508.50 m   (metros direto)
//   estaca: 'EST 125+8,50'  ↔ 2508.50 m   (estaca × 20m + offset 0..19.99)
//
// Parsing aceita vírgula OU ponto como separador decimal (PT-BR usa vírgula).
// Inputs malformados retornam null — NUNCA throw — pra que o caller exiba erro
// inline na UI sem precisar de try/catch.

export type UnidadeEspaco = 'km' | 'm' | 'estaca' | 'custom'

const METROS_POR_ESTACA = 20

/**
 * Formata metros pra string de exibição na unidade dada.
 *
 * NaN / null / undefined / Infinity / negativo → '' (string vazia).
 * Conversão "barata" pro caso comum de UI; pra display rico (alinhamento de
 * casas decimais etc), o caller pode pós-processar.
 *
 * 'custom' faz fallback pra formato 'm' (metros raw). Display rico que usa
 * o label/divisor do trecho exige função separada (deferido — só UI do mapa
 * usa custom hoje, e usa o label diretamente).
 */
export function formatPosicao(
  metros: number | null | undefined,
  unidade: UnidadeEspaco
): string {
  if (metros == null || !Number.isFinite(metros) || metros < 0) return ''

  switch (unidade) {
    case 'm':
    case 'custom':
      return formatComma(metros, 2)
    case 'km': {
      const km = Math.floor(metros / 1000)
      const resto = metros - km * 1000
      // Convenção rodoviária: meters part padded a 3 dígitos. Ex: 2+050,00.
      return `${km}+${formatComma(resto, 2, 3)}`
    }
    case 'estaca': {
      const est = Math.floor(metros / METROS_POR_ESTACA)
      const offset = metros - est * METROS_POR_ESTACA
      return `EST ${est}+${formatComma(offset, 2)}`
    }
  }
}

/**
 * Parsea string de input pra metros. Vírgula ou ponto como separador decimal.
 *
 * Tolerante por unidade — aceita formato canônico OU "só metros":
 *   'km':     'KM+M[,CC]'  (ex: '2+508,50' → 2508.50)        — canônico
 *             OU 'N[,CC]'   (ex: '2508,50'  → 2508.50)        — só metros
 *   'm':      'N[,CC]'      (ex: '2508,50'  → 2508.50)
 *   'estaca': '[EST] N+M[,CC]' (ex: 'EST 125+8,50' → 2508.50) — canônico
 *             OU 'N[,CC]'   (ex: '2508,50'  → 2508.50)        — só metros
 *
 * "Só metros" sempre interpreta como metros diretos. UI mostra a forma
 * canônica via formatPosicao no preview.
 *
 * Rejeita (retorna null): vazio, só espaços, negativo (sinal explícito), NaN,
 *   metros >= 1000 no SEGMENTO M do formato canônico de km, offset >=
 *   METROS_POR_ESTACA no formato canônico de estaca.
 */
export function parsePosicao(input: string, unidade: UnidadeEspaco): number | null {
  if (typeof input !== 'string') return null
  const raw = input.trim()
  if (raw.length === 0) return null
  if (raw.startsWith('-')) return null

  // Detecta canônico (com "+" e/ou prefixo EST) vs "só metros".
  const temPlus = raw.includes('+')

  switch (unidade) {
    case 'm':
    case 'custom': {
      // Custom faz fallback pra parse de metros raw. Display canonico
      // (com label) sera funcao separada.
      const n = parseNumeroPtBR(raw)
      if (n === null || n < 0) return null
      return n
    }
    case 'km': {
      if (temPlus) {
        // Canônico: KM+M[,CC]
        const m = raw.match(/^(\d+)\+(\d+(?:[,.]\d+)?)$/)
        if (!m) return null
        const km = parseInt(m[1], 10)
        const metros = parseNumeroPtBR(m[2])
        if (metros === null || km < 0 || metros < 0 || metros >= 1000) return null
        return km * 1000 + metros
      }
      // "Só metros" — interpreta como metros diretos.
      const n = parseNumeroPtBR(raw)
      if (n === null || n < 0) return null
      return n
    }
    case 'estaca': {
      const temEstPrefix = /^EST\b/i.test(raw)
      if (temPlus || temEstPrefix) {
        // Canônico: '[EST] N+M[,CC]'. Prefixo EST opcional.
        const m = raw.match(/^(?:EST\s*)?(\d+)\+(\d+(?:[,.]\d+)?)$/i)
        if (!m) return null
        const est = parseInt(m[1], 10)
        const offset = parseNumeroPtBR(m[2])
        if (offset === null || est < 0 || offset < 0 || offset >= METROS_POR_ESTACA) {
          return null
        }
        return est * METROS_POR_ESTACA + offset
      }
      // "Só metros" — interpreta como metros diretos.
      const n = parseNumeroPtBR(raw)
      if (n === null || n < 0) return null
      return n
    }
  }
}

// ─── Trecho-aware: marcador real (sentido + offset + limites) ──────────────
//
// O DB armazena `posicao_inicio_m` / `posicao_fim_m` como METROS INTERNOS da
// polilinha do trecho (origem zero = início da geometria importada; sempre
// não-negativo; sempre crescente). O USUÁRIO digita e visualiza o MARCADOR
// REAL (km/estaca), que depende de:
//
//   * marcador_valor_inicial   — valor no início da polilinha (ex: 100 = km 100)
//   * geometry_sentido         — 'natural' (crescente) ou 'invertido' (decrescente)
//   * unidade_espaco_padrao    — define o divisor (km=1000, estaca=20, custom=user)
//   * geometry_comprimento_m   — limite superior em metros internos
//
// Trecho INVERTIDO (sentido='invertido', valor_inicial=100, comprimento=50km):
//   metros internos 0       → marcador km 100  (início da polilinha)
//   metros internos 25000   → marcador km 75   (meio)
//   metros internos 50000   → marcador km 50   (fim — decrescente)
//
// Tarefa "km 95 → km 75" nesse trecho:
//   posicao_inicio_m = (100 - 95) × 1000 = 5000
//   posicao_fim_m    = (100 - 75) × 1000 = 25000
//   (constraint posicao_fim_m >= posicao_inicio_m mantém-se OK)

export interface TrechoCtx {
  unidade_espaco_padrao: UnidadeEspaco
  unidade_custom_label?: string | null
  unidade_custom_divisor_m?: number | null
  marcador_valor_inicial?: number | null
  geometry_sentido?: 'natural' | 'invertido' | null
  geometry_comprimento_m?: number | null
}

/** Metros que 1 unidade do marcador representa (km=1000, estaca=20, custom=user). */
export function divisorMetrosPorUnidade(trecho: TrechoCtx): number {
  switch (trecho.unidade_espaco_padrao) {
    case 'km':
      return 1000
    case 'm':
      return 1
    case 'estaca':
      return METROS_POR_ESTACA
    case 'custom':
      return Number(trecho.unidade_custom_divisor_m) || 1
  }
}

/** Converte metros internos da polilinha → valor de marcador real (com sentido). */
export function metrosToMarcador(metrosInternos: number, trecho: TrechoCtx): number {
  const divisor = divisorMetrosPorUnidade(trecho)
  const inicial = Number(trecho.marcador_valor_inicial ?? 0)
  const deltaUnidades = metrosInternos / divisor
  return trecho.geometry_sentido === 'invertido'
    ? inicial - deltaUnidades
    : inicial + deltaUnidades
}

/** Converte valor de marcador real → metros internos da polilinha. */
export function marcadorToMetros(marcador: number, trecho: TrechoCtx): number {
  const divisor = divisorMetrosPorUnidade(trecho)
  const inicial = Number(trecho.marcador_valor_inicial ?? 0)
  const deltaUnidades =
    trecho.geometry_sentido === 'invertido' ? inicial - marcador : marcador - inicial
  return deltaUnidades * divisor
}

/**
 * Formata metros internos como marcador real para display. Considera
 * sentido + offset. Quando o marcador resultante seria negativo (input
 * inválido), retorna ''.
 */
export function formatMarcador(
  metrosInternos: number | null | undefined,
  trecho: TrechoCtx
): string {
  if (metrosInternos == null || !Number.isFinite(metrosInternos) || metrosInternos < 0) return ''
  const marcador = metrosToMarcador(metrosInternos, trecho)
  if (!Number.isFinite(marcador) || marcador < 0) return ''
  // Reaproveita formatPosicao com a unidade do trecho.
  // Para 'km' e 'estaca' o marcador é o valor "real" mostrado em formato
  // canônico (KM+M ou EST N+M). Para metros raw, mostra o marcador (ou 0
  // se o trecho começa em 0).
  // Conversão: marcador (unidades) × divisor → metros do marcador (origem 0)
  const metrosDoMarcador = marcador * divisorMetrosPorUnidade(trecho)
  return formatPosicao(metrosDoMarcador, trecho.unidade_espaco_padrao)
}

/**
 * Versão COMPACTA do marcador real — mostra só o valor da unidade, sem offset
 * (`km 5`, `EST 1050`, `1500 m`, `ref 12`). Sentido-aware (usa metrosToMarcador).
 * Ideal pra rótulos de marcador no mapa e ticks do eixo do marcha-tempo, onde
 * o offset (`+0,00`) só polui. Marcador negativo (config inválida) → ''.
 */
export function formatMarcadorCompacto(
  metrosInternos: number | null | undefined,
  trecho: TrechoCtx
): string {
  if (metrosInternos == null || !Number.isFinite(metrosInternos) || metrosInternos < 0) return ''
  const marcador = metrosToMarcador(metrosInternos, trecho)
  if (!Number.isFinite(marcador) || marcador < 0) return ''
  const n = Number.isInteger(marcador)
    ? String(marcador)
    : marcador.toFixed(2).replace(/\.?0+$/, '')
  switch (trecho.unidade_espaco_padrao) {
    case 'km':
      return `km ${n}`
    case 'estaca':
      return `EST ${n}`
    case 'm':
      return `${n} m`
    case 'custom':
      return `${trecho.unidade_custom_label?.trim() || 'ref'} ${n}`
  }
}

/**
 * Parsea string do usuário (em marcador real) → metros internos. Considera
 * sentido + offset, e valida limites contra `geometry_comprimento_m` se
 * preenchido. Sem geometria: validação só de não-negativo.
 *
 * Formatos aceitos por unidade do trecho:
 *   km:     '100+500,50'  (canônico, km+metros)  OU  '100,5' / '100' (marker direto, km)
 *   estaca: 'EST 5+10,5'  (canônico, estaca+offset) OU '5' / '5,5' (marker direto, estacas)
 *   m:      '1500' / '1500,50' (raw metros — única unidade em metros)
 *   custom: '100' / '100,5' (marker direto na unidade custom)
 *
 * Diferente de `parsePosicao`, aqui "só número" SEM '+' é interpretado como
 * MARKER VALUE na unidade do trecho (ex: '100' em trecho km = km 100, NÃO
 * 100 metros). É o que o engenheiro espera ao editar inline no Gantt.
 *
 * Returns:
 *   { metros: number }            — sucesso (metros internos da polilinha)
 *   { metros: null, erro: 'fmt' } — string inválida
 *   { metros: null, erro: 'fora-do-trecho' } — fora dos limites do trecho
 *   { metros: null, erro: 'sentido-invalido' } — marcador < valor_inicial em
 *     sentido natural, ou marcador > valor_inicial em invertido
 */
export type ParseMarcadorResult =
  | { metros: number; erro?: undefined }
  | { metros: null; erro: 'fmt' | 'fora-do-trecho' | 'sentido-invalido' }

export function parseMarcador(input: string, trecho: TrechoCtx): ParseMarcadorResult {
  // 1) Parse "bruto" usando unidade do trecho.
  //    - Formato canônico (com '+'): retorna metros desde origem 0
  //      (ex: '100+500' → 100500m).
  //    - "Só número" (sem '+'): retorna o número raw. Em trecho km/estaca/custom
  //      esse número É o valor do marcador (ex: '100' em km = km 100), NÃO
  //      metros. Em trecho 'm', é metros mesmo. O passo (2) lida com isso.
  const parsedRaw = parsePosicao(input, trecho.unidade_espaco_padrao)
  if (parsedRaw === null) return { metros: null, erro: 'fmt' }

  // 2) Determina o `marcador` (em unidades do trecho) a partir do parse bruto.
  //    Canônico ou unidade 'm': dividir pelo divisor pra obter marker units.
  //    "Só número" em km/estaca/custom: o número JÁ é o marker value.
  const isCanonical = input.includes('+') || /^\s*EST\b/i.test(input)
  const divisor = divisorMetrosPorUnidade(trecho)
  const ehMetrosRaw = trecho.unidade_espaco_padrao === 'm'
  const marcador =
    isCanonical || ehMetrosRaw ? parsedRaw / divisor : parsedRaw
  const inicial = Number(trecho.marcador_valor_inicial ?? 0)

  // 3) Sentido-aware: trecho natural → marcador deve ser >= inicial;
  //    invertido → marcador deve ser <= inicial.
  const sentido = trecho.geometry_sentido ?? 'natural'
  if (sentido === 'natural' && marcador < inicial) {
    return { metros: null, erro: 'sentido-invalido' }
  }
  if (sentido === 'invertido' && marcador > inicial) {
    return { metros: null, erro: 'sentido-invalido' }
  }

  // 4) Converte para metros internos.
  const metros = marcadorToMetros(marcador, trecho)
  if (!Number.isFinite(metros) || metros < 0) return { metros: null, erro: 'fora-do-trecho' }

  // 5) Limite superior via comprimento (se importado do KMZ).
  if (
    typeof trecho.geometry_comprimento_m === 'number' &&
    Number.isFinite(trecho.geometry_comprimento_m) &&
    trecho.geometry_comprimento_m > 0
  ) {
    // Tolerância de 1cm pra arredondamento de display.
    if (metros > trecho.geometry_comprimento_m + 0.01) {
      return { metros: null, erro: 'fora-do-trecho' }
    }
  }
  return { metros }
}

/**
 * Helper: marcador real do início e do fim do trecho, em string formatada.
 * Útil pra mostrar "intervalo válido" abaixo do input.
 */
export function intervaloMarcadorDoTrecho(trecho: TrechoCtx): {
  inicio: string
  fim: string | null
} {
  const inicial = Number(trecho.marcador_valor_inicial ?? 0)
  const inicio = formatPosicao(inicial * divisorMetrosPorUnidade(trecho), trecho.unidade_espaco_padrao)
  if (!trecho.geometry_comprimento_m) return { inicio, fim: null }
  const fimMarcador = metrosToMarcador(trecho.geometry_comprimento_m, trecho)
  const fim = formatPosicao(
    fimMarcador * divisorMetrosPorUnidade(trecho),
    trecho.unidade_espaco_padrao
  )
  return { inicio, fim }
}

// ─── Helpers privados ───────────────────────────────────────────────────────

/**
 * Parsea string numérica PT-BR (vírgula como decimal) ou EN (ponto). Aceita
 * apenas dígitos + um separador decimal opcional. Rejeita "1.234,56" (milhar).
 */
function parseNumeroPtBR(s: string): number | null {
  if (!/^\d+(?:[,.]\d+)?$/.test(s)) return null
  const normalized = s.replace(',', '.')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

/**
 * Formata número com vírgula decimal PT-BR + número fixo de casas decimais.
 * Opcionalmente padding a esquerda na parte inteira (pra '050' em km).
 */
function formatComma(n: number, decimais = 2, minIntegerDigits = 1): string {
  const fixed = n.toFixed(decimais)
  const [intPart, decPart] = fixed.split('.')
  const padded = intPart.padStart(minIntegerDigits, '0')
  return decimais > 0 && decPart !== undefined ? `${padded},${decPart}` : padded
}
