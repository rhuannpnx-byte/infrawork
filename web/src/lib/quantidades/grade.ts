// Tipos da grade de quantidades de um eixo. A geração das faixas (por unidade, N unidades, N metros) fica em
// `segmentos.ts` (`gerarSegmentos`); a planilha de quantidades por local, em `boq-xlsx.ts`.

export interface SegmentoAnalitico {
  ordem: number
  posicao_inicio_m: number
  posicao_fim_m: number
  unidade_inicio_label: string // "km 5", "EST 12", "ref 0", "m 0"
  unidade_fim_label: string
}

export interface TrechoUnidadeConfig {
  geometry_comprimento_m: number
  unidade_espaco_padrao: 'km' | 'm' | 'estaca' | 'custom'
  unidade_custom_label: string | null
  unidade_custom_divisor_m: number | null
  marcador_valor_inicial: number
  /** invertido = numeração decrescente ao longo do eixo. */
  geometry_sentido?: 'natural' | 'invertido' | null
}
