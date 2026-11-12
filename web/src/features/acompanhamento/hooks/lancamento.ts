// Módulo de lançamento de produção (nativo): itens lançáveis, encarregados,
// lançamentos do dia, criar/editar/excluir, fotos (upload direto ao bucket),
// importação em lote por modelo XLSX e "desfazer importação".

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import exifr from 'exifr'
import { supabase } from '@/lib/supabase/client'
import { lerTodas } from '@/lib/supabase/paginar'
import { useAuthStore } from '@/stores/auth-store'
import type { Encarregado, LancamentoInput, ProducaoEnriquecida } from '@/types/acompanhamento'
import { PROD_COLS } from './producao'

/** Lançamento muda produção, curvas, valor agregado, alertas e a prontidão da obra: relê tudo isso. */
function invalidarAcompanhamento(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ['acompanhamento'] })
  void qc.invalidateQueries({ queryKey: ['prontidao'] })
}

// ─── Itens lançáveis ─────────────────────────────────────────────────────

export interface ItemLancavel {
  id: string
  codigo: string
  descricao: string
  quantidade_referencia: number | null
  unidade_referencia: string | null
  servico_codigo: string | null
  servico_nome: string | null
  servico_unidade: string | null
  /** Quantidade já lançada (convertida), do previsto × realizado. */
  qtd_real: number
}

/** Itens `servico_grupo` (não indiretos) da obra + realizado acumulado. */
export function useItensLancaveis(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<ItemLancavel[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'itens-lancaveis', obraId],
    enabled: !!obraId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<ItemLancavel[]> => {
      const [itensData, realRes] = await Promise.all([
        lerTodas((de, ate) =>
          supabase
            .from('item_orcamentario')
            .select(
              'id, codigo, descricao, quantidade_referencia, unidade_referencia, servico:servico_id(codigo, nome, unidade)'
            )
            .eq('obra_id', obraId!)
            .eq('tipo', 'servico_grupo')
            .is('indireto_id', null)
            // agrupamento sem composição não recebe produção até ser vinculado
            .not('servico_id', 'is', null)
            .order('codigo')
            .order('id')
            .range(de, ate)
        ),
        supabase
          .from('vw_acompanhamento_previsto_x_realizado')
          .select('item_orcamentario_id, qtd_real')
          .eq('obra_id', obraId!)
      ])
      const real = new Map<string, number>()
      for (const r of (realRes.data ?? []) as Array<{
        item_orcamentario_id: string
        qtd_real: number
      }>) {
        real.set(r.item_orcamentario_id, Number(r.qtd_real ?? 0))
      }
      return (
        itensData as unknown as Array<{
          id: string
          codigo: string
          descricao: string
          quantidade_referencia: number | null
          unidade_referencia: string | null
          servico: { codigo: string; nome: string; unidade: string | null } | null
        }>
      ).map((i) => ({
        id: i.id,
        codigo: i.codigo,
        descricao: i.descricao,
        quantidade_referencia: i.quantidade_referencia,
        unidade_referencia: i.unidade_referencia,
        servico_codigo: i.servico?.codigo ?? null,
        servico_nome: i.servico?.nome ?? null,
        servico_unidade: i.servico?.unidade ?? null,
        qtd_real: real.get(i.id) ?? 0
      }))
    }
  })
}

// ─── Encarregados ────────────────────────────────────────────────────────

export function useEncarregados(
  obraId: string | null | undefined,
  incluirInativos = false
): ReturnType<typeof useQuery<Encarregado[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'encarregados', obraId, incluirInativos],
    enabled: !!obraId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<Encarregado[]> => {
      let q = supabase.from('encarregado').select('*').eq('obra_id', obraId!).order('nome')
      if (!incluirInativos) q = q.eq('ativo', true)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as Encarregado[]
    }
  })
}

export interface EncarregadoInput {
  obra_id: string
  nome: string
  apelido?: string | null
  telefone?: string | null
  ativo?: boolean
}

export function useCreateEncarregado(): ReturnType<
  typeof useMutation<Encarregado, Error, EncarregadoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input): Promise<Encarregado> => {
      const { data, error } = await supabase
        .from('encarregado')
        .insert({
          obra_id: input.obra_id,
          nome: input.nome.trim(),
          apelido: input.apelido?.trim() || null,
          telefone: input.telefone?.trim() || null,
          ativo: input.ativo ?? true
        })
        .select('*')
        .single()
      if (error) throw error
      return data as Encarregado
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['acompanhamento', 'encarregados'] })
  })
}

