import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidarCadeia } from '@/lib/query/cadeia'
import { supabase } from '@/lib/supabase/client'
import type {
  AlocInfo,
  AlocStatus,
  CpuItemGrupo,
  ItemAlocacao,
  ItemDetalhe,
  ItemOrcamentario,
  ItemTipo,
  ItemTreeNode,
  QtdRefModo
} from '@/types/orcamento'

const ITEM_COLUNAS =
  'id, obra_id, parent_id, nivel, codigo, descricao, tipo, unidade, servico_id, quantidade, ' +
  'venda_unitaria, indireto_id, quantidade_referencia, unidade_referencia, ' +
  'qtd_ref_modo, qtd_ref_filhos, ordem, custo_unitario_calc, custo_total_calc, ' +
  'venda_total_calc, lucratividade_perc_calc, aditivo_id, created_at, updated_at'

const ALOC_COLUNAS = 'id, obra_id, grupo_id, receita_id, criterio, valor, bases, compoe_qtd, fracao'

// ─── Planilha de venda + serviços + alocações ─────────────────────────────

export interface PlanOrcData {
  /** Planilha de venda (etapas + receitas) em DFS — sem os serviços. */
  flat: ItemTreeNode[]
  tree: ItemTreeNode[]
  /** Serviços (agrupadores), fora da árvore de venda, por código. */
  servicos: ItemOrcamentario[]
  alocacoes: ItemAlocacao[]
  /** Situação de alocação por receita e por etapa (agregada pela venda). */
  alocInfo: Map<string, AlocInfo>
  /** Venda total da planilha e quanto dela já está nos serviços. */
  totais: { venda: number; agrupado: number }
}

