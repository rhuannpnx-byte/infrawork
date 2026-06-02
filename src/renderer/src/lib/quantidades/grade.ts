// Gera a grade analítica de um trecho: uma linha por unidade mínima
// (km, estaca, metro, ou unidade custom). Último segmento pode ser parcial
// se comprimentoM não for múltiplo de divisorM.

export interface SegmentoAnalitico {
  ordem: number
  posicao_inicio_m: number
  posicao_fim_m: number
  unidade_inicio_label: string  // "km 5", "EST 12", "ref 0", "m 0"
  unidade_fim_label: string
}

export interface TrechoUnidadeConfig {
  geometry_comprimento_m: number
  unidade_espaco_padrao: 'km' | 'm' | 'estaca' | 'custom'
  unidade_custom_label: string | null
  unidade_custom_divisor_m: number | null
  marcador_valor_inicial: number
}

const DIVISOR_PADRAO: Record<Exclude<TrechoUnidadeConfig['unidade_espaco_padrao'], 'custom'>, number> = {
  km: 1000,
  estaca: 20,
  m: 1
}

const LABEL_PADRAO: Record<Exclude<TrechoUnidadeConfig['unidade_espaco_padrao'], 'custom'>, string> = {
  km: 'km',
  estaca: 'EST',
  m: 'm'
}

export function gerarGradeAnalitica(trecho: TrechoUnidadeConfig): SegmentoAnalitico[] {
  const comprimentoM = Number(trecho.geometry_comprimento_m)
  if (!Number.isFinite(comprimentoM) || comprimentoM <= 0) return []

  const divisor =
    trecho.unidade_espaco_padrao === 'custom'
      ? Number(trecho.unidade_custom_divisor_m)
      : DIVISOR_PADRAO[trecho.unidade_espaco_padrao]
  if (!Number.isFinite(divisor) || divisor <= 0) return []

  const label =
    trecho.unidade_espaco_padrao === 'custom'
      ? (trecho.unidade_custom_label?.trim() || 'ref')
      : LABEL_PADRAO[trecho.unidade_espaco_padrao]
  const valorInicial = Number(trecho.marcador_valor_inicial) || 0

  const out: SegmentoAnalitico[] = []
  let ordem = 0
  for (let pos = 0; pos < comprimentoM; pos += divisor) {
    const fim = Math.min(pos + divisor, comprimentoM)
    const valorIni = valorInicial + pos / divisor
    const valorFim = valorInicial + fim / divisor
    out.push({
      ordem,
      posicao_inicio_m: Math.round(pos * 100) / 100,
      posicao_fim_m: Math.round(fim * 100) / 100,
      unidade_inicio_label: `${label} ${formatValor(valorIni)}`,
      unidade_fim_label: `${label} ${formatValor(valorFim)}`
    })
    ordem++
  }
  return out
}

function formatValor(v: number): string {
  if (Number.isInteger(v)) return String(v)
  return v.toFixed(2).replace(/\.?0+$/, '')
}
