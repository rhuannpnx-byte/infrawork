/**
 * Tipos do módulo Planejamento — cronograma de obra com tarefas, equipes,
 * dependências e calendário. Cada obra tem N revisões (`planejamento`);
 * uma é marcada como linha-de-base (`is_baseline=true`).
 *
 * Tarefas referenciam `item_orcamentario` com `tipo='servico_grupo'`
 * (vínculo CPU + quantidade_referencia já definidos no orçamento).
 */

export type PlanejamentoStatus = 'rascunho' | 'ativo' | 'arquivado'
export type DependenciaTipo = 'FS' | 'SS' | 'FF' | 'SF'

/**
 * Tipo do nó na EAP da tarefa:
 *   tarefa — folha do CPM, exige item_orcamentario_id (servico_grupo)
 *   grupo  — nó organizacional EAP (até nivel 2), sem cálculo próprio
 *   marco  — evento sem duração, exibido como losango no Gantt
 */
export type TipoNo = 'tarefa' | 'grupo' | 'marco'

/** Uma semana do perfil semanal de uma tarefa (vindo da view v2). */
export interface SemanaPerfil {
  /** Segunda-feira ISO da semana, 'YYYY-MM-DD'. */
  semana_segunda: string
  quantidade_planejada: number
}

export const EQUIPE_TIPOS = [
  'Pavimentação',
  'Terraplanagem',
  'Drenagem',
  'Sinalização',
  'Geral'
] as const

export const EQUIPE_CORES_PADRAO = [
  '#3b82f6', // azul
  '#10b981', // verde
  '#f59e0b', // âmbar
  '#ef4444', // vermelho
  '#8b5cf6', // violeta
  '#ec4899', // rosa
  '#14b8a6', // teal
  '#f97316' // laranja
]

export interface Equipe {
  id: string
  obra_id: string
  nome: string
  tipo: string
  cor: string
  ativo: boolean
  /** Ordem das lanes na Programação por equipes. */
  ordem: number
  /** Equipe de sistema (ex.: "Indireto") — não aparece nas lanes. */
  is_sistema?: boolean
  /** Encarregado responsável (um encarregado tem N equipes). */
  encarregado_id: string | null
  created_at: string
  created_by: string | null
}

export interface Planejamento {
  id: string
  obra_id: string
  nome: string
  descricao: string | null
  /** true = linha de base (travada); false = plano em edição (no máx. 1 por obra). */
  is_baseline: boolean
  /** Linha de base vigente — régua do acompanhamento (no máx. 1 por obra). */
  vigente: boolean
  /** Última vez que foi marcada vigente (referência provisória sem vigente). */
  vigente_em: string | null
  /** Quando foi travada como linha de base. */
  travada_em: string | null
  /** Orçamento/composições mudaram desde o último cálculo do cronograma. */
  recalculo_pendente?: boolean
  /** Calendário congelado na promoção (só linha de base). */
  premissa_calendario?: {
    bitmask: number | null
    excecoes: Array<[string, boolean]>
    fatores: Array<[string, number]>
  } | null
  status: PlanejamentoStatus
  data_referencia_inicio: string
  /** Data Date / Status Date — fronteira passado/futuro. NULL = sem freeze. */
  data_date: string | null
  criado_por: string | null
  created_at: string
  updated_at: string
}

export interface PlanejamentoTarefa {
  id: string
  planejamento_id: string
  /** Item orçamentário (servico_grupo). NULL em tipo_no IN ('grupo','marco'). */
  item_orcamentario_id: string | null
  data_inicio: string | null
  data_fim: string | null
  duracao_dias_uteis_calc: number | null
  /** true quando a folga total é zero (gravado pelo cálculo do cronograma). */
  is_critico: boolean
  notas: string | null
  ordem: number
  /** Tipo do nó na EAP. Default 'tarefa'. */
  tipo_no: TipoNo
  /** Pai na hierarquia EAP. NULL = raiz (nivel=1). */
  parent_id: string | null
  /** Nível da EAP: 1=raiz, 2=sub-grupo, 3=tarefa-folha. */
  nivel: 1 | 2 | 3
  /** Quantidade alocada nesta tarefa-folha. NULL em grupo/marco. */
  quantidade_alocada: number | null
  /** Código hierárquico EAP ("1", "1.2", "1.2.3"). Derivado UI; persistido p/ auditoria. */
  codigo_eap: string | null
  /** Override do nome (sobrescreve servico_grupo_descricao). NULL = usa descrição do item. */
  nome_custom: string | null
  created_at: string
  updated_at: string
}

export interface EquipeAlocada {
  id: string
  nome: string
  cor: string
  tipo: string
  ordem: number
  qtd_equipes: number
  /** Produção efetiva da tarefa = composição × nº de equipes × coeficiente. */
  producao_diaria_efetiva: number | null
}

