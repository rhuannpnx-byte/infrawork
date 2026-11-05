/**
 * Entrada do motor do cronograma: o retrato de um plano do InfraWork, montado a partir do banco (`dados.ts`) e
 * convertido para o ApeX (`obra.ts` → `projeto.ts`). Sem dependência de React nem do Supabase: roda no Web Worker e
 * nos testes.
 */

export interface DiaSemana {
  /** "HH:MM" */
  inicio: string
  /** horas de expediente (0 = sem trabalho) */
  horas: number
}

export type TipoDefinicao = 'feriado' | 'pascoa' | 'folga_semana' | 'horario_excecao'

export interface DefinicaoCalendario {
  tipo: TipoDefinicao
  nome: string
  /** "AAAA-MM-DD" */
  data_inicio: string | null
  data_fim: string | null
  todo_ano: boolean
  /** 0 = segunda … 6 = domingo (folga anual em dia da semana) */
  dia_semana: number | null
  semana: DiaSemana[] | null
}

export interface CalendarioEntrada {
  id: string
  nome: string
  padrao: boolean
  /** segunda … domingo */
  semana: DiaSemana[]
  definicoes: DefinicaoCalendario[]
}

export interface FatorMes {
  /** "AAAA-MM-01" */
  ano_mes: string
  fator: number
}

export interface TrechoEntrada {
  id: string
  nome: string
  /** eixo = estaqueamento linear (road line do ApeX); área = local sem estacas (area do ApeX) */
  tipo: 'eixo' | 'area'
  /** comprimento do eixo em metros (posições internas 0…comprimento); null só em área */
  comprimento_m: number | null
  /** só para as visões: estaqueamento e cor do trecho */
  exib?: {
    cor: string
    unidade_espaco_padrao: 'km' | 'm' | 'estaca' | 'custom'
    unidade_custom_label: string | null
    unidade_custom_divisor_m: number | null
    marcador_valor_inicial: number | null
    geometry_sentido: 'natural' | 'invertido' | null
  }
}

export interface ServicoEntrada {
  id: string
  codigo: string
  nome: string
  unidade: string | null
}

export interface RecursoEquipe {
  recurso_id: string
  nome: string
  /** grupo do recurso (EQUIPAMENTO, MO…), só para as visões */
  grupo?: string
  /** quantidade na composição (pode ser fracionária: 0,1 trator) */
  qtd: number
}

/** Equipe do ApeX = composição viva do serviço (`servico_equipe_viva`). */
export interface EquipeServico {
  servico_id: string
  /** produção por dia de trabalho (unidade do serviço); null/0 = sem produção */
  producao_diaria: number | null
  recursos: RecursoEquipe[]
}

export interface LocalEntrada {
  id: string
  ordem: number
  trecho_id: string | null
  inicio_m: number | null
  fim_m: number | null
  quantidade: number
  qtd_origem: 'manual' | 'trecho'
}

export type RestricaoInicio = 'nao_antes' | 'exato'
export type RestricaoFim = 'nao_depois' | 'exato'

export interface TarefaEntrada {
  id: string
  tipo_no: 'tarefa' | 'grupo'
  parent_id: string | null
  ordem: number
  nome: string
  /** agrupador do orçamento (servico_grupo) */
  item_orcamentario_id: string | null
  /** serviço do catálogo = tipo da tarefa no ApeX */
  servico_id: string | null
  is_indireto: boolean
  quantidade: number
  prioridade: number
  asap: boolean
  inicio_dia: boolean
  sentido: 'crescente' | 'decrescente'
  restricao_inicio: RestricaoInicio | null
  restricao_inicio_em: string | null
  restricao_fim: RestricaoFim | null
  restricao_fim_em: string | null
  coef_producao: number
  qtd_equipes: number
  calendario_id: string | null
  derivar_predecessoras: boolean
  /** equipes nomeadas (recursos identificados) */
  equipes_ids: string[]
  locais: LocalEntrada[]
  /** início do último cálculo ("AAAA-MM-DDTHH:MM:SS"): o início desejado de uma tarefa não ASAP */
  inicio_em: string | null
  /** dados do orçamento para indiretos e receita */
  venda_unitaria: number | null
  venda_total_item: number | null
  quantidade_referencia: number | null
  custo_unitario_item: number | null
  indireto: IndiretoConfig | null
  /** só para as visões (não entra no motor) */
  exib?: {
    codigo: string | null
    notas: string | null
    aparencia: { cor?: string; rotulo?: boolean } | null
  }
}

