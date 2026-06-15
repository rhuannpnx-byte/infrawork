// Wrappers tipados sobre as Edge Functions do InfraWork.
// Todas as chamadas anexam o Bearer JWT da sessão corrente do Supabase.

import { supabase } from './client'

async function authHeader(): Promise<HeadersInit> {
  if (!supabase) throw new Error('Supabase desativado')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sem sessão ativa')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
}

interface CallInit {
  method?: string
  headers?: HeadersInit
  body?: object
}

async function call<T>(path: string, init: CallInit = {}): Promise<T> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL
  const headers = await authHeader()
  const r = await fetch(`${baseUrl}/functions/v1/${path}`, {
    method: init.method ?? 'POST',
    headers: { ...headers, ...(init.headers ?? {}) },
    body: init.body ? JSON.stringify(init.body) : null
  })
  const text = await r.text()
  const parsed = text ? JSON.parse(text) : null
  if (!r.ok) {
    const body = parsed as { error?: string; detalhe?: string } | null
    const msg = body?.error ?? r.statusText
    // Inclui `detalhe` (mensagem original do banco / fonte da falha) quando
    // disponível — sem isso o usuário vê só o wrapper genérico.
    const det = body?.detalhe && body.detalhe !== msg ? ` (${body.detalhe})` : ''
    throw new Error(`${path}: ${msg}${det}`)
  }
  return parsed as T
}

// ─── Endpoints ───────────────────────────────────────────────────────────

