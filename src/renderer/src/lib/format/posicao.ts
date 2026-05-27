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

export type UnidadeEspaco = 'km' | 'm' | 'estaca'

const METROS_POR_ESTACA = 20

/**
 * Formata metros pra string de exibição na unidade dada.
 *
 * NaN / null / undefined / Infinity / negativo → '' (string vazia).
 * Conversão "barata" pro caso comum de UI; pra display rico (alinhamento de
 * casas decimais etc), o caller pode pós-processar.
 */
export function formatPosicao(
  metros: number | null | undefined,
  unidade: UnidadeEspaco
): string {
  if (metros == null || !Number.isFinite(metros) || metros < 0) return ''

  switch (unidade) {
    case 'm':
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
    case 'm': {
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
