// Hooks de obra_trecho — CRUD direto via supabase-js. RLS controla acesso:
//   god: tudo
//   adm: trechos da propria empresa
//   eng: trechos das obras onde tem permissao
//   apoio: leitura via permissao do engenheiro

import { useMemo } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type { ObraTrecho, UnidadeEspacoPadrao } from '@/types/gerencial'
import type { TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

/**
 * Trechos da obra. `incluirSistema` (default false) controla se trecho-sistema
 * (= 'Indireto', is_sistema=true) entra no resultado. Selects de UI normais
 * mantêm default — só componentes que precisam mapear trecho_id da tarefa
 * indireta (ex: Gantt) passam `incluirSistema: true`.
 */
export function useObraTrechos(
  obraId: string | null | undefined,
  opts: { incluirSistema?: boolean } = {}
): ReturnType<typeof useQuery<ObraTrecho[]>> {
  const incluirSistema = opts.incluirSistema ?? false
  return useQuery({
    queryKey: ['planejamento', 'trechos', obraId, incluirSistema],
    enabled: !!obraId,
    queryFn: async (): Promise<ObraTrecho[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      let q = supabase
        .from('obra_trecho')
        .select('*')
        .eq('obra_id', obraId!)
        .order('ordem', { ascending: true })
        .order('created_at', { ascending: true })
      if (!incluirSistema) q = q.eq('is_sistema', false)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as ObraTrecho[]
    }
  })
}

export interface CreateTrechoInput {
  obra_id: string
  nome: string
  ordem?: number
  unidade_espaco_padrao: UnidadeEspacoPadrao
}

export function useCreateTrecho(): ReturnType<
  typeof useMutation<{ id: string }, Error, CreateTrechoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('obra_trecho')
        .insert({
          obra_id: body.obra_id,
          nome: body.nome.trim(),
          ordem: body.ordem ?? 0,
          unidade_espaco_padrao: body.unidade_espaco_padrao
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'trechos', vars.obra_id] })
    }
  })
}

export interface UpdateTrechoInput {
  id: string
  obra_id: string
  nome?: string
  ordem?: number
  unidade_espaco_padrao?: UnidadeEspacoPadrao
  cor?: string
  unidade_custom_label?: string | null
  unidade_custom_divisor_m?: number | null
  marcador_valor_inicial?: number
  geometry_geojson?: GeoJSON.LineString | null
  geometry_bounds?: ObraTrecho['geometry_bounds']
  geometry_comprimento_m?: number | null
  geometry_sentido?: 'natural' | 'invertido'
  geometry_importado_em?: string | null
}

export function useUpdateTrecho(): ReturnType<typeof useMutation<void, Error, UpdateTrechoInput>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, obra_id: _o, ...rest }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const payload: Record<string, unknown> = {}
      if (rest.nome !== undefined) payload.nome = rest.nome.trim()
      if (rest.ordem !== undefined) payload.ordem = rest.ordem
      if (rest.unidade_espaco_padrao !== undefined)
        payload.unidade_espaco_padrao = rest.unidade_espaco_padrao
      if (rest.cor !== undefined) payload.cor = rest.cor
      if (rest.unidade_custom_label !== undefined)
        payload.unidade_custom_label = rest.unidade_custom_label
      if (rest.unidade_custom_divisor_m !== undefined)
        payload.unidade_custom_divisor_m = rest.unidade_custom_divisor_m
      if (rest.marcador_valor_inicial !== undefined)
        payload.marcador_valor_inicial = rest.marcador_valor_inicial
      if (rest.geometry_geojson !== undefined)
        payload.geometry_geojson = rest.geometry_geojson
      if (rest.geometry_bounds !== undefined) payload.geometry_bounds = rest.geometry_bounds
      if (rest.geometry_comprimento_m !== undefined)
        payload.geometry_comprimento_m = rest.geometry_comprimento_m
      if (rest.geometry_sentido !== undefined) payload.geometry_sentido = rest.geometry_sentido
      if (rest.geometry_importado_em !== undefined)
        payload.geometry_importado_em = rest.geometry_importado_em
      if (Object.keys(payload).length === 0) return
      const { error } = await supabase.from('obra_trecho').update(payload).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'trechos', vars.obra_id] })
      // Mudanca de unidade afeta o que vw_planejamento_tarefa_completa retorna
      // (unidade_espaco_efetiva). Invalida tarefas pra refletir.
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas'] })
    }
  })
}

/**
 * Salvar atomicamente todos os campos do wizard de geometria.
 * Apenas composicao em torno de useUpdateTrecho — single UPDATE que abrange
 * todos os campos derivados do KML + escolhas do usuario no wizard.
 */
export type SalvarGeometriaInput = Omit<UpdateTrechoInput, 'nome' | 'ordem'>

export function useSalvarGeometriaTrecho(): ReturnType<
  typeof useMutation<void, Error, SalvarGeometriaInput>
> {
  return useUpdateTrecho()
}

/**
 * Carrega o template de quantidades MARCADO COMO ATUAL de um trecho, completo
 * (com colunas + segmentos + células). Usado pelo Grid do redesign pra
 * resolver qtd_link → valor calculado em tempo real.
 *
 * Retorna NULL se o trecho não tem template ainda (caso comum em obras novas).
 *
 * Espelha a lógica de useVersaoTemplate em [hooks/quantidades.ts] — duplicado
 * aqui pra evitar dependência cruzada entre hooks/quantidades e o Grid (que
 * só precisa do template ativo, não da gestão de versões).
 */
