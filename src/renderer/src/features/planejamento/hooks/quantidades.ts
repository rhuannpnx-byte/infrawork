// Hooks de templates de quantidades versionadas por trecho.
//
// Leitura via supabase-js direto (RLS controla acesso). Escrita também direto —
// transações manuais (cliente sequencia INSERTs com rollback DELETE em caso de
// erro). Sem edge function (não precisa de auth privilegiada).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type {
  ModoQuantidade,
  TrechoQuantidadeTemplate,
  TrechoQuantidadeTemplateResumo,
  TrechoQuantidadeVersao,
  TrechoQuantidadeVersaoCompleta
} from '@/types/quantidades'
import type { ObraTrecho } from '@/types/gerencial'
import { gerarGradeAnalitica, type TrechoUnidadeConfig } from '@/lib/quantidades/grade'
import { gerarTemplateExcel } from '@/lib/quantidades/excel-template'
import { parseExcelQuantidades, type ParseExcelResult } from '@/lib/quantidades/excel-parse'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

// ─── Leitura ────────────────────────────────────────────────────────────

/**
 * Lista templates de um trecho com dados resumidos da versão atual.
 * Faz 2 queries em paralelo: templates + agregados de versão atual.
 */
export function useTemplatesQuantidade(
  trechoId: string | null | undefined
): ReturnType<typeof useQuery<TrechoQuantidadeTemplateResumo[]>> {
  return useQuery({
    queryKey: ['quantidades', 'templates', trechoId],
    enabled: !!trechoId,
    queryFn: async (): Promise<TrechoQuantidadeTemplateResumo[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data: templates, error } = await supabase
        .from('trecho_quantidade_template')
        .select('*')
        .eq('trecho_id', trechoId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      if (!templates || templates.length === 0) return []

      const ids = templates.map((t) => t.id)
      const { data: versoes, error: vErr } = await supabase
        .from('trecho_quantidade_versao')
        .select('id, template_id, numero, is_atual, comentario, created_at')
        .in('template_id', ids)
      if (vErr) throw vErr

      // Counts: colunas + segmentos por versão atual (1 query cada).
      const atuaisIds = (versoes ?? []).filter((v) => v.is_atual).map((v) => v.id)
      const [{ data: colCounts }, { data: segCounts }] = await Promise.all([
        atuaisIds.length === 0
          ? Promise.resolve({ data: [] })
          : supabase
              .from('trecho_quantidade_coluna')
              .select('versao_id')
              .in('versao_id', atuaisIds),
        atuaisIds.length === 0
          ? Promise.resolve({ data: [] })
          : supabase
              .from('trecho_quantidade_segmento')
              .select('versao_id')
              .in('versao_id', atuaisIds)
      ])
      const countByVersao = (rows: Array<{ versao_id: string }> | null): Map<string, number> => {
        const m = new Map<string, number>()
        for (const r of rows ?? []) m.set(r.versao_id, (m.get(r.versao_id) ?? 0) + 1)
        return m
      }
      const colMap = countByVersao(colCounts as Array<{ versao_id: string }> | null)
      const segMap = countByVersao(segCounts as Array<{ versao_id: string }> | null)

      return (templates as TrechoQuantidadeTemplate[]).map((t) => {
        const vs = (versoes ?? []).filter((v) => v.template_id === t.id)
        const atual = vs.find((v) => v.is_atual) ?? null
        return {
          ...t,
          total_versoes: vs.length,
          versao_atual: atual
            ? {
                id: atual.id,
                numero: atual.numero,
                comentario: atual.comentario,
                created_at: atual.created_at,
                total_colunas: colMap.get(atual.id) ?? 0,
                total_segmentos: segMap.get(atual.id) ?? 0
              }
            : null
        }
      })
    }
  })
}

/** Histórico: todas as versões de um template, ordem desc por número. */
export function useVersoesTemplate(
  templateId: string | null | undefined
): ReturnType<typeof useQuery<TrechoQuantidadeVersao[]>> {
  return useQuery({
    queryKey: ['quantidades', 'versoes', templateId],
    enabled: !!templateId,
    queryFn: async (): Promise<TrechoQuantidadeVersao[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('trecho_quantidade_versao')
        .select('*')
        .eq('template_id', templateId!)
        .order('numero', { ascending: false })
      if (error) throw error
      return (data ?? []) as TrechoQuantidadeVersao[]
    }
  })
}