export function useUpdateEncarregado(): ReturnType<
  typeof useMutation<void, Error, Partial<EncarregadoInput> & { id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }): Promise<void> => {
      const body: Record<string, unknown> = {}
      if (patch.nome !== undefined) body.nome = patch.nome.trim()
      if (patch.apelido !== undefined) body.apelido = patch.apelido?.trim() || null
      if (patch.telefone !== undefined) body.telefone = patch.telefone?.trim() || null
      if (patch.ativo !== undefined) body.ativo = patch.ativo
      const { error } = await supabase.from('encarregado').update(body).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'encarregados'] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'producao'] })
    }
  })
}

// ─── Lançamentos ─────────────────────────────────────────────────────────

export function useLancamentosDia(
  obraId: string | null | undefined,
  dataISO: string
): ReturnType<typeof useQuery<ProducaoEnriquecida[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'lancamentos-dia', obraId, dataISO],
    enabled: !!obraId && !!dataISO,
    staleTime: 15 * 1000,
    queryFn: async (): Promise<ProducaoEnriquecida[]> => {
      const { data, error } = await supabase
        .from('vw_acompanhamento_producao_enriquecida')
        .select(PROD_COLS)
        .eq('obra_id', obraId!)
        .eq('data', dataISO)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ProducaoEnriquecida[]
    }
  })
}

/** Registro para a producao_salvar: produção + materiais numa transação (materiais ausentes = não mexe). */
function rowDe(input: LancamentoInput): Record<string, unknown> {
  return {
    obra_id: input.obra_id,
    data: input.data,
    item_orcamentario_id: input.item_orcamentario_id,
    equipe_id: input.equipe_id,
    encarregado_id: input.encarregado_id,
    quantidade: input.quantidade,
    frente: input.frente?.trim() || null,
    estaca_inicial: input.estaca_inicial?.trim() || null,
    estaca_final: input.estaca_final?.trim() || null,
    trecho_id: input.trecho_id ?? null,
    posicao_inicio_m: input.trecho_id ? (input.posicao_inicio_m ?? null) : null,
    posicao_fim_m: input.trecho_id ? (input.posicao_fim_m ?? null) : null,
    obs: input.obs?.trim() || null,
    ...(input.materiais
      ? {
          materiais: input.materiais
            .filter((m) => m.nome.trim() || m.recurso_id)
            .map((m) => ({
              nome: m.nome.trim(),
              quantidade: m.quantidade,
              unidade: m.unidade?.trim() || null,
              recurso_id: m.recurso_id ?? null
            }))
        }
      : {})
  }
}

async function salvarProducao(
  registros: Record<string, unknown>[],
  origem: 'app' | 'importacao',
  importacaoId: string | null = null
): Promise<string[]> {
  const { data, error } = await supabase.rpc('producao_salvar', {
    _registros: registros,
    _origem: origem,
    _importacao_id: importacaoId
  })
  if (error) throw error
  return (data as { ids: string[] }).ids
}

export function useCreateLancamento(): ReturnType<
  typeof useMutation<{ id: string }, Error, LancamentoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input): Promise<{ id: string }> => {
      const [id] = await salvarProducao([rowDe(input)], 'app')
      return { id }
    },
    onSuccess: () => invalidarAcompanhamento(qc)
  })
}

export function useUpdateLancamento(): ReturnType<
  typeof useMutation<void, Error, LancamentoInput & { id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...input }): Promise<void> => {
      await salvarProducao([{ ...rowDe(input), id }], 'app')
    },
    onSuccess: () => invalidarAcompanhamento(qc)
  })
}

export function useDeleteLancamento(): ReturnType<typeof useMutation<void, Error, { id: string }>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }): Promise<void> => {
      const { error } = await supabase.from('acompanhamento_producao').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidarAcompanhamento(qc)
  })
}

export function useMateriaisLancamento(producaoId: string | null | undefined): ReturnType<
  typeof useQuery<
    Array<{
      id: string
      nome: string
      quantidade: number | null
      unidade: string | null
      recurso_id: string | null
    }>
  >
> {
  return useQuery({
    queryKey: ['acompanhamento', 'materiais', producaoId],
    enabled: !!producaoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('acompanhamento_producao_material')
        .select('id, nome, quantidade, unidade, recurso_id')
        .eq('producao_id', producaoId!)
      if (error) throw error
      return (data ?? []) as Array<{
        id: string
        nome: string
        quantidade: number | null
        unidade: string | null
        recurso_id: string | null
      }>
    }
  })
}

// ─── Lote (grid do dia) e importação ─────────────────────────────────────

export function useCreateLancamentosLote(): ReturnType<
  typeof useMutation<
    { inseridos: number; importacao_id: string | null },
    Error,
    { linhas: LancamentoInput[]; origem: 'app' | 'importacao' }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ linhas, origem }) => {
      if (linhas.length === 0) return { inseridos: 0, importacao_id: null }
      const importacao_id = origem === 'importacao' ? crypto.randomUUID() : null
      // tudo ou nada: uma linha recusada desfaz o lote inteiro
      const ids = await salvarProducao(linhas.map(rowDe), origem, importacao_id)
      return { inseridos: ids.length, importacao_id }
    },
    onSuccess: () => invalidarAcompanhamento(qc)
  })
}

