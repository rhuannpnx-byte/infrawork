/**
 * Tipos do módulo Acompanhamento — vínculo InfraWork ↔ ERP SIGA + cache de
 * produção/fotos via Edge Functions que leem o MySQL SIGA e o bucket
 * Supabase `monito-fotos`.
 */

export type SyncStatus = 'ok' | 'erro' | 'rodando'

export interface SyncStats {
  producao_inseridas?: number
  producao_atualizadas?: number
  fotos_inseridas?: number
  fotos_atualizadas?: number
}

export interface ObraAcompanhamentoLink {
  id: string
  obra_id: string
  siga_projeto_id: number
  siga_projeto_codigo: string
  siga_projeto_nome: string | null
  ativo: boolean
  ultimo_sync_em: string | null
  ultimo_sync_status: SyncStatus | null
  ultimo_sync_erro: string | null
  ultimo_sync_stats: SyncStats | null
  criado_por: string | null
  criado_em: string
  updated_at: string
}

export interface SigaProjeto {
  id: number
  codigo: string
  nome: string
}

export interface AcompanhamentoProducao {
  id: string
  obra_id: string
  siga_producao_id: number
  data: string | null
  servico_id: number | null
  servico_nome: string | null
  encarregado_id: number | null
  encarregado_nome: string | null
  equipe_id: number | null
  equipe_nome: string | null
  qtd: number | null
  trecho: string | null
  estaca_inicial: string | null
  estaca_final: string | null
  obs: string | null
  frente: string | null
  siga_created_at: string | null
  siga_updated_at: string | null
  sincronizado_em: string
}

export interface AcompanhamentoFoto {
  id: string
  obra_id: string
  siga_foto_id: number
  app_uuid: string | null
  producao_siga_id: number | null
  lat: number | null
  lng: number | null
  servico_executado_id: number | null
  servico_executado_nome: string | null
  encarregado_id: number | null
  encarregado_nome: string | null
  captured_at: string | null
  storage_bucket: string | null
  storage_key: string | null
  obs: string | null
  size_bytes: number | null
  mime: string | null
  siga_created_at: string | null
  sincronizado_em: string
}

export interface SyncResultadoItem {
  obra_id: string
  siga_projeto_id: number
  stats?: SyncStats
  warnings?: string[]
  erro?: string
}

export const SYNC_STATUS_LABEL: Record<SyncStatus, string> = {
  ok: 'OK',
  erro: 'Erro',
  rodando: 'Rodando'
}

// ─── Fase B+ ────────────────────────────────────────────────────────────

export type MatchOrigem = 'auto' | 'manual' | 'rejeitado'
export type MatchTipo = 'equipe' | 'encarregado' | 'servico'

export interface EquipeMatch {
  id: string
  obra_id: string
  siga_equipe_nome: string
  equipe_id: string | null
  confianca_sugestao: number | null
  origem: MatchOrigem
  confirmado_por: string | null
  confirmado_em: string | null
  criado_em: string
  updated_at: string
}

export interface EncarregadoMatch {
  id: string
  obra_id: string
  siga_encarregado_nome: string
  apelido_canonico: string | null
  equipe_match_id: string | null
  confianca_sugestao: number | null
  origem: MatchOrigem
  confirmado_por: string | null
  confirmado_em: string | null
  criado_em: string
  updated_at: string
}

export interface ServicoMatch {
  id: string
  obra_id: string
  siga_servico_executado_id: number
  siga_servico_nome: string | null
  servico_id: string | null
  item_orcamentario_id: string | null
  confianca_sugestao: number | null
  origem: MatchOrigem
  fator_conversao: number
  siga_unidade_id: number | null
  siga_unidade_nome: string | null
  confirmado_por: string | null
  confirmado_em: string | null
  criado_em: string
  updated_at: string
}

