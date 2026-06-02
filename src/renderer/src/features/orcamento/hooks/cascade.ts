// Preview de cascata de exclusão para módulo Orçamento.
//
// Cada função examina dependências FK ANTES do delete e retorna contagens,
// para a UI exibir confirmação clara: "vai apagar X, vai orfanizar Y".
//
// Mapeamento das FKs relevantes:
//   recurso ─→ cpu_item (RESTRICT) ─→ cpu (CASCADE de cpu_item)
//                                  ─→ item_orcamentario.cpu_id_origem (SET NULL)
//   cpu ─────→ cpu_item (CASCADE)
//          ──→ item_orcamentario.cpu_id_origem    (SET NULL)
//          ──→ item_orcamentario.cpu_snapshot_id  (SET NULL, via cpu_snapshot)
//          ──→ servico_cpu_link.cpu_id            (CASCADE)
//   servico ─→ cpu.servico_id              (SET NULL — CPU vira órfã, não bloqueia)
//          ──→ item_orcamentario.servico_id (RESTRICT — bloqueia)
//          ──→ servico.parent_id           (RESTRICT — cascateamos manual)
//          ──→ servico_cpu_link.servico_id (CASCADE)
//          ──→ acompanhamento_servico_match.servico_id (SET NULL)
//   item_orcamentario ─→ item_orcamentario.parent_id (RESTRICT — cascateamos manual)
//                     ─→ planejamento_tarefa (SET NULL, após migração)
//                     ─→ revisao_item (CASCADE)

import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

export interface RecursoCascadePreview {
  cpuItensAfetados: number
  cpusAfetadas: number
  itensOrcamentoComCpuOrigem: number
  /** cpu_item IDs que serão removidos para liberar o delete. */
  cpuItemIdsParaApagar: string[]
}

export async function previewCascadeRecursos(recursoIds: string[]): Promise<RecursoCascadePreview> {
  if (!SUPABASE_ENABLED || !supabase) notReady()
  if (recursoIds.length === 0) {
    return {
      cpuItensAfetados: 0,
      cpusAfetadas: 0,
      itensOrcamentoComCpuOrigem: 0,
      cpuItemIdsParaApagar: []
    }
  }
  const { data: cpuItens, error } = await supabase
    .from('cpu_item')
    .select('id, cpu_id')
    .in('recurso_id', recursoIds)
  if (error) throw error
  const cpuIds = Array.from(new Set((cpuItens ?? []).map((r) => r.cpu_id as string)))
  let itensOrcamento = 0
  if (cpuIds.length > 0) {
    const { count } = await supabase
      .from('item_orcamentario')
      .select('id', { count: 'exact', head: true })
      .in('cpu_id_origem', cpuIds)
    itensOrcamento = count ?? 0
  }
  return {
    cpuItensAfetados: cpuItens?.length ?? 0,
    cpusAfetadas: cpuIds.length,
    itensOrcamentoComCpuOrigem: itensOrcamento,
    cpuItemIdsParaApagar: (cpuItens ?? []).map((r) => r.id as string)
  }
}

export interface CpuCascadePreview {
  cpuItensQueIraoEmbora: number
  itensOrcamentoComCpuOrigem: number
}

export async function previewCascadeCpus(cpuIds: string[]): Promise<CpuCascadePreview> {
  if (!SUPABASE_ENABLED || !supabase) notReady()
  if (cpuIds.length === 0) {
    return { cpuItensQueIraoEmbora: 0, itensOrcamentoComCpuOrigem: 0 }
  }
  const [{ count: cpuItensCount }, { count: itensCount }] = await Promise.all([
    supabase.from('cpu_item').select('id', { count: 'exact', head: true }).in('cpu_id', cpuIds),
    supabase
      .from('item_orcamentario')
      .select('id', { count: 'exact', head: true })
      .in('cpu_id_origem', cpuIds)
  ])
  return {
    cpuItensQueIraoEmbora: cpuItensCount ?? 0,
    itensOrcamentoComCpuOrigem: itensCount ?? 0
  }
}

export interface ItemOrcamentarioCascadePreview {
  /** Total considerando descendentes (cascade manual via parent_id). */
  totalParaApagar: number
  /** Apenas descendentes (totalParaApagar − selecionados). */
  descendentesEmCascata: number
  /** Tarefas de planejamento que ficarão órfãs (SET NULL). */
  tarefasQueFicarOrfas: number
  /** IDs em ordem segura de exclusão (filhos antes dos pais). */
  idsOrdenadosParaDelete: string[]
}

interface FlatItem {
  id: string
  nivel: number | null
}

