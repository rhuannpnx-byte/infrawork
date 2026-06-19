/**
 * Tipos do módulo Orçamento — catálogos vedados 100% por obra.
 *
 * Mapeiam 1:1 as tabelas Postgres em snake_case. Recursos, Serviços, CPUs
 * e Encargos são por obra (`obra_id`). Importação cross-obra fica para
 * iteração futura como "importar de outra obra" (cria cópia local).
 */

export type RecursoGrupo = 'MO' | 'MVE' | 'COMBUSTIVEL' | 'MATERIAL' | 'ADM'

export type CpuItemGrupo = 'EQUIPAMENTO' | 'COMBUSTIVEL' | 'MO' | 'MATERIAL'

export interface Recurso {
  id: string
  obra_id: string
  codigo: string | null
  grupo: RecursoGrupo
  nome: string
  unidade: string
  ativo: boolean
  fonte: string | null
  observacao: string | null
  created_at: string
  updated_at: string
  /** Preenchido por hooks que fazem join com recurso_preco — preço vigente em current_date. */
  preco_vigente?: number | null
}

export interface RecursoPreco {
  id: string
  recurso_id: string
  custo_unitario: number
  vigencia_inicio: string
  vigencia_fim: string | null
  origem: string | null
  documento_url: string | null
  observacao: string | null
  criado_por: string | null
  created_at: string
}

export interface Servico {
  id: string
  obra_id: string
  codigo: string
  nome: string
  parent_id: string | null
  nivel: number
  unidade: string | null
  ativo: boolean
  descricao: string | null
  referencia_externa: string | null
  /** Produção diária do servico-agregador (NULL = herda da 1ª CPU vinculada). */
  producao_diaria_qtde: number | null
  producao_diaria_unidade: string | null
  created_at: string
}

export interface ServicoTreeNode extends Servico {
  children: ServicoTreeNode[]
}

export type ServicoCpuOperacao = 'dividir' | 'multiplicar'

/** Vínculo N:N entre servico-agregador e CPU. */
export interface ServicoCpuLink {
  id: string
  servico_id: string
  cpu_id: string
  /** Fator de conversão aplicado conforme `operacao`.
   *  - operacao='dividir':     custo_link = cpu.custo_unit / fator
   *  - operacao='multiplicar': custo_link = cpu.custo_unit * fator */
  fator: number
  operacao: ServicoCpuOperacao
  ordem: number
  observacao: string | null
  created_at: string
  updated_at: string
}

/** Linha da view vw_servico_custo_agregado. */
export interface ServicoCustoAgregado {
  servico_id: string
  obra_id: string
  codigo: string
  nome: string
  unidade: string | null
  cpus_vinculadas: number
  custo_unit_agregado: number | null
  producao_diaria_efetiva: number | null
  producao_diaria_unidade_efetiva: string
  modo: 'legado' | 'agregador'
}

/**
 * Conjunto de taxas (impostos sobre receita) aplicado como deflator no
 * cálculo de lucro. Antes chamado "Encargos Sociais"; mantém o nome de
 * tabela `encargos_sociais_regime` por compatibilidade de FKs.
 *
 * total_perc_calc é a soma de iss + pis + cofins + csll + irpj + cprb + outros.
 * Lucro = Venda - Custo - Venda × total_perc_calc.
 */
export interface TaxaRegime {
  id: string
  obra_id: string
  nome: string
  iss_perc: number
  pis_perc: number
  cofins_perc: number
  csll_perc: number
  irpj_perc: number
  cprb_perc: number
  outros_perc: number
  total_perc_calc: number
  vigencia_inicio: string | null
  vigencia_fim: string | null
  ativo: boolean
  created_at: string
}

/** @deprecated use TaxaRegime */
export type EncargosSociaisRegime = TaxaRegime

export interface Cpu {
  id: string
  obra_id: string
  /** Servico-dono da CPU. NULL quando a CPU é "órfã" (importada sem servico ou
   *  teve servico apagado depois). Pode ser promovida em servico via UI. */
  servico_id: string | null
  /** Nome próprio da CPU, independente do servico-dono. Backfill copia de
   *  servico.nome ou extrai de notas pra CPUs antigas. NULL = sem nome
   *  explícito; frontend usa fallback. */
  nome: string | null
  versao: number
  producao_diaria_qtde: number
  producao_diaria_unidade: string
  encargos_sociais_id: string | null
  notas: string | null
  custo_eq_dia_calc: number
  custo_comb_dia_calc: number
  custo_mo_dia_calc: number
  custo_mat_dia_calc: number
  custo_unit_calc: number
  is_vigente: boolean
  criado_por: string | null
  created_at: string
}

