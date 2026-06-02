/**
 * Tipos do módulo Quantidades — templates de quantidades (volumes, áreas,
 * pesos etc) versionados por trecho.
 *
 * Modelo:
 *   - Template (estável; nome+modo não mudam após criação)
 *     └─ Versão (snapshot completo; é_atual única por template)
 *         ├─ Coluna  (nome + unidade definidos pelo usuário)
 *         └─ Segmento (1 por unidade mínima da grade do trecho)
 *             └─ Célula (segmento × coluna → valor)
 *
 * Versões !is_atual são imutáveis por trigger no DB.
 */

export type ModoQuantidade = 'analitico' | 'simplificado'

export interface TrechoQuantidadeTemplate {
  id: string
  trecho_id: string
  nome: string
  modo: ModoQuantidade
  created_at: string
  updated_at: string
}

export interface TrechoQuantidadeVersao {
  id: string
  template_id: string
  numero: number
  is_atual: boolean
  comentario: string | null
  criado_por: string | null
  created_at: string
  updated_at: string
}

export interface TrechoQuantidadeColuna {
  id: string
  versao_id: string
  nome: string
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

export interface TrechoQuantidadeCelula {
  segmento_id: string
  coluna_id: string
  valor: number
}

/** Card resumo de template na lista (template + dados da versão atual). */
export interface TrechoQuantidadeTemplateResumo extends TrechoQuantidadeTemplate {
  total_versoes: number
  versao_atual: {
    id: string
    numero: number
    comentario: string | null
    created_at: string
    total_colunas: number
    total_segmentos: number
  } | null
}

/** Versão completa: dados + colunas + segmentos com células agregadas. */
export interface TrechoQuantidadeVersaoCompleta extends TrechoQuantidadeVersao {
  colunas: TrechoQuantidadeColuna[]
  segmentos: Array<
    TrechoQuantidadeSegmento & {
      /** Map coluna_id → valor. Vazio se nenhuma célula salva pra este segmento. */
      valores: Record<string, number>
    }
  >
}

