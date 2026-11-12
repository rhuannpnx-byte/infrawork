// Hooks de obra_trecho — CRUD direto via supabase-js. RLS controla acesso:
//   god: tudo
//   adm: trechos da propria empresa
//   eng: trechos das obras onde tem permissao
//   apoio: leitura via permissao do engenheiro

import { useMemo } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { fetchCelulasDaVersao } from '@/lib/quantidades/celulas-fetch'
import type { ObraTrecho, UnidadeEspacoPadrao } from '@/types/gerencial'
import type { TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'

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
      const q = supabase
        .from('obra_trecho')
        .select('*')
        .eq('obra_id', obraId!)
        .order('ordem', { ascending: true })
        .order('created_at', { ascending: true })
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
  tipo?: 'eixo' | 'area'
  /** eixo sem KML: estação final em metros internos (obrigatório) */
  comprimento_m?: number | null
  marcador_valor_inicial?: number
  geometry_sentido?: 'natural' | 'invertido'
  cor?: string
  unidade_custom_label?: string | null
  unidade_custom_divisor_m?: number | null
}

export function useCreateTrecho(): ReturnType<
  typeof useMutation<{ id: string }, Error, CreateTrechoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      const { data, error } = await supabase
        .from('obra_trecho')
        .insert({
          obra_id: body.obra_id,
          nome: body.nome.trim(),
          ordem: body.ordem ?? 0,
          unidade_espaco_padrao: body.unidade_espaco_padrao,
          tipo: body.tipo ?? 'eixo',
          comprimento_m: (body.tipo ?? 'eixo') === 'area' ? null : (body.comprimento_m ?? null),
          ...(body.marcador_valor_inicial !== undefined
            ? { marcador_valor_inicial: body.marcador_valor_inicial }
            : {}),
          ...(body.geometry_sentido ? { geometry_sentido: body.geometry_sentido } : {}),
          ...(body.cor ? { cor: body.cor } : {}),
          ...(body.unidade_custom_label !== undefined
            ? { unidade_custom_label: body.unidade_custom_label }
            : {}),
          ...(body.unidade_custom_divisor_m !== undefined
            ? { unidade_custom_divisor_m: body.unidade_custom_divisor_m }
            : {})
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
  tipo?: 'eixo' | 'area'
  comprimento_m?: number | null
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
      const payload: Record<string, unknown> = {}
      if (rest.nome !== undefined) payload.nome = rest.nome.trim()
      if (rest.ordem !== undefined) payload.ordem = rest.ordem
      if (rest.unidade_espaco_padrao !== undefined)
        payload.unidade_espaco_padrao = rest.unidade_espaco_padrao
      if (rest.cor !== undefined) payload.cor = rest.cor
      if (rest.tipo !== undefined) payload.tipo = rest.tipo
      if (rest.comprimento_m !== undefined) payload.comprimento_m = rest.comprimento_m
      if (rest.unidade_custom_label !== undefined)
        payload.unidade_custom_label = rest.unidade_custom_label
      if (rest.unidade_custom_divisor_m !== undefined)
        payload.unidade_custom_divisor_m = rest.unidade_custom_divisor_m
      if (rest.marcador_valor_inicial !== undefined)
        payload.marcador_valor_inicial = rest.marcador_valor_inicial
      if (rest.geometry_geojson !== undefined) payload.geometry_geojson = rest.geometry_geojson
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
export async function fetchTemplateAtual(
  trechoId: string
): Promise<TrechoQuantidadeVersaoCompleta | null> {
  const { data: tpl, error: tErr } = await supabase
    .from('trecho_quantidade_template')
    .select('id, modo')
    .eq('trecho_id', trechoId)
    .maybeSingle()
  if (tErr) throw tErr
  if (!tpl) return null

  const { data: versao, error: vErr } = await supabase
    .from('trecho_quantidade_versao')
    .select('*')
    .eq('template_id', tpl.id)
    .eq('is_atual', true)
    .maybeSingle()
  if (vErr) throw vErr
  if (!versao) return null

  const [colRes, segRes] = await Promise.all([
    supabase
      .from('trecho_quantidade_coluna')
      .select(
        'id, versao_id, item_orcamentario_id, ordem, item:item_orcamentario_id(codigo, descricao, unidade_referencia)'
      )
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

  // Células paginadas (evita o corte de 1000 linhas do PostgREST).
  const celData = await fetchCelulasDaVersao(versao.id)
  const valoresPorSeg = new Map<string, Record<string, number>>()
  for (const c of celData) {
    const r = valoresPorSeg.get(c.segmento_id) ?? {}
    r[c.coluna_id] = Number(c.valor)
    valoresPorSeg.set(c.segmento_id, r)
  }

  const colunas = (colRes.data ?? []).map((c) => {
    const raw = (c as unknown as { item: unknown }).item
    const it = (Array.isArray(raw) ? raw[0] : raw) as {
      codigo: string
      descricao: string
      unidade_referencia: string | null
    } | null
    return {
      id: c.id as string,
      versao_id: c.versao_id as string,
      item_orcamentario_id: c.item_orcamentario_id as string,
      ordem: c.ordem as number,
      codigo: it?.codigo ?? '',
      nome: it ? `${it.codigo} ${it.descricao}` : '?',
      unidade: it?.unidade_referencia ?? ''
    }
  })
  return {
    ...versao,
    modo: tpl.modo,
    colunas,
    segmentos: (segRes.data ?? []).map((sg) => ({
      ...sg,
      posicao_inicio_m: Number(sg.posicao_inicio_m),
      posicao_fim_m: Number(sg.posicao_fim_m),
      valores: valoresPorSeg.get(sg.id) ?? {}
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
  const cacheKey = uniqueIds.map((id, i) => `${id}:${queries[i]?.dataUpdatedAt ?? 0}`).join('|')
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
