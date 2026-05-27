/**
 * Tipos do módulo Planejamento — cronograma de obra com tarefas, equipes,
 * dependências e calendário. Cada obra tem N revisões (`planejamento`);
 * uma é marcada como linha-de-base (`is_baseline=true`).
 *
 * Tarefas referenciam `item_orcamentario` com `tipo='servico_grupo'`
 * (vínculo CPU + quantidade_referencia já definidos no orçamento).
 */

export type PlanejamentoStatus = 'rascunho' | 'ativo' | 'arquivado'
export type DependenciaTipo = 'FS' | 'SS' | 'FF'
/** Unidade de display pra posição espacial — alinhada com Obra. */
export type UnidadeEspacoDisplay = 'km' | 'm' | 'estaca'
/** Shapes de distribuição semanal de quantidade ao longo de uma tarefa. */
export type PerfilNome =
  | 'uniforme'
  | 'rampa-subida'
  | 'rampa-descida'
  | 'sino'
  | 'front-loaded'
  | 'back-loaded'

export const PERFIL_LABEL: Record<PerfilNome, string> = {
  uniforme: 'Uniforme',
  'rampa-subida': 'Rampa de subida',
  'rampa-descida': 'Rampa de descida',
  sino: 'Sino',
  'front-loaded': 'Front-loaded',
  'back-loaded': 'Back-loaded'
}

export const PERFIL_NOMES: PerfilNome[] = [
  'uniforme',
  'rampa-subida',
  'rampa-descida',
  'sino',
  'front-loaded',
  'back-loaded'
]

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
  criado_por: string | null
  created_at: string
  updated_at: string
}

export interface PlanejamentoTarefa {
  id: string
  planejamento_id: string
  item_orcamentario_id: string
  data_inicio: string | null
  data_fim: string | null
  duracao_dias_uteis_calc: number | null
  data_inicio_manual: boolean
  notas: string | null
  ordem: number
  /** Posição espacial em METROS. Ambas null ou ambas preenchidas. */
  posicao_inicio_m: number | null
  posicao_fim_m: number | null
  /** Override de unidade para display desta tarefa; null = usa Obra.unidade_espaco_padrao. */
  unidade_espaco_display: UnidadeEspacoDisplay | null
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

/** Vinda da view vw_planejamento_tarefa_completa. */
export interface PlanejamentoTarefaCompleta extends PlanejamentoTarefa {
  obra_id: string
  is_baseline: boolean
  planejamento_status: PlanejamentoStatus
  servico_grupo_codigo: string
  servico_grupo_descricao: string
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
  custo_total_tarefa: number
  /**
   * Unidade efetiva resolvida na view via
   * COALESCE(tarefa.unidade_espaco_display, obra.unidade_espaco_padrao).
   * Cliente NÃO precisa fazer esse fallback.
   */
  unidade_espaco_efetiva: UnidadeEspacoDisplay
  equipes: EquipeAlocada[]
  predecessoras: PredecessoraRef[]
  sucessoras: SucessoraRef[]
  /** Perfil semanal agregado da view v2 (ordenado por semana_segunda asc). */
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
  FF: 'Fim → Fim'
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

/** dow 0=dom, 1=seg, ..., 6=sab → bit 0=seg ... 6=dom */
export function dowToBit(dow: number): number {
  return dow === 0 ? 6 : dow - 1
}

export function isWorkDayByBitmask(date: Date, bitmask: number): boolean {
  const dow = date.getDay()
  const bit = dowToBit(dow)
  return ((bitmask >> bit) & 1) === 1
}
