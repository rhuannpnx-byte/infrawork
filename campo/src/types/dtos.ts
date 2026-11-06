/**
 * Contrato com o InfraWork Web (migração 0034): o que as RPCs `campo_*` devolvem e recebem.
 * Os ids são uuid; as quantidades vêm em número (jsonb).
 */

export type UnidadeEspaco = 'km' | 'm' | 'estaca' | 'custom'

export interface ObraDto {
  id: string
  codigo: string
  nome: string
  empresa_id: string
  status?: string | null
}

export interface MaterialServicoDto {
  id: string
  nome: string
  unidade: string | null
}

/** Serviço (agrupador do orçamento) com a parametrização do Planejamento. */
export interface ServicoDto {
  id: string
  codigo: string
  descricao: string
  unidade: string | null
  modo_lancamento: 'quantidade' | 'viagens'
  controla_material: boolean
  material: MaterialServicoDto | null
  material_obrigatorio: boolean
  habilita_obs: boolean
  exige_local: boolean
}

export interface NomeDto {
  id: string
  nome: string
}

export interface EncarregadoDto extends NomeDto {
  apelido: string | null
}

export interface EquipeDto extends NomeDto {
  /** Encarregado da equipe (ausente em catálogos antigos). */
  encarregado_id?: string | null
}

/** Local da obra: eixo (com estaqueamento) ou área. */
export interface LocalDto {
  id: string
  nome: string
  tipo: 'eixo' | 'area'
  ordem: number
  comprimento_m: number | null
  geometry_comprimento_m: number | null
  unidade_espaco_padrao: UnidadeEspaco
  unidade_custom_label: string | null
  unidade_custom_divisor_m: number | null
  marcador_valor_inicial: number | null
  geometry_sentido: 'natural' | 'invertido' | null
}

export interface VeiculoDto {
  id: string
  prefixo: string
  placa: string | null
  tipo: string
  modelo: string | null
  proprietario: 'proprio' | 'terceiro'
  capacidade_m3: number | null
}

export interface OrigemDestinoDto {
  id: string
  nome: string
  tipo: 'jazida' | 'usina' | 'central' | 'bota_fora' | 'deposito' | 'pista' | 'outro'
  trecho_id: string | null
}

export interface RotaDto {
  origem_id: string
  destino_id: string
  dmt_km: number
}

/** `campo_catalogo(obra)` — tudo que o app precisa da obra, sem preços nem custos. */
export interface CatalogoDto {
  versao: string
  obra: ObraDto
  servicos: ServicoDto[]
  equipes: EquipeDto[]
  encarregados: EncarregadoDto[]
  locais: LocalDto[]
  veiculos: VeiculoDto[]
  origens_destinos: OrigemDestinoDto[]
  rotas: RotaDto[]
}

/** Registro do lote `campo_sync_producao` (upsert por app_uuid). */
export interface ProducaoRegistroDto {
  app_uuid: string
  obra_id: string
  data: string
  item_orcamentario_id: string
  equipe_id: string | null
  encarregado_id: string | null
  quantidade: number
  trecho_id: string | null
  posicao_inicio_m: number | null
  posicao_fim_m: number | null
  estaca_inicial: string | null
  estaca_final: string | null
  frente: string | null
  obs: string | null
  material_qtd: number | null
  excluir?: boolean
}

export interface ProducaoBatchResponse {
  aceitos: string[]
  rejeitados: { app_uuid: string; motivo: string }[]
}

export interface ViagemDto {
  id: string
  item_orcamentario_id: string
  origem_id: string | null
  destino_id: string | null
  hora_carga: string | null
  hora_descarga: string | null
  quantidade: number
  material_qtd: number | null
  dmt_km: number | null
  nf_ticket: string | null
  trecho_id: string | null
  posicao_inicio_m: number | null
  posicao_fim_m: number | null
  obs: string | null
  carregador_id: string | null
}

/** Ficha de viagens do dia (cabeçalho + viagens) — `campo_sync_ficha`, idempotente pelos ids. */
export interface FichaDto {
  id: string
  obra_id: string
  data: string
  veiculo_id: string | null
  motorista: string | null
  encarregado_id: string | null
  equipe_id: string | null
  km_inicial: number | null
  km_final: number | null
  obs: string | null
  origem: 'campo'
  viagens: ViagemDto[]
  excluir?: boolean
}

export interface FotoMetaDto {
  app_uuid: string
  obra_id: string
  producao_app_uuid: string | null
  item_orcamentario_id: string | null
  encarregado_id: string | null
  lat: number | null
  lng: number | null
  captured_at: string
  storage_key: string
  mime: string
  size_bytes: number
  width: number | null
  height: number | null
  obs: string | null
}

// ── Visão estratégica (campo_painel) — só god, adm e engenheiro ─────────────────────────────────────────────────
export type StatusServico =
  | 'sem_plano'
  | 'nao_iniciado'
  | 'concluido'
  | 'em_andamento'
  | 'atrasado'
  | 'em_risco'
  | 'no_prazo'
  | 'adiantado'

export interface PainelServicoDto {
  id: string
  codigo: string
  descricao: string
  unidade: string | null
  qtd_plan: number | null
  qtd_real: number
  pct_avanco: number | null
  pct_esperado: number | null
  status: StatusServico
  desvio_dias: number | null
  inicio: string | null
  fim: string | null
  ritmo_plan: number | null
  media_7d: number | null
  /** produção dos últimos 14 dias (o último é hoje) */
  dias14: number[]
  valor_executado: number
  valor_previsto: number
  excedente_qtd: number | null
}

export interface PainelServicoEquipeDto {
  id: string
  codigo: string | null
  descricao: string | null
  unidade: string | null
  hoje: number | null
  d7: number | null
  d30: number | null
  dias: number
  aderencia?: number | null
}

export interface PainelEquipeDto {
  id: string | null
  nome: string
  lancou_hoje: boolean
  ativa_semana: boolean
  dias_30d: number
  registros_7d: number
  ultimo: string | null
  servicos: PainelServicoEquipeDto[] | null
}

/** Produção dos últimos 90 dias somada por dia, serviço, equipe e encarregado (mapa de calor). */
export interface PainelProducaoDto {
  desde: string
  dias: { d: string; s: string; e: string | null; n: string | null; q: number }[]
  servicos: Record<
    string,
    { codigo: string | null; descricao: string | null; unidade: string | null }
  >
  equipes: Record<string, string>
  encarregados: Record<string, string>
}

export interface PainelDto {
  versao: string
  gerado_em: string
  hoje: string
  obra: { id: string; codigo: string; nome: string }
  referencia: { nome: string; vigente: boolean } | null
  resumo: {
    avanco: number | null
    esperado: number | null
    registros_hoje: number
    registros_7d: number
    registros_30d: number
    servicos_hoje: number
    servicos_7d: number
    dias_30d: number
    equipes_hoje: number
    equipes_7d: number
    ultimo_lancamento: string | null
  }
  financeiro: {
    contrato: number
    servicos: number
    executado: number
    executado_mes: number
    previsto: number
    servicos_alem_contrato: number
  }
  curva: { s: string; p: number | null; r: number | null }[]
  servicos: PainelServicoDto[]
  equipes: PainelEquipeDto[]
  encarregados: PainelEquipeDto[]
  /** ausente nos retratos guardados antes da 0045 */
  producao?: PainelProducaoDto
  ultimos: {
    data: string
    codigo: string | null
    descricao: string | null
    qtd: number
    unidade: string | null
    equipe: string | null
    encarregado: string | null
    estacas: string | null
    origem: string
    por: string | null
  }[]
}
