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
/** Modo de scheduling CPM (Fase 2):
 *   asap — agenda no early start (default, comportamento clássico).
 *   alap — agenda no late start dentro da folga, sem alterar deadline.
 */
export type ScheduleMode = 'asap' | 'alap'
/**
 * Tipos de constraint formal (MS Project completo):
 *   snet — Start No Earlier Than ("Não iniciar antes de", soft, empurra ES).
 *   snlt — Start No Later Than ("Não iniciar depois de", soft, puxa LS).
 *   fnet — Finish No Earlier Than ("Não terminar antes de", soft, atrasa EF).
 *   fnlt — Finish No Later Than ("Não terminar depois de", soft, puxa LF).
 *   mso  — Must Start On ("Deve iniciar em", hard, força ES).
 *   mfo  — Must Finish On ("Deve terminar em", hard, força LF).
 */
export type ConstraintType = 'snet' | 'snlt' | 'fnet' | 'fnlt' | 'mso' | 'mfo'

export const CONSTRAINT_LABEL: Record<ConstraintType, string> = {
  snet: 'Não iniciar antes de',
  snlt: 'Não iniciar depois de',
  fnet: 'Não terminar antes de',
  fnlt: 'Não terminar depois de',
  mso: 'Deve iniciar em',
  mfo: 'Deve terminar em'
}

export const SCHEDULE_MODE_LABEL: Record<ScheduleMode, string> = {
  asap: 'O mais cedo possível',
  alap: 'O mais tarde possível'
}
/**
 * Tipo do nó na EAP da tarefa:
 *   tarefa — folha do CPM, exige item_orcamentario_id (servico_grupo)
 *   grupo  — nó organizacional EAP (até nivel 2), sem cálculo próprio
 *   marco  — evento sem duração, exibido como losango no Gantt
 */
export type TipoNo = 'tarefa' | 'grupo' | 'marco'
/** Unidade de display pra posição espacial — alinhada com Obra. */
export type UnidadeEspacoDisplay = 'km' | 'm' | 'estaca'
/**
 * Shape de distribuição semanal de quantidade ao longo de uma tarefa.
 *
 * 2026-06: shapes não-uniformes (sino/rampa/etc) removidas. Toda tarefa opera
 * com 'uniforme'. CHECK constraint `chk_plan_tar_perfil_flat_uniforme` no DB
 * garante invariante; o motor (edge + client) usa `calcularDuracaoDiaria` +
 * `agruparPorSemana` em vez do `gerarPerfilSemanal` antigo (deletado).
 */
export type PerfilNome = 'uniforme'

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
  '#f97316'  // laranja
]

export interface ObraCalendario {
  obra_id: string
  /** Bitmask: bit0=seg, bit1=ter, ..., bit6=dom. 62 = seg-sex. */
  dias_uteis_bitmask: number
  created_at: string
  updated_at: string
}

export interface ObraCalendarioExcecao {
  id: string
  obra_id: string
  data: string
  motivo: string
  /** false = bloqueia dia útil; true = libera fim-de-semana. */
  eh_util: boolean
  created_at: string
}

export interface ObraProdutividadeMes {
  obra_id: string
  ano_mes: string // YYYY-MM-01
  fator: number
  motivo: string | null
  created_at: string
}

export interface Equipe {
  id: string
  obra_id: string
  nome: string
  tipo: string
  cor: string
  ativo: boolean
  created_at: string
  created_by: string | null
}