/**
 * Carrega o template+versão atual+colunas+segmentos+células de UM trecho.
 * Extraída do hook pra ser reaproveitada em useQueries (multi-trecho).
 */
async function fetchTemplateAtual(
  trechoId: string
): Promise<TrechoQuantidadeVersaoCompleta | null> {
  if (!SUPABASE_ENABLED || !supabase) notReady()
  // 1) Localiza template do trecho (pode haver vários — pega o mais antigo
  //    como "padrão", ou pode haver nenhum)
  const { data: templates, error: tErr } = await supabase
    .from('trecho_quantidade_template')
    .select('id')
    .eq('trecho_id', trechoId)
    .order('created_at', { ascending: true })
    .limit(1)
  if (tErr) throw tErr
  if (!templates || templates.length === 0) return null

  // 2) Carrega a versão ATUAL
  const { data: versao, error: vErr } = await supabase
    .from('trecho_quantidade_versao')
    .select('*')
    .eq('template_id', templates[0].id)
    .eq('is_atual', true)
    .maybeSingle()
  if (vErr) throw vErr
  if (!versao) return null

  // 3) Carrega colunas + segmentos em paralelo
  const [colRes, segRes] = await Promise.all([
    supabase
      .from('trecho_quantidade_coluna')
      .select('*')
      .eq('versao_id', versao.id)
      .order('ordem'),
    supabase
      .from('trecho_quantidade_segmento')
      .select('*')
      .eq('versao_id', versao.id)
      .order('ordem')
  ])
  if (colRes.error) throw colRes.error
  if (segRes.error) throw segRes.error

  const segmentoIds = (segRes.data ?? []).map((s) => s.id)
  // Busca células em LOTES: um `.in('segmento_id', [...])` com todos os ids vira
  // querystring gigante (trecho longo em estaca = centenas de segmentos) e a
  // requisição estoura o limite de URL do PostgREST/gateway, derrubando o fetch
  // inteiro (sintoma: "trecho sem template" em trechos longos). Chunk evita isso.
  const CHUNK_SEG = 100
  const celData: Array<{ segmento_id: string; coluna_id: string; valor: number }> = []
  for (let i = 0; i < segmentoIds.length; i += CHUNK_SEG) {
    const ids = segmentoIds.slice(i, i + CHUNK_SEG)
    const { data, error } = await supabase
      .from('trecho_quantidade_celula')
      .select('segmento_id, coluna_id, valor')
      .in('segmento_id', ids)
    if (error) throw error
    if (data) celData.push(...data)
  }

  const valoresPorSeg = new Map<string, Record<string, number>>()
  for (const c of celData) {
    const r = valoresPorSeg.get(c.segmento_id) ?? {}
    r[c.coluna_id] = Number(c.valor)
    valoresPorSeg.set(c.segmento_id, r)
  }

  return {
    ...versao,
    colunas: colRes.data ?? [],
    segmentos: (segRes.data ?? []).map((s) => ({
      ...s,
      posicao_inicio_m: Number(s.posicao_inicio_m),
      posicao_fim_m: Number(s.posicao_fim_m),
      valores: valoresPorSeg.get(s.id) ?? {}
    }))
  } as TrechoQuantidadeVersaoCompleta
}

export function useTrechoQuantidadeTemplateAtual(
  trechoId: string | null | undefined
): ReturnType<typeof useQuery<TrechoQuantidadeVersaoCompleta | null>> {
  return useQuery({
    queryKey: ['quantidades', 'template-atual', trechoId],
    enabled: !!trechoId,
    queryFn: () => fetchTemplateAtual(trechoId!)
  })
}

/**
 * Carrega os templates atuais de N trechos em paralelo (via useQueries). Retorna
 * um Map<trechoId, template | null>. Usado no cronograma quando há tarefas
 * vinculadas em vários trechos diferentes — precisamos do template de cada um
 * pra computar qtd_alocada via computeLinkedQtd.
 *
 * Trechos sem template ou ainda carregando aparecem como NULL no Map.
 */
export function useTrechosQuantidadeTemplatesAtuais(
  trechoIds: string[]
): Map<string, TrechoQuantidadeVersaoCompleta | null> {
  // Dedup + sort pra estabilizar a queryKey entre renders.
  const uniqueIds = useMemo(
    () => Array.from(new Set(trechoIds.filter((id): id is string => !!id))).sort(),
    [trechoIds]
  )
  const queries = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: ['quantidades', 'template-atual', id] as const,
      queryFn: () => fetchTemplateAtual(id)
    }))
  })
  // Chave string estável: muda quando algum trecho entra/sai ou quando algum
  // template termina de carregar (dataUpdatedAt aumenta). Substitui o array
  // de deps de tamanho variável, que violava regra dos hooks do React e
  // crashava a tela ao alterar quais trechos têm tarefas com qtd_link.
  const cacheKey = uniqueIds
    .map((id, i) => `${id}:${queries[i]?.dataUpdatedAt ?? 0}`)
    .join('|')
  return useMemo(() => {
    const m = new Map<string, TrechoQuantidadeVersaoCompleta | null>()
    uniqueIds.forEach((id, idx) => {
      m.set(id, queries[idx]?.data ?? null)
    })
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey])
}

export function useDeleteTrecho(): ReturnType<
  typeof useMutation<void, Error, { id: string; obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      // FK ON DELETE RESTRICT — se houver tarefas referenciando, falha com
      // 23503. Mensagem traduzida pra UX em chamadores.
      const { error } = await supabase.from('obra_trecho').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'trechos', vars.obra_id] })
    }
  })
}
