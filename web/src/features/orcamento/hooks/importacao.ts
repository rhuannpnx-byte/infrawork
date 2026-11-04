import { useMutation, useQueryClient } from '@tanstack/react-query'
import { invalidarCadeia } from '@/lib/query/cadeia'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { adminApi } from '@/lib/supabase/functions'
import type { ImportResultado } from '@/lib/xlsx/types'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

interface RpcErro {
  row?: number
  msg: string
  composicao?: string
  codigo?: string
}

function fmtErros(erros: RpcErro[] | undefined): string[] {
  return (erros ?? []).map(
    (e) =>
      `linha ${e.row ?? '?'}${e.composicao ? ` (${e.composicao})` : e.codigo ? ` (${e.codigo})` : ''}: ${e.msg}`
  )
}

function fmtAvisos(avisos: Array<{ row?: number; msg: string }> | undefined): string[] {
  return (avisos ?? []).map((a) => `linha ${a.row ?? '?'}: ${a.msg}`)
}

// ─── Recursos ──────────────────────────────────────────────────────────────
export interface ImportarRecursosInput {
  obra_id: string
  linhas: Record<string, unknown>[]
  opcoes?: { atualizar_existentes?: boolean; atualizar_precos?: boolean; tudo_ou_nada?: boolean }
}

export function useImportarRecursos(): ReturnType<
  typeof useMutation<ImportResultado, Error, ImportarRecursosInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input): Promise<ImportResultado> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase.rpc('importar_recursos', {
        _obra_id: input.obra_id,
        _linhas: input.linhas,
        _opcoes: input.opcoes ?? {}
      })
      if (error) throw error
      const r = data as {
        ok: boolean
        stats: Record<string, number>
        erros: RpcErro[]
        duracao_ms: number
      }
      return {
        ok: r.ok,
        stats: r.stats,
        erros: fmtErros(r.erros),
        avisos: [],
        duracao_ms: r.duracao_ms
      }
    },
    onSuccess: () => {
      invalidarCadeia(qc)
      void qc.invalidateQueries({ queryKey: ['orcamento', 'recursos'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpus'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpu'] })
    }
  })
}

// ─── Composições ───────────────────────────────────────────────────────────
export type ModoExistente = 'substituir_itens' | 'nova_versao' | 'pular' | 'erro'

export interface ImportarComposicoesInput {
  obra_id: string
  composicoes: Record<string, unknown>[]
  opcoes?: {
    modo_existente?: ModoExistente
    criar_recursos_faltantes?: boolean
    combustivel_padrao_recurso_id?: string | null
    tudo_ou_nada?: boolean
  }
}

export interface ComposicaoResultadoLinha {
  row: number
  codigo: string
  servico_id: string
  cpu_id: string
  custo_unit: number | null
  acao: 'criar' | 'atualizar' | 'pular'
}

export interface ImportarComposicoesResultado extends ImportResultado {
  resultados: ComposicaoResultadoLinha[]
}

export function useImportarComposicoes(): ReturnType<
  typeof useMutation<ImportarComposicoesResultado, Error, ImportarComposicoesInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input): Promise<ImportarComposicoesResultado> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase.rpc('importar_composicoes', {
        _obra_id: input.obra_id,
        _composicoes: input.composicoes,
        _opcoes: input.opcoes ?? {}
      })
      if (error) throw error
      const r = data as {
        ok: boolean
        stats: Record<string, number>
        resultados: ComposicaoResultadoLinha[]
        erros: RpcErro[]
        avisos: Array<{ row?: number; msg: string }>
        duracao_ms: number
      }
      return {
        ok: r.ok,
        stats: r.stats,
        resultados: r.resultados ?? [],
        erros: fmtErros(r.erros),
        avisos: fmtAvisos(r.avisos),
        duracao_ms: r.duracao_ms
      }
    },
    onSuccess: () => {
      invalidarCadeia(qc)
      for (const k of [
        'servicos',
        'cpus',
        'cpu',
        'servico-cpu-links',
        'servico-custo-agregado',
        'recursos'
      ]) {
        void qc.invalidateQueries({ queryKey: ['orcamento', k] })
      }
    }
  })
}

// ─── Orçamento ─────────────────────────────────────────────────────────────
export interface ImportarOrcamentoInput {
  obra_id: string
  itens: Record<string, unknown>[]
  /** Alocações/rateios das receitas aos serviços (aba "Orçamento" do modelo v4). */
  alocacoes?: Record<string, unknown>[]
  /** Quantidade/unidade manual dos serviços. */
  servicos?: Record<string, unknown>[]
  opcoes?: { existentes?: 'pular' | 'atualizar'; tudo_ou_nada?: boolean }
}

export function useImportarOrcamento(): ReturnType<
  typeof useMutation<ImportResultado, Error, ImportarOrcamentoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input): Promise<ImportResultado> => {
      const r = await adminApi.importOrcamento(input)
      return {
        ok: r.ok,
        stats: r.stats,
        erros: r.erros ?? [],
        avisos: r.avisos ?? [],
        duracao_ms: r.duracao_ms
      }
    },
    onSuccess: (_r, v) => {
      invalidarCadeia(qc)
      void qc.invalidateQueries({ queryKey: ['orcamento', 'plan-orc', v.obra_id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'plan-orc'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'lucratividade'] })
    }
  })
}
