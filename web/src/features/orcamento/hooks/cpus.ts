import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidarCadeia } from '@/lib/query/cadeia'
import { supabase } from '@/lib/supabase/client'
import type {
  Cpu,
  CpuComServico,
  CpuDetalhado,
  CpuItem,
  CpuItemComRecurso
} from '@/types/orcamento'

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

export function usePublishCpu(): ReturnType<typeof useMutation<void, Error, { id: string }>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      // O trigger fn_cpu_demarcar_outras revoga as outras da mesma servico_id.
      const { error } = await supabase.from('cpu').update({ is_vigente: true }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidarCadeia(qc)
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpus'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpu'] })
    }
  })
}