/** Versão completa: dados + colunas + segmentos + células agregadas. */
export function useVersaoTemplate(
  versaoId: string | null | undefined
): ReturnType<typeof useQuery<TrechoQuantidadeVersaoCompleta | null>> {
  return useQuery({
    queryKey: ['quantidades', 'versao', versaoId],
    enabled: !!versaoId,
    queryFn: async (): Promise<TrechoQuantidadeVersaoCompleta | null> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data: versao, error: vErr } = await supabase
        .from('trecho_quantidade_versao')
        .select('*')
        .eq('id', versaoId!)
        .maybeSingle()
      if (vErr) throw vErr
      if (!versao) return null

      const [colRes, segRes] = await Promise.all([
        supabase
          .from('trecho_quantidade_coluna')
          .select('*')
          .eq('versao_id', versaoId!)
          .order('ordem'),
        supabase
          .from('trecho_quantidade_segmento')
          .select('*')
          .eq('versao_id', versaoId!)
          .order('ordem')
      ])
      if (colRes.error) throw colRes.error
      if (segRes.error) throw segRes.error

      // Chunked SELECT: .in('id', [...]) estoura limite de URL do PostgREST
      // (~2000 IDs no Supabase). Pra versões grandes (modo simplificado em
      // metros: 1 seg por metro) o número de segmentos pode passar de 5k.
      const segmentoIds = (segRes.data ?? []).map((s) => s.id as string)
      const CHUNK = 500
      const celulasData: Array<{ segmento_id: string; coluna_id: string; valor: number }> = []
      for (let i = 0; i < segmentoIds.length; i += CHUNK) {
        const idsSlice = segmentoIds.slice(i, i + CHUNK)
        const { data, error } = await supabase
          .from('trecho_quantidade_celula')
          .select('segmento_id, coluna_id, valor')
          .in('segmento_id', idsSlice)
        if (error) throw error
        if (data) {
          for (const c of data) {
            celulasData.push(c as { segmento_id: string; coluna_id: string; valor: number })
          }
        }
      }

      const valoresPorSeg = new Map<string, Record<string, number>>()
      for (const c of celulasData) {
        const r = valoresPorSeg.get(c.segmento_id) ?? {}
        r[c.coluna_id] = Number(c.valor)
        valoresPorSeg.set(c.segmento_id, r)
      }

      return {
        ...(versao as TrechoQuantidadeVersao),
        colunas: colRes.data ?? [],
        segmentos: (segRes.data ?? []).map((s) => ({
          ...s,
          posicao_inicio_m: Number(s.posicao_inicio_m),
          posicao_fim_m: Number(s.posicao_fim_m),
          valores: valoresPorSeg.get(s.id) ?? {}
        }))
      } as TrechoQuantidadeVersaoCompleta
    }
  })
}

/**
 * Lista os `item_orcamentario` da obra com `tipo='servico_grupo'` — os
 * agrupadores da planilha orçamentária que são elegíveis pro cronograma.
 * Usado pelo botão "Carregar defaults" do ConfigTemplateQuantidadeDialog
 * pra pré-popular as colunas com nome + unidade vindos do orçamento.
 */
export interface AgrupadorOrcamentario {
  id: string
  codigo: string
  descricao: string
  unidade: string
}

