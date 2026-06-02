// Parseia etiqueta de unidade ("km 5", "EST 12.5", "ref 0") pra metros usando
// a config do trecho. Usado pelo parser do Excel quando o user preenche só
// "Unid Inicial/Final" sem preencher "Início (m)" / "Fim (m)".

import type { TrechoUnidadeConfig } from './grade'

const DIVISOR_PADRAO: Record<Exclude<TrechoUnidadeConfig['unidade_espaco_padrao'], 'custom'>, number> = {
  km: 1000,
  estaca: 20,
  m: 1
}

/**
 * Retorna metros (≥0) ou null se não parsea / valor negativo.
 *
 * Aceita formato "<label> <valor>" OU só "<valor>" — captura o último número
 * na string. Label/prefixo é ignorado (case-insensitive).
 */
export function parseLabelParaMetros(
  label: string,
  trecho: TrechoUnidadeConfig
): number | null {
  if (typeof label !== 'string') return null
  const raw = label.trim()
  if (raw.length === 0) return null

  const m = raw.match(/([\d]+(?:[,.][\d]+)?)\s*$/)
  if (!m) return null
  const valorUnidade = parseFloat(m[1].replace(',', '.'))
  if (!Number.isFinite(valorUnidade)) return null

  const divisor =
    trecho.unidade_espaco_padrao === 'custom'
      ? Number(trecho.unidade_custom_divisor_m)
      : DIVISOR_PADRAO[trecho.unidade_espaco_padrao]
  if (!Number.isFinite(divisor) || divisor <= 0) return null

  const valorInicial = Number(trecho.marcador_valor_inicial) || 0
  const metros = (valorUnidade - valorInicial) * divisor
  if (!Number.isFinite(metros) || metros < 0) return null
  return Math.round(metros * 100) / 100
}