export interface Planejamento {
  id: string
  obra_id: string
  nome: string
  descricao: string | null
  is_baseline: boolean
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
  /** Trecho da obra. NULL aceito para grupo/marco. */
  trecho_id: string | null
  data_inicio: string | null
  data_fim: string | null
  duracao_dias_uteis_calc: number | null
  /** Early Start (CPM forward pass). NULL antes do primeiro recálculo. */
  early_start: string | null
  /** Early Finish (CPM forward pass). NULL antes do primeiro recálculo. */
  early_finish: string | null
  /** Late Start (CPM backward pass). NULL antes do primeiro recálculo. */
  late_start: string | null
  /** Late Finish (CPM backward pass). NULL antes do primeiro recálculo. */
  late_finish: string | null
  /** Folga total em dias úteis = LS - ES. ≤ 0 = caminho crítico. */
  total_float: number | null
  /** Folga livre em dias úteis = min(ES sucessoras) - EF. */
  free_float: number | null
  /** true quando total_float ≤ 0. Populado pela edge function. */
  is_critico: boolean
  /** Modo de scheduling: 'asap' (default) ou 'alap'. */
  schedule_mode: ScheduleMode
  /** Constraint formal. NULL = sem constraint (ASAP puro). */
  constraint_type: ConstraintType | null
  /** Data-alvo da constraint. NULL quando constraint_type é NULL. */
  constraint_date: string | null
  data_inicio_manual: boolean
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
  /** Posição espacial em METROS. Ambas null ou ambas preenchidas. */
  posicao_inicio_m: number | null
  posicao_fim_m: number | null
  /** Override de unidade para display desta tarefa; null = usa unidade do trecho. */
  unidade_espaco_display: UnidadeEspacoDisplay | null
  /**
   * Vínculo de quantidade_alocada com uma métrica do template de quantidades
   * do trecho. Armazena o NOME da coluna do template (ex: "Área pavimentada").
   * Quando setado, UI mostra qtd_alocada como readonly + valor calculado via
   * `computeLinkedQtd`. Edge function calcular-cronograma também resolve isto
   * antes do forward pass. NULL = quantidade_alocada é manual.
   */
  qtd_link: string | null
  /** Shape de perfil escolhida ao criar/editar a tarefa. Default 'uniforme'. */
  perfil_default: PerfilNome
  /**
   * True se o perfil foi editado manualmente via RPC. Edge function preserva
   * perfis customizados durante recálculo (apenas shift se predecessor mudar).
   */
  usa_perfil_customizado: boolean
  created_at: string
  updated_at: string
}

export interface EquipeAlocada {
  id: string
  nome: string
  cor: string
  tipo: string
  qtd_equipes: number
}

export interface PredecessoraRef {
  id: string
  predecessora_id: string
  tipo: DependenciaTipo
  lag_dias: number
}

export interface SucessoraRef {
  id: string
  sucessora_id: string
  tipo: DependenciaTipo
  lag_dias: number
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

/** Vinda da view vw_planejamento_tarefa_completa v10. */
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
  cpu_snapshot_id: string | null
  cpu_id_origem: string | null
  producao_diaria_qtde: number | null
  producao_diaria_unidade: string | null
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
  /**
   * Unidade efetiva resolvida na view via
   * COALESCE(tarefa.unidade_espaco_display, trecho.unidade_espaco_padrao).
   * NULL em grupo/marco sem trecho.
   */
  unidade_espaco_efetiva: UnidadeEspacoDisplay | null
  /** Nome do trecho. NULL em grupo/marco sem trecho. */
  trecho_nome: string | null
  /** Ordem do trecho dentro da obra. NULL em grupo/marco sem trecho. */
  trecho_ordem: number | null
  equipes: EquipeAlocada[]
  predecessoras: PredecessoraRef[]
  sucessoras: SucessoraRef[]
  /** Perfil semanal agregado (ordenado por semana_segunda asc). Vazio em grupo/marco. */
  perfil_semanas: SemanaPerfil[]
}

export interface PlanejamentoDependencia {
  id: string
  planejamento_id: string
  predecessora_id: string
  sucessora_id: string
  tipo: DependenciaTipo
  lag_dias: number
  created_at: string
}

export interface PlanejamentoTarefaEquipe {
  tarefa_id: string
  equipe_id: string
  qtd_equipes: number
}

export const STATUS_LABEL: Record<PlanejamentoStatus, string> = {
  rascunho: 'Rascunho',
  ativo: 'Ativo',
  arquivado: 'Arquivado'
}

export const DEPENDENCIA_LABEL: Record<DependenciaTipo, string> = {
  FS: 'Fim → Início',
  SS: 'Início → Início',
  FF: 'Fim → Fim',
  SF: 'Início → Fim'
}

// ────────────────────────────────────────────────────────────────────────
// Helpers de bitmask de dias úteis
// ────────────────────────────────────────────────────────────────────────

export const DIAS_LABEL = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

export function bitmaskToDias(b: number): number[] {
  const out: number[] = []
  for (let i = 0; i < 7; i++) if ((b >> i) & 1) out.push(i)
  return out
}