export function usePlanOrc(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<PlanOrcData>> {
  return useQuery({
    queryKey: ['orcamento', 'plan-orc', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<PlanOrcData> => {
      const [itensRes, alocRes] = await Promise.all([
        supabase
          .from('item_orcamentario')
          .select(ITEM_COLUNAS)
          .eq('obra_id', obraId!)
          .order('codigo'),
        supabase.from('item_orc_alocacao').select(ALOC_COLUNAS).eq('obra_id', obraId!)
      ])
      if (itensRes.error) throw itensRes.error
      if (alocRes.error) throw alocRes.error
      const itens = (itensRes.data ?? []) as unknown as ItemOrcamentario[]
      const alocacoes = ((alocRes.data ?? []) as unknown as ItemAlocacao[]).map((a) => ({
        ...a,
        valor: a.valor === null ? null : Number(a.valor),
        fracao: Number(a.fracao)
      }))
      return buildPlanOrcTree(itens, alocacoes)
    }
  })
}

const FULL = 0.9999

/** Constrói a árvore da planilha de venda, a lista de serviços e a situação de alocação. */
export function buildPlanOrcTree(
  itens: ItemOrcamentario[],
  alocacoes: ItemAlocacao[] = []
): PlanOrcData {
  const servicos = itens
    .filter((i) => i.tipo === 'servico_grupo')
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
  const servicoById = new Map(servicos.map((s) => [s.id, s]))
  const venda = itens.filter((i) => i.tipo !== 'servico_grupo')

  const byId = new Map<string, ItemTreeNode>()
  for (const it of venda) byId.set(it.id, { ...it, children: [], depth: 0 })
  const roots: ItemTreeNode[] = []
  for (const it of venda) {
    const node = byId.get(it.id)!
    if (it.parent_id && byId.has(it.parent_id)) byId.get(it.parent_id)!.children.push(node)
    else roots.push(node)
  }
  const sortRec = (arr: ItemTreeNode[]): void => {
    arr.sort((a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo))
    arr.forEach((n) => sortRec(n.children))
  }
  sortRec(roots)

  // Alocações por receita
  const alocPorReceita = new Map<string, ItemAlocacao[]>()
  for (const a of alocacoes) {
    const arr = alocPorReceita.get(a.receita_id) ?? []
    arr.push(a)
    alocPorReceita.set(a.receita_id, arr)
  }
  const alocInfo = new Map<string, AlocInfo>()

  // Rollup (post-order) de venda/custo das etapas e da venda alocada.
  // O custo das receitas é o apropriado dos serviços (calculado no banco).
  const rollup = (n: ItemTreeNode): { venda: number; custo: number; alocada: number } => {
    if (n.tipo === 'receita') {
      const lista = alocPorReceita.get(n.id) ?? []
      const fracao = Math.min(
        1,
        lista.reduce((acc, a) => acc + (a.fracao || 0), 0)
      )
      const status: AlocStatus =
        lista.length === 0
          ? 'sem'
          : fracao < FULL
            ? 'saldo'
            : lista.length > 1
              ? 'rateado'
              : 'unico'
      alocInfo.set(n.id, {
        status,
        fracao,
        destinos: lista
          .map((a) => ({ servico: servicoById.get(a.grupo_id)!, alocacao: a }))
          .filter((d) => !!d.servico)
          .sort((a, b) => b.alocacao.fracao - a.alocacao.fracao)
      })
      const v = n.venda_total_calc ?? 0
      return { venda: v, custo: n.custo_total_calc ?? 0, alocada: v * fracao }
    }
    let v = 0
    let c = 0
    let al = 0
    for (const ch of n.children) {
      const s = rollup(ch)
      v += s.venda
      c += s.custo
      al += s.alocada
    }
    // venda/custo das etapas = soma dos filhos (mesmo valor do banco, à prova de
    // cache defasado); a lucratividade vem do banco (inclui a alíquota da obra).
    n.venda_total_calc = v
    n.custo_total_calc = c
    const fracao = v > 0 ? al / v : 0
    alocInfo.set(n.id, {
      status: fracao <= 0 ? 'sem' : fracao < FULL ? 'saldo' : 'unico',
      fracao,
      destinos: []
    })
    return { venda: v, custo: c, alocada: al }
  }
  let totalVenda = 0
  let totalAlocado = 0
  for (const r of roots) {
    const s = rollup(r)
    totalVenda += s.venda
    totalAlocado += s.alocada
  }

  const flat: ItemTreeNode[] = []
  const visit = (nodes: ItemTreeNode[], depth: number): void => {
    for (const n of nodes) {
      n.depth = depth
      flat.push(n)
      if (n.children.length > 0) visit(n.children, depth + 1)
    }
  }
  visit(roots, 0)
  return {
    flat,
    tree: roots,
    servicos,
    alocacoes,
    alocInfo,
    totais: { venda: totalVenda, agrupado: totalAlocado }
  }
}

// ─── Detalhe do item ────────────────────────────────────────────

export function useItemDetalhe(
  id: string | null | undefined
): ReturnType<typeof useQuery<ItemDetalhe>> {
  return useQuery({
    queryKey: ['orcamento', 'item-detalhe', id],
    enabled: !!id,
    queryFn: async (): Promise<ItemDetalhe> => {
      const { data, error } = await supabase
        .from('item_orcamentario')
        .select(ITEM_COLUNAS + ', servico:servico_id(id, codigo, nome, unidade)')
        .eq('id', id!)
        .single()
      if (error) throw error
      const item = data as unknown as ItemDetalhe

      return item
    }
  })
}

// ─── Mutations ────────────────────────────────────────────────────────────

export interface UpsertItemInput {
  id?: string
  obra_id: string
  parent_id?: string | null
  codigo?: string
  descricao?: string
  tipo: ItemTipo
  unidade?: string | null
  servico_id?: string | null
  quantidade?: number | null
  venda_unitaria?: number | null
  quantidade_referencia?: number | null
  unidade_referencia?: string | null
  qtd_ref_modo?: QtdRefModo | null
  ordem?: number
}

export function useUpsertItem(): ReturnType<
  typeof useMutation<{ id: string }, Error, UpsertItemInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }) => {
      if (id) {
        const { error } = await supabase.from('item_orcamentario').update(body).eq('id', id)
        if (error) throw error
        return { id }
      }
      const insertPayload = {
        obra_id: body.obra_id,
        parent_id: body.parent_id ?? null,
        codigo: body.codigo ?? null,
        descricao: body.descricao ?? 'Sem descrição',
        tipo: body.tipo,
        unidade: body.unidade ?? null,
        servico_id: body.servico_id ?? null,
        quantidade: body.quantidade ?? null,
        venda_unitaria: body.venda_unitaria ?? null,
        quantidade_referencia: body.quantidade_referencia ?? null,
        unidade_referencia: body.unidade_referencia ?? null,
        qtd_ref_modo: body.qtd_ref_modo ?? null,
        ordem: body.ordem ?? 0
      }
      const { data, error } = await supabase
        .from('item_orcamentario')
        .insert(insertPayload)
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: () => {
      invalidarCadeia(qc)
    }
  })
}

export function useDeleteItem(): ReturnType<
  typeof useMutation<void, Error, { id: string; obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('item_orcamentario').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidarCadeia(qc)
    }
  })
}

/**
 * Sobe ou desce o item entre os irmãos (mesmo parent). Renumera todos os
 * irmãos em múltiplos de 10 para garantir resultado estável.
 */
export function useReorderItem(): ReturnType<
  typeof useMutation<void, Error, { id: string; obra_id: string; direction: 'up' | 'down' }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, obra_id, direction }) => {
      const { data: item } = await supabase
        .from('item_orcamentario')
        .select('id, parent_id, ordem')
        .eq('id', id)
        .single()
      if (!item) throw new Error('Item não encontrado')

      let q = supabase.from('item_orcamentario').select('id, ordem, codigo').eq('obra_id', obra_id)
      if (item.parent_id === null) q = q.is('parent_id', null).neq('tipo', 'servico_grupo')
      else q = q.eq('parent_id', item.parent_id)
      const { data: irmaos } = await q
      const lista = ((irmaos ?? []) as { id: string; ordem: number; codigo: string }[]).sort(
        (a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.codigo.localeCompare(b.codigo)
      )

      const idx = lista.findIndex((x) => x.id === id)
      if (idx === -1) return
      const newIdx = direction === 'up' ? idx - 1 : idx + 1
      if (newIdx < 0 || newIdx >= lista.length) return

      const reordered = lista.slice()
      ;[reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]]

      // Aplica ordens novas (10, 20, 30…) somente onde mudou.
      for (let i = 0; i < reordered.length; i++) {
        const novaOrdem = (i + 1) * 10
        if (reordered[i].ordem === novaOrdem) continue
        const { error } = await supabase
          .from('item_orcamentario')
          .update({ ordem: novaOrdem })
          .eq('id', reordered[i].id)
        if (error) throw error
      }
    },
    onSuccess: () => {
      invalidarCadeia(qc)
    }
  })
}