export function useAgrupadoresOrcamento(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<AgrupadorOrcamentario[]>> {
  return useQuery({
    queryKey: ['quantidades', 'agrupadores-orcamento', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<AgrupadorOrcamentario[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('item_orcamentario')
        .select('id, codigo, descricao, unidade_referencia')
        .eq('obra_id', obraId!)
        .eq('tipo', 'servico_grupo')
        .order('codigo')
      if (error) throw error
      return (data ?? []).map((r) => ({
        id: r.id as string,
        codigo: r.codigo as string,
        descricao: r.descricao as string,
        unidade: (r.unidade_referencia as string | null) ?? ''
      }))
    }
  })
}

// ─── Escrita ────────────────────────────────────────────────────────────

export interface CriarTemplateInput {
  trecho_id: string
  nome: string
  modo: ModoQuantidade
  colunas: Array<{ nome: string; unidade: string }>
}

/**
 * Cria template + versão v1 (is_atual=true) + colunas iniciais.
 * Atomic via try/catch + rollback DELETE no template (cascade limpa o resto).
 */
export function useCriarTemplateQuantidade(): ReturnType<
  typeof useMutation<{ template_id: string; versao_id: string }, Error, CriarTemplateInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data: tpl, error: tErr } = await supabase
        .from('trecho_quantidade_template')
        .insert({ trecho_id: body.trecho_id, nome: body.nome.trim(), modo: body.modo })
        .select('id')
        .single()
      if (tErr) throw tErr

      try {
        const { data: ver, error: vErr } = await supabase
          .from('trecho_quantidade_versao')
          .insert({ template_id: tpl.id, is_atual: true, comentario: 'Versão inicial' })
          .select('id')
          .single()
        if (vErr) throw vErr

        if (body.colunas.length > 0) {
          const colPayload = body.colunas.map((c, idx) => ({
            versao_id: ver.id,
            nome: c.nome.trim(),
            unidade: c.unidade.trim(),
            ordem: idx
          }))
          const { error: cErr } = await supabase.from('trecho_quantidade_coluna').insert(colPayload)
          if (cErr) throw cErr
        }
        return { template_id: tpl.id, versao_id: ver.id }
      } catch (e) {
        await supabase.from('trecho_quantidade_template').delete().eq('id', tpl.id)
        throw e
      }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['quantidades', 'templates', vars.trecho_id] })
      void qc.invalidateQueries({ queryKey: ['quantidades', 'template-atual', vars.trecho_id] })
    }
  })
}

export function useDeletarTemplateQuantidade(): ReturnType<
  typeof useMutation<void, Error, { template_id: string; trecho_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ template_id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('trecho_quantidade_template')
        .delete()
        .eq('id', template_id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['quantidades', 'templates', vars.trecho_id] })
      void qc.invalidateQueries({ queryKey: ['quantidades', 'template-atual', vars.trecho_id] })
    }
  })
}

/**
 * Cria nova versão clonando da versão atual (colunas + segmentos + células).
 * Promove a nova automaticamente (trigger desmarca a anterior). Usado pelo
 * fluxo "Restaurar versão antiga" (passa versao_id de origem) ou "Nova versão
 * vazia" (clona da atual sem mudar nada).
 */
export interface NovaVersaoInput {
  template_id: string
  /** Versão de origem pra clonar. Default: versão is_atual do template. */
  origem_versao_id?: string
  comentario?: string
}