export type DependenciaOrigem = 'manual'

export interface PredecessoraRef {
  id: string
  predecessora_id: string
  tipo: DependenciaTipo
  origem: DependenciaOrigem
}

export interface SucessoraRef {
  id: string
  sucessora_id: string
  tipo: DependenciaTipo
  origem: DependenciaOrigem
}

// ─── Tarefa indireta ─────────────────────────────────────────────────────
// Items orçamentários com indireto_id (XOR com servico_id) — quando viram
// tarefa, têm regra de cálculo completamente diferente: custo recorrente
// (R$/dia, R$/mês, R$/ano) e duração dinâmica cobrindo todo o cronograma.
// Persiste em planejamento_tarefa_indireto (1:1 com planejamento_tarefa).

export type CustoPeriodicidade = 'dia' | 'mes' | 'ano'
export type ReceitaModoIndireto = 'mesma_logica_custo' | 'percentual_dos_servicos'

export interface IndiretoConfig {
  /** Periodicidade do custo unitário. */
  custo_periodicidade: CustoPeriodicidade
  custo_unitario: number
  receita_modo: ReceitaModoIndireto
  /** Preenchido só quando receita_modo='mesma_logica_custo'. */
  receita_unitaria: number | null
  /** Preenchido só quando receita_modo='percentual_dos_servicos' (0–100). */
  receita_percentual: number | null
  /** Dias úteis antes do início global. Default 0. */
  offset_dias_antes: number
  /** Dias úteis depois do fim global. Default 0. */
  offset_dias_depois: number
  /**
   * true (default) = receita acompanha o período integral.
   * false = receita capada em item.venda_total_calc (custo cresce sem limite,
   * mas receita trava no que a planilha paga). Útil quando planejador estica
   * o prazo da indireta além do escopo orçado.
   */
  receita_extrapola: boolean
  aplica_taxas: boolean
  taxa_regime_id: string | null
  /** Cache: N períodos (dias/meses/anos) cobertos. Populado pela edge. */
  periodos_calc: number | null
}

/** Vinda da view vw_planejamento_tarefa_completa v12. */
export interface PlanejamentoTarefaCompleta extends PlanejamentoTarefa {
  obra_id: string
  is_baseline: boolean
  planejamento_status: PlanejamentoStatus
  /** Data Date do planejamento (replicado da view). NULL = sem freeze. */
  planejamento_data_date: string | null
  /** Código do item (NULL em grupo/marco). */
  servico_grupo_codigo: string | null
  /** Descrição do item (NULL em grupo/marco — usar nome_custom). */
  servico_grupo_descricao: string | null
  quantidade_referencia: number | null
  servico_id: string | null
  servico_codigo: string | null
  servico_nome: string | null
  unidade_servico: string | null
  cpu_id_origem: string | null
  /** Taxa da CPU (fallback quando a equipe não tem taxa própria). */
  producao_diaria_qtde: number | null
  producao_diaria_unidade: string | null
  /**
   * Taxa diária efetiva da tarefa = Σ_equipes coalesce(override, equipe, CPU)
   * × qtd_equipes. NULL sem equipes alocadas (motor cai na taxa da CPU).
   */
  producao_diaria_efetiva: number | null
  custo_unit_snapshot: number | null
  /** Custo = custo_unit * quantidade_alocada. 0 em grupo/marco. (Legado — direta only.) */
  custo_total_tarefa: number
  /** Indireto-related (v10). */
  indireto_id: string | null
  is_indireto: boolean
  /** Config indireta — NULL quando is_indireto=false. */
  indireto_config: IndiretoConfig | null
  /**
   * Custo total unificado: indireta usa cache de planejamento_tarefa_indireto;
   * direta usa custo_unit_snapshot × quantidade_alocada. Sempre não-null.
   */
  custo_total_calc: number
  /**
   * Receita total unificada: indireta usa cache; direta usa venda_unitaria_item
   * × quantidade_alocada. Sempre não-null.
   */
  receita_total_calc: number
  /** Custo adicional de taxas (só indireta). NULL quando direta. */
  custo_taxas_calc: number | null
  /** Venda unitária do item orçamentário (NULL em grupo/marco). */
  venda_unitaria_item: number | null
  /** Venda total do item orçamentário (NULL em grupo/marco). */
  venda_total_item: number | null
  equipes: EquipeAlocada[]
  predecessoras: PredecessoraRef[]
  sucessoras: SucessoraRef[]
  /** Perfil semanal agregado (ordenado por semana_segunda asc). Vazio em grupo/marco. */
  perfil_semanas: SemanaPerfil[]
}
