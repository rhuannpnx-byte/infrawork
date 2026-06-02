// useTracosMarchaTempo — deriva as polilinhas TILOS a partir das tarefas
// diretas + templates por trecho. Encapsula:
//   * carregamento dos templates ATUAIS dos trechos em uso
//   * cálculo da trajetória (perfilada ou uniforme) por tarefa
//   * memoização das polilinhas
//
// Filtra: ignora tarefas indiretas, grupos e marcos (estes últimos podem
// ser exibidos como pontos verticais separados pela camada de UI).

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type {
  GranularidadeTempo,
  PlanejamentoTarefaCompleta,
  PontoTraco,
  TracoTarefa
} from '@/types/planejamento'
import type { TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'
import {
  corDoServico,
  granularidadeParaResolucaoDias,
  segmentosPorColuna,
  tracarPerfiladaIlhas,
  tracarUniforme
} from '../lib/marcha-tempo-pure'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

/**
 * Carrega os templates ATUAIS (versão `is_atual=true`) dos trechos passados,
 * com colunas + segmentos + células. Uma query por trecho (paralelizadas).
 *
 * Retorna Map<trechoId, TrechoQuantidadeVersaoCompleta | null>. Trechos sem
 * template apontam pra null.
 */
export function useTemplatesAtuaisPorTrecho(
  trechoIds: string[]
): ReturnType<typeof useQuery<Map<string, TrechoQuantidadeVersaoCompleta | null>>> {
  // Memoiza array de IDs (estável) pra query key — TanStack faz hash interno.
  const idsKey = [...trechoIds].sort().join(',')
  return useQuery({
    queryKey: ['planejamento', 'marcha-tempo', 'templates-atuais', idsKey],
    enabled: trechoIds.length > 0,
    queryFn: async (): Promise<Map<string, TrechoQuantidadeVersaoCompleta | null>> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const out = new Map<string, TrechoQuantidadeVersaoCompleta | null>()

      // 1) Templates dos trechos
      const { data: tpls, error: tplErr } = await supabase
        .from('trecho_quantidade_template')
        .select('id, trecho_id')
        .in('trecho_id', trechoIds)
      if (tplErr) throw tplErr

      const templatesPorTrecho = new Map<string, string[]>()
      for (const t of tpls ?? []) {
        const arr = templatesPorTrecho.get(t.trecho_id as string) ?? []
        arr.push(t.id as string)
        templatesPorTrecho.set(t.trecho_id as string, arr)
      }

      if ((tpls ?? []).length === 0) {
        for (const id of trechoIds) out.set(id, null)
        return out
      }

      // 2) Versão atual de cada template
      const tplIds = (tpls ?? []).map((t) => t.id as string)
      const { data: versoes, error: vErr } = await supabase
        .from('trecho_quantidade_versao')
        .select('id, template_id, numero, is_atual, comentario, criado_por, created_at, updated_at')
        .in('template_id', tplIds)
        .eq('is_atual', true)
      if (vErr) throw vErr
      if (!versoes || versoes.length === 0) {
        for (const id of trechoIds) out.set(id, null)
        return out
      }

      const versaoPorTemplate = new Map<string, (typeof versoes)[number]>()
      for (const v of versoes) versaoPorTemplate.set(v.template_id as string, v)

      const versoesIds = versoes.map((v) => v.id as string)

      // 3) Colunas + segmentos
      const [colRes, segRes] = await Promise.all([
        supabase
          .from('trecho_quantidade_coluna')
          .select('*')
          .in('versao_id', versoesIds)
          .order('ordem'),
        supabase
          .from('trecho_quantidade_segmento')
          .select('*')
          .in('versao_id', versoesIds)
          .order('ordem')
      ])
      if (colRes.error) throw colRes.error
      if (segRes.error) throw segRes.error

      // 4) Células — chunked
      const segmentoIds = (segRes.data ?? []).map((s) => s.id as string)
      const CHUNK = 500
      const celulas: Array<{ segmento_id: string; coluna_id: string; valor: number }> = []
      for (let i = 0; i < segmentoIds.length; i += CHUNK) {
        const slice = segmentoIds.slice(i, i + CHUNK)
        const { data, error } = await supabase
          .from('trecho_quantidade_celula')
          .select('segmento_id, coluna_id, valor')
          .in('segmento_id', slice)
        if (error) throw error
        for (const c of data ?? []) {
          celulas.push(c as { segmento_id: string; coluna_id: string; valor: number })
        }
      }

      const valoresPorSeg = new Map<string, Record<string, number>>()
      for (const c of celulas) {
        const r = valoresPorSeg.get(c.segmento_id) ?? {}
        r[c.coluna_id] = Number(c.valor)
        valoresPorSeg.set(c.segmento_id, r)
      }

      // 5) Monta map trechoId → versão completa (pega a primeira versão atual
      //    de cada trecho — em prática há ≤ 1 template ativo por trecho)
      for (const trechoId of trechoIds) {
        const tpls = templatesPorTrecho.get(trechoId) ?? []
        let versaoEscolhida: (typeof versoes)[number] | null = null
        for (const tplId of tpls) {
          const v = versaoPorTemplate.get(tplId)
          if (v) {
            versaoEscolhida = v
            break
          }
        }
        if (!versaoEscolhida) {
          out.set(trechoId, null)
          continue
        }
        const colunas = (colRes.data ?? []).filter((c) => c.versao_id === versaoEscolhida!.id)
        const segmentos = (segRes.data ?? [])
          .filter((s) => s.versao_id === versaoEscolhida!.id)
          .map((s) => ({
            ...s,
            posicao_inicio_m: Number(s.posicao_inicio_m),
            posicao_fim_m: Number(s.posicao_fim_m),
            valores: valoresPorSeg.get(s.id as string) ?? {}
          }))
        out.set(trechoId, {
          ...(versaoEscolhida as unknown as TrechoQuantidadeVersaoCompleta),
          colunas,
          segmentos
        } as TrechoQuantidadeVersaoCompleta)
      }

      return out
    }
  })
}

