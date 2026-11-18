import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { lerTodas } from '@/lib/supabase/paginar'
import type { StatusComparativo } from '@/types/acompanhamento'

/** Situação de uma obra na entrada do sistema (Início sem obra escolhida). */
export interface ObraNaCarteira {
  rodovia: string | null
  trecho: string | null
  extensaoKm: number | null
  /** Fração de 0 a 1, ponderada pela receita; `null` sem linha de base vigente. */
  avancoPct: number | null
  alertasCriticos: number
  ultimaProducao: string | null
  servicos: number
  atrasados: number
  emRisco: number
  semPlano: number
  /** Nenhum serviço com previsto: sem linha de base vigente (o resumo devolve 0% nesse caso). */
  semLinhaBase: boolean
}

interface LinhaObra {
  id: string
  rodovia: string | null
  trecho: string | null
  extensao_km: number | null
}
interface LinhaResumo {
  obra_id: string
  avanco_pct: number | null
  alertas_criticos: number | null
  data_ultima_producao: string | null
}
interface LinhaServico {
  obra_id: string
  status: StatusComparativo
}

const VAZIA: ObraNaCarteira = {
  rodovia: null,
  trecho: null,
  extensaoKm: null,
  avancoPct: null,
  alertasCriticos: 0,
  ultimaProducao: null,
  servicos: 0,
  atrasados: 0,
  emRisco: 0,
  semPlano: 0,
  semLinhaBase: true
}

/**
 * As obras da empresa numa consulta por fonte (cadastro, resumo do acompanhamento e previsto × realizado), em vez de
 * uma rodada por obra. O resumo e os serviços são do escritório: o cliente vê só o cadastro.
 */
export function useCarteira(
  obraIds: string[],
  interno: boolean
): {
  porObra: Map<string, ObraNaCarteira>
  carregandoCadastro: boolean
  carregandoSituacao: boolean
  erro: unknown
  tentarDeNovo: () => void
} {
  const ids = useMemo(() => [...obraIds].sort(), [obraIds])
  const tem = ids.length > 0

  const cadastro = useQuery({
    queryKey: ['painel', 'carteira', 'cadastro', ids],
    enabled: tem,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<LinhaObra[]> => {
      const { data, error } = await supabase
        .from('obras')
        .select('id, rodovia, trecho, extensao_km')
        .in('id', ids)
      if (error) throw error
      return (data ?? []) as LinhaObra[]
    }
  })

  const resumo = useQuery({
    queryKey: ['painel', 'carteira', 'resumo', ids],
    enabled: tem && interno,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<LinhaResumo[]> => {
      const { data, error } = await supabase
        .from('vw_acompanhamento_obra_resumo')
        .select('obra_id, avanco_pct, alertas_criticos, data_ultima_producao')
        .in('obra_id', ids)
      if (error) throw error
      return (data ?? []) as LinhaResumo[]
    }
  })

  const servicos = useQuery({
    queryKey: ['painel', 'carteira', 'servicos', ids],
    enabled: tem && interno,
    staleTime: 60 * 1000,
    queryFn: () =>
      lerTodas<LinhaServico>((de, ate) =>
        supabase
          .from('vw_acompanhamento_previsto_x_realizado')
          .select('obra_id, status')
          .in('obra_id', ids)
          .order('obra_id')
          .order('tarefa_id')
          .order('item_orcamentario_id')
          .range(de, ate)
      )
  })

  const porObra = useMemo(() => {
    const mapa = new Map<string, ObraNaCarteira>(ids.map((id) => [id, { ...VAZIA }]))
    for (const o of cadastro.data ?? []) {
      const alvo = mapa.get(o.id)
      if (!alvo) continue
      alvo.rodovia = o.rodovia
      alvo.trecho = o.trecho
      alvo.extensaoKm = o.extensao_km == null ? null : Number(o.extensao_km)
    }
    for (const r of resumo.data ?? []) {
      const alvo = mapa.get(r.obra_id)
      if (!alvo) continue
      alvo.avancoPct = r.avanco_pct == null ? null : Number(r.avanco_pct)
      alvo.alertasCriticos = Number(r.alertas_criticos ?? 0)
      alvo.ultimaProducao = r.data_ultima_producao
    }
    for (const s of servicos.data ?? []) {
      const alvo = mapa.get(s.obra_id)
      if (!alvo) continue
      alvo.servicos++
      if (s.status === 'atrasado') alvo.atrasados++
      else if (s.status === 'em_risco') alvo.emRisco++
      else if (s.status === 'sem_plano') alvo.semPlano++
    }
    for (const c of mapa.values()) c.semLinhaBase = c.servicos === c.semPlano
    return mapa
  }, [ids, cadastro.data, resumo.data, servicos.data])

  return {
    porObra,
    carregandoCadastro: cadastro.isLoading,
    carregandoSituacao: resumo.isLoading || servicos.isLoading,
    erro: cadastro.error ?? resumo.error ?? servicos.error ?? null,
    tentarDeNovo: () => {
      for (const c of [cadastro, resumo, servicos]) if (c.error) void c.refetch()
    }
  }
}
