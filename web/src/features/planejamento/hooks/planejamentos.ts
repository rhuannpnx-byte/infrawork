import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { invalidarCadeia } from '@/lib/query/cadeia'
import type { Planejamento } from '@/types/planejamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

const COLUNAS =
  'id, obra_id, nome, descricao, is_baseline, vigente, vigente_em, travada_em, recalculo_pendente, premissa_calendario, status, ' +
  'data_referencia_inicio, data_date, criado_por, created_at, updated_at'

/** Estados mudam a trava da cadeia (orçamento/composições) — invalida tudo. */
function invalidarPlanos(qc: QueryClient): void {
  invalidarCadeia(qc)
  void qc.invalidateQueries({ queryKey: ['acompanhamento'] })
}

/**
 * Planos da obra: o plano em edição primeiro, depois a vigente e as demais
 * linhas de base (mais recentes primeiro).
 */
export function usePlanejamentos(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<Planejamento[]>> {
  return useQuery({
    queryKey: ['planejamento', 'lista', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<Planejamento[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('planejamento')
        .select(COLUNAS)
        .eq('obra_id', obraId!)
        .order('is_baseline', { ascending: true })
        .order('vigente', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as Planejamento[]
    }
  })
}

/**
 * Plano padrão das telas de planejamento: o plano em edição; sem ele, a
 * vigente; sem ela, a linha de base mais recente.
 */
export function usePlanejamentoAtivo(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<Planejamento | null>> {
  return useQuery({
    queryKey: ['planejamento', 'ativo', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<Planejamento | null> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('planejamento')
        .select(COLUNAS)
        .eq('obra_id', obraId!)
        .order('is_baseline', { ascending: true })
        .order('vigente', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw error
      return ((data ?? [])[0] ?? null) as unknown as Planejamento | null
    }
  })
}

export type PlanoReferencia = Planejamento & {
  /** Sem vigente: a última LB que foi vigente segue como régua provisória. */
  provisoria: boolean
}

/**
 * Régua do acompanhamento: a linha de base vigente — ou, enquanto não houver
 * vigente (replanejamento), a última que foi vigente.
 */
export function useBaseline(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<PlanoReferencia | null>> {
  return useQuery({
    queryKey: ['planejamento', 'baseline', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<PlanoReferencia | null> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('planejamento')
        .select(COLUNAS)
        .eq('obra_id', obraId!)
        .eq('is_baseline', true)
        .not('vigente_em', 'is', null)
        .order('vigente', { ascending: false })
        .order('vigente_em', { ascending: false })
        .limit(1)
      if (error) throw error
      const p = (data ?? [])[0] as unknown as Planejamento | undefined
      return p ? { ...p, provisoria: !p.vigente } : null
    }
  })
}

/** Motivo da trava da cadeia (orçamento/composições/recursos); null = editável. */
export function useCadeiaTrava(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<string | null>> {
  return useQuery({
    queryKey: ['orcamento', 'cadeia-trava', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<string | null> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase.rpc('cadeia_trava_motivo', { _obra_id: obraId! })
      if (error) throw error
      return (data as string | null) ?? null
    }
  })
}

export interface PremissaDiffItem {
  item_orcamentario_id: string
  codigo: string
  descricao: string
  quantidade: [number, number] | null
  venda: [number, number] | null
  custo_unit: [number, number] | null
  producao: [number, number] | null
}

export interface PremissasDiff {
  mudou: boolean
  itens: PremissaDiffItem[]
  calendario: boolean
}

/** O que mudou desde que a linha de base foi travada. */
export function useLbPremissasDiff(
  planejamentoId: string | null | undefined,
  enabled = true
): ReturnType<typeof useQuery<PremissasDiff>> {
  return useQuery({
    queryKey: ['planejamento', 'premissas-diff', planejamentoId],
    enabled: !!planejamentoId && enabled,
    queryFn: async (): Promise<PremissasDiff> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase.rpc('lb_premissas_diff', {
        _planejamento_id: planejamentoId!
      })
      if (error) throw error
      return data as PremissasDiff
    }
  })
}

export interface CreatePlanejamentoInput {
  obra_id: string
  nome: string
  descricao?: string
  data_referencia_inicio: string
}

function msgEdicao(err: { message: string }): Error {
  return new Error(
    err.message.includes('uq_planejamento_edicao')
      ? 'Já existe um plano em edição nesta obra — promova-o a linha de base ou exclua-o antes.'
      : err.message
  )
}

export function useCreatePlanejamento(): ReturnType<
  typeof useMutation<{ id: string }, Error, CreatePlanejamentoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('planejamento')
        .insert({
          obra_id: body.obra_id,
          nome: body.nome.trim(),
          descricao: body.descricao?.trim() || null,
          data_referencia_inicio: body.data_referencia_inicio,
          status: 'ativo'
        })
        .select('id')
        .single()
      if (error) throw msgEdicao(error)
      return { id: data.id as string }
    },
    onSuccess: () => invalidarPlanos(qc)
  })
}

export function useDeletePlanejamento(): ReturnType<
  typeof useMutation<void, Error, { id: string; obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('planejamento').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidarPlanos(qc)
  })
}

