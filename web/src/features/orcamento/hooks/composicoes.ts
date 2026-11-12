import { useMutation, useQueryClient } from '@tanstack/react-query'
import { invalidarCadeia } from '@/lib/query/cadeia'
import { supabase } from '@/lib/supabase/client'
import type { CpuItemGrupo } from '@/types/orcamento'
import type { ComposicaoResultadoLinha, ModoExistente } from './importacao'

export interface ComposicaoItemInput {
  grupo: CpuItemGrupo
  recurso_id: string
  quantidade: number | null
  horas_dia: number | null
  consumo_combustivel_lh: number | null
  indice_produtividade: number | null
  consumo_material_por_unid: number | null
}

export interface SalvarComposicaoInput {
  obra_id: string
  codigo: string
  nome: string
  unidade: string
  producao_qtde: number
  observacao: string | null
  itens: ComposicaoItemInput[]
  /** 'erro' (nova), 'substituir_itens' (editar) ou 'nova_versao'. */
  modo: ModoExistente
}

/**
 * Salva uma composição (serviço folha + CPU vigente + insumos) numa única
 * transação — usa a RPC `importar_composicoes` com um array de 1 elemento.
 */
export function useSalvarComposicao(): ReturnType<
  typeof useMutation<ComposicaoResultadoLinha, Error, SalvarComposicaoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input): Promise<ComposicaoResultadoLinha> => {
      const { data, error } = await supabase.rpc('importar_composicoes', {
        _obra_id: input.obra_id,
        _composicoes: [
          {
            row: 1,
            codigo: input.codigo,
            nome: input.nome,
            unidade: input.unidade,
            producao_qtde: input.producao_qtde,
            observacao: input.observacao,
            itens: input.itens.map((i, idx) => ({ row: idx + 1, ...i }))
          }
        ],
        _opcoes: {
          modo_existente: input.modo,
          criar_recursos_faltantes: false,
          combustivel_padrao_recurso_id: null,
          tudo_ou_nada: true
        }
      })
      if (error) throw error
      const r = data as {
        ok: boolean
        resultados: ComposicaoResultadoLinha[]
        erros: Array<{ row?: number; msg: string }>
      }
      if (!r.ok || !r.resultados?.[0]) {
        throw new Error(r.erros?.[0]?.msg ?? 'Falha ao salvar a composição.')
      }
      return r.resultados[0]
    },
    onSuccess: (res) => {
      invalidarCadeia(qc)
      for (const k of [
        'servicos',
        'cpus',
        'servico-cpu-links',
        'servico-custo-agregado',
        'recursos'
      ]) {
        void qc.invalidateQueries({ queryKey: ['orcamento', k] })
      }
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpu', res.cpu_id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpu'] })
    }
  })
}

/** Próximo código livre na raiz do catálogo ("01", "02", …). */
export function sugerirProximoCodigo(codigosExistentes: string[]): string {
  let max = 0
  for (const c of codigosExistentes) {
    if (!/^[0-9]+$/.test(c)) continue
    max = Math.max(max, parseInt(c, 10))
  }
  return String(max + 1).padStart(2, '0')
}