export interface MatchCandidato {
  id: string
  nome: string
  confianca: number
  motivo: 'referencia_externa' | 'exato' | 'fuzzy_alto' | 'fuzzy_medio'
  item_orcamentario_id?: string | null
  unidade_orcamento?: string | null
}

export interface SugestaoEquipe {
  siga_nome: string
  candidatos: MatchCandidato[]
  match_atual: { equipe_id: string | null; origem: MatchOrigem } | null
}

export interface SugestaoEncarregado {
  siga_nome: string
  apelido_canonico_sugerido: string
  match_atual: { equipe_match_id: string | null; origem: MatchOrigem } | null
}

export interface SugestaoServico {
  siga_id: number
  siga_nome: string
  siga_unidade_id: number | null
  siga_unidade_nome: string | null
  candidatos: MatchCandidato[]
  match_atual: {
    servico_id: string | null
    item_orcamentario_id: string | null
    origem: MatchOrigem
    fator_conversao: number | null
  } | null
}

export interface MatchingSugestoesResposta {
  ok: boolean
  equipes: SugestaoEquipe[]
  encarregados: SugestaoEncarregado[]
  servicos: SugestaoServico[]
  totais: {
    equipes_siga: number
    encarregados_siga: number
    servicos_siga: number
    equipes_cad: number
    servicos_cad: number
    itens_orc_com_servico: number
  }
}

// ─── Alertas ────────────────────────────────────────────────────────────

export type AlertaTipo =
  | 'producao_zero_dias'
  | 'desvio_quantidade'
  | 'desvio_prazo'
  | 'sem_foto_periodo'
  | 'equipe_nao_vinculada'
  | 'encarregado_nao_vinculado'
  | 'servico_nao_vinculado'
  | 'produtividade_baixa'
  | 'sync_falhou'

export type AlertaSeveridade = 'info' | 'warn' | 'critical'
export type AlertaStatus = 'aberto' | 'silenciado' | 'resolvido'

export interface AcompanhamentoAlerta {
  id: string
  obra_id: string
  tipo: AlertaTipo
  severidade: AlertaSeveridade
  titulo: string
  descricao: string | null
  contexto: Record<string, unknown>
  contexto_hash?: string
  status: AlertaStatus
  silenciado_ate: string | null
  silenciado_por: string | null
  resolvido_em: string | null
  resolvido_automaticamente: boolean
  criado_em: string
  updated_at: string
}

export const ALERTA_TIPO_LABEL: Record<AlertaTipo, string> = {
  producao_zero_dias: 'Produção parada',
  desvio_quantidade: 'Desvio de quantidade',
  desvio_prazo: 'Desvio de prazo',
  sem_foto_periodo: 'Sem evidência fotográfica',
  equipe_nao_vinculada: 'Equipe sem vínculo',
  encarregado_nao_vinculado: 'Encarregado sem vínculo',
  servico_nao_vinculado: 'Serviço sem vínculo',
  produtividade_baixa: 'Produtividade abaixo do esperado',
  sync_falhou: 'Falha de sincronização'
}

export const ALERTA_TIPO_ICON: Record<AlertaTipo, string> = {
  producao_zero_dias: 'pause-circle',
  desvio_quantidade: 'trending-down',
  desvio_prazo: 'clock-alert',
  sem_foto_periodo: 'image-off',
  equipe_nao_vinculada: 'unlink',
  encarregado_nao_vinculado: 'user-x',
  servico_nao_vinculado: 'circle-x',
  produtividade_baixa: 'gauge',
  sync_falhou: 'cloud-off'
}

// ─── Views enriquecidas ──────────────────────────────────────────────────