export function useNovaVersao(): ReturnType<
  typeof useMutation<{ versao_id: string }, Error, NovaVersaoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      // 1) Resolve versão origem
      let origemId = body.origem_versao_id
      if (!origemId) {
        const { data: atual, error: aErr } = await supabase
          .from('trecho_quantidade_versao')
          .select('id')
          .eq('template_id', body.template_id)
          .eq('is_atual', true)
          .maybeSingle()
        if (aErr) throw aErr
        if (!atual) throw new Error('Template não tem versão atual pra clonar.')
        origemId = atual.id
      }

      // 2) Carrega tudo da versão origem
      const [colRes, segRes] = await Promise.all([
        supabase.from('trecho_quantidade_coluna').select('*').eq('versao_id', origemId),
        supabase.from('trecho_quantidade_segmento').select('*').eq('versao_id', origemId)
      ])
      if (colRes.error) throw colRes.error
      if (segRes.error) throw segRes.error

      const segIdsOrigem = (segRes.data ?? []).map((s) => s.id as string)
      const CHUNK_SEL = 500
      type CelulaRow = { segmento_id: string; coluna_id: string; valor: number }
      const celDataOrigem: CelulaRow[] = []
      for (let i = 0; i < segIdsOrigem.length; i += CHUNK_SEL) {
        const idsSlice = segIdsOrigem.slice(i, i + CHUNK_SEL)
        const { data, error } = await supabase
          .from('trecho_quantidade_celula')
          .select('*')
          .in('segmento_id', idsSlice)
        if (error) throw error
        if (data) for (const r of data) celDataOrigem.push(r as CelulaRow)
      }
      const celRes = { data: celDataOrigem, error: null as null }

      // 3) Cria nova versão. Trigger promote desmarca a anterior; trigger
      //    numero_auto define numero. is_atual=true por default.
      const { data: nova, error: nErr } = await supabase
        .from('trecho_quantidade_versao')
        .insert({
          template_id: body.template_id,
          is_atual: true,
          comentario: body.comentario?.trim() || null
        })
        .select('id')
        .single()
      if (nErr) throw nErr

      try {
        // 4) Clona colunas com novos IDs e mapa antigo→novo
        const mapaColunas = new Map<string, string>()
        if ((colRes.data ?? []).length > 0) {
          const novasCols = (colRes.data ?? []).map((c) => ({
            id: crypto.randomUUID(),
            versao_id: nova.id,
            nome: c.nome,
            unidade: c.unidade,
            ordem: c.ordem
          }))
          for (let i = 0; i < (colRes.data ?? []).length; i++) {
            mapaColunas.set(colRes.data![i].id, novasCols[i].id)
          }
          const { error: cErr } = await supabase.from('trecho_quantidade_coluna').insert(novasCols)
          if (cErr) throw cErr
        }

        // 5) Clona segmentos com novos IDs e mapa antigo→novo
        const mapaSegmentos = new Map<string, string>()
        if ((segRes.data ?? []).length > 0) {
          const novosSegs = (segRes.data ?? []).map((s) => ({
            id: crypto.randomUUID(),
            versao_id: nova.id,
            ordem: s.ordem,
            posicao_inicio_m: s.posicao_inicio_m,
            posicao_fim_m: s.posicao_fim_m,
            unidade_inicio_label: s.unidade_inicio_label,
            unidade_fim_label: s.unidade_fim_label
          }))
          for (let i = 0; i < (segRes.data ?? []).length; i++) {
            mapaSegmentos.set(segRes.data![i].id, novosSegs[i].id)
          }
          const { error: sErr } = await supabase
            .from('trecho_quantidade_segmento')
            .insert(novosSegs)
          if (sErr) throw sErr
        }

        // 6) Clona células remapeando segmento_id + coluna_id
        if ((celRes.data ?? []).length > 0) {
          const novasCels = (celRes.data ?? [])
            .map((c) => {
              const segNovo = mapaSegmentos.get(c.segmento_id)
              const colNovo = mapaColunas.get(c.coluna_id)
              if (!segNovo || !colNovo) return null
              return { segmento_id: segNovo, coluna_id: colNovo, valor: c.valor }
            })
            .filter((x): x is NonNullable<typeof x> => x !== null)
          // Chunked insert pra não estourar limite de payload
          const CHUNK = 500
          for (let i = 0; i < novasCels.length; i += CHUNK) {
            const { error: ceErr } = await supabase
              .from('trecho_quantidade_celula')
              .insert(novasCels.slice(i, i + CHUNK))
            if (ceErr) throw ceErr
          }
        }
        return { versao_id: nova.id }
      } catch (e) {
        // Rollback: cascade limpa colunas/segmentos/células
        await supabase.from('trecho_quantidade_versao').delete().eq('id', nova.id)
        throw e
      }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['quantidades', 'versoes', vars.template_id] })
      void qc.invalidateQueries({ queryKey: ['quantidades', 'templates'] })
      void qc.invalidateQueries({ queryKey: ['quantidades', 'template-atual'] })
    }
  })
}

/**
 * Edita SÓ o comentário da versão atual (única que aceita UPDATE por design).
 * Trigger de imutabilidade bloqueia versões não-atuais.
 */
