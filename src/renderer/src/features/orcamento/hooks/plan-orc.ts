import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { adminApi } from '@/lib/supabase/functions'
import type {
  CpuSnapshot,
  ItemDetalhe,
  ItemOrcamentario,
  ItemTipo,
  ItemTreeNode,
  QtdRefModo
} from '@/types/orcamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

const ITEM_COLUNAS =
  'id, obra_id, parent_id, nivel, codigo, descricao, tipo, unidade, servico_id, quantidade, ' +
  'venda_unitaria, cpu_snapshot_id, indireto_id, quantidade_referencia, unidade_referencia, ' +
  'qtd_ref_modo, qtd_ref_filhos, ordem, custo_unitario_calc, custo_total_calc, ' +
  'venda_total_calc, lucratividade_perc_calc, created_at, updated_at'

// ─── Lista plana + árvore ─────────────────────────────────────────────────

interface PlanOrcData {
  flat: ItemTreeNode[]
  tree: ItemTreeNode[]
}

export function usePlanOrc(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<PlanOrcData>> {
  return useQuery({
    queryKey: ['orcamento', 'plan-orc', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<PlanOrcData> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('item_orcamentario')
        .select(ITEM_COLUNAS)
        .eq('obra_id', obraId!)
        .order('codigo')
      if (error) throw error
      const itens = (data ?? []) as unknown as ItemOrcamentario[]
      return buildPlanOrcTree(itens)
    }
  })
}

/** Constrói árvore + flat list (DFS) para virtualização. */
export function buildPlanOrcTree(itens: ItemOrcamentario[]): PlanOrcData {
  const byId = new Map<string, ItemTreeNode>()
  for (const it of itens) {
    byId.set(it.id, { ...it, children: [], depth: 0 })
  }
  const roots: ItemTreeNode[] = []
  for (const it of itens) {
    const node = byId.get(it.id)!
    if (it.parent_id && byId.has(it.parent_id)) {
      byId.get(it.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortRec = (arr: ItemTreeNode[]): void => {
    arr.sort((a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo))
    arr.forEach((n) => sortRec(n.children))
  }
  sortRec(roots)

  // Rollup client-side (post-order). Mantém receita inalterada; em
  // servico_grupo, venda = soma das receitas filhas (custo já vem do snapshot);
  // em etapa, ambos = soma dos filhos. Garante propagação correta na UI
  // mesmo se o recalcular_orcamento do servidor estiver stale.
  const rollup = (n: ItemTreeNode): { venda: number; custo: number } => {
    if (n.children.length === 0) {
      return { venda: n.venda_total_calc ?? 0, custo: n.custo_total_calc ?? 0 }
    }
    let venda = 0
    let custo = 0
    for (const c of n.children) {
      const s = rollup(c)
      venda += s.venda
      custo += s.custo
    }
    if (n.tipo === 'etapa') {
      n.venda_total_calc = venda
      n.custo_total_calc = custo
      n.lucratividade_perc_calc = venda > 0 ? (venda - custo) / venda : null
    } else if (n.tipo === 'servico_grupo') {
      n.venda_total_calc = venda
      // custo_total_calc vem do snapshot × qtd_ref (trigger backend); preserva.
      const custoSg = n.custo_total_calc ?? 0
      n.lucratividade_perc_calc = venda > 0 ? (venda - custoSg) / venda : null
      // Para o pai (etapa), o custo do servico_grupo é o que ele declara.
      return { venda, custo: custoSg }
    }
    return { venda, custo }
  }
  for (const r of roots) rollup(r)

  const flat: ItemTreeNode[] = []
  const visit = (nodes: ItemTreeNode[], depth: number): void => {
    for (const n of nodes) {
      n.depth = depth
      flat.push(n)
      if (n.children.length > 0) visit(n.children, depth + 1)
    }
  }
  visit(roots, 0)
  return { flat, tree: roots }
}

// ─── Detalhe (item + snapshot) ────────────────────────────────────────────

export function useItemDetalhe(
  id: string | null | undefined
): ReturnType<typeof useQuery<ItemDetalhe>> {
  return useQuery({
    queryKey: ['orcamento', 'item-detalhe', id],
    enabled: !!id,
    queryFn: async (): Promise<ItemDetalhe> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('item_orcamentario')
        .select(ITEM_COLUNAS + ', servico:servico_id(id, codigo, nome, unidade)')
        .eq('id', id!)
        .single()
      if (error) throw error
      const item = data as unknown as ItemDetalhe

      if (item.cpu_snapshot_id) {
        const { data: snap } = await supabase
          .from('cpu_snapshot')
          .select(
            'id, obra_id, cpu_id_origem, versao_origem, snapshot_em, criado_por, custo_unit, custo_eq_dia, custo_comb_dia, custo_mo_dia, custo_mat_dia, producao_diaria_qtde, producao_diaria_unidade, servico_codigo, servico_nome, servico_unidade, payload'
          )
          .eq('id', item.cpu_snapshot_id)
          .maybeSingle()
        if (snap) item.cpu_snapshot = snap as unknown as CpuSnapshot
      }
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
  cpu_snapshot_id?: string | null
  quantidade_referencia?: number | null
  unidade_referencia?: string | null
  qtd_ref_modo?: QtdRefModo | null
  qtd_ref_filhos?: string[] | null
  ordem?: number
}

export function useUpsertItem(): ReturnType<
  typeof useMutation<{ id: string }, Error, UpsertItemInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
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
        cpu_snapshot_id: body.cpu_snapshot_id ?? null,
        quantidade_referencia: body.quantidade_referencia ?? null,
        unidade_referencia: body.unidade_referencia ?? null,
        qtd_ref_modo: body.qtd_ref_modo ?? null,
        qtd_ref_filhos: body.qtd_ref_filhos ?? null,
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
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'plan-orc', vars.obra_id] })
      if (vars.id) {
        void qc.invalidateQueries({ queryKey: ['orcamento', 'item-detalhe', vars.id] })
      }
    }
  })
}

