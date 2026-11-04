// Wrappers tipados sobre as Edge Functions.
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
    role: 'god' | 'adm' | 'engenheiro' | 'apoio' | 'cliente' | 'apontador'
    empresa_id?: string | null
    engenheiro_id?: string | null
    whatsapp?: string | null
    password?: string
  }) =>
    call<{ id: string; email: string; role: string }>('create-usuario', { method: 'POST', body }),

  updateUsuario: (body: {
    id: string
    nome?: string
    whatsapp?: string | null
    role?: 'god' | 'adm' | 'engenheiro' | 'apoio' | 'cliente' | 'apontador'
    empresa_id?: string | null
    engenheiro_id?: string | null
    ativo?: boolean
    /** nova senha (≥ 10) — redefinição pelo administrador */
    senha?: string
  }) =>
    call<{
      id: string
      email: string
      nome: string
      role: string
      empresa_id: string | null
      engenheiro_id: string | null
      ativo: boolean
      whatsapp: string | null
      created_at: string
    }>('update-usuario', { method: 'POST', body }),

  deleteUsuario: (body: { id: string }) =>
    call<{ ok: boolean; deleted: { id: string; nome: string } }>('delete-usuario', {
      method: 'POST',
      body
    }),

  createObra: (body: {
    nome: string
    codigo: string
    status?: string
    empresa_id?: string
    /** Unidade do primeiro trecho 'Principal' criado junto com a obra. Default 'km'. */
    unidade_espaco_padrao?: 'km' | 'm' | 'estaca'
  }) => call<{ id: string; nome: string; codigo: string }>('create-obra', { method: 'POST', body }),

  setObraAtiva: (body: { obra_id: string; ativa: boolean }) =>
    call<{ ok: boolean; obra_id: string; ativa: boolean; codigo: string }>('set-obra-ativa', {
      method: 'POST',
      body
    }),

  deleteObra: (body: { obra_id: string }) =>
    call<{ ok: boolean; deleted: { id: string; nome: string; codigo: string } }>('delete-obra', {
      method: 'POST',
      body
    }),

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

  // ─── Importação pelo modelo padrão (planilha orçamentária) ────────────
  importOrcamento: (body: {
    obra_id: string
    itens: Record<string, unknown>[]
    alocacoes?: Record<string, unknown>[]
    servicos?: Record<string, unknown>[]
    opcoes?: { existentes?: 'pular' | 'atualizar'; tudo_ou_nada?: boolean }
  }) =>
    call<{
      ok: boolean
      stats: Record<string, number>
      avisos: string[]
      erros: string[]
      duracao_ms: number
    }>('import-orcamento', { method: 'POST', body }),

  // ─── Acompanhamento (Fase A) ──────────────────────────────────────────
  acompanhamentoFotoSignedUrl: (body: { foto_id: string }) =>
    call<{ url: string; expires_at: string }>('acompanhamento-foto-signed-url', {
      method: 'POST',
      body
    }),

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
    url_transform?: {
      width?: number
      height?: number
      quality?: number
      resize?: 'cover' | 'contain' | 'fill'
    }
  }) =>
    call<import('@renderer/types/acompanhamento').FotosListarResposta>(
      'acompanhamento-fotos-listar',
      { method: 'POST', body }
    ),

  acompanhamentoFotoSignedUrlsBatch: (body: {
    foto_ids: string[]
    transform?: {
      width?: number
      height?: number
      quality?: number
      resize?: 'cover' | 'contain' | 'fill'
    }
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
