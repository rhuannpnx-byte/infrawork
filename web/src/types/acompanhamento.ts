/**
 * Tipos do módulo Acompanhamento — produção NATIVA (módulo de lançamento),
 * fotos enviadas pelo app e views que comparam plano × real pelo item do
 * orçamento (servico_grupo).
 */

/** app = lançado no web; campo = app de campo; viagens = soma das viagens do dia; importacao = planilha */
export type ProducaoOrigem = 'app' | 'importacao' | 'campo' | 'viagens'

export interface Encarregado {
  id: string
  obra_id: string
  nome: string
  apelido: string | null
  telefone: string | null
  profile_id: string | null
  ativo: boolean
  created_at: string
  updated_at: string
}

export interface AcompanhamentoProducao {
  id: string
  obra_id: string
  data: string
  item_orcamentario_id: string | null
  servico_id: string | null
  servico_nome: string
  unidade: string | null
  equipe_id: string | null
  encarregado_id: string | null
  quantidade: number
  fator_conversao: number
  frente: string | null
  estaca_inicial: string | null
  estaca_final: string | null
  /** local do lançamento (eixo ou área) e a faixa em metros internos do eixo (área: null) */
  trecho_id: string | null
  posicao_inicio_m: number | null
  posicao_fim_m: number | null
  obs: string | null
  origem: ProducaoOrigem
  importacao_id: string | null
  criado_por: string | null
  created_at: string
  updated_at: string
}

export interface ProducaoMaterial {
  id: string
  producao_id: string
  nome: string
  quantidade: number | null
  unidade: string | null
}

export interface AcompanhamentoFoto {
  id: string
  obra_id: string
  producao_id: string | null
  item_orcamentario_id: string | null
  servico_nome: string | null
  encarregado_id: string | null
  lat: number | null
  lng: number | null
  captured_at: string | null
  storage_bucket: string
  storage_key: string
  mime: string | null
  size_bytes: number | null
  width: number | null
  height: number | null
  obs: string | null
  enviado_por: string | null
  excluida_em: string | null
  excluida_por: string | null
  created_at: string
}

/** Payload de criação/edição de um lançamento de produção. */
export interface LancamentoInput {
  obra_id: string
  /** 'YYYY-MM-DD' no fuso local. */
  data: string
  item_orcamentario_id: string
  equipe_id: string | null
  encarregado_id: string | null
  quantidade: number
  frente?: string | null
  estaca_inicial?: string | null
  estaca_final?: string | null
  /** controle por estaca: o local (eixo/área) e a faixa em metros internos do eixo */
  trecho_id?: string | null
  posicao_inicio_m?: number | null
  posicao_fim_m?: number | null
  obs?: string | null
  /** recurso_id: o material controlado pela parametrização do serviço (nome/unidade viram retrato) */
  materiais?: Array<{
    nome: string
    quantidade: number | null
    unidade: string | null
    recurso_id?: string | null
  }>
}

// ─── Alertas ────────────────────────────────────────────────────────────

export type AlertaTipo =
  | 'producao_zero_dias'
  | 'desvio_quantidade'
  | 'desvio_prazo'
  | 'sem_foto_periodo'
  | 'produtividade_baixa'
  | 'lancamento_sem_equipe'

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
  produtividade_baixa: 'Produtividade abaixo da meta',
  lancamento_sem_equipe: 'Lançamentos sem equipe'
}

export const ALERTA_TIPO_ICON: Record<AlertaTipo, string> = {
  producao_zero_dias: 'pause-circle',
  desvio_quantidade: 'trending-down',
  desvio_prazo: 'clock-alert',
  sem_foto_periodo: 'image-off',
  produtividade_baixa: 'gauge',
  lancamento_sem_equipe: 'users'
}

// ─── Views enriquecidas ──────────────────────────────────────────────────

export interface ProducaoEnriquecida {
  id: string
  obra_id: string
  data: string
  item_orcamentario_id: string | null
  servico_id: string | null
  /** Alias legado de servico_id. */
  servico_planejamento_id: string | null
  servico_nome: string
  qtd: number
  qtd_convertida: number
  fator_conversao: number
  unidade: string | null
  unidade_plano: string | null
  /** Frente (nunca vazia: '(sem frente)' quando não informada). */
  frente: string
  frente_raw: string | null
  estaca_inicial: string | null
  estaca_final: string | null
  obs: string | null
  origem: ProducaoOrigem
  importacao_id: string | null
  criado_por: string | null
  criado_por_nome: string | null
  created_at: string
  updated_at: string
  equipe_id: string | null
  /** Alias legado de equipe_id. */
  equipe_planejamento_id: string | null
  equipe_display_nome: string
  equipe_display_cor: string
  equipe_tipo: string | null
  encarregado_id: string | null
  encarregado_display_nome: string | null
  servico_codigo: string | null
  servico_display_nome: string
  servico_unidade: string | null
  servico_grupo_codigo: string | null
  servico_grupo_descricao: string | null
  tarefa_baseline_id: string | null
  tarefa_data_inicio: string | null
  tarefa_data_fim: string | null
  fotos_count: number
  trecho_id: string | null
  posicao_inicio_m: number | null
  posicao_fim_m: number | null
  trecho_nome: string | null
  trecho_tipo: 'eixo' | 'area' | null
  /** material aplicado: "qtd un nome; …" (view) */
  material_resumo?: string | null
}