export function useEditarComentarioVersaoAtual(): ReturnType<
  typeof useMutation<
    void,
    Error,
    { versao_id: string; template_id: string; comentario: string | null }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ versao_id, comentario }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('trecho_quantidade_versao')
        .update({ comentario: comentario?.trim() || null })
        .eq('id', versao_id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['quantidades', 'versoes', vars.template_id] })
      void qc.invalidateQueries({ queryKey: ['quantidades', 'versao', vars.versao_id] })
      void qc.invalidateQueries({ queryKey: ['quantidades', 'template-atual'] })
    }
  })
}

/**
 * Edita colunas da versão atual (SO atual). Sync incremental por id:
 *   - DELETE só colunas cujo id não veio mais na lista (cascade limpa células delas)
 *   - UPDATE colunas com id que continuam na lista (nome/unidade/ordem)
 *   - INSERT colunas sem id (novas)
 *
 * Preserva células das colunas mantidas — só perde dados das colunas removidas.
 */
export interface EditarColunasInput {
  versao_id: string
  template_id: string
  colunas: Array<{ id?: string; nome: string; unidade: string }>
}

// ─── Download Excel ─────────────────────────────────────────────────────

export interface BaixarExcelInput {
  versao_id: string
  trecho: ObraTrecho
  empresaNome: string
  obraCodigo: string
  obraNome: string
}

/**
 * Gera Excel da versão e dispara download. Caller só precisa passar o
 * versao_id + dados de contexto (empresa/obra/trecho).
 */
export function useBaixarExcelVersao(): ReturnType<
  typeof useMutation<{ filename: string }, Error, BaixarExcelInput>