export function diasToBitmask(dias: number[]): number {
  return dias.reduce((acc, d) => acc | (1 << d), 0)
}

// ────────────────────────────────────────────────────────────────────────
// Marcha-Tempo (TILOS) — visualização tempo × caminho
// ────────────────────────────────────────────────────────────────────────

/** Granularidade do eixo de tempo. */
export type GranularidadeTempo = 'diario' | 'semanal' | 'mensal' | 'auto'

/** Opções da visualização marcha-tempo, persistidas no estado da página. */
export interface MarchaTempoOpcoes {
  /** true (default) = tempo no eixo X; false = caminho no X (tempo desce no Y). */
  eixoXTempo: boolean
  /**
   * 'perfilada': trajetória respeita a densidade do template (mais devagar
   * em segmentos densos, pula regiões sem trabalho). Requer qtd_link + template
   * + perfil_semanas.
   * 'uniforme': linha reta entre (data_inicio, pos_inicio) e (data_fim, pos_fim).
   */
  geom: 'perfilada' | 'uniforme'
  /** Granularidade dos ticks do eixo tempo. */
  granularidadeTempo: GranularidadeTempo
  /**
   * Passo do eixo posição em METROS. NULL = passo automático (1/2/5 × 10^k).
   * Quando setado, ticks são gerados a cada `passoPosicaoM` metros.
   */
  passoPosicaoM: number | null
  mostrarMarcos: boolean
  mostrarDependencias: boolean
  mostrarTodayLine: boolean
  /**
   * Nomes das colunas do template a expor como faixa lateral à esquerda do
   * eixo posição. Cada coluna marcada vira uma faixa estreita com blocos
   * coloridos mostrando o valor da célula em cada segmento + total somado.
   */
  colunasQuantidade: string[]
}

/** Um ponto da polilinha de uma tarefa no plano tempo×caminho. */
export interface PontoTraco {
  /** Data ISO 'YYYY-MM-DD' do ponto. */
  data: string
  /** Posição em metros (no eixo do trecho). */
  posicaoM: number
}

/** Trajetória de uma tarefa direta (marcha-tempo). */
export interface TracoTarefa {
  tarefaId: string
  trechoId: string
  /**
   * Polilinhas em ilhas independentes. Cada ilha = polilinha contínua dentro
   * de uma região com trabalho > 0. Quando o template tem segmentos `valor=0`
   * (ou gaps sem cobertura) entre fatias com trabalho, a polilinha se quebra
   * em múltiplas ilhas — visualmente a frente "salta" e regiões sem trabalho
   * ficam vazias no eixo posição.
   *
   * Modo 'uniforme' sempre retorna 1 ilha com 2 pontos. Modo 'perfilada' pode
   * retornar 1+ ilhas conforme o template.
   */
  ilhas: PontoTraco[][]
  /**
   * 'perfilada' = derivada do template + perfil_semanas.
   * 'uniforme'  = fallback linear (sinaliza com tracejado fino na UI).
   */
  modo: 'perfilada' | 'uniforme'
  cor: string
  /** Label para tooltip/legenda: `${codigo} ${descricao}`. */
  label: string
  /** Código EAP ou código do servico_grupo, pra agrupar/colorir. */
  codigo: string | null
  /** Quantidade total (mesma unidade do qtd_link ou unidade_servico). */
  qtdTotal: number
  unidadeQtd: string | null
  /** Produção média (qtd/dia útil). */
  prodMediaPorDia: number
  /** Produção espacial média (|Δpos| / dias úteis), em metros. */
  prodMediaEspacial: number
  dataInicio: string
  dataFim: string
  /** Posição de início (1ª ilha, 1º ponto). */
  posIniM: number
  /** Posição de fim (última ilha, último ponto). */
  posFimM: number
  /** Sinal: 1 = avanço crescente em pos, -1 = retrocede. */
  direcao: 1 | -1
}

/** dow 0=dom, 1=seg, ..., 6=sab → bit 0=seg ... 6=dom */
export function dowToBit(dow: number): number {
  return dow === 0 ? 6 : dow - 1
}

export function isWorkDayByBitmask(date: Date, bitmask: number): boolean {
  const dow = date.getUTCDay()
  const bit = dowToBit(dow)
  return ((bitmask >> bit) & 1) === 1
}
