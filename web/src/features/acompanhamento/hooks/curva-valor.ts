import { useMemo } from 'react'
import { useBaseline, useTarefas } from '@/features/planejamento/hooks'
import { hojeLocalISO } from '@/lib/format/local-date'
import type { PontoCurvaS } from '@/components/charts/CurvaS'
import {
  criarValorizacao,
  montarCurvaValorAgregado,
  type HistoricoPrecos
} from '../lib/valor-agregado-calc'
import { useCurvaSDia, useEapGrupos, useHistoricoPrecos } from './valor-agregado'

const SEM_HISTORICO: HistoricoPrecos = new Map()

export interface CurvaSValor {
  /** Receita acumulada por semana: prevista (linha de base) e executada (produção a preço de venda). */
  pontos: PontoCurvaS[]
  /** Valor total previsto no fim da linha de base. */
  total: number
  previstoHoje: number
  executado: number
  semLinhaBase: boolean
  isLoading: boolean
  error: unknown
  /** Refaz só as consultas que falharam. */
  refetch: () => void
}

/**
 * Curva S da obra em valor (R$): a mesma régua da tela Valor Agregado, sem a medição e o comparativo. Serve para
 * somar serviços de unidades diferentes sem misturar m², m³ e metros.
 */
export function useCurvaSValor(obraId: string | null | undefined): CurvaSValor {
  const linhaBase = useBaseline(obraId)
  const tarefas = useTarefas(linhaBase.data?.id)
  const dias = useCurvaSDia(obraId)
  const eap = useEapGrupos(obraId)
  const precos = useHistoricoPrecos(obraId)
  const hoje = hojeLocalISO()

  const travadaEm = linhaBase.data?.travada_em?.slice(0, 10) ?? null
  const curva = useMemo(() => {
    if (!tarefas.data?.length || !dias.data || !eap.data) return []
    const valorizacao = criarValorizacao(eap.data, precos.data ?? SEM_HISTORICO, travadaEm)
    return montarCurvaValorAgregado({
      tarefas: tarefas.data,
      curvaSRows: dias.data,
      hoje,
      valorizacao
    })
  }, [tarefas.data, dias.data, eap.data, precos.data, travadaEm, hoje])

  return useMemo(() => {
    const pontos = curva.map((b) => ({
      data: b.periodo,
      previsto: b.receita_planejada_acum,
      realizado: b.receita_projetada_acum
    }))
    let previstoHoje = 0
    let executado = 0
    for (const b of curva) {
      if (b.receita_projetada_acum == null) break
      previstoHoje = b.receita_planejada_acum
      executado = b.receita_projetada_acum
    }
    return {
      pontos,
      total: curva.length ? curva[curva.length - 1].receita_planejada_acum : 0,
      previstoHoje,
      executado,
      semLinhaBase: !linhaBase.isLoading && !linhaBase.data,
      isLoading:
        linhaBase.isLoading ||
        tarefas.isLoading ||
        dias.isLoading ||
        eap.isLoading ||
        precos.isLoading,
      error: linhaBase.error ?? tarefas.error ?? dias.error ?? eap.error ?? precos.error ?? null,
      refetch: () => {
        for (const c of [linhaBase, tarefas, dias, eap, precos]) if (c.error) void c.refetch()
      }
    }
  }, [curva, linhaBase, tarefas, dias, eap, precos])
}