> {
  return useMutation({
    mutationFn: async ({ versao_id, trecho, empresaNome, obraCodigo, obraNome }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()

      // Carrega versão + template + colunas + segmentos + células em paralelo
      const { data: versao, error: vErr } = await supabase
        .from('trecho_quantidade_versao')
        .select('id, template_id, numero, is_atual, comentario')
        .eq('id', versao_id)
        .single()
      if (vErr) throw vErr

      const { data: template, error: tErr } = await supabase
        .from('trecho_quantidade_template')
        .select('nome, modo')
        .eq('id', versao.template_id)
        .single()
      if (tErr) throw tErr

      const [colRes, segRes] = await Promise.all([
        supabase
          .from('trecho_quantidade_coluna')
          .select('id, nome, unidade, ordem')
          .eq('versao_id', versao_id)
          .order('ordem'),
        supabase
          .from('trecho_quantidade_segmento')
          .select(
            'id, ordem, posicao_inicio_m, posicao_fim_m, unidade_inicio_label, unidade_fim_label'
          )
          .eq('versao_id', versao_id)
          .order('ordem')
      ])
      if (colRes.error) throw colRes.error
      if (segRes.error) throw segRes.error

      const segmentoIds = (segRes.data ?? []).map((s) => s.id as string)
      // Chunked SELECT pra evitar estouro de URL no PostgREST.
      const CHUNK_SEL = 500
      const celData: Array<{ segmento_id: string; coluna_id: string; valor: number }> = []
      for (let i = 0; i < segmentoIds.length; i += CHUNK_SEL) {
        const idsSlice = segmentoIds.slice(i, i + CHUNK_SEL)
        const { data, error } = await supabase
          .from('trecho_quantidade_celula')
          .select('segmento_id, coluna_id, valor')
          .in('segmento_id', idsSlice)
        if (error) throw error
        if (data)
          for (const r of data)
            celData.push(r as { segmento_id: string; coluna_id: string; valor: number })
      }

      // Reconstrói map de valores por ordem de segmento + coluna_id
      const segIdToOrdem = new Map<string, number>()
      for (const s of segRes.data ?? []) segIdToOrdem.set(s.id, s.ordem)

      const valoresExistentes = new Map<number, Map<string, number>>()
      for (const c of celData) {
        const ordem = segIdToOrdem.get(c.segmento_id)
        if (ordem == null) continue
        let m = valoresExistentes.get(ordem)
        if (!m) {
          m = new Map()
          valoresExistentes.set(ordem, m)
        }
        m.set(c.coluna_id, Number(c.valor))
      }

      // Grade analítica do trecho (sempre — fornece headers de label corretos)
      const trechoCfg: TrechoUnidadeConfig = {
        geometry_comprimento_m: Number(trecho.geometry_comprimento_m ?? 0),
        unidade_espaco_padrao: trecho.unidade_espaco_padrao,
        unidade_custom_label: trecho.unidade_custom_label,
        unidade_custom_divisor_m: trecho.unidade_custom_divisor_m,
        marcador_valor_inicial: trecho.marcador_valor_inicial
      }
      const grade = gerarGradeAnalitica(trechoCfg)
      const unidadeBaseLabel =
        trecho.unidade_espaco_padrao === 'custom'
          ? trecho.unidade_custom_label || 'ref'
          : trecho.unidade_espaco_padrao === 'estaca'
            ? 'EST'
            : trecho.unidade_espaco_padrao

      const blob = await gerarTemplateExcel({
        empresaNome,
        obraCodigo,
        obraNome,
        trechoNome: trecho.nome,
        trechoCor: trecho.cor,
        template: { nome: template.nome, modo: template.modo as 'analitico' | 'simplificado' },
        versao: {
          numero: versao.numero,
          is_atual: versao.is_atual,
          comentario: versao.comentario
        },
        unidadeBaseLabel,
        comprimentoM: Number(trecho.geometry_comprimento_m ?? 0),
        colunas: (colRes.data ?? []).map((c) => ({ id: c.id, nome: c.nome, unidade: c.unidade })),
        grade,
        valoresExistentes
      })

      const filename = `quantidades-${slug(trecho.nome)}-${slug(template.nome)}-v${versao.numero}-${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      return { filename }
    }
  })
}

// ─── Import Excel ───────────────────────────────────────────────────────

export interface ImportarExcelInput {
  template_id: string
  trecho: ObraTrecho
  file: File
  /** Substituir versão atual in-place OU criar nova versão. */
  modo_importacao: 'substituir' | 'nova_versao'
  /** Comentário pra nova versão (ignorado se modo='substituir'). */
  comentario?: string
}

export interface ImportarExcelResult {
  versao_id: string
  segmentos_inseridos: number
  celulas_inseridas: number
  warnings: ParseExcelResult['warnings']
}

/**
 * Parse Excel + commit. Em modo 'nova_versao', clona colunas da versão atual,
 * popula com dados parseados, promove a nova. Em 'substituir', deleta dados
 * da atual e re-insere.
 */
export function useImportarExcelQuantidades(): ReturnType<
  typeof useMutation<ImportarExcelResult, Error, ImportarExcelInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()

      // 1) Resolve versão atual + modo + colunas
      const { data: template, error: tErr } = await supabase
        .from('trecho_quantidade_template')
        .select('id, modo')
        .eq('id', body.template_id)
        .single()
      if (tErr) throw tErr

      const { data: versaoAtual, error: vErr } = await supabase
        .from('trecho_quantidade_versao')
        .select('id')
        .eq('template_id', body.template_id)
        .eq('is_atual', true)
        .single()
      if (vErr) throw vErr

      const { data: colsAtuais, error: cErr } = await supabase
        .from('trecho_quantidade_coluna')
        .select('id, nome, unidade, ordem')
        .eq('versao_id', versaoAtual.id)
        .order('ordem')
      if (cErr) throw cErr
      if (!colsAtuais || colsAtuais.length === 0) {
        throw new Error('Versão atual não tem colunas. Configure o template primeiro.')
      }

      // 2) Parse Excel
      const trechoCfg: TrechoUnidadeConfig = {
        geometry_comprimento_m: Number(body.trecho.geometry_comprimento_m ?? 0),
        unidade_espaco_padrao: body.trecho.unidade_espaco_padrao,
        unidade_custom_label: body.trecho.unidade_custom_label,
        unidade_custom_divisor_m: body.trecho.unidade_custom_divisor_m,
        marcador_valor_inicial: body.trecho.marcador_valor_inicial
      }
      const parsed = await parseExcelQuantidades({
        file: body.file,
        modo: template.modo as 'analitico' | 'simplificado',
        colunas: colsAtuais.map((c) => ({ id: c.id, nome: c.nome, unidade: c.unidade })),
        trecho: trechoCfg
      })

      if (parsed.segmentos.length === 0) {
        return {
          versao_id: versaoAtual.id,
          segmentos_inseridos: 0,
          celulas_inseridas: 0,
          warnings: [
            ...parsed.warnings,
            { row: null, msg: 'Nenhum segmento válido detectado — nada salvo.' }
          ]
        }
      }

      // 3) Resolve versão alvo
      let versaoAlvoId: string
      let colMapByOriginalId = new Map<string, string>() // id antiga (template) → id na versão alvo
      for (const c of colsAtuais) colMapByOriginalId.set(c.id, c.id)

      if (body.modo_importacao === 'nova_versao') {
        // Cria nova versão clonando colunas da atual (NÃO clona segmentos —
        // serão substituídos pelos dados parseados)
        const { data: novaVer, error: nvErr } = await supabase
          .from('trecho_quantidade_versao')
          .insert({
            template_id: body.template_id,
            is_atual: true,
            comentario: body.comentario?.trim() || null
          })
          .select('id')
          .single()
        if (nvErr) throw nvErr

        try {
          // Clona colunas com novos IDs, mantém ordem; map antigo → novo
          colMapByOriginalId = new Map()
          const novasCols = colsAtuais.map((c) => {
            const novoId = crypto.randomUUID()
            colMapByOriginalId.set(c.id, novoId)
            return {
              id: novoId,
              versao_id: novaVer.id,
              nome: c.nome,
              unidade: c.unidade,
              ordem: c.ordem
            }
          })
          const { error: insColErr } = await supabase
            .from('trecho_quantidade_coluna')
            .insert(novasCols)
          if (insColErr) throw insColErr
          versaoAlvoId = novaVer.id
        } catch (e) {
          await supabase.from('trecho_quantidade_versao').delete().eq('id', novaVer.id)
          throw e
        }
      } else {
        // Substituir: deleta segmentos+células da atual e re-insere abaixo
        const { error: dErr } = await supabase
          .from('trecho_quantidade_segmento')
          .delete()
          .eq('versao_id', versaoAtual.id)
        if (dErr) throw dErr
        versaoAlvoId = versaoAtual.id
      }

      // 4) Insere segmentos com IDs pré-gerados pra encadear células
      const segmentosPayload = parsed.segmentos.map((s) => ({
        id: crypto.randomUUID(),
        versao_id: versaoAlvoId,
        ordem: s.ordem,
        posicao_inicio_m: s.posicao_inicio_m,
        posicao_fim_m: s.posicao_fim_m,
        unidade_inicio_label: s.unidade_inicio_label,
        unidade_fim_label: s.unidade_fim_label
      }))
      try {
        // Chunked insert pra evitar payload gigante
        const SEG_CHUNK = 500
        for (let i = 0; i < segmentosPayload.length; i += SEG_CHUNK) {
          const { error: insSegErr } = await supabase
            .from('trecho_quantidade_segmento')
            .insert(segmentosPayload.slice(i, i + SEG_CHUNK))
          if (insSegErr) throw insSegErr
        }

        // 5) Insere células — remapeia coluna_id se modo='nova_versao'.
        // Filtra zeros: célula com valor 0 não agrega à soma (UI mostra "—")
        // e em planilhas grandes representa 90%+ das células — gravar todas
        // estouraria a tabela e tornaria o "Visualizar" lento até inutilizável.
        const celulasPayload: Array<{
          segmento_id: string
          coluna_id: string
          valor: number
        }> = []
        for (let i = 0; i < parsed.segmentos.length; i++) {
          const segOriginal = parsed.segmentos[i]
          const segNovo = segmentosPayload[i]
          for (const [colIdOriginal, valor] of segOriginal.valores) {
            if (valor === 0 || !Number.isFinite(valor)) continue
            const colIdAlvo = colMapByOriginalId.get(colIdOriginal) ?? colIdOriginal
            celulasPayload.push({
              segmento_id: segNovo.id,
              coluna_id: colIdAlvo,
              valor
            })
          }
        }
        const CEL_CHUNK = 500
        for (let i = 0; i < celulasPayload.length; i += CEL_CHUNK) {
          const { error: insCelErr } = await supabase
            .from('trecho_quantidade_celula')
            .insert(celulasPayload.slice(i, i + CEL_CHUNK))
          if (insCelErr) throw insCelErr
        }

        return {
          versao_id: versaoAlvoId,
          segmentos_inseridos: segmentosPayload.length,
          celulas_inseridas: celulasPayload.length,
          warnings: parsed.warnings
        }
      } catch (e) {
        // Rollback parcial: se foi nova versão, deleta ela (cascade limpa tudo).
        // Se substituir, segmentos já foram deletados — não dá pra restaurar.
        // Mas o trigger DEFERRABLE ja não existe aqui; melhor avisar.
        if (body.modo_importacao === 'nova_versao') {
          await supabase.from('trecho_quantidade_versao').delete().eq('id', versaoAlvoId)
        }
        throw e
      }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['quantidades', 'templates'] })
      void qc.invalidateQueries({ queryKey: ['quantidades', 'versoes', vars.template_id] })
      void qc.invalidateQueries({ queryKey: ['quantidades', 'versao'] })
      void qc.invalidateQueries({ queryKey: ['quantidades', 'template-atual'] })
    }
  })
}

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .toLowerCase()
}

export function useEditarColunasVersaoAtual(): ReturnType<
  typeof useMutation<void, Error, EditarColunasInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ versao_id, colunas }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()

      // 1) Carrega colunas existentes pra particionar em delete/update/insert.
      const { data: existentes, error: eErr } = await supabase
        .from('trecho_quantidade_coluna')
        .select('id, nome, unidade, ordem')
        .eq('versao_id', versao_id)
      if (eErr) throw eErr
      const existentesIds = new Set((existentes ?? []).map((c) => c.id as string))

      const idsMantidos = new Set<string>()
      const mantidas: Array<{ id: string; nome: string; unidade: string; ordem: number }> = []
      const novas: Array<{ nome: string; unidade: string; ordem: number }> = []
      colunas.forEach((c, idx) => {
        const nome = c.nome.trim()
        const unidade = c.unidade.trim()
        if (c.id && existentesIds.has(c.id)) {
          idsMantidos.add(c.id)
          mantidas.push({ id: c.id, nome, unidade, ordem: idx })
        } else {
          novas.push({ nome, unidade, ordem: idx })
        }
      })

      // 2) DELETE colunas removidas — cascade limpa SÓ as células dessas colunas.
      const removidasIds = (existentes ?? [])
        .map((c) => c.id as string)
        .filter((id) => !idsMantidos.has(id))
      if (removidasIds.length > 0) {
        const { error: dErr } = await supabase
          .from('trecho_quantidade_coluna')
          .delete()
          .in('id', removidasIds)
        if (dErr) throw dErr
      }

      // 3) UPDATE mantidas em 2 passes pra suportar renomeações e swaps de nome
      //    sem violar uq_tqc_versao_nome no meio do batch.
      if (mantidas.length > 0) {
        for (const c of mantidas) {
          const { error } = await supabase
            .from('trecho_quantidade_coluna')
            .update({ nome: `__tmp_${c.id}__` })
            .eq('id', c.id)
          if (error) throw error
        }
        for (const c of mantidas) {
          const { error } = await supabase
            .from('trecho_quantidade_coluna')
            .update({ nome: c.nome, unidade: c.unidade, ordem: c.ordem })
            .eq('id', c.id)
          if (error) throw error
        }
      }

      // 4) INSERT colunas novas.
      if (novas.length > 0) {
        const payload = novas.map((n) => ({
          versao_id,
          nome: n.nome,
          unidade: n.unidade,
          ordem: n.ordem
        }))
        const { error: iErr } = await supabase.from('trecho_quantidade_coluna').insert(payload)
        if (iErr) throw iErr
      }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['quantidades', 'versao', vars.versao_id] })
      void qc.invalidateQueries({ queryKey: ['quantidades', 'templates'] })
      void qc.invalidateQueries({ queryKey: ['quantidades', 'template-atual'] })
    }
  })
}
