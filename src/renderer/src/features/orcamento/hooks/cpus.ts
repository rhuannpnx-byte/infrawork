import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type {
  Cpu,
  CpuComServico,
  CpuDetalhado,
  CpuItem,
  CpuItemComRecurso,
  CpuItemGrupo
} from '@/types/orcamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

// ─── Listagem ────────────────────────────────────────────────────────────

/**
 * Lista CPUs da empresa. Se `servicoId` for passado, filtra pelo serviço (exibe
 * todas as versões dele); senão lista todas as vigentes.
 */
export function useCpus(
  obraId: string | null | undefined,
  servicoId?: string | null
): ReturnType<typeof useQuery<CpuComServico[]>> {
  return useQuery({
    queryKey: ['orcamento', 'cpus', obraId, servicoId ?? null],
    enabled: !!obraId,
    queryFn: async (): Promise<CpuComServico[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      let q = supabase
        .from('cpu')
        .select(
          'id, obra_id, servico_id, nome, versao, producao_diaria_qtde, producao_diaria_unidade, encargos_sociais_id, notas, custo_eq_dia_calc, custo_comb_dia_calc, custo_mo_dia_calc, custo_mat_dia_calc, custo_unit_calc, is_vigente, criado_por, created_at, servico:servico_id(id, codigo, nome, unidade)'
        )
        .eq('obra_id', obraId!)
      if (servicoId) {
        q = q.eq('servico_id', servicoId).order('versao', { ascending: false })
      } else {
        q = q.eq('is_vigente', true).order('created_at', { ascending: false })
      }
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as CpuComServico[]
    }
  })
}

export function useCpu(id: string | undefined): ReturnType<typeof useQuery<CpuDetalhado>> {
  return useQuery({
    queryKey: ['orcamento', 'cpu', id],
    enabled: !!id,
    queryFn: async (): Promise<CpuDetalhado> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data: cpu, error: errCpu } = await supabase
        .from('cpu')
        .select(
          'id, obra_id, servico_id, nome, versao, producao_diaria_qtde, producao_diaria_unidade, encargos_sociais_id, notas, custo_eq_dia_calc, custo_comb_dia_calc, custo_mo_dia_calc, custo_mat_dia_calc, custo_unit_calc, is_vigente, criado_por, created_at, servico:servico_id(id, codigo, nome, unidade)'
        )
        .eq('id', id!)
        .single()
      if (errCpu) throw errCpu

      const { data: itens, error: errItens } = await supabase
        .from('cpu_item')
        .select(
          'id, cpu_id, grupo, recurso_id, quantidade, horas_dia, consumo_combustivel_lh, indice_produtividade, consumo_material_por_unid, ordem, custo_total_calc, created_at, updated_at, recurso:recurso_id(id, nome, unidade, grupo)'
        )
        .eq('cpu_id', id!)
        .order('grupo')
        .order('ordem')
      if (errItens) throw errItens

      // Busca preços vigentes em lote para enriquecer os itens.
      const recursosIds = Array.from(
        new Set((itens ?? []).map((i: { recurso_id: string }) => i.recurso_id))
      )
      let precosMap: Record<string, number | null> = {}
      if (recursosIds.length > 0) {
        const { data: precos } = await supabase
          .from('vw_recurso_com_preco')
          .select('id, preco_vigente')
          .in('id', recursosIds)
        precosMap = Object.fromEntries(
          (precos ?? []).map((p: { id: string; preco_vigente: number | null }) => [
            p.id,
            p.preco_vigente
          ])
        )
      }

      const itensEnriched: CpuItemComRecurso[] = (itens ?? []).map((it) => {
        const recurso = (
          it as unknown as {
            recurso?: { id: string; nome: string; unidade: string; grupo: string }
          }
        ).recurso
        return {
          ...(it as unknown as CpuItem),
          recurso: recurso
            ? {
                ...recurso,
                grupo: recurso.grupo as CpuItemComRecurso['recurso'] extends infer R
                  ? R extends { grupo: infer G }
                    ? G
                    : never
                  : never,
                preco_vigente: precosMap[recurso.id] ?? null
              }
            : undefined
        } as CpuItemComRecurso
      })

      return {
        ...(cpu as unknown as Cpu),
        servico: (cpu as unknown as { servico?: CpuDetalhado['servico'] }).servico,
        itens: itensEnriched
      }
    }
  })
}