export function useDeleteItem(): ReturnType<
  typeof useMutation<void, Error, { id: string; obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('item_orcamentario').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'plan-orc', vars.obra_id] })
    }
  })
}

export function useMoveItem(): ReturnType<
  typeof useMutation<
    void,
    Error,
    { id: string; obra_id: string; parent_id: string | null; ordem: number }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, parent_id, ordem }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('item_orcamentario')
        .update({ parent_id, ordem })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'plan-orc', vars.obra_id] })
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
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data: item } = await supabase
        .from('item_orcamentario')
        .select('id, parent_id, ordem')
        .eq('id', id)
        .single()
      if (!item) throw new Error('Item não encontrado')

      let q = supabase.from('item_orcamentario').select('id, ordem, codigo').eq('obra_id', obra_id)
      if (item.parent_id === null) q = q.is('parent_id', null)
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
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'plan-orc', vars.obra_id] })
    }
  })
}

/**
 * Move o item para outro pai (reparent). Triggers do banco validam regras
 * (servico_grupo só aceita receita; receita não pode ter filhos; etc).
 */
export function useReparentItem(): ReturnType<
  typeof useMutation<void, Error, { id: string; obra_id: string; new_parent_id: string | null }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, new_parent_id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('item_orcamentario')
        .update({ parent_id: new_parent_id })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'plan-orc', vars.obra_id] })
    }
  })
}

// ─── Agrupar receitas em servico_grupo ────────────────────────────────────