export const adminApi = {
  createEmpresa: (body: { nome: string; cnpj?: string }) =>
    call<{ id: string; nome: string; cnpj: string | null }>('create-empresa', {
      method: 'POST',
      body
    }),

  createUsuario: (body: {
    email: string
    nome: string
    role: 'god' | 'adm' | 'engenheiro' | 'apoio' | 'cliente'
    empresa_id?: string | null
    engenheiro_id?: string | null
    password?: string
  }) =>
    call<{ id: string; email: string; role: string }>('create-usuario', { method: 'POST', body }),

  createObra: (body: {
    nome: string
    codigo: string
    status?: string
    empresa_id?: string
    /** Unidade do primeiro trecho 'Principal' criado junto com a obra. Default 'km'. */
    unidade_espaco_padrao?: 'km' | 'm' | 'estaca'
  }) =>
    call<{ id: string; nome: string; codigo: string }>('create-obra', { method: 'POST', body }),

  grantObraPermissao: (body: { obra_id: string; user_id: string }) =>
    call<{ id: string; obra_id: string; user_id: string }>('grant-obra-permissao', {
      method: 'POST',
      body
    }),

  revokeObraPermissao: (body: { obra_id: string; user_id: string }) =>
    call<{ revoked: { id: string; obra_id: string; user_id: string } }>('revoke-obra-permissao', {
      method: 'POST',
      body
    }),

  // ─── Orçamento Fase 2 ─────────────────────────────────────────────────
  recalcularOrcamento: (body: { obra_id: string }) =>
    call<{
      ok: boolean
      itens_atualizados: number
      custo_total: number
      venda_total: number
      lucratividade_global: number | null
      duracao_ms: number
    }>('recalcular-orcamento', { method: 'POST', body }),

  snapshotCpuNoItem: (body: { item_id: string; cpu_id?: string; force?: boolean }) =>
    call<{ snapshot_id: string; custo_unit: number; criado: boolean }>('snapshot-cpu-no-item', {
      method: 'POST',
      body
    }),

  atualizarItensParaCpuVigente: (body: { obra_id: string; servico_ids?: string[] }) =>
    call<{
      atualizados: number
      custo_total_anterior: number
      custo_total_novo: number
      diff_perc: number
    }>('atualizar-itens-para-cpu-vigente', { method: 'POST', body }),

  // ─── Orçamento Fase 3 ─────────────────────────────────────────────────
  criarRevisaoOrcamento: (body: { obra_id: string; rotulo?: string; observacao?: string }) =>
    call<{
      id: string
      versao: number
      status: string
      custo_total: number
      venda_total: number
      lucratividade_perc: number | null
      criada_em: string
    }>('criar-revisao-orcamento', { method: 'POST', body }),

  copiarRevisaoOrcamento: (body: {
    obra_id: string
    origem_revisao_id: string | null
    rotulo?: string
    observacao?: string
    copiar?: {
      planilha?: 'tudo' | string[] | null
      indireto?: 'tudo' | string[] | null
      recursos?: 'tudo' | string[] | null
      cpus?: 'tudo' | string[] | null
    }
  }) =>
    call<{
      ok: boolean
      obra_id: string
      snapshot_preservacao_id: string | null
      itens_copiados: number
      indiretos_copiados: number
      cpus_preservadas: boolean
      recursos_preservados: boolean
      rotulo: string | null
    }>('copiar-revisao-orcamento', { method: 'POST', body }),

  transicionarStatusRevisao: (body: {
    revisao_id: string
    novo_status: 'rascunho' | 'em_revisao' | 'aprovada' | 'homologada' | 'cancelada'
  }) =>
    call<{
      id: string
      status: string
      aprovada_em: string | null
      homologada_em: string | null
      cancelada_em: string | null
    }>('transicionar-status-revisao', { method: 'POST', body }),

  // ─── Orçamento Fase 4 — Importação (3 wizards independentes) ──────────
  importCpuAplicar: (body: {
    obra_id: string
    cpus: {
      aba_nome: string
      servico_nome: string
      servico_unidade: string | null
      producao_diaria_qtde: number
      producao_diaria_unidade: string
      itens: {
        grupo: 'EQUIPAMENTO' | 'COMBUSTIVEL' | 'MO' | 'MATERIAL'
        row_origem: number
        recurso_nome: string
        recurso_unidade: string | null
        quantidade: number | null
        horas_dia: number | null
        consumo_combustivel_lh: number | null
        indice_produtividade: number | null
        consumo_material_por_unid: number | null
      }[]
      incompleta: boolean
      warnings: string[]
    }[]
    recursos_catalogo?: {
      grupo: 'MO' | 'MVE' | 'COMBUSTIVEL' | 'MATERIAL' | 'ADM'
      nome: string
      unidade: string | null
      custo_unitario: number | null
    }[]
  }) =>
    call<{
      ok: boolean
      stats: {
        cpus_criadas: number
        cpus_puladas: number
        servicos_criados: number
        servicos_reutilizados: number
        recursos_criados: number
        recursos_reutilizados: number
        precos_criados: number
        cpu_items_criados: number
      }
      warnings: string[]
      erros: string[]
      duracao_ms: number
    }>('import-cpu-aplicar', { method: 'POST', body }),

  importIndiretoAplicar: (body: {
    obra_id: string
    descricao?: string
    valor_mensal: number
    meses: number
  }) =>
    call<{
      ok: boolean
      item: { id: string; codigo: string; descricao: string; valor_total: number }
      valor_mensal: number
      meses: number
      valor_total: number
      duracao_ms: number
    }>('import-indireto-aplicar', { method: 'POST', body }),

  importPlanOrcAplicar: (body: {
    obra_id: string
    itens: {
      idx: number
      codigo: string
      descricao: string
      unidade: string | null
      quantidade: number | null
      venda_unitaria: number | null
      is_folha: boolean
    }[]
  }) =>
    call<{
      ok: boolean
      stats: { criados: number; pulados: number }
      erros: string[]
      duracao_ms: number
    }>('import-plan-orc-aplicar', { method: 'POST', body }),

  // ─── Planejamento (Fase P1) ───────────────────────────────────────────
  calcularCronograma: (body: { planejamento_id: string; force?: boolean }) =>
    call<{
      ok: boolean
      tarefas_recalculadas: number
      data_inicio: string
      data_fim: string
      duracao_total_dias_uteis: number
      duracao_total_dias_corridos: number
      caminho_critico_ids: string[]
      warning_drift?: boolean
      duracao_ms: number
    }>('calcular-cronograma', { method: 'POST', body }),

  promoverBaseline: (body: { planejamento_id: string }) =>
    call<{ ok: boolean; baseline_id: string; snapshot_id: string }>('promover-baseline', {
      method: 'POST',
      body
    }),

  copiarPlanejamento: (body: {
    origem_id: string
    nome_novo: string
    ajuste_data_inicio?: string
  }) =>
    call<{
      ok: boolean
      novo_id: string
      tarefas_copiadas: number
      dependencias_copiadas: number
    }>('copiar-planejamento', { method: 'POST', body }),

  // ─── Acompanhamento (Fase A) ──────────────────────────────────────────
  acompanhamentoListarProjetosSiga: () =>
    call<{
      ok: boolean
      projetos: Array<{ id: number; codigo: string; nome: string }>
      schema_detectado?: unknown
    }>('acompanhamento-listar-projetos-siga', { method: 'POST', body: {} }),

  acompanhamentoSync: (body: { obra_id?: string; force_full?: boolean }) =>
    call<{
      ok: boolean
      sincronizados: Array<{
        obra_id: string
        siga_projeto_id: number
        stats?: {
          producao_inseridas?: number
          producao_atualizadas?: number
          fotos_inseridas?: number
          fotos_atualizadas?: number
        }
        warnings?: string[]
        erro?: string
      }>
      duracao_ms: number
    }>('acompanhamento-sync', { method: 'POST', body }),

  acompanhamentoFotoSignedUrl: (body: { foto_id: string }) =>
    call<{ url: string; expires_at: string }>('acompanhamento-foto-signed-url', {
      method: 'POST',
      body
    }),

  // ─── Acompanhamento (Fase B+) ─────────────────────────────────────────
  acompanhamentoMatchingSugerir: (body: { obra_id: string }) =>
    call<import('@renderer/types/acompanhamento').MatchingSugestoesResposta>(
      'acompanhamento-matching-sugerir',
      { method: 'POST', body }
    ),

  acompanhamentoMatchingConfirmar: (body: {
    obra_id: string
    matches: Array<
      | { tipo: 'equipe'; siga_nome: string; equipe_id: string | null; confianca?: number }
      | {
          tipo: 'encarregado'
          siga_nome: string
          apelido_canonico?: string
          equipe_match_id?: string | null
          confianca?: number
        }
      | {
          tipo: 'servico'
          siga_id: number
          siga_nome?: string
          servico_id: string | null
          item_orcamentario_id?: string | null
          confianca?: number
          fator_conversao?: number
          siga_unidade_id?: number | null
          siga_unidade_nome?: string | null
        }
    >
    origem?: 'auto' | 'manual'
  }) =>
    call<{
      ok: boolean
      gravados: { equipes?: number; encarregados?: number; servicos?: number }
      erros?: string[]
    }>('acompanhamento-matching-confirmar', { method: 'POST', body }),

  acompanhamentoAlertasRecalcular: (body: { obra_id?: string }) =>
    call<{
      ok: boolean
      resultados: Array<{
        obra_id: string
        inseridos: number
        resolvidos: number
        total: number
        erros: string[]
      }>
      duracao_ms: number
    }>('acompanhamento-alertas-recalcular', { method: 'POST', body }),

  acompanhamentoFotosListar: (body: {
    obra_id: string
    filtros?: import('@renderer/types/acompanhamento').FotosListarFiltros
    page?: number
    page_size?: number
    with_urls?: boolean
    url_transform?: { width?: number; height?: number; quality?: number; resize?: 'cover' | 'contain' | 'fill' }
  }) =>
    call<import('@renderer/types/acompanhamento').FotosListarResposta>(
      'acompanhamento-fotos-listar',
      { method: 'POST', body }
    ),

  acompanhamentoFotoSignedUrlsBatch: (body: {
    foto_ids: string[]
    transform?: { width?: number; height?: number; quality?: number; resize?: 'cover' | 'contain' | 'fill' }
  }) =>
    call<{
      ok: boolean
      urls: import('@renderer/types/acompanhamento').FotoSignedUrl[]
      ttl_seconds: number
    }>('acompanhamento-foto-signed-urls-batch', { method: 'POST', body }),

  acompanhamentoFotoDelete: (body: { foto_ids: string[] }) =>
    call<{
      ok: boolean
      removidas: number
      ja_excluidas: number
      warnings?: string[]
    }>('acompanhamento-foto-delete', { method: 'POST', body }),

  acompanhamentoDashboardResumo: (body: { obra_id: string; periodo_dias?: number }) =>
    call<import('@renderer/types/acompanhamento').DashboardResumoResposta>(
      'acompanhamento-dashboard-resumo',
      { method: 'POST', body }
    )
}
