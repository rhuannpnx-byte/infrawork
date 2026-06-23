// Hooks do Agente de Agrupamento (Planilha Orçamentária).
//   - useSugerirAgrupamento: chama a Edge Function que gera/refina a proposta.
//   - useRegistrarFeedbackAgrupamento: grava aceite/correção/rejeição (insert
//     direto; empresa_id e created_by são preenchidos no banco). Esses registros
//     viram few-shot empresa-wide na próxima geração.

import { useMutation } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { adminApi } from '@/lib/supabase/functions'
import type {
  AgrupamentoResposta,
  FeedbackAgrupamentoInput,
  GrupoSugerido,
  MensagemChat
} from '@/types/agrupamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

export interface SugerirAgrupamentoVars {
  obra_id: string
  instrucoes?: string
  plano_atual?: GrupoSugerido[]
  historico_chat?: MensagemChat[]
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Enfileira o job na Edge Function (resposta imediata com job_id) e faz polling
 * da tabela `agrupamento_job` até concluir. Mantém o contrato de antes: resolve
 * com a AgrupamentoResposta, então o modal não muda.
 */
export function useSugerirAgrupamento(): ReturnType<
  typeof useMutation<AgrupamentoResposta, Error, SugerirAgrupamentoVars>
> {
  return useMutation({
    mutationFn: async (vars) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { job_id } = await adminApi.sugerirAgrupamento(vars)
      // Polling: ~2.5s × 96 ≈ 4min de teto (geração típica ~1-2min).
      for (let i = 0; i < 96; i++) {
        await sleep(2500)
        const { data, error } = await supabase
          .from('agrupamento_job')
          .select('status, resultado, erro')
          .eq('id', job_id)
          .maybeSingle()
        if (error) throw error
        if (!data) continue
        if (data.status === 'concluido') return data.resultado as AgrupamentoResposta
        if (data.status === 'erro') throw new Error(data.erro || 'Falha ao gerar proposta')
      }
      throw new Error('Tempo esgotado aguardando a proposta. Tente novamente.')
    }
  })
}

export function useRegistrarFeedbackAgrupamento(): ReturnType<
  typeof useMutation<void, Error, FeedbackAgrupamentoInput | FeedbackAgrupamentoInput[]>
> {
  return useMutation({
    mutationFn: async (input) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const linhas = (Array.isArray(input) ? input : [input]).map((f) => ({
        obra_id: f.obra_id,
        receita_codigo: f.receita_codigo,
        receita_descricao: f.receita_descricao,
        servico_id: f.servico_id,
        servico_codigo: f.servico_codigo,
        servico_nome: f.servico_nome,
        acao: f.acao,
        contexto: f.contexto ?? {},
        origem: f.origem ?? 'agente'
      }))
      if (linhas.length === 0) return
      const { error } = await supabase.from('agrupamento_feedback').insert(linhas)
      if (error) throw error
    }
  })
}
