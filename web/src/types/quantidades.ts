/**
 * Tipos do módulo Quantidades — templates de quantidades (volumes, áreas,
 * pesos etc) versionados por trecho.
 *
 * Modelo (web): 1 template por trecho
 *   - Template (modo analítico/simplificado)
 *     └─ Versão (snapshot completo; é_atual única por template)
 *         ├─ Coluna  (= serviço/agrupador do orçamento, por id)
 *         └─ Segmento (1 por unidade mínima da grade do trecho)
 *             └─ Célula (segmento × coluna → valor)
 *
 * Versões !is_atual são imutáveis por trigger no DB.
 */

export type ModoQuantidade = 'analitico' | 'simplificado'

export interface TrechoQuantidadeVersao {
  id: string
  template_id: string
  numero: number
  is_atual: boolean
  comentario: string | null
  criado_por: string | null
  created_at: string
}

export interface TrechoQuantidadeColuna {
  id: string
  versao_id: string
  /** Serviço (agrupador) do orçamento — o vínculo é nativo, por id. */
  item_orcamentario_id: string
  /** "S01 Base de brita graduada" (derivado do serviço). */
  nome: string
  codigo: string
  unidade: string
  ordem: number
}

export interface TrechoQuantidadeSegmento {
  id: string
  versao_id: string
  ordem: number
  posicao_inicio_m: number
  posicao_fim_m: number
  unidade_inicio_label: string | null
  unidade_fim_label: string | null
}

/** Versão completa: dados + colunas + segmentos com células agregadas. */
export interface TrechoQuantidadeVersaoCompleta extends TrechoQuantidadeVersao {
  modo: ModoQuantidade
  colunas: TrechoQuantidadeColuna[]
  segmentos: Array<
    TrechoQuantidadeSegmento & {
      /** Map coluna_id → valor. Vazio se nenhuma célula salva pra este segmento. */
      valores: Record<string, number>
    }
  >
}