export async function previewCascadeItensOrcamentarios(
  itemIds: string[],
  allFlat: { id: string; parent_id: string | null; nivel: number | null }[]
): Promise<ItemOrcamentarioCascadePreview> {
  if (!SUPABASE_ENABLED || !supabase) notReady()
  if (itemIds.length === 0) {
    return {
      totalParaApagar: 0,
      descendentesEmCascata: 0,
      tarefasQueFicarOrfas: 0,
      idsOrdenadosParaDelete: []
    }
  }

  // Expansão de descendentes via flat (ja temos a árvore no client).
  const childrenByParent = new Map<string, string[]>()
  const nivelById = new Map<string, number | null>()
  for (const it of allFlat) {
    nivelById.set(it.id, it.nivel)
    if (it.parent_id) {
      const arr = childrenByParent.get(it.parent_id) ?? []
      arr.push(it.id)
      childrenByParent.set(it.parent_id, arr)
    }
  }
  const universo = new Set<string>(itemIds)
  const stack: string[] = [...itemIds]
  while (stack.length > 0) {
    const cur = stack.pop()!
    const filhos = childrenByParent.get(cur) ?? []
    for (const f of filhos) {
      if (!universo.has(f)) {
        universo.add(f)
        stack.push(f)
      }
    }
  }

  const todos: FlatItem[] = Array.from(universo).map((id) => ({
    id,
    nivel: nivelById.get(id) ?? 0
  }))

  // Conta tarefas vinculadas a quaisquer desses items.
  const { count: tarefasCount } = await supabase
    .from('planejamento_tarefa')
    .select('id', { count: 'exact', head: true })
    .in('item_orcamentario_id', Array.from(universo))

  const ordenados = todos.sort((a, b) => (b.nivel ?? 0) - (a.nivel ?? 0)).map((x) => x.id)

  return {
    totalParaApagar: universo.size,
    descendentesEmCascata: universo.size - itemIds.length,
    tarefasQueFicarOrfas: tarefasCount ?? 0,
    idsOrdenadosParaDelete: ordenados
  }
}

// ─── Servicos ────────────────────────────────────────────────────────────

export interface ServicoCascadePreview {
  /** Total considerando descendentes (cascade manual via parent_id). */
  totalParaApagar: number
  /** Apenas descendentes (totalParaApagar − selecionados). */
  descendentesEmCascata: number
  /** CPUs que ficarão órfãs (SET NULL). Não bloqueia o delete. */
  cpusOrfanizadas: number
  /** Itens orçamentários que apontam pra esses servicos (FK RESTRICT). */
  itensOrcamentoBloqueando: number
  /** Vínculos servico_cpu_link que serão arrastados (CASCADE). */
  vinculosCpuLink: number
  /** IDs em ordem segura de delete (filhos antes dos pais). */
  idsOrdenadosParaDelete: string[]
  /** Se há bloqueios (items), delete vai falhar. */
  bloqueado: boolean
}

export async function previewCascadeServicos(
  servicoIds: string[],
  allServicos: { id: string; parent_id: string | null; nivel: number | null }[]
): Promise<ServicoCascadePreview> {
  if (!SUPABASE_ENABLED || !supabase) notReady()
  if (servicoIds.length === 0) {
    return {
      totalParaApagar: 0,
      descendentesEmCascata: 0,
      cpusOrfanizadas: 0,
      itensOrcamentoBloqueando: 0,
      vinculosCpuLink: 0,
      idsOrdenadosParaDelete: [],
      bloqueado: false
    }
  }

  // Expande descendentes (FK servico.parent_id é RESTRICT, então precisamos
  // cascatear manualmente em ordem nível-DESC).
  const childrenByParent = new Map<string, string[]>()
  const nivelById = new Map<string, number | null>()
  for (const s of allServicos) {
    nivelById.set(s.id, s.nivel)
    if (s.parent_id) {
      const arr = childrenByParent.get(s.parent_id) ?? []
      arr.push(s.id)
      childrenByParent.set(s.parent_id, arr)
    }
  }
  const universo = new Set<string>(servicoIds)
  const stack: string[] = [...servicoIds]
  while (stack.length > 0) {
    const cur = stack.pop()!
    const filhos = childrenByParent.get(cur) ?? []
    for (const f of filhos) {
      if (!universo.has(f)) {
        universo.add(f)
        stack.push(f)
      }
    }
  }
  const idsArr = Array.from(universo)

  const [cpus, itens, vinculos] = await Promise.all([
    supabase.from('cpu').select('id', { count: 'exact', head: true }).in('servico_id', idsArr),
    supabase
      .from('item_orcamentario')
      .select('id', { count: 'exact', head: true })
      .in('servico_id', idsArr),
    supabase
      .from('servico_cpu_link')
      .select('id', { count: 'exact', head: true })
      .in('servico_id', idsArr)
  ])

  const cpusOrfanizadas = cpus.count ?? 0
  const itensOrcamentoBloqueando = itens.count ?? 0
  const vinculosCpuLink = vinculos.count ?? 0

  const ordenados = idsArr
    .map((id) => ({ id, nivel: nivelById.get(id) ?? 0 }))
    .sort((a, b) => (b.nivel ?? 0) - (a.nivel ?? 0))
    .map((x) => x.id)

  return {
    totalParaApagar: universo.size,
    descendentesEmCascata: universo.size - servicoIds.length,
    cpusOrfanizadas,
    itensOrcamentoBloqueando,
    vinculosCpuLink,
    idsOrdenadosParaDelete: ordenados,
    bloqueado: itensOrcamentoBloqueando > 0
  }
}