interface OpcoesTracos {
  /** Quando 'uniforme', ignora template e desenha reta (debug/preview). */
  geom: 'perfilada' | 'uniforme'
  /** Trechos a considerar (vazio = todos os trechos com tarefas). */
  trechoIds?: string[]
  /** Granularidade temporal: define a resolução de pontos na polilinha. */
  granularidadeTempo: GranularidadeTempo
}

/**
 * Hook React: dado lista de tarefas completas e map de templates por trecho,
 * retorna polilinhas (`TracoTarefa[]`) para cada tarefa direta com posição.
 *
 * Filtra:
 *   * is_indireto = true (cobre tudo, sem posição)
 *   * tipo_no !== 'tarefa' (grupos, marcos)
 *   * sem trecho_id, sem posições, sem data_inicio/fim
 */
export function useTracosMarchaTempo(
  tarefas: PlanejamentoTarefaCompleta[],
  templatesPorTrecho: Map<string, TrechoQuantidadeVersaoCompleta | null>,
  opcoes: OpcoesTracos
): TracoTarefa[] {
  return useMemo(() => {
    const out: TracoTarefa[] = []
    for (const t of tarefas) {
      if (t.tipo_no !== 'tarefa') continue
      if (t.is_indireto) continue
      if (!t.trecho_id) continue
      if (t.posicao_inicio_m == null || t.posicao_fim_m == null) continue
      if (!t.data_inicio || !t.data_fim) continue
      if (opcoes.trechoIds && opcoes.trechoIds.length > 0 && !opcoes.trechoIds.includes(t.trecho_id)) {
        continue
      }

      const posIni = Number(t.posicao_inicio_m)
      const posFim = Number(t.posicao_fim_m)
      const direcao: 1 | -1 = posFim >= posIni ? 1 : -1
      const durDias = Number(t.duracao_dias_uteis_calc ?? 0)
      const qtdAlocada = Number(t.quantidade_alocada ?? 0)

      const template = templatesPorTrecho.get(t.trecho_id) ?? null
      const segs =
        opcoes.geom === 'perfilada'
          ? segmentosPorColuna(template, t.qtd_link)
          : []
      const perfil = t.perfil_semanas ?? []

      let ilhas: PontoTraco[][] = []
      let modo: 'perfilada' | 'uniforme' = 'uniforme'

      const podePerfilar =
        opcoes.geom === 'perfilada' && segs.length > 0 && perfil.length > 0

      if (podePerfilar) {
        // Resolve granularidade → dias por sample com base no span da tarefa.
        const tIniMs = new Date(`${t.data_inicio}T00:00:00Z`).getTime()
        const tFimMs = new Date(`${t.data_fim}T00:00:00Z`).getTime()
        const resolucaoDias = granularidadeParaResolucaoDias(
          tIniMs,
          tFimMs,
          opcoes.granularidadeTempo
        )
        ilhas = tracarPerfiladaIlhas({
          dataInicio: t.data_inicio,
          dataFim: t.data_fim,
          posIni,
          posFim,
          segmentosColuna: segs,
          perfil,
          resolucaoDias
        })
        if (ilhas.length > 0) {
          modo = 'perfilada'
        }
      }

      if (ilhas.length === 0) {
        ilhas = tracarUniforme({
          dataInicio: t.data_inicio,
          dataFim: t.data_fim,
          posIni,
          posFim
        })
        modo = 'uniforme'
      }

      const compEspacial = Math.abs(posFim - posIni)
      out.push({
        tarefaId: t.id,
        trechoId: t.trecho_id,
        ilhas,
        modo,
        cor: corDaTarefa(t),
        label: tarefaLabel(t),
        codigo: t.servico_grupo_codigo ?? t.codigo_eap,
        qtdTotal: qtdAlocada,
        unidadeQtd: t.unidade_servico ?? t.producao_diaria_unidade ?? null,
        prodMediaPorDia: durDias > 0 ? qtdAlocada / durDias : 0,
        prodMediaEspacial: durDias > 0 ? compEspacial / durDias : 0,
        dataInicio: t.data_inicio,
        dataFim: t.data_fim,
        posIniM: posIni,
        posFimM: posFim,
        direcao
      })
    }
    return out
  }, [
    tarefas,
    templatesPorTrecho,
    opcoes.geom,
    opcoes.trechoIds,
    opcoes.granularidadeTempo
  ])
}

function corDaTarefa(t: PlanejamentoTarefaCompleta): string {
  // Usa helper compartilhado da lib — mesma cor é aplicada nas faixas de
  // quantidade quando a coluna do template casa com o código do serviço.
  const chave = t.servico_grupo_codigo ?? t.codigo_eap ?? t.id
  return corDoServico(chave)
}

function tarefaLabel(t: PlanejamentoTarefaCompleta): string {
  const codigo = t.servico_grupo_codigo ?? ''
  const desc = t.nome_custom ?? t.servico_grupo_descricao ?? ''
  return `${codigo}${codigo && desc ? ' · ' : ''}${desc}`.trim() || t.id.slice(0, 8)
}