// ─── Editar um servico_grupo já criado ────────────────────────────────────

export interface AtualizarAgrupadorInput {
  id: string
  obra_id: string
  descricao: string
  /** Serviço de custo vinculado (CPU). Null mantém/zera o vínculo. */
  servico_id: string | null
  /** Item de indireto que dá o custo (exclusivo com servico_id). */
  indireto_id?: string | null
  unidade_referencia: string | null
  qtd_ref_modo: QtdRefModo
  /** Já calculada conforme o modo (manual/herança/soma) e os filhos escolhidos. */
  /** Só no modo manual; nos demais o recálculo usa as receitas que compõem. */
  quantidade_referencia: number
}

/**
 * Edita um agrupador (servico_grupo) existente — descrição, serviço de custo,
 * modo de quantidade (manual/herança/soma) e quais filhos são a referência.
 * O custo vem ao vivo da composição e o orçamento se recalcula no banco.
 */
export function useAtualizarAgrupador(): ReturnType<
  typeof useMutation<{ id: string }, Error, AtualizarAgrupadorInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (b) => {
      const patch: Record<string, unknown> = {
        descricao: b.descricao,
        servico_id: b.servico_id,
        ...(b.indireto_id !== undefined ? { indireto_id: b.indireto_id } : {}),
        unidade_referencia: b.unidade_referencia,
        qtd_ref_modo: b.qtd_ref_modo,
        quantidade_referencia: b.quantidade_referencia
      }
      const { error } = await supabase.from('item_orcamentario').update(patch).eq('id', b.id)
      if (error) throw error

      return { id: b.id }
    },
    onSuccess: () => {
      invalidarCadeia(qc)
    }
  })
}

/** Move o item para outro pai na planilha de venda (etapa ou raiz). */
export function useReparentItem(): ReturnType<
  typeof useMutation<void, Error, { id: string; obra_id: string; new_parent_id: string | null }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, new_parent_id }) => {
      const { error } = await supabase
        .from('item_orcamentario')
        .update({ parent_id: new_parent_id })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidarCadeia(qc)
    }
  })
}

// ─── Composição ao vivo do serviço (aba "Composição" do detalhe) ──────────

export interface ComposicaoViva {
  custo_unit: number | null
  producao_diaria_qtde: number | null
  producao_diaria_unidade: string | null
  custo_eq_dia: number | null
  custo_comb_dia: number | null
  custo_mo_dia: number | null
  custo_mat_dia: number | null
  modo: 'agregador' | 'legado'
  itens: Array<{
    id: string
    grupo: CpuItemGrupo
    quantidade: number
    custo_total_calc: number
    recurso: { nome: string; unidade: string } | null
  }>
}

/** Custo/produção vigentes da composição do serviço (vw_servico_vivo) + insumos. */
export function useComposicaoViva(
  servicoId: string | null | undefined
): ReturnType<typeof useQuery<ComposicaoViva | null>> {
  return useQuery({
    queryKey: ['orcamento', 'composicao-viva', servicoId],
    enabled: !!servicoId,
    queryFn: async (): Promise<ComposicaoViva | null> => {
      const { data: v, error } = await supabase
        .from('vw_servico_vivo')
        .select(
          'custo_unit, producao_diaria_qtde, producao_diaria_unidade, custo_eq_dia, custo_comb_dia, custo_mo_dia, custo_mat_dia, modo'
        )
        .eq('servico_id', servicoId!)
        .maybeSingle()
      if (error) throw error
      if (!v) return null
      const { data: links } = await supabase
        .from('servico_cpu_link')
        .select('cpu_id')
        .eq('servico_id', servicoId!)
      let cpuIds = (links ?? []).map((l) => l.cpu_id as string)
      if (cpuIds.length === 0) {
        const { data: cv } = await supabase
          .from('cpu')
          .select('id')
          .eq('servico_id', servicoId!)
          .eq('is_vigente', true)
        cpuIds = (cv ?? []).map((c) => c.id as string)
      }
      const { data: itens } =
        cpuIds.length > 0
          ? await supabase
              .from('cpu_item')
              .select('id, grupo, quantidade, custo_total_calc, recurso:recurso_id(nome, unidade)')
              .in('cpu_id', cpuIds)
              .order('grupo')
              .order('ordem')
          : { data: [] }
      return { ...(v as Omit<ComposicaoViva, 'itens'>), itens: (itens ?? []) as never }
    }
  })
}