export interface ProducaoEnriquecida {
  id: string
  obra_id: string
  siga_producao_id: number
  data: string | null
  siga_servico_id: number | null
  siga_servico_nome: string | null
  siga_encarregado_id: number | null
  siga_encarregado_nome: string | null
  siga_equipe_id: number | null
  siga_equipe_nome: string | null
  qtd: number | null
  qtd_convertida: number | null
  fator_conversao: number | null
  siga_unidade_nome: string | null
  trecho: string | null
  estaca_inicial: string | null
  estaca_final: string | null
  obs: string | null
  frente: string | null
  siga_created_at: string | null
  siga_updated_at: string | null
  sincronizado_em: string
  equipe_match_id: string | null
  equipe_planejamento_id: string | null
  equipe_display_nome: string | null
  equipe_display_cor: string | null
  equipe_match_origem: MatchOrigem | null
  equipe_tipo: string | null
  encarregado_match_id: string | null
  encarregado_display_nome: string | null
  encarregado_match_origem: MatchOrigem | null
  servico_match_id: string | null
  servico_planejamento_id: string | null
  item_orcamentario_id: string | null
  servico_codigo: string | null
  servico_display_nome: string | null
  servico_unidade: string | null
  unidade_plano: string | null
  servico_grupo_codigo: string | null
  servico_grupo_descricao: string | null
  tarefa_baseline_id: string | null
  tarefa_data_inicio: string | null
  tarefa_data_fim: string | null
  fotos_count: number
}

export interface FotoEnriquecida {
  id: string
  obra_id: string
  siga_foto_id: number
  producao_siga_id: number | null
  lat: number | null
  lng: number | null
  siga_servico_id: number | null
  siga_servico_nome: string | null
  siga_encarregado_id: number | null
  siga_encarregado_nome: string | null
  captured_at: string | null
  captured_date: string | null
  storage_bucket: string | null
  storage_key: string | null
  obs: string | null
  size_bytes: number | null
  mime: string | null
  sincronizado_em: string
  servico_match_id: string | null
  servico_planejamento_id: string | null
  servico_display_nome: string | null
  encarregado_match_id: string | null
  encarregado_display_nome: string | null
  equipe_match_id: string | null
  equipe_display_nome: string | null
  equipe_display_cor: string | null
  correlacao_producao: 'direto' | 'inferido' | 'avulso'
  producao_inferida_id: string | null
  frente: string | null
}

// ─── Comparativo previsto × realizado ────────────────────────────────────

export type StatusComparativo =
  | 'sem_plano'
  | 'nao_iniciado'
  | 'em_andamento'
  | 'no_prazo'
  | 'em_risco'
  | 'atrasado'
  | 'adiantado'
  | 'concluido'

export interface PrevistoRealizadoItem {
  obra_id: string
  tarefa_id: string
  item_orcamentario_id: string
  codigo: string
  descricao: string
  unidade: string | null
  qtd_plan: number | null
  qtd_real: number
  pct_avanco: number | null
  data_inicio_plan: string | null
  data_fim_plan: string | null
  dias_plan: number | null
  dias_real: number | null
  data_primeira_realizacao: string | null
  data_ultima_realizacao: string | null
  pct_esperado_hoje: number | null
  desvio_dias_estimado: number | null
  status: StatusComparativo
}

export const STATUS_COMP_LABEL: Record<StatusComparativo, string> = {
  sem_plano: 'Sem plano',
  nao_iniciado: 'Não iniciado',
  em_andamento: 'Em andamento',
  no_prazo: 'No prazo',
  em_risco: 'Em risco',
  atrasado: 'Atrasado',
  adiantado: 'Adiantado',
  concluido: 'Concluído'
}

export const STATUS_COMP_COR: Record<StatusComparativo, string> = {
  sem_plano: '#64748b',
  nao_iniciado: '#94a3b8',
  em_andamento: '#22d3ee',
  no_prazo: '#10b981',
  em_risco: '#f59e0b',
  atrasado: '#ef4444',
  adiantado: '#8b5cf6',
  concluido: '#0d9488'
}

// ─── Produtividade equipe ────────────────────────────────────────────────

