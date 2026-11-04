/**
 * Composições vivas dos serviços do plano (para o histograma de material e combustível): as CPUs vinculadas ao
 * serviço (`servico_cpu_link`, com fator e operação) ou, sem vínculo, a CPU vigente do serviço — a mesma escolha de
 * `servico_equipe_viva` — com os itens e os recursos.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type { RecursoGrupo } from '@/types/orcamento'

export interface ItemComposicao {
  grupo: 'MO' | 'EQUIPAMENTO' | 'MATERIAL' | 'COMBUSTIVEL'
  recurso: { id: string; nome: string; unidade: string; grupo: RecursoGrupo }
  /** MO/equipamento: contagem; material: quantidade por dia (sem consumo por unidade) */
  quantidade: number
  horas_dia: number
  consumo_combustivel_lh: number
  indice_produtividade: number
  consumo_material_por_unid: number | null
}

export interface UnidadeComposicao {
  fator: number
  operacao: 'dividir' | 'multiplicar'
  /** produção diária da CPU */
  producao: number
  itens: ItemComposicao[]
}

const n = (v: unknown, d = 0): number => (v === null || v === undefined || v === '' ? d : Number(v))

export function useComposicoesServicos(
  obraId: string | null | undefined,
  servicoIds: string[]
): ReturnType<typeof useQuery<Map<string, UnidadeComposicao[]>>> {
  const ids = [...new Set(servicoIds)].sort()
  return useQuery({
    queryKey: ['cronograma', 'composicoes-servicos', obraId, ids.join(',')],
    enabled: !!obraId && ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      if (!SUPABASE_ENABLED || !supabase) throw new Error('Supabase não configurado.')
      const c = supabase
      const [{ data: links, error: e1 }, { data: vigentes, error: e2 }] = await Promise.all([
        c
          .from('servico_cpu_link')
          .select('servico_id, cpu_id, fator, operacao')
          .in('servico_id', ids),
        c.from('cpu').select('id, servico_id').in('servico_id', ids).eq('is_vigente', true)
      ])
      if (e1) throw e1
      if (e2) throw e2
      const porServico = new Map<string, { cpu_id: string; fator: number; operacao: string }[]>()
      for (const l of links ?? [])
        porServico.set(l.servico_id as string, [
          ...(porServico.get(l.servico_id as string) ?? []),
          {
            cpu_id: l.cpu_id as string,
            fator: n(l.fator, 1),
            operacao: (l.operacao as string) ?? 'dividir'
          }
        ])
      for (const v of vigentes ?? [])
        if (!porServico.has(v.servico_id as string))
          porServico.set(v.servico_id as string, [
            { cpu_id: v.id as string, fator: 1, operacao: 'dividir' }
          ])
      const cpuIds = [...new Set([...porServico.values()].flat().map((x) => x.cpu_id))]
      if (!cpuIds.length) return new Map()
      const [{ data: cpus, error: e3 }, { data: itens, error: e4 }] = await Promise.all([
        c.from('cpu').select('id, producao_diaria_qtde').in('id', cpuIds),
        c
          .from('cpu_item')
          .select(
            'cpu_id, grupo, quantidade, horas_dia, consumo_combustivel_lh, indice_produtividade, consumo_material_por_unid, recurso:recurso_id(id, nome, unidade, grupo)'
          )
          .in('cpu_id', cpuIds)
      ])
      if (e3) throw e3
      if (e4) throw e4
      const producao = new Map((cpus ?? []).map((x) => [x.id as string, n(x.producao_diaria_qtde)]))
      const itensPorCpu = new Map<string, ItemComposicao[]>()
      for (const it of itens ?? []) {
        const raw = (it as unknown as { recurso: unknown }).recurso
        const r = (Array.isArray(raw) ? raw[0] : raw) as {
          id: string
          nome: string
          unidade: string | null
          grupo: RecursoGrupo
        } | null
        if (!r) continue
        const lista = itensPorCpu.get(it.cpu_id as string) ?? []
        lista.push({
          grupo: it.grupo as ItemComposicao['grupo'],
          recurso: { id: r.id, nome: r.nome, unidade: r.unidade ?? '', grupo: r.grupo },
          quantidade: n(it.quantidade),
          horas_dia: n(it.horas_dia),
          consumo_combustivel_lh: n(it.consumo_combustivel_lh),
          indice_produtividade: n(it.indice_produtividade, 1) || 1,
          consumo_material_por_unid:
            it.consumo_material_por_unid === null ? null : n(it.consumo_material_por_unid)
        })
        itensPorCpu.set(it.cpu_id as string, lista)
      }
      const out = new Map<string, UnidadeComposicao[]>()
      for (const [servico, ls] of porServico)
        out.set(
          servico,
          ls.map((l) => ({
            fator: l.fator || 1,
            operacao: l.operacao === 'multiplicar' ? 'multiplicar' : 'dividir',
            producao: producao.get(l.cpu_id) ?? 0,
            itens: itensPorCpu.get(l.cpu_id) ?? []
          }))
        )
      return out
    }
  })
}