// ─── Mutations: CPU (cabeçalho) ──────────────────────────────────────────

export interface CreateCpuInput {
  obra_id: string
  /** Nome próprio da CPU (entidade técnica). Obrigatório. */
  nome: string
  /** Servico-dono opcional — vincula CPU a um servico existente. */
  servico_id?: string | null
  producao_diaria_qtde: number
  /** Unidade dimensional produzida por dia (m³, m², t, un, m, vb…). Obrigatória.
   *  Não aceita "DIA" — esse era um default herdado incorreto que propagava
   *  pra servico.unidade e item_orcamentario.unidade_referencia. */
  producao_diaria_unidade: string
  encargos_sociais_id?: string | null
  notas?: string
  marcar_vigente?: boolean
}

export function useCreateCpu(): ReturnType<
  typeof useMutation<{ id: string }, Error, CreateCpuInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      // Próxima versão: se há servico-dono, conta versões existentes do
      // mesmo servico; senão, versão = 1 (CPU órfã sempre é v1).
      let proximaVersao = 1
      if (body.servico_id) {
        const { data: existentes, error: errExist } = await supabase
          .from('cpu')
          .select('versao')
          .eq('servico_id', body.servico_id)
          .order('versao', { ascending: false })
          .limit(1)
        if (errExist) throw errExist
        proximaVersao = ((existentes?.[0]?.versao as number | undefined) ?? 0) + 1
      }

      const { data, error } = await supabase
        .from('cpu')
        .insert({
          obra_id: body.obra_id,
          servico_id: body.servico_id ?? null,
          nome: body.nome.trim(),
          versao: proximaVersao,
          producao_diaria_qtde: body.producao_diaria_qtde,
          producao_diaria_unidade: body.producao_diaria_unidade,
          encargos_sociais_id: body.encargos_sociais_id ?? null,
          notas: body.notas?.trim() || null,
          is_vigente: body.marcar_vigente ?? proximaVersao === 1
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpus'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpus-orfas'] })
    }
  })
}

export interface UpdateCpuInput {
  id: string
  nome?: string | null
  servico_id?: string | null
  producao_diaria_qtde?: number
  producao_diaria_unidade?: string
  encargos_sociais_id?: string | null
  notas?: string | null
}

export function useUpdateCpu(): ReturnType<typeof useMutation<void, Error, UpdateCpuInput>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('cpu').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpu', vars.id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpus'] })
    }
  })
}

export function usePublishCpu(): ReturnType<typeof useMutation<void, Error, { id: string }>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      // O trigger fn_cpu_demarcar_outras revoga as outras da mesma servico_id.
      const { error } = await supabase.from('cpu').update({ is_vigente: true }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpus'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpu'] })
    }
  })
}

export function useDeleteCpu(): ReturnType<typeof useMutation<void, Error, { id: string }>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('cpu').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpus'] })
    }
  })
}

// ─── Mutations: CPU items ────────────────────────────────────────────────

export interface UpsertCpuItemInput {
  id?: string
  cpu_id: string
  grupo: CpuItemGrupo
  recurso_id: string
  quantidade: number
  horas_dia?: number | null
  consumo_combustivel_lh?: number | null
  indice_produtividade?: number
  consumo_material_por_unid?: number | null
  ordem?: number
}

export function useUpsertCpuItem(): ReturnType<
  typeof useMutation<{ id: string }, Error, UpsertCpuItemInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const payload = {
        cpu_id: body.cpu_id,
        grupo: body.grupo,
        recurso_id: body.recurso_id,
        quantidade: body.quantidade,
        horas_dia: body.horas_dia ?? null,
        consumo_combustivel_lh: body.consumo_combustivel_lh ?? null,
        indice_produtividade: body.indice_produtividade ?? 1.0,
        consumo_material_por_unid: body.consumo_material_por_unid ?? null,
        ordem: body.ordem ?? 0
      }
      if (body.id) {
        const { error } = await supabase.from('cpu_item').update(payload).eq('id', body.id)
        if (error) throw error
        return { id: body.id }
      }
      const { data, error } = await supabase.from('cpu_item').insert(payload).select('id').single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpu', vars.cpu_id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpus'] })
    }
  })
}

export function useDeleteCpuItem(): ReturnType<
  typeof useMutation<void, Error, { id: string; cpu_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('cpu_item').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpu', vars.cpu_id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpus'] })
    }
  })
}
