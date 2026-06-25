// Emissor de TAP — campos manuais (os que NÃO vêm dos documentos do contrato).
// O bloco "auto" é derivado do ObraDossier no render; aqui só persistimos os
// campos manuais (1 linha por obra em documentacao_tap), via RLS por obra.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'

/** Um campo manual: valor digitado + documento-fonte opcional. */
export interface TapCampoManual {
  valor: string
  doc_fonte?: string
}
export type TapManual = Record<string, TapCampoManual>

/** Definição canônica dos campos manuais do TAP (rótulo + fonte sugerida). */
export const TAP_CAMPOS_MANUAIS: { chave: string; rotulo: string; fonte: string }[] = [
  {
    chave: 'pct_participacao_tecpav',
    rotulo: '% participação TECPAV no consórcio',
    fonte: 'Instrumento de consórcio'
  },
  {
    chave: 'retencoes',
    rotulo: 'Retenções (ISS/INSS/IRRF)',
    fonte: 'Contrato + regra fiscal do órgão'
  },
  {
    chave: 'riscos_materiais_rs',
    rotulo: 'Riscos — Materiais (R$)',
    fonte: 'Matriz de risco / orçamento'
  },
  {
    chave: 'riscos_mo_rs',
    rotulo: 'Riscos — Mão de obra (R$)',
    fonte: 'Matriz de risco / orçamento'
  },
  {
    chave: 'lucratividade_licitacao',
    rotulo: 'Lucratividade licitação (%)',
    fonte: 'Planilha de proposta'
  },
  {
    chave: 'lucratividade_planejamento',
    rotulo: 'Lucratividade planejamento (%)',
    fonte: 'Estudo de planejamento'
  }
]

interface TapRow {
  manual: TapManual | null
  emitido_em: string | null
}

export function useTapManual(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<TapRow>> {
  return useQuery({
    queryKey: ['documentacao', 'tap', obraId],
    enabled: !!obraId && SUPABASE_ENABLED,
    queryFn: async (): Promise<TapRow> => {
      const { data, error } = await supabase!
        .from('documentacao_tap')
        .select('manual, emitido_em')
        .eq('obra_id', obraId!)
        .maybeSingle()
      if (error) throw error
      return { manual: (data?.manual as TapManual) ?? {}, emitido_em: data?.emitido_em ?? null }
    }
  })
}

export function useSalvarTapManual(): ReturnType<
  typeof useMutation<void, Error, { obra_id: string; manual: TapManual; emitir?: boolean }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ obra_id, manual, emitir }) => {
      if (!SUPABASE_ENABLED || !supabase) throw new Error('Supabase não configurado.')
      const row: Record<string, unknown> = {
        obra_id,
        manual,
        atualizado_em: new Date().toISOString()
      }
      if (emitir) row.emitido_em = new Date().toISOString()
      const { error } = await supabase
        .from('documentacao_tap')
        .upsert(row, { onConflict: 'obra_id' })
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['documentacao', 'tap', vars.obra_id] })
    }
  })
}