export interface CpuComServico extends Cpu {
  servico?: { id: string; codigo: string; nome: string; unidade: string | null }
}

export interface CpuItem {
  id: string
  cpu_id: string
  grupo: CpuItemGrupo
  recurso_id: string
  quantidade: number
  horas_dia: number | null
  consumo_combustivel_lh: number | null
  indice_produtividade: number
  consumo_material_por_unid: number | null
  ordem: number
  custo_total_calc: number
  created_at: string
  updated_at: string
}

export interface CpuItemComRecurso extends CpuItem {
  recurso?: {
    id: string
    nome: string
    unidade: string
    grupo: RecursoGrupo
    /** Preço vigente em current_date (vem por join no hook). */
    preco_vigente?: number | null
  }
}

export interface CpuDetalhado extends Cpu {
  itens: CpuItemComRecurso[]
  servico?: { id: string; codigo: string; nome: string; unidade: string | null }
}

export const RECURSO_GRUPO_LABEL: Record<RecursoGrupo, string> = {
  MO: 'Mão de obra',
  MVE: 'Equipamento',
  COMBUSTIVEL: 'Combustível',
  MATERIAL: 'Material',
  ADM: 'Administrativo'
}

export const CPU_ITEM_GRUPO_LABEL: Record<CpuItemGrupo, string> = {
  EQUIPAMENTO: 'Equipamento',
  COMBUSTIVEL: 'Combustível',
  MO: 'Mão de obra',
  MATERIAL: 'Material'
}

/** Mapeamento de qual `RecursoGrupo` é elegível para cada `CpuItemGrupo`. */
export const CPU_ITEM_GRUPO_TO_RECURSO_GRUPOS: Record<CpuItemGrupo, RecursoGrupo[]> = {
  EQUIPAMENTO: ['MVE'],
  COMBUSTIVEL: ['COMBUSTIVEL'],
  MO: ['MO'],
  MATERIAL: ['MATERIAL']
}

// ─── Planilha Orçamentária (revisão maior) ───────────────────────────────
// Três tipos de item:
//   - 'etapa'         → estrutural/EAP, agrupa filhos; sem CPU.
//   - 'servico_grupo' → bloco com serviço + CPU; tem quantidade_referencia
//                       que multiplica a CPU para gerar o custo; venda é
//                       soma das receitas filhas.
//   - 'receita'       → tarefa cobrada do cliente; tem unidade+qtd+venda_unit;
//                       NÃO tem CPU. Só compõe a venda.

export type ItemTipo = 'etapa' | 'servico_grupo' | 'receita'

export type QtdRefModo = 'manual' | 'heranca' | 'soma_filhos'

export type IndiretoTipo = 'mobilizacao' | 'desmob' | 'admin_local' | 'outros'

export interface ItemOrcamentario {
  id: string
  obra_id: string
  parent_id: string | null
  nivel: number
  codigo: string
  descricao: string
  tipo: ItemTipo
  /** Receita: NOT NULL. servico_grupo/etapa: NULL. */
  unidade: string | null
  /** Receita: NOT NULL. servico_grupo/etapa: NULL. */
  quantidade: number | null
  /** Receita: NOT NULL. servico_grupo/etapa: NULL. */
  venda_unitaria: number | null
  /** servico_grupo: NOT NULL (livre). receita/etapa: NULL. */
  servico_id: string | null
  /** servico_grupo: pode ter snapshot vinculado. */
  cpu_snapshot_id: string | null
  /** servico_grupo: alternativa a servico_id — linka a um indireto_item.
   * Mutuamente exclusivo com servico_id. */
  indireto_id: string | null
  /** servico_grupo: NOT NULL. Multiplica a CPU para gerar o custo. */
  quantidade_referencia: number | null
  /** servico_grupo: NOT NULL. Unidade da CPU (espelhada para display). */
  unidade_referencia: string | null
  /** servico_grupo: NOT NULL. Origem da qtd_ref. */
  qtd_ref_modo: QtdRefModo | null
  /** servico_grupo: usado por heranca/soma_filhos. */
  qtd_ref_filhos: string[] | null
  ordem: number
  custo_unitario_calc: number | null
  custo_total_calc: number
  venda_total_calc: number
  lucratividade_perc_calc: number | null
  created_at: string
  updated_at: string
}

export interface ItemTreeNode extends ItemOrcamentario {
  children: ItemTreeNode[]
  depth: number
}

export const ITEM_TIPO_LABEL: Record<ItemTipo, string> = {
  etapa: 'Índice',
  servico_grupo: 'Grupo de serviço',
  receita: 'Receita'
}

