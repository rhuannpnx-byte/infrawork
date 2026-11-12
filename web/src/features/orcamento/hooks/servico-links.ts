// Hooks pro servico-agregador: vínculos N CPUs com fator + custo agregado.
//
// Conceito: um servico pode vincular N CPUs em servico_cpu_link com fator
// divisor. Custo unitário do servico = Σ (cpu.custo_unit_calc / fator).
// O serviço do orçamento lê esse custo AO VIVO (vw_servico_vivo); o banco
// recalcula o orçamento no fim de cada transação.

import { invalidarCadeia } from '@/lib/query/cadeia'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { ServicoCpuLink, ServicoCpuOperacao, Cpu } from '@/types/orcamento'

export interface ServicoCpuLinkComCpu extends ServicoCpuLink {
  cpu?: Pick<
    Cpu,
    | 'id'
    | 'servico_id'
    | 'versao'
    | 'producao_diaria_qtde'
    | 'producao_diaria_unidade'
    | 'custo_unit_calc'
    | 'is_vigente'
    | 'notas'
  > & {
    servico?: { id: string; codigo: string; nome: string; unidade: string | null }
  }
}

export function useServicoCpuLinks(
  servicoId: string | null | undefined
): ReturnType<typeof useQuery<ServicoCpuLinkComCpu[]>> {
  return useQuery({
    queryKey: ['orcamento', 'servico-cpu-links', servicoId],
    enabled: !!servicoId,
    queryFn: async (): Promise<ServicoCpuLinkComCpu[]> => {
      const { data, error } = await supabase
        .from('servico_cpu_link')
        .select(
          'id, servico_id, cpu_id, fator, operacao, ordem, observacao, created_at, updated_at, ' +
            'cpu:cpu_id(id, servico_id, versao, producao_diaria_qtde, producao_diaria_unidade, custo_unit_calc, is_vigente, notas, servico:servico_id(id, codigo, nome, unidade))'
        )
        .eq('servico_id', servicoId!)
        .order('ordem')
      if (error) throw error
      return (data ?? []) as unknown as ServicoCpuLinkComCpu[]
    }
  })
}

export interface UpsertServicoCpuLinkInput {
  id?: string
  servico_id: string
  cpu_id: string
  fator: number
  operacao?: ServicoCpuOperacao
  ordem?: number
  observacao?: string | null
}

export function useUpsertServicoCpuLink(): ReturnType<
  typeof useMutation<{ id: string }, Error, UpsertServicoCpuLinkInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      const payload = {
        servico_id: body.servico_id,
        cpu_id: body.cpu_id,
        fator: body.fator,
        operacao: body.operacao ?? 'dividir',
        ordem: body.ordem ?? 0,
        observacao: body.observacao ?? null
      }
      if (body.id) {
        const { error } = await supabase.from('servico_cpu_link').update(payload).eq('id', body.id)
        if (error) throw error
        return { id: body.id }
      }
      const { data, error } = await supabase
        .from('servico_cpu_link')
        .insert(payload)
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: (_d, vars) => {
      invalidarCadeia(qc)
      void qc.invalidateQueries({ queryKey: ['orcamento', 'servico-cpu-links', vars.servico_id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'servico-custo-agregado'] })
    }
  })
}

export function useDeleteServicoCpuLink(): ReturnType<
  typeof useMutation<void, Error, { id: string; servico_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('servico_cpu_link').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      invalidarCadeia(qc)
      void qc.invalidateQueries({ queryKey: ['orcamento', 'servico-cpu-links', vars.servico_id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'servico-custo-agregado'] })
    }
  })
}

export interface CpuOrfa {
  id: string
  nome: string | null
  versao: number
  producao_diaria_qtde: number
  producao_diaria_unidade: string
  custo_unit_calc: number
  notas: string | null
  created_at: string
}

/** Lista CPUs órfãs (sem servico-dono) da obra. */
export function useCpusOrfas(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<CpuOrfa[]>> {
  return useQuery({
    queryKey: ['orcamento', 'cpus-orfas', obraId],
    enabled: !!obraId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cpu')
        .select(
          'id, nome, versao, producao_diaria_qtde, producao_diaria_unidade, custo_unit_calc, notas, created_at'
        )
        .eq('obra_id', obraId!)
        .is('servico_id', null)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as CpuOrfa[]
    }
  })
}

/** Cria 1 servico + 1 vínculo a uma CPU existente (modo "importar CPU" do NewServicoDialog). */
export interface CreateServicoFromCpuInput {
  obra_id: string
  codigo: string
  nome: string
  unidade: string
  parent_id?: string | null
  cpu_id: string
  fator: number
  operacao?: ServicoCpuOperacao
}

export function useCreateServicoFromCpu(): ReturnType<
  typeof useMutation<{ id: string }, Error, CreateServicoFromCpuInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      const { data: serv, error: errServ } = await supabase
        .from('servico')
        .insert({
          obra_id: body.obra_id,
          codigo: body.codigo,
          nome: body.nome,
          unidade: body.unidade,
          parent_id: body.parent_id ?? null
        })
        .select('id')
        .single()
      if (errServ || !serv) throw errServ ?? new Error('Falha ao criar servico')

      const { error: errLink } = await supabase.from('servico_cpu_link').insert({
        servico_id: serv.id as string,
        cpu_id: body.cpu_id,
        fator: body.fator,
        operacao: body.operacao ?? 'dividir',
        ordem: 0
      })
      if (errLink) throw errLink

      // Vincula a CPU ao servico (servico_id) — fica como dono.
      await supabase
        .from('cpu')
        .update({ servico_id: serv.id as string })
        .eq('id', body.cpu_id)

      return { id: serv.id as string }
    },
    onSuccess: () => {
      invalidarCadeia(qc)
      void qc.invalidateQueries({ queryKey: ['orcamento', 'servicos'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpus'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpus-orfas'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'servico-cpu-links'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'servico-custo-agregado'] })
    }
  })
}

export interface UpdateServicoProducaoInput {
  id: string
  producao_diaria_qtde: number | null
  producao_diaria_unidade: string | null
}

export function useUpdateServicoProducao(): ReturnType<
  typeof useMutation<void, Error, UpdateServicoProducaoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }) => {
      const { error } = await supabase.from('servico').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidarCadeia(qc)
      void qc.invalidateQueries({ queryKey: ['orcamento', 'servicos'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'servico-custo-agregado'] })
    }
  })
}