export function useCopiarPlanejamento(): ReturnType<
  typeof useMutation<
    { novo_id: string; tarefas_copiadas: number; tarefas_ajustadas: number },
    Error,
    { origem_id: string; nome_novo: string; ajuste_data_inicio?: string; obra_id: string }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ origem_id, nome_novo, ajuste_data_inicio }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase.rpc('planejamento_copiar', {
        _origem_id: origem_id,
        _nome: nome_novo,
        _inicio: ajuste_data_inicio ?? null
      })
      if (error) throw new Error(error.message)
      return data as { novo_id: string; tarefas_copiadas: number; tarefas_ajustadas: number }
    },
    onSuccess: () => invalidarPlanos(qc)
  })
}

export function usePromoverBaseline(): ReturnType<
  typeof useMutation<
    { baseline_id: string; snapshot_id: string; vigente: boolean },
    Error,
    { planejamento_id: string; obra_id: string; marcar_vigente?: boolean }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ planejamento_id, marcar_vigente }) =>
      promover(planejamento_id, marcar_vigente),
    onSuccess: () => invalidarPlanos(qc)
  })
}

async function promover(
  planejamento_id: string,
  marcar_vigente?: boolean
): Promise<{ baseline_id: string; snapshot_id: string; vigente: boolean }> {
  if (!SUPABASE_ENABLED || !supabase) notReady()
  const { data, error } = await supabase.rpc('planejamento_promover', {
    _planejamento_id: planejamento_id,
    _marcar_vigente: marcar_vigente ?? null
  })
  if (error) throw new Error(error.message)
  return data as { baseline_id: string; snapshot_id: string; vigente: boolean }
}

export function useMarcarVigente(): ReturnType<
  typeof useMutation<void, Error, { planejamento_id: string; obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ planejamento_id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.rpc('marcar_vigente', { _planejamento_id: planejamento_id })
      if (error) throw error
    },
    onSuccess: () => invalidarPlanos(qc)
  })
}

export function useDesmarcarVigente(): ReturnType<
  typeof useMutation<void, Error, { obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ obra_id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.rpc('desmarcar_vigente', { _obra_id: obra_id })
      if (error) throw error
    },
    onSuccess: () => invalidarPlanos(qc)
  })
}

/**
 * "Restaurar como nova linha de base": a linha de base antiga fica intacta; uma cópia é calculada com as premissas
 * atuais (no motor do cronograma, no navegador) e travada como nova linha de base. Exige não haver plano em edição
 * (a cópia passa por ele). Se o cálculo ou a trava falharem, a cópia fica como plano em edição para revisão.
 */
export function useRestaurarLinhaBase(): ReturnType<
  typeof useMutation<
    { novo_id: string; tarefas_ajustadas: number; vigente: boolean },
    Error,
    { planejamento_id: string; nome_novo: string; obra_id: string; marcar_vigente?: boolean }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ planejamento_id, nome_novo, marcar_vigente }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data: lb } = await supabase
        .from('planejamento')
        .select('is_baseline')
        .eq('id', planejamento_id)
        .single()
      if (!lb?.is_baseline) throw new Error('Só linhas de base podem ser restauradas')
      const { data, error } = await supabase.rpc('planejamento_copiar', {
        _origem_id: planejamento_id,
        _nome: nome_novo,
        _inicio: null
      })
      if (error) throw new Error(error.message)
      const novo = (data as { novo_id: string }).novo_id
      try {
        await calcularEGravar(novo)
        const r = await promover(novo, marcar_vigente ?? false)
        return { novo_id: novo, tarefas_ajustadas: 0, vigente: r.vigente }
      } catch (e) {
        throw new Error(
          `${e instanceof Error ? e.message : String(e)} — a cópia ficou como plano em edição para revisão.`
        )
      }
    },
    onSettled: () => {
      invalidarPlanos(qc)
      void qc.invalidateQueries({ queryKey: ['cronograma'] })
    }
  })
}

/** Calcula o plano no motor do cronograma e grava os resultados (até o banco aceitar a revisão dos dados). */
async function calcularEGravar(planejamentoId: string): Promise<void> {
  const [{ carregarPlanoEntrada }, { calcularNoWorker }] = await Promise.all([
    import('@/features/cronograma/dados'),
    import('@/features/cronograma/motor/cliente')
  ])
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const entrada = await carregarPlanoEntrada(planejamentoId)
    const calc = await calcularNoWorker(entrada)
    if (!calc.payload) return
    const { data, error } = await supabase!.rpc('planejamento_gravar_calculo', {
      _planejamento_id: planejamentoId,
      _dados: calc.payload
    })
    if (error) throw new Error(error.message)
    if ((data as { ok: boolean }).ok) return
  }
  throw new Error('Os dados do plano mudaram durante o cálculo; tente de novo')
}