export const QTD_REF_MODO_LABEL: Record<QtdRefModo, string> = {
  manual: 'Manual',
  heranca: 'Herança de filho',
  soma_filhos: 'Soma de filhos'
}

export interface CpuSnapshotPayloadCpuItem {
  id: string
  grupo: CpuItemGrupo
  recurso_id: string
  quantidade: number
  horas_dia: number | null
  consumo_combustivel_lh: number | null
  indice_produtividade: number
  consumo_material_por_unid: number | null
  ordem: number
  custo_total_calc: number
  recurso: { id: string; nome: string; unidade: string; grupo: RecursoGrupo; codigo: string | null }
  preco_vigente: number | null
}

/**
 * Uma CPU dentro de um snapshot AGREGADOR: cpu_items crus + o fator/operacao do
 * vínculo servico_cpu_link. O `fator` NÃO está embutido nos `itens` — é aplicado
 * só ao custo agregado (e, no histograma físico, só ao MATERIAL).
 */
export interface CpuSnapshotPayloadCpuUnidade {
  cpu: {
    id: string
    servico_id: string
    versao: number
    custo_unit_calc?: number
    producao_diaria_qtde: number
    producao_diaria_unidade: string
    servico?: { codigo: string; nome: string; unidade: string | null } | null
  }
  fator: number
  operacao: ServicoCpuOperacao
  ordem: number
  observacao: string | null
  contribuicao_custo?: number
  itens: CpuSnapshotPayloadCpuItem[]
}

/**
 * Payload do cpu_snapshot. Dois formatos discriminados por `modo`:
 *  - 'legado' (ou ausente): 1 CPU única → usa `cpu` + `itens`.
 *  - 'agregador': N CPUs com fator → usa `servico` + `cpus[]` (itens crus por CPU).
 * Campos de ambos os formatos ficam opcionais para conviverem no mesmo tipo.
 */
export interface CpuSnapshotPayload {
  modo?: 'legado' | 'agregador'
  // ── Formato legado ──
  cpu?: {
    id: string
    servico_id: string
    versao: number
    producao_diaria_qtde: number
    producao_diaria_unidade: string
  }
  itens?: CpuSnapshotPayloadCpuItem[]
  // ── Formato agregador ──
  servico?: {
    id: string
    codigo: string
    nome: string
    unidade: string | null
    producao_diaria_qtde: number | null
    producao_diaria_unidade: string | null
  }
  cpus?: CpuSnapshotPayloadCpuUnidade[]
  snapshot_em: string
}

export interface CpuSnapshot {
  id: string
  obra_id: string
  cpu_id_origem: string | null
  versao_origem: number | null
  snapshot_em: string
  criado_por: string | null
  custo_unit: number
  custo_eq_dia: number
  custo_comb_dia: number
  custo_mo_dia: number
  custo_mat_dia: number
  producao_diaria_qtde: number
  producao_diaria_unidade: string
  servico_codigo: string | null
  servico_nome: string | null
  servico_unidade: string | null
  payload: CpuSnapshotPayload
}

export interface ItemDetalhe extends ItemOrcamentario {
  cpu_snapshot?: CpuSnapshot | null
  servico?: { id: string; codigo: string; nome: string; unidade: string | null } | null
}

export interface Indireto {
  id: string
  obra_id: string
  parent_id: string | null
  codigo: string
  descricao: string
  tipo: IndiretoTipo
  valor_total: number
  distribuicao_perc: number
  ordem: number
  created_at: string
}

export const INDIRETO_TIPO_LABEL: Record<IndiretoTipo, string> = {
  mobilizacao: 'Mobilização',
  desmob: 'Desmobilização',
  admin_local: 'Administração local',
  outros: 'Outros'
}

export interface LucratividadeResumo {
  venda_total: number
  /** Custo direto SEM indiretos vinculados (já isolados em custo_indireto). */
  custo_direto: number
  /** Custos indiretos totais = standalone + vinculados a agrupadores da planilha. */
  custo_indireto: number
  /** Detalhamento opcional pra tooltip/breakdown na UI. */
  custo_indireto_standalone: number
  custo_indireto_vinculado: number
  aliquota_total_perc: number
  impostos: number
  lucro_liquido: number
  margem_perc: number | null
}

// ─── Fase 3: Revisões + Comentários + Memória + Anexos ───────────────────

export type RevisaoStatus = 'rascunho' | 'em_revisao' | 'aprovada' | 'homologada' | 'cancelada'