export function useDesfazerImportacao(): ReturnType<
  typeof useMutation<number, Error, { importacao_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ importacao_id }): Promise<number> => {
      const { error, count } = await supabase
        .from('acompanhamento_producao')
        .delete({ count: 'exact' })
        .eq('importacao_id', importacao_id)
      if (error) throw error
      return count ?? 0
    },
    onSuccess: () => invalidarAcompanhamento(qc)
  })
}

// ─── Fotos: upload direto ao bucket + metadados ──────────────────────────

const MAX_LADO = 1920
const JPEG_Q = 0.82

async function comprimir(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
    throw new Error(
      `"${file.name}" está em HEIC. No iPhone, use Ajustes → Câmera → Formatos → "Mais compatível", ou converta para JPEG.`
    )
  }
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image'
  } as ImageBitmapOptions)
  const ratio = Math.min(1, MAX_LADO / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * ratio)
  const h = Math.round(bitmap.height * ratio)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponível')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_Q)
  )
  if (!blob) throw new Error('Falha ao comprimir a imagem')
  return { blob, width: w, height: h }
}

async function lerExif(
  file: File
): Promise<{ lat: number | null; lng: number | null; captured_at: string | null }> {
  try {
    const [gps, meta] = await Promise.all([
      exifr.gps(file).catch(() => null),
      exifr.parse(file, ['DateTimeOriginal', 'OffsetTimeOriginal', 'CreateDate']).catch(() => null)
    ])
    const lat = gps?.latitude != null && Number.isFinite(gps.latitude) ? gps.latitude : null
    const lng = gps?.longitude != null && Number.isFinite(gps.longitude) ? gps.longitude : null
    const dt: Date | undefined = (meta?.DateTimeOriginal ?? meta?.CreateDate) as Date | undefined
    return {
      lat,
      lng,
      captured_at: dt instanceof Date && !isNaN(dt.getTime()) ? dt.toISOString() : null
    }
  } catch {
    return { lat: null, lng: null, captured_at: null }
  }
}

export interface UploadFotoInput {
  obra_id: string
  producao_id: string | null
  files: File[]
  onProgress?: (feitas: number, total: number) => void
}

export interface UploadFotoResultado {
  enviadas: number
  erros: string[]
}

export function useUploadFotosLancamento(): ReturnType<
  typeof useMutation<UploadFotoResultado, Error, UploadFotoInput>
> {
  const qc = useQueryClient()
  const empresaId = useAuthStore((s) => s.profile?.empresa_id ?? null)
  const obras = useAuthStore((s) => s.obras)
  return useMutation({
    mutationFn: async ({
      obra_id,
      producao_id,
      files,
      onProgress
    }): Promise<UploadFotoResultado> => {
      const empresa = empresaId ?? obras.find((o) => o.id === obra_id)?.empresa_id ?? 'sem-empresa'
      const erros: string[] = []
      let enviadas = 0
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        try {
          const [{ blob, width, height }, exif] = await Promise.all([
            comprimir(file),
            lerExif(file)
          ])
          const key = `${empresa}/${obra_id}/${producao_id ?? 'avulsa'}/${crypto.randomUUID()}.jpg`
          let tentativa = 0
          let upErr: Error | null = null
          while (tentativa < 3) {
            const { error } = await supabase.storage
              .from('acompanhamento-fotos')
              .upload(key, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' })
            if (!error) {
              upErr = null
              break
            }
            upErr = error
            tentativa++
          }
          if (upErr) throw upErr
          const { error: errMeta } = await supabase.from('acompanhamento_foto').insert({
            obra_id,
            producao_id,
            lat: exif.lat,
            lng: exif.lng,
            captured_at: exif.captured_at,
            storage_bucket: 'acompanhamento-fotos',
            storage_key: key,
            mime: 'image/jpeg',
            size_bytes: blob.size,
            width,
            height
          })
          if (errMeta) throw errMeta
          enviadas++
        } catch (e) {
          erros.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`)
        }
        onProgress?.(i + 1, files.length)
      }
      return { enviadas, erros }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'fotos'] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'fotos-geo'] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'producao'] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'lancamentos-dia'] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'dashboard'] })
    }
  })
}

/** Frentes já usadas na obra (datalist do formulário). */
export function useFrentesObra(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<string[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'frentes', obraId],
    enabled: !!obraId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('vw_acompanhamento_frente_kpis')
        .select('frente')
        .eq('obra_id', obraId!)
        .order('ultima_data', { ascending: false })
        .limit(50)
      if (error) throw error
      return ((data ?? []) as Array<{ frente: string }>)
        .map((f) => f.frente)
        .filter((f) => f && f !== '(sem frente)')
    }
  })
}