export interface AgruparComoServicoInput {
  obra_id: string
  parent_id?: string | null
  codigo?: string
  descricao: string
  /** Linka o agrupador a uma CPU (vigente do serviço). */
  servico_id?: string | null
  cpu_snapshot_id?: string | null
  /** Alternativa: linka o agrupador a um item de indireto. Mutuamente exclusivo com servico_id. */
  indireto_id?: string | null
  unidade_referencia: string
  qtd_ref_modo: QtdRefModo
  /** Manual: usado direto. Heranca: pega quantidade do primeiro id. Soma: soma todos. */
  quantidade_referencia: number
  qtd_ref_filhos: string[]
  /** IDs das receitas que serão penduradas sob o novo grupo. */
  receitas_ids: string[]
}

export function useAgruparComoServico(): ReturnType<
  typeof useMutation<{ id: string }, Error, AgruparComoServicoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      // 1) Cria o servico_grupo
      const { data: grupo, error: errGrupo } = await supabase
        .from('item_orcamentario')
        .insert({
          obra_id: body.obra_id,
          parent_id: body.parent_id ?? null,
          codigo: body.codigo ?? null,
          descricao: body.descricao,
          tipo: 'servico_grupo',
          servico_id: body.servico_id ?? null,
          cpu_snapshot_id: body.cpu_snapshot_id ?? null,
          indireto_id: body.indireto_id ?? null,
          quantidade_referencia: body.quantidade_referencia,
          unidade_referencia: body.unidade_referencia,
          qtd_ref_modo: body.qtd_ref_modo,
          qtd_ref_filhos: body.qtd_ref_filhos
        })
        .select('id')
        .single()
      if (errGrupo) throw errGrupo

      // 2) Reparenta as receitas
      if (body.receitas_ids.length > 0) {
        const { error: errMove } = await supabase
          .from('item_orcamentario')
          .update({ parent_id: grupo.id })
          .in('id', body.receitas_ids)
        if (errMove) throw errMove
      }

      // 3) Cria snapshot da CPU vigente do serviço (se houver) — assim o custo
      // do agrupador aparece imediatamente, sem o usuário precisar acionar
      // "Atualizar CPUs vigentes" manualmente. Erros aqui não bloqueiam.
      // Não aplica quando o agrupador é linkado a indireto (sem CPU).
      if (body.servico_id && !body.cpu_snapshot_id) {
        try {
          await adminApi.snapshotCpuNoItem({ item_id: grupo.id as string })
        } catch {
          /* sem CPU vigente — usuário cadastra depois */
        }
      }

      // 4) Recalcula
      await adminApi.recalcularOrcamento({ obra_id: body.obra_id })

      return { id: grupo.id as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'plan-orc', vars.obra_id] })
    }
  })
}

// ─── Edge Function wrappers ───────────────────────────────────────────────

export function useRecalcularOrcamento(): ReturnType<
  typeof useMutation<
    Awaited<ReturnType<typeof adminApi.recalcularOrcamento>>,
    Error,
    { obra_id: string }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => adminApi.recalcularOrcamento(body),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'plan-orc', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'lucratividade', vars.obra_id] })
    }
  })
}

export function useSnapshotCpuNoItem(): ReturnType<
  typeof useMutation<
    Awaited<ReturnType<typeof adminApi.snapshotCpuNoItem>>,
    Error,
    { item_id: string; obra_id: string; cpu_id?: string; force?: boolean }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars) =>
      adminApi.snapshotCpuNoItem({ item_id: vars.item_id, cpu_id: vars.cpu_id, force: vars.force }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'plan-orc', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'item-detalhe', vars.item_id] })
    }
  })
}

export function useAtualizarItensParaCpuVigente(): ReturnType<
  typeof useMutation<
    Awaited<ReturnType<typeof adminApi.atualizarItensParaCpuVigente>>,
    Error,
    { obra_id: string; servico_ids?: string[] }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => adminApi.atualizarItensParaCpuVigente(body),
    onSuccess: (d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'plan-orc', vars.obra_id] })
      // A função já re-snapshota e recalcula orçamento + cronograma (server-side).
      // Aqui só invalidamos os caches do planejamento p/ a UI refletir.
      if (d?.atualizados) void qc.invalidateQueries({ queryKey: ['planejamento'] })
    }
  })
}