export interface Revisao {
  id: string
  obra_id: string
  versao: number
  rotulo: string | null
  status: RevisaoStatus
  snapshot: unknown
  custo_total: number
  venda_total: number
  lucratividade_perc: number | null
  observacao: string | null
  criada_por: string | null
  criada_em: string
  aprovada_por: string | null
  aprovada_em: string | null
  homologada_por: string | null
  homologada_em: string | null
  cancelada_por: string | null
  cancelada_em: string | null
}

export const REVISAO_STATUS_LABEL: Record<RevisaoStatus, string> = {
  rascunho: 'Rascunho',
  em_revisao: 'Em revisão',
  aprovada: 'Aprovada',
  homologada: 'Homologada',
  cancelada: 'Cancelada'
}

export const REVISAO_STATUS_VARIANT: Record<
  RevisaoStatus,
  'default' | 'accent' | 'success' | 'warn' | 'danger'
> = {
  rascunho: 'default',
  em_revisao: 'warn',
  aprovada: 'accent',
  homologada: 'success',
  cancelada: 'danger'
}

export interface ComentarioItem {
  id: string
  item_id: string
  obra_id: string
  autor_id: string | null
  texto: string
  resolvido: boolean
  resolvido_por: string | null
  resolvido_em: string | null
  created_at: string
  updated_at: string
  autor?: { id: string; nome: string } | null
}

export interface MemoriaCalculoItem {
  id: string
  item_id: string
  obra_id: string
  body_md: string
  estaca_inicio: string | null
  estaca_fim: string | null
  autor_id: string | null
  created_at: string
  updated_at: string
}

export type AnexoEscopo = 'obra' | 'item' | 'revisao'

export interface Anexo {
  id: string
  obra_id: string
  escopo: AnexoEscopo
  escopo_id: string
  nome: string
  storage_path: string
  mime: string | null
  tamanho_bytes: number | null
  autor_id: string | null
  created_at: string
}

// ─── Fase 4: Importação Excel/PDF ────────────────────────────────────────

export type ImportJobStatus = 'criado' | 'parseado' | 'mapeado' | 'aplicado' | 'erro' | 'cancelado'

export interface TemplateImportacao {
  id: string
  obra_id: string
  nome: string
  descricao: string | null
  formato: 'xlsx' | 'pdf'
  mapping: unknown
  eh_default: boolean
  ativo: boolean
  criado_por: string | null
  created_at: string
  updated_at: string
}

export interface ImportItemParsed {
  idx: number
  codigo: string
  descricao: string
  unidade: string | null
  quantidade: number | null
  venda_unitaria: number | null
  is_folha: boolean
}

export interface ImportIndiretoParsed {
  idx: number
  codigo: string | null
  descricao: string
  tipo: IndiretoTipo
  valor_total: number
}

export interface ImportPayloadParse {
  itens: ImportItemParsed[]
  indireto: ImportIndiretoParsed[]
}

export interface ImportMatch {
  servico_id: string
  tipo: 'forte' | 'fraco'
}

export interface ImportPayloadMatch {
  matches: Record<number, ImportMatch>
}

export interface ImportJob {
  id: string
  obra_id: string
  template_id: string | null
  arquivo_nome: string
  arquivo_tamanho: number | null
  arquivo_storage_path: string | null
  status: ImportJobStatus
  payload_parse: ImportPayloadParse | null
  payload_match: ImportPayloadMatch | null
  total_itens: number
  matches_fortes: number
  matches_fracos: number
  sem_match: number
  itens_aplicados: number | null
  error_msg: string | null
  criado_por: string | null
  created_at: string
  updated_at: string
  finished_at: string | null
}

export interface ImportMatchFraco {
  id: string
  job_id: string
  item_idx: number
  codigo_origem: string | null
  descricao_origem: string
  sugestoes: {
    servico_id: string
    codigo: string | null
    nome: string
    score: number
  }[]
  escolha_servico_id: string | null
  escolha_em: string | null
  escolha_por: string | null
}

export const IMPORT_JOB_STATUS_LABEL: Record<ImportJobStatus, string> = {
  criado: 'Criado',
  parseado: 'Parseado',
  mapeado: 'Mapeado',
  aplicado: 'Aplicado',
  erro: 'Erro',
  cancelado: 'Cancelado'
}

export const IMPORT_JOB_STATUS_VARIANT: Record<
  ImportJobStatus,
  'default' | 'accent' | 'success' | 'warn' | 'danger'
> = {
  criado: 'default',
  parseado: 'warn',
  mapeado: 'accent',
  aplicado: 'success',
  erro: 'danger',
  cancelado: 'default'
}
