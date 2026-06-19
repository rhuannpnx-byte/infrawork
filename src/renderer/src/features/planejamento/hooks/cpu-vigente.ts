// Composição AO VIVO (CPU vigente) por serviço — alternativa ao cpu_snapshot
// congelado, para o Histograma refletir edições recentes nas CPUs.
//
// Resolve do mesmo jeito que o snapshot-cpu-no-item:
//   - serviço COM servico_cpu_link → agregador (as CPUs vinculadas + fator/operação)
//   - serviço SEM vínculo → legado (a CPU vigente do serviço)
// Edições de CPU são in-place (mesmo cpu_id), então ler cpu_item atual reflete a
// mudança imediatamente.

import { useQuery } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type { CpuSnapshotPayloadCpuItem, ServicoCpuOperacao } from '@/types/orcamento'
import type { UnidadeCpu } from '@/features/planejamento/lib/histograma-recursos'

interface LinkRow {
  servico_id: string
  cpu_id: string
  fator: number | null
  operacao: ServicoCpuOperacao | null
  ordem: number
}

/** Monta um CpuSnapshotPayloadCpuItem a partir de uma linha de cpu_item viva. */
function itemDeCpuItem(it: Record<string, unknown>): CpuSnapshotPayloadCpuItem {
  const r = (it.recurso as CpuSnapshotPayloadCpuItem['recurso'] | null) ?? {
    id: String(it.recurso_id ?? ''),
    nome: '—',
    unidade: '',
    grupo: 'MATERIAL',
    codigo: null
  }
  return {
    id: String(it.id ?? ''),
    grupo: it.grupo as CpuSnapshotPayloadCpuItem['grupo'],
    recurso_id: String(it.recurso_id ?? r.id),
    quantidade: Number(it.quantidade) || 0,
    horas_dia: it.horas_dia == null ? null : Number(it.horas_dia),
    consumo_combustivel_lh:
      it.consumo_combustivel_lh == null ? null : Number(it.consumo_combustivel_lh),
    indice_produtividade: Number(it.indice_produtividade) || 1,
    consumo_material_por_unid:
      it.consumo_material_por_unid == null ? null : Number(it.consumo_material_por_unid),
    ordem: Number(it.ordem) || 0,
    custo_total_calc: Number(it.custo_total_calc) || 0,
    recurso: r,
    preco_vigente: null
  }
}

/**
 * Para os serviços dados, devolve Map<servico_id, UnidadeCpu[]> com a composição
 * VIGENTE (ao vivo). Use como `resolver` em calcularHistogramaRecursos.
 */
export function useComposicoesVigentes(
  obraId: string | undefined,
  servicoIds: string[] | undefined
): ReturnType<typeof useQuery<Map<string, UnidadeCpu[]>>> {
  const ids = Array.from(new Set((servicoIds ?? []).filter(Boolean))).sort()
  return useQuery({
    queryKey: ['planejamento', 'composicoes-vigentes', obraId, ids],
    enabled: !!obraId && ids.length > 0,
    queryFn: async (): Promise<Map<string, UnidadeCpu[]>> => {
      if (!SUPABASE_ENABLED || !supabase) throw new Error('Supabase não configurado.')

      // 1) vínculos (agregador) dos serviços
      const { data: linksRaw } = await supabase
        .from('servico_cpu_link')
        .select('servico_id, cpu_id, fator, operacao, ordem')
        .in('servico_id', ids)
        .order('ordem')
      const links = (linksRaw ?? []) as LinkRow[]
      const linksPorServico = new Map<string, LinkRow[]>()
      for (const l of links) {
        const arr = linksPorServico.get(l.servico_id) ?? []
        arr.push(l)
        linksPorServico.set(l.servico_id, arr)
      }

      // 2) serviços sem vínculo → CPU vigente (legado)
      const servicosSemLink = ids.filter((s) => !linksPorServico.has(s))
      const { data: cpusVigRaw } = servicosSemLink.length
        ? await supabase
            .from('cpu')
            .select('id, servico_id, producao_diaria_qtde')
            .eq('obra_id', obraId!)
            .eq('is_vigente', true)
            .in('servico_id', servicosSemLink)
        : { data: [] as Record<string, unknown>[] }
      const cpuVigentePorServico = new Map<string, { id: string; pCpu: number }>()
      for (const c of (cpusVigRaw ?? []) as Record<string, unknown>[]) {
        cpuVigentePorServico.set(c.servico_id as string, {
          id: c.id as string,
          pCpu: Number(c.producao_diaria_qtde) || 1
        })
      }

      // 3) carrega produção/dia de TODAS as CPUs envolvidas + os cpu_item
      const cpuIds = Array.from(
        new Set([
          ...links.map((l) => l.cpu_id),
          ...[...cpuVigentePorServico.values()].map((c) => c.id)
        ])
      )
      if (cpuIds.length === 0) return new Map()

      const [{ data: cpusRaw }, { data: itensRaw }] = await Promise.all([
        supabase.from('cpu').select('id, producao_diaria_qtde').in('id', cpuIds),
        supabase
          .from('cpu_item')
          .select(
            'id, cpu_id, grupo, recurso_id, quantidade, horas_dia, consumo_combustivel_lh, indice_produtividade, consumo_material_por_unid, ordem, custo_total_calc, recurso:recurso_id(id, nome, unidade, grupo, codigo)'
          )
          .in('cpu_id', cpuIds)
          .order('ordem')
      ])
      const pCpuById = new Map<string, number>()
      for (const c of (cpusRaw ?? []) as Record<string, unknown>[]) {
        pCpuById.set(c.id as string, Number(c.producao_diaria_qtde) || 1)
      }
      const itensPorCpu = new Map<string, CpuSnapshotPayloadCpuItem[]>()
      for (const it of (itensRaw ?? []) as Record<string, unknown>[]) {
        const cid = it.cpu_id as string
        const arr = itensPorCpu.get(cid) ?? []
        arr.push(itemDeCpuItem(it))
        itensPorCpu.set(cid, arr)
      }

      // 4) monta UnidadeCpu[] por serviço
      const out = new Map<string, UnidadeCpu[]>()
      for (const servicoId of ids) {
        const ls = linksPorServico.get(servicoId)
        if (ls && ls.length > 0) {
          out.set(
            servicoId,
            ls.map((l) => ({
              fator: Number(l.fator) || 1,
              operacao: l.operacao ?? 'dividir',
              pCpu: pCpuById.get(l.cpu_id) || 1,
              itens: itensPorCpu.get(l.cpu_id) ?? []
            }))
          )
          continue
        }
        const vig = cpuVigentePorServico.get(servicoId)
        if (vig) {
          out.set(servicoId, [
            {
              fator: 1,
              operacao: 'dividir',
              pCpu: vig.pCpu,
              itens: itensPorCpu.get(vig.id) ?? []
            }
          ])
        }
      }
      return out
    }
  })
}