export interface FotoEnriquecida {
  id: string
  obra_id: string
  producao_id: string | null
  item_orcamentario_id: string | null
  lat: number | null
  lng: number | null
  captured_at: string | null
  captured_date: string | null
  storage_bucket: string
  storage_key: string
  obs: string | null
  size_bytes: number | null
  mime: string | null
  width: number | null
  height: number | null
  enviado_por: string | null
  created_at: string
  servico_nome: string | null
  servico_display_nome: string | null
  servico_codigo: string | null
  encarregado_id: string | null
  encarregado_display_nome: string | null
  equipe_id: string | null
  equipe_display_nome: string
  equipe_display_cor: string
  correlacao_producao: 'direto' | 'inferido' | 'avulso'
  producao_inferida_id: string | null
  frente: string
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
  /** Quantidade planejada acumulada até hoje (cronograma do baseline). */
  qtd_plan_periodo: number | null
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
  /** Taxa diária efetiva do plano (equipes) com fallback na CPU. */
  producao_diaria_plan?: number | null
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
  sem_plano: 'var(--text-dim)',
  nao_iniciado: 'var(--text-muted)',
  em_andamento: 'var(--module-planejamento)',
  no_prazo: 'var(--success)',
  em_risco: 'var(--warn)',
  atrasado: 'var(--danger)',
  adiantado: 'var(--module-suprimentos)',
  concluido: 'var(--chart-teal)'
}

// ─── Mapa: cor por serviço + Sequência de Ataque ─────────────────────────

/** Paleta estável pra colorir marcadores/setas por serviço no mapa. */
export const SERVICO_CORES_PADRAO = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#06b6d4',
  '#84cc16',
  '#a855f7',
  '#e11d48'
]

/** Cor estável derivada de uma chave (id ou nome do serviço). Hash → paleta. */
export function corDeServico(chave: string | number | null | undefined): string {
  if (chave == null) return '#67e8f9'
  const s = String(chave)
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  const idx = Math.abs(h) % SERVICO_CORES_PADRAO.length
  return SERVICO_CORES_PADRAO[idx]
}

/** Uma seta da Sequência de Ataque: 1ª → última foto do dia de uma frente. */
export interface SequenciaAtaque {
  key: string
  dia: string
  frente: string | null
  encarregado: string | null
  servico: string | null
  trechoNome: string | null
  unidadeLabel: string
  ini: { lat: number; lng: number; marcador: string | null }
  fim: { lat: number; lng: number; marcador: string | null }
  sentido: 'crescente' | 'decrescente' | null
  distanciaFmt: string | null
  qtdTotal: number
  cor: string
}

// ─── Produtividade equipe ────────────────────────────────────────────────

export interface ProdutividadeEquipeItem {
  obra_id: string
  equipe_id: string | null
  /** Alias legado de equipe_id. */
  equipe_planejamento_id: string | null
  equipe_display_nome: string
  /** Alias legado (= equipe_display_nome). */
  siga_equipe_nome: string
  equipe_cor: string
  servico_nome: string
  servico_id: string | null
  /** Alias legado de servico_id. */
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
  /** Meta diária: taxa da equipe para o serviço, ou produção da CPU. */
  producao_diaria_meta: number | null
  /** Alias legado de producao_diaria_meta. */
  producao_diaria_cpu: number | null
  pct_aderencia_meta: number | null
  /** Alias legado de pct_aderencia_meta. */
  pct_aderencia_cpu: number | null
  primeira_data: string | null
  ultima_data: string | null
}

/** Benchmark histórico (outras obras da empresa, sem outliers) por código de serviço. */
export interface PerfHistorico {
  n_amostras: number
  n_outliers: number
  p25: number | null
  p50: number | null
  p75: number | null
  media_trim: number | null
  media_bruta: number | null
  n_obras?: number
  unidade?: string | null
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
  producao_30d_qtd: number
  producao_30d_registros: number
  dias_com_apontamento: number
  equipes_ativas_hoje: number
  equipes_ativas_semana: number
  fotos_total: number
  fotos_com_geo: number
  cobertura_fotografica_pct: number | null
  alertas_criticos: number
  alertas_abertos_total: number
  ultimo_lancamento_em: string | null
  data_ultima_producao: string | null
  lancamentos_total: number
}

export interface UltimoApontamento {
  id: string
  data: string
  qtd: number
  qtd_convertida: number
  fator_conversao: number
  unidade: string | null
  unidade_plano: string | null
  item_orcamentario_id: string | null
  servico_nome: string
  servico_display_nome: string
  equipe_id: string | null
  equipe_display_nome: string
  equipe_display_cor: string
  encarregado_display_nome: string | null
  frente: string
  fotos_count: number
  origem: ProducaoOrigem
  created_at: string
}

export interface FotoGeo {
  id: string
  lat: number | null
  lng: number | null
  captured_at: string | null
  servico_display_nome: string | null
  servico_nome: string | null
  item_orcamentario_id: string | null
  equipe_display_cor: string
  storage_bucket: string
  storage_key: string
}

export interface DashboardResumoResposta {
  ok: boolean
  resumo: ObraResumo | null
  curva_s: CurvaSPonto[]
  previsto_realizado: PrevistoRealizadoItem[]
  produtividade_equipes: ProdutividadeEquipeItem[]
  frentes: FrenteAtiva[]
  alertas_criticos: AcompanhamentoAlerta[]
  ultimos_apontamentos: UltimoApontamento[]
  fotos_geo: FotoGeo[]
  cobertura_mes: Array<{ data: string; qtd: number }>
  periodo_dias: number
  duracao_ms: number
}

// ─── Fotos listar ───────────────────────────────────────────────────────

export interface FotosListarFiltros {
  data_de?: string
  data_ate?: string
  item_ids?: string[]
  equipe_ids?: string[]
  encarregado_ids?: string[]
  producao_id?: string
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