export interface ProdutividadeEquipeItem {
  obra_id: string
  siga_equipe_nome: string
  equipe_match_id: string | null
  equipe_planejamento_id: string | null
  equipe_display_nome: string
  equipe_cor: string
  servico_nome: string
  siga_servico_id: number | null
  servico_planejamento_id: string | null
  item_orcamentario_id: string | null
  unidade: string | null
  registros: number
  dias_trabalhados: number
  qtd_total: number
  qtd_media: number
  qtd_min: number
  qtd_max: number
  qtd_p50: number
  qtd_p90: number
  producao_diaria_cpu: number | null
  pct_aderencia_cpu: number | null
  primeira_data: string | null
  ultima_data: string | null
}

// ─── Curva-S ─────────────────────────────────────────────────────────────

export interface CurvaSPonto {
  data: string
  planejado_acumulado: number
  realizado_acumulado: number
  planejado_dia?: number
  realizado_dia?: number
  servico_grupo_codigo: string | null
  item_orcamentario_id: string | null
}

// ─── Frentes ─────────────────────────────────────────────────────────────

export interface FrenteAtiva {
  obra_id: string
  frente: string
  registros: number
  dias_ativos: number
  equipes_distintas: number
  equipes: string[]
  servicos_distintos: number
  qtd_total: number
  primeira_data: string | null
  ultima_data: string | null
  registros_ultima_semana: number
}

// ─── Resumo / dashboard ──────────────────────────────────────────────────

export interface ObraResumo {
  obra_id: string
  avanco_pct: number | null
  producao_total_registros: number
  dias_com_apontamento: number
  data_primeira_producao: string | null
  data_ultima_producao: string | null
  equipes_ativas_hoje: number
  equipes_ativas_semana: number
  fotos_total: number
  fotos_com_geo: number
  cobertura_fotografica_pct: number | null
  alertas_criticos: number
  alertas_abertos_total: number
  ultimo_sync_em: string | null
  ultimo_sync_status: SyncStatus | null
  siga_projeto_codigo: string
  siga_projeto_nome: string | null
}

export interface DashboardResumoResposta {
  ok: boolean
  resumo: ObraResumo | null
  curva_s: CurvaSPonto[]
  previsto_realizado: PrevistoRealizadoItem[]
  produtividade_equipes: ProdutividadeEquipeItem[]
  frentes: FrenteAtiva[]
  alertas_criticos: AcompanhamentoAlerta[]
  ultimos_apontamentos: Array<{
    id: string
    data: string | null
    qtd: number | null
    qtd_convertida: number | null
    fator_conversao: number | null
    siga_unidade_nome: string | null
    unidade_plano: string | null
    servico_match_id: string | null
    siga_servico_nome: string | null
    servico_display_nome: string | null
    equipe_display_nome: string | null
    equipe_display_cor: string | null
    frente: string | null
  }>
  fotos_geo: Array<{
    id: string
    lat: number | null
    lng: number | null
    captured_at: string | null
    servico_display_nome: string | null
    siga_servico_nome: string | null
    equipe_display_cor: string | null
    storage_bucket: string | null
    storage_key: string | null
  }>
  cobertura_mes: Array<{ data: string; qtd: number }>
  periodo_dias: number
  duracao_ms: number
}

// ─── Fotos listar ───────────────────────────────────────────────────────

export interface FotosListarFiltros {
  data_de?: string
  data_ate?: string
  servico_ids?: number[]
  equipe_match_ids?: string[]
  encarregado_nomes?: string[]
  frente?: string
  somente_geo?: boolean
  bbox?: [number, number, number, number]
}

export interface FotoSignedUrl {
  foto_id: string
  url?: string
  expires_at?: string
  error?: string
}

export interface FotosListarResposta {
  ok: boolean
  fotos: FotoEnriquecida[]
  urls: Array<{ foto_id: string; url: string; expires_at: string }>
  page: number
  page_size: number
  total: number
  ttl_seconds: number
}
