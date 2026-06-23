// Tipos do Agente de Agrupamento (Planilha Orçamentária).
// Espelham o contrato da Edge Function `sugerir-agrupamento`.

export type PapelReceita = 'principal' | 'transporte' | 'material' | 'mao_obra' | 'outro'

export type QtdRefModoAgente = 'manual' | 'heranca' | 'soma_filhos'

export interface ReceitaSugerida {
  id: string
  codigo: string
  descricao: string
  papel: PapelReceita
}

export interface AlertaCompartilhamento {
  receita_id: string
  servicos_concorrentes: string[]
  observacao: string
}

export interface GrupoSugerido {
  descricao: string
  servico_id: string
  servico_codigo: string
  servico_nome: string
  servico_unidade: string | null
  confianca: number | null
  justificativa: string
  receitas: ReceitaSugerida[]
  qtd_ref_modo: QtdRefModoAgente
  qtd_ref_sugerida: number | null
  alertas_compartilhamento: AlertaCompartilhamento[]
}

export interface ReceitaNaoAgrupada {
  receita_id: string
  codigo: string
  descricao: string
  motivo: string
}

/** Uma fala na conversa do workbench (chat à direita). */
export interface MensagemChat {
  role: 'user' | 'agente'
  texto: string
}

export interface AgrupamentoResposta {
  grupos: GrupoSugerido[]
  nao_agrupados: ReceitaNaoAgrupada[]
  avisos: string[]
  /** Frase curta do agente sobre o que mudou neste turno (chat). */
  resposta_agente?: string
  _meta?: {
    modelo: string
    receitas_soltas: number
    servicos_catalogo: number
    exemplos_fewshot: number
    duracao_ms: number
  }
}

/** Ação registrada como feedback de aprendizado. */
export type AcaoFeedback = 'aceito' | 'rejeitado' | 'corrigido' | 'movido'

export interface FeedbackAgrupamentoInput {
  obra_id: string
  receita_codigo: string | null
  receita_descricao: string
  servico_id: string | null
  servico_codigo: string | null
  servico_nome: string | null
  acao: AcaoFeedback
  contexto?: Record<string, unknown>
  origem?: 'agente' | 'manual'
}
