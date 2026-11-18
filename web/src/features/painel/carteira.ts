import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { lerTodas } from '@/lib/supabase/paginar'
import type { StatusComparativo } from '@/types/acompanhamento'

/** Traçado de um eixo da obra: pontos [longitude, latitude]. */
export type Tracado = Array<[number, number]>

/** Situação de uma obra na home (Início). */
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
  /** Eixos com traçado importado (KML/DXF); vazio quando a obra ainda não tem traçado. */
  tracados: Tracado[]
}

/** Um lançamento de produção recente, de qualquer obra da empresa. */
export interface AtividadeRecente {
  id: string
  obra_id: string
  data: string
  created_at: string
  qtd: number
  unidade: string | null
  servico_display_nome: string | null
  encarregado_display_nome: string | null
  equipe_display_nome: string | null
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
interface LinhaTrecho {
  obra_id: string
  geometry_geojson: { type: string; coordinates: number[][] } | null
}

const VAZIA: Omit<ObraNaCarteira, 'tracados'> = {
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

const SEM_ATIVIDADE: AtividadeRecente[] = []

/**
 * A carteira de obras da empresa numa consulta por fonte (cadastro, traçado, resumo do acompanhamento, previsto ×
 * realizado e produção recente), em vez de uma rodada por obra. Resumo, serviços e produção são do escritório: o
 * cliente vê o cadastro e o traçado.
 */
export function useCarteira(
  obraIds: string[],
  interno: boolean,
  desde: string
): {
  porObra: Map<string, ObraNaCarteira>
  atividade: AtividadeRecente[]
  lancamentosPeriodo: number | null
  carregandoCadastro: boolean
  carregandoSituacao: boolean
  carregandoAtividade: boolean
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

  // o traçado só enfeita o cartão: se falhar, o cartão mostra o quadro sem mapa, sem aviso de erro
  const tracados = useQuery({
    queryKey: ['painel', 'carteira', 'tracados', ids],
    enabled: tem,
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<LinhaTrecho[]> => {
      const { data, error } = await supabase
        .from('obra_trecho')
        .select('obra_id, geometry_geojson')
        .in('obra_id', ids)
        .not('geometry_geojson', 'is', null)
      if (error) throw error
      return (data ?? []) as LinhaTrecho[]
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

  const atividade = useQuery({
    queryKey: ['painel', 'carteira', 'atividade', ids],
    enabled: tem && interno,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<AtividadeRecente[]> => {
      const { data, error } = await supabase
        .from('vw_acompanhamento_producao_enriquecida')
        .select(
          'id, obra_id, data, created_at, qtd, unidade, servico_display_nome, encarregado_display_nome, equipe_display_nome'
        )
        .in('obra_id', ids)
        .order('created_at', { ascending: false })
        .order('id')
        .limit(8)
      if (error) throw error
      return (data ?? []) as AtividadeRecente[]
    }
  })

  const periodo = useQuery({
    queryKey: ['painel', 'carteira', 'lancamentos', ids, desde],
    enabled: tem && interno,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('acompanhamento_producao')
        .select('id', { count: 'exact', head: true })
        .in('obra_id', ids)
        .gte('data', desde)
      if (error) throw error
      return count ?? 0
    }
  })

  const porObra = useMemo(() => {
    const mapa = new Map<string, ObraNaCarteira>(ids.map((id) => [id, { ...VAZIA, tracados: [] }]))
    for (const o of cadastro.data ?? []) {
      const alvo = mapa.get(o.id)
      if (!alvo) continue
      alvo.rodovia = o.rodovia
      alvo.trecho = o.trecho
      alvo.extensaoKm = o.extensao_km == null ? null : Number(o.extensao_km)
    }
    for (const t of tracados.data ?? []) {
      const g = t.geometry_geojson
      const alvo = mapa.get(t.obra_id)
      if (!alvo || g?.type !== 'LineString' || !Array.isArray(g.coordinates)) continue
      const pontos = g.coordinates
        .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]))
        .map((c) => [c[0], c[1]] as [number, number])
      if (pontos.length >= 2) alvo.tracados.push(pontos)
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
  }, [ids, cadastro.data, tracados.data, resumo.data, servicos.data])

  return {
    porObra,
    atividade: atividade.data ?? SEM_ATIVIDADE,
    lancamentosPeriodo: periodo.data ?? null,
    carregandoCadastro: cadastro.isLoading,
    carregandoSituacao: resumo.isLoading || servicos.isLoading,
    carregandoAtividade: atividade.isLoading || periodo.isLoading,
    erro:
      cadastro.error ?? resumo.error ?? servicos.error ?? atividade.error ?? periodo.error ?? null,
    tentarDeNovo: () => {
      for (const c of [cadastro, resumo, servicos, atividade, periodo])
        if (c.error) void c.refetch()
    }
  }
}