export interface IndiretoConfig {
  custo_periodicidade: 'dia' | 'mes' | 'ano'
  custo_unitario: number | null
  receita_modo: 'mesma_logica_custo' | 'percentual_dos_servicos'
  receita_unitaria: number | null
  receita_percentual: number | null
  offset_dias_antes: number
  offset_dias_depois: number
  receita_extrapola: boolean
  aplica_taxas: boolean
  /** percentual total do regime de taxas (decimal: 0,1508 = 15,08 %) */
  taxa_percentual: number | null
  taxa_regime_id?: string | null
}

export type TipoDependencia = 'FS' | 'SS' | 'FF' | 'SF' | 'EST'

export interface DependenciaEntrada {
  id: string
  predecessora_id: string
  sucessora_id: string
  tipo: TipoDependencia
  /** null = sem atraso mínimo (a dependência não segura datas) */
  atraso_min: number | null
  atraso_max: number | null
  dias_uteis: boolean
}

export interface DependenciaTipo {
  predecessor_id: string
  sucessor_id: string
  atraso_dias: number
}

export interface FaixaMarco {
  trecho_id: string
  inicio_m: number
  fim_m: number
}

export interface MarcoEntrada {
  id: string
  nome: string
  inicio: string | null
  fim: string | null
  filtro_servicos: boolean
  servicos: string[]
  filtro_recursos: boolean
  recursos: string[]
  filtro_estacas: boolean
  faixas: FaixaMarco[]
  incluidas: string[]
  excluidas: string[]
}

export interface LimiteRecurso {
  /** id em planejamento_recurso_limite (para editar) */
  id?: string
  recurso_id: string
  /** null = projeto inteiro */
  grupo_id: string | null
  maximo: number
}

/** Segmentos do template de quantidades do trecho (versão atual) para um serviço. */
export interface SegmentoTemplate {
  inicio_m: number
  fim_m: number
  /** item_orcamentario_id → quantidade no segmento */
  valores: Record<string, number>
}

/** Trecho de tarefa já calculado (linha de base: congelado). */
export interface WpCongelado {
  tarefa_id: string
  local_id: string | null
  ordem: number
  trecho_id: string | null
  inicio_m: number | null
  fim_m: number | null
  quantidade: number
  inicio_em: string
  fim_em: string
}

export interface PlanoEntrada {
  plano: {
    id: string
    nome: string
    /** "AAAA-MM-DD" */
    inicio: string
    prazo: string | null
    calendario_id: string | null
    modo: 'programacao' | 'controle'
    /** data de controle escolhida ("AAAA-MM-DD"; null = hoje) — `planejamento.data_date` */
    data_controle?: string | null
    is_baseline: boolean
    dados_rev: number
    /** dados_rev do último cálculo gravado (null = nunca calculado pelo motor do ApeX) */
    calculo_rev?: number | null
    /** orçamento, composições ou calendário mudaram desde o último cálculo */
    recalculo_pendente?: boolean
  }
  calendarios: CalendarioEntrada[]
  fatoresMes: FatorMes[]
  trechos: TrechoEntrada[]
  servicos: ServicoEntrada[]
  equipes: EquipeServico[]
  tiposDependencias: DependenciaTipo[]
  equipesNomeadas: { id: string; nome: string }[]
  tarefas: TarefaEntrada[]
  dependencias: DependenciaEntrada[]
  marcos: MarcoEntrada[]
  limites: LimiteRecurso[]
  /** trecho_id → segmentos do template (versão atual) */
  templates: Record<string, SegmentoTemplate[]>
  /** só na linha de base: os trechos de tarefa congelados (substituem a divisão pelo template atual) */
  wpsCongelados?: WpCongelado[]
  /** modo controle: a produção lançada até a data de controle (realizado e previsão) */
  controle?: import('./controle').ControleEntrada
}
