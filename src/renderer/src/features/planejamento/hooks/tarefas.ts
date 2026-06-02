import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type { PlanejamentoTarefaCompleta, TipoNo } from '@/types/planejamento'
import { recalcBus } from '../lib/recalc-bus'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

/** Helper local: emite mutationDone pro CPM reativo. Mantém os hooks DRY. */
function emitCpm(planejamento_id: string, source: string, fields?: string[]): void {
  recalcBus.emit('mutationDone', { planejamentoId: planejamento_id, source, fields })
}

export function useTarefas(
  planejamentoId: string | null | undefined
): ReturnType<typeof useQuery<PlanejamentoTarefaCompleta[]>> {
  return useQuery({
    queryKey: ['planejamento', 'tarefas', planejamentoId],
    enabled: !!planejamentoId,
    queryFn: async (): Promise<PlanejamentoTarefaCompleta[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      // Ordenação primária por `ordem` (drag-drop respeita). Empate → código
      // do item (estabilidade visual para tarefas legadas com ordem=0).
      // Hierarquia/agrupamento por parent_id é feita no client via buildTaskTree.
      const { data, error } = await supabase
        .from('vw_planejamento_tarefa_completa')
        .select('*')
        .eq('planejamento_id', planejamentoId!)
        .order('ordem', { ascending: true })
        .order('servico_grupo_codigo', { ascending: true, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as unknown as PlanejamentoTarefaCompleta[]
    }
  })
}

export interface CreateTarefaInput {
  planejamento_id: string
  /** NULL para grupo/marco. */
  item_orcamentario_id?: string | null
  /** Trecho da obra — required para tarefa-folha. NULL aceito em grupo/marco. */
  trecho_id?: string | null
  ordem?: number
  notas?: string
  /** Default 'tarefa'. */
  tipo_no?: TipoNo
  /** Pai na EAP. NULL = raiz (nivel=1). */
  parent_id?: string | null
  nivel?: 1 | 2 | 3
  /** Required para tarefa-folha. NULL em grupo/marco. */
  quantidade_alocada?: number | null
  /** Override do nome (obrigatório em grupo/marco; opcional em tarefa). */
  nome_custom?: string | null
  /** Marco: data_inicio = data_fim. Folha: opcional (recálculo preenche). */
  data_inicio?: string | null
  data_inicio_manual?: boolean
  obra_id: string
}

export function useCreateTarefa(): ReturnType<
  typeof useMutation<{ id: string }, Error, CreateTarefaInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const tipo_no: TipoNo = body.tipo_no ?? 'tarefa'
      const payload: Record<string, unknown> = {
        planejamento_id: body.planejamento_id,
        item_orcamentario_id: body.item_orcamentario_id ?? null,
        trecho_id: body.trecho_id ?? null,
        ordem: body.ordem ?? 0,
        notas: body.notas ?? null,
        tipo_no,
        parent_id: body.parent_id ?? null,
        nivel: body.nivel ?? 1,
        quantidade_alocada: body.quantidade_alocada ?? null,
        nome_custom: body.nome_custom ?? null
      }
      if (body.data_inicio !== undefined) payload.data_inicio = body.data_inicio
      if (body.data_inicio_manual !== undefined)
        payload.data_inicio_manual = body.data_inicio_manual
      // Marco: data_fim = data_inicio (sem duração).
      if (tipo_no === 'marco' && body.data_inicio) {
        payload.data_fim = body.data_inicio
        payload.duracao_dias_uteis_calc = 0
        payload.data_inicio_manual = true
      }
      const { data, error } = await supabase
        .from('planejamento_tarefa')
        .insert(payload)
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
      emitCpm(vars.planejamento_id, 'useCreateTarefa')
    }
  })
}

// ─── Marcos (milestones) ──────────────────────────────────────────────
export interface CreateMarcoInput {
  planejamento_id: string
  obra_id: string
  nome: string
  data_inicio: string
  trecho_id?: string | null
  parent_id?: string | null
  nivel?: 1 | 2 | 3
  ordem?: number
  notas?: string | null
}

export function useCreateMarco(): ReturnType<
  typeof useMutation<{ id: string }, Error, CreateMarcoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('planejamento_tarefa')
        .insert({
          planejamento_id: body.planejamento_id,
          item_orcamentario_id: null,
          trecho_id: body.trecho_id ?? null,
          tipo_no: 'marco',
          parent_id: body.parent_id ?? null,
          nivel: body.nivel ?? 1,
          nome_custom: body.nome,
          data_inicio: body.data_inicio,
          data_fim: body.data_inicio,
          duracao_dias_uteis_calc: 0,
          data_inicio_manual: true,
          ordem: body.ordem ?? 0,
          notas: body.notas ?? null
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
      emitCpm(vars.planejamento_id, 'useCreateMarco')
    }
  })
}

// ─── Grupos (nós organizacionais da EAP) ──────────────────────────────
export interface CreateGrupoInput {
  planejamento_id: string
  obra_id: string
  nome: string
  parent_id?: string | null
  nivel?: 1 | 2 | 3
  ordem?: number
}

export function useCreateGrupo(): ReturnType<
  typeof useMutation<{ id: string }, Error, CreateGrupoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('planejamento_tarefa')
        .insert({
          planejamento_id: body.planejamento_id,
          item_orcamentario_id: null,
          trecho_id: null,
          tipo_no: 'grupo',
          parent_id: body.parent_id ?? null,
          nivel: body.nivel ?? 1,
          nome_custom: body.nome,
          ordem: body.ordem ?? 0
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
      emitCpm(vars.planejamento_id, 'useCreateGrupo')
    }
  })
}

export interface UpdateTarefaInput {
  id: string
  planejamento_id: string
  data_inicio?: string | null
  data_inicio_manual?: boolean
  notas?: string | null
  ordem?: number
  /** Posição espacial em METROS (sempre — UI converte de unidade display antes do mutate). */
  posicao_inicio_m?: number | null
  posicao_fim_m?: number | null
  unidade_espaco_display?: 'km' | 'm' | 'estaca' | null
  /** Trecho da obra. Mudar nao remapeia posicao_*_m (operador valida). */
  trecho_id?: string | null
  /** Quantidade alocada nesta tarefa-folha. Soma por item ≤ quantidade_referencia. */
  quantidade_alocada?: number | null
  /** Nome custom (override de servico_grupo_descricao). */
  nome_custom?: string | null
  /** Modo de scheduling ('asap' default | 'alap'). */
  schedule_mode?: 'asap' | 'alap'
  /**
   * Tipo de constraint formal (MS Project). NULL limpa (+ constraint_date null).
   * 2026-06: expandido pra 6 tipos (adicionado snlt e fnet).
   */
  constraint_type?: 'snet' | 'snlt' | 'fnet' | 'fnlt' | 'mso' | 'mfo' | null
  /** Data-alvo da constraint. NULL quando constraint_type NULL. */
  constraint_date?: string | null
  /** Redesign Gantt Fase 2: vínculo de qtd_alocada a métrica do template do trecho. */
  qtd_link?: string | null
}

export function useUpdateTarefa(): ReturnType<typeof useMutation<void, Error, UpdateTarefaInput>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, planejamento_id: _p, ...rest }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('planejamento_tarefa').update(rest).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
      emitCpm(vars.planejamento_id, 'useUpdateTarefa', Object.keys(vars).filter((k) => k !== 'id' && k !== 'planejamento_id'))
    }
  })
}

// ─── Tradução de erros do banco ────────────────────────────────────────
/**
 * Traduz erros Postgres (code 23514 check_violation) em mensagem amigável
 * para o usuário. Reconhece padrões de mensagem dos triggers customizados
 * (Quantidade alocada total / Soma do perfil semanal / parent / nivel).
 */
export function traduzirErroPlanejamento(err: unknown): string {
  if (!(err instanceof Error)) return 'Erro desconhecido'
  const msg = err.message
  if (msg.includes('excede a quantidade orcada')) {
    return 'A soma das quantidades alocadas excede o total orçado para este item.'
  }
  if (msg.includes('Soma do perfil semanal')) {
    return 'O perfil semanal não bate com a quantidade alocada da tarefa. Recalcule o cronograma.'
  }
  if (msg.includes('nivel maximo da EAP')) {
    return 'A EAP suporta no máximo 3 níveis (2 grupos + tarefa-folha).'
  }
  if (msg.includes('parent deve ser tipo_no=grupo')) {
    return 'O pai precisa ser um grupo.'
  }
  if (msg.includes('tarefa-folha exige item_orcamentario_id')) {
    return 'Tarefas-folha precisam de um item orçado vinculado.'
  }
  if (msg.includes('nao pode ter item_orcamentario_id')) {
    return 'Grupos e marcos não podem ter item orçado.'
  }
  return msg
}

// ─── Helper derivado: alocação de quantidade por item orçado ───────────
// Hook puro (sem query) que deriva de useTarefas().data via useMemo.
// Útil para indicadores visuais ("8.500/10.000 m³ · 85%").

export type AlocacaoStatus = 'ok' | 'parcial' | 'estourado' | 'sem-item'

export interface AlocacaoQuantidade {
  alocado: number
  total: number
  restante: number
  status: AlocacaoStatus
  /** Número de tarefas-folha deste item neste planejamento. */
  tarefas: number
}

/**
 * Calcula alocação de quantidade para um item_orcamentario no contexto de
 * um planejamento. Não faz query — deriva da lista de tarefas já em cache.
 *
 * `status`:
 *   - 'ok'        — alocado ≈ total (dentro da tolerância 0.1%)
 *   - 'parcial'   — alocado < total (sinalização amarela, permitido)
 *   - 'estourado' — alocado > total (sinalização vermelha, backend bloqueia)
 *   - 'sem-item'  — item_orcamentario_id null (grupo/marco)
 */
export function useAlocacaoQuantidade(
  item_orcamentario_id: string | null | undefined,
  tarefas: PlanejamentoTarefaCompleta[]
): AlocacaoQuantidade {
  return useMemo(() => {
    if (!item_orcamentario_id) {
      return { alocado: 0, total: 0, restante: 0, status: 'sem-item', tarefas: 0 }
    }
    let alocado = 0
    let total = 0
    let count = 0
    for (const t of tarefas) {
      if (t.tipo_no !== 'tarefa') continue
      if (t.item_orcamentario_id !== item_orcamentario_id) continue
      alocado += Number(t.quantidade_alocada ?? 0)
      // total vem de qualquer linha (mesmo item → mesmo quantidade_referencia)
      if (total === 0 && t.quantidade_referencia) {
        total = Number(t.quantidade_referencia)
      }
      count++
    }
    const restante = Math.max(0, total - alocado)
    const tol = Math.max(Math.abs(total) * 0.001, 0.0001)
    const status: AlocacaoStatus =
      Math.abs(alocado - total) <= tol ? 'ok' : alocado > total ? 'estourado' : 'parcial'
    return { alocado, total, restante, status, tarefas: count }
  }, [item_orcamentario_id, tarefas])
}

export function useDeleteTarefa(): ReturnType<
  typeof useMutation<void, Error, { id: string; planejamento_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('planejamento_tarefa').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
      emitCpm(vars.planejamento_id, 'useDeleteTarefa')
    }
  })
}

// ─── Reorder (drag-and-drop) ──────────────────────────────────────────
// Mutação em batch — recebe array de {id, ordem, parent_id?} e dispara N
// updates em paralelo. Optimistic update: aplica nova ordem no cache antes
// da resposta do servidor; em erro, invalida pra rollback.
//
// Aceita também `parent_id` para mover tarefa entre grupos (Fase 4). Quando
// `parent_id` está omitido na entrada, mantém o valor atual (não muda).
export interface ReorderItem {
  id: string
  ordem: number
  parent_id?: string | null
  /** Quando muda parent, geralmente muda nivel também (parent.nivel+1). */
  nivel?: 1 | 2 | 3
}

export interface ReorderTarefasInput {
  planejamento_id: string
  items: ReorderItem[]
}

export function useReorderTarefas(): ReturnType<
  typeof useMutation<void, Error, ReorderTarefasInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ items }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      if (items.length === 0) return
      // Updates em paralelo. Trigger fn_tarefa_validar_nivel valida cada row
      // individualmente. Como parent já existe (não está sendo criado agora),
      // ordem dos UPDATEs não importa.
      const results = await Promise.all(
        items.map((it) => {
          const payload: Record<string, unknown> = { ordem: it.ordem }
          if (it.parent_id !== undefined) payload.parent_id = it.parent_id
          if (it.nivel !== undefined) payload.nivel = it.nivel
          return supabase!.from('planejamento_tarefa').update(payload).eq('id', it.id)
        })
      )
      const erros = results.filter((r) => r.error).map((r) => r.error!.message)
      if (erros.length > 0) throw new Error(erros[0])
    },
    onMutate: async ({ planejamento_id, items }) => {
      // Optimistic update no cache da query useTarefas.
      const key = ['planejamento', 'tarefas', planejamento_id] as const
      await qc.cancelQueries({ queryKey: key })
      const previo = qc.getQueryData<PlanejamentoTarefaCompleta[]>(key)
      if (previo) {
        const patchMap = new Map(items.map((it) => [it.id, it] as const))
        const novo = previo.map((t) => {
          const patch = patchMap.get(t.id)
          if (!patch) return t
          return {
            ...t,
            ordem: patch.ordem,
            parent_id: patch.parent_id !== undefined ? patch.parent_id : t.parent_id,
            nivel: patch.nivel ?? t.nivel
          }
        })
        qc.setQueryData(key, novo)
      }
      return { previo }
    },
    onError: (_err, vars, ctx) => {
      // Rollback: restaura snapshot anterior.
      const c = ctx as { previo?: PlanejamentoTarefaCompleta[] } | undefined
      if (c?.previo) {
        qc.setQueryData(['planejamento', 'tarefas', vars.planejamento_id], c.previo)
      }
    },
    onSettled: (_d, _err, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
    },
    onSuccess: (_d, vars) => {
      emitCpm(vars.planejamento_id, 'useReorderTarefas')
    }
  })
}

// ─── Item sincronizável (catálogo do orçamento) ────────────────────────
/**
 * Linha do "catálogo" de itens disponíveis para virar tarefa-folha no
 * planejamento. Cada item é um `servico_grupo` da obra orçada. Vem com
 * info de alocação atual (`alocado`, `restante`, `count`) para a UI
 * mostrar `AlocacaoIndicator` ao lado e sugerir `quantidade_alocada`
 * default = `restante`.
 */
export interface ItemSincronizavel {
  id: string
  codigo: string
  descricao: string
  quantidade_referencia: number
  unidade: string | null
  /** Soma de quantidade_alocada das tarefas-folha já criadas deste item. */
  alocado: number
  /** quantidade_referencia - alocado (mínimo 0). */
  restante: number
  /** Número de tarefas-folha já criadas deste item neste planejamento. */
  count: number
  /** Quando NOT NULL, o item é indireto (lógica de cronograma diferente). */
  indireto_id: string | null
  /** Venda total orçada (NULL se não há venda_unitaria × quantidade). */
  venda_total: number | null
  /**
   * Custo unitário orçado. Pra indiretos = indireto_item.valor_total
   * (custo por período). Pra diretos = cpu_snapshot.custo_unit.
   */
  custo_unitario: number | null
}

/**
 * Lista de itens orçados (tipo='servico_grupo') da obra, com info de
 * alocação contextualizada ao planejamento (quanto já está alocado em
 * tarefas-folha vs. orçado).
 *
 * Esse hook substitui o uso ad-hoc de `item_orcamentario` no antigo
 * `useSincronizarComOrcamento` — agora a UI pode mostrar restante por
 * item e o usuário escolhe quantidade alocada explicitamente.
 */
export function useItensSincronizaveis(
  planejamento_id: string | null | undefined,
  obra_id: string | null | undefined
): ReturnType<typeof useQuery<ItemSincronizavel[]>> {
  return useQuery({
    queryKey: ['planejamento', 'itens-sincronizaveis', planejamento_id, obra_id],
    enabled: !!planejamento_id && !!obra_id,
    queryFn: async (): Promise<ItemSincronizavel[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      // Carrega itens servico_grupo da obra + suas tarefas-folha (planejamento).
      // Duas queries pequenas; preferimos isso a uma view nova só pra isso.
      const [{ data: itens, error: itensErr }, { data: tarefas, error: tarErr }] = await Promise.all(
        [
          supabase
            .from('item_orcamentario')
            .select(
              'id, codigo, descricao, quantidade_referencia, indireto_id, venda_total_calc, custo_unitario_calc, unidade_referencia, servico:servico_id(unidade)'
            )
            .eq('obra_id', obra_id!)
            .eq('tipo', 'servico_grupo')
            .order('codigo'),
          supabase
            .from('planejamento_tarefa')
            .select('item_orcamentario_id, quantidade_alocada')
            .eq('planejamento_id', planejamento_id!)
            .eq('tipo_no', 'tarefa')
        ]
      )
      if (itensErr) throw itensErr
      if (tarErr) throw tarErr
      const stats = new Map<string, { alocado: number; count: number }>()
      for (const t of tarefas ?? []) {
        const id = t.item_orcamentario_id as string | null
        if (!id) continue
        const cur = stats.get(id) ?? { alocado: 0, count: 0 }
        cur.alocado += Number(t.quantidade_alocada ?? 0)
        cur.count += 1
        stats.set(id, cur)
      }
      return (itens ?? []).map((it) => {
        const s = stats.get(it.id as string) ?? { alocado: 0, count: 0 }
        const total = Number(it.quantidade_referencia ?? 0)
        // supabase-js: relacionamento 1:1 retorna objeto OU array dependendo do
        // tipo gerado. Aqui é `servico:servico_id(unidade)` que pode vir como
        // objeto ou array de 1 — normaliza.
        const servicoRaw = (it as unknown as { servico: unknown }).servico
        const servico = Array.isArray(servicoRaw) ? servicoRaw[0] : servicoRaw
        const unidadeServ = (servico as { unidade?: string } | null)?.unidade ?? null
        // Para indiretos, servico_id é NULL — usa unidade_referencia do item.
        const unidadeRef = (it as unknown as { unidade_referencia?: string | null })
          .unidade_referencia
        const unidade = unidadeServ ?? unidadeRef ?? null
        const indiretoId = (it as unknown as { indireto_id: string | null }).indireto_id
        const vendaTotalRaw = (it as unknown as { venda_total_calc: number | string | null })
          .venda_total_calc
        const vendaTotal = vendaTotalRaw == null ? null : Number(vendaTotalRaw)
        const custoUnitRaw = (it as unknown as { custo_unitario_calc: number | string | null })
          .custo_unitario_calc
        const custoUnit = custoUnitRaw == null ? null : Number(custoUnitRaw)
        return {
          id: it.id as string,
          codigo: it.codigo as string,
          descricao: it.descricao as string,
          quantidade_referencia: total,
          unidade,
          alocado: s.alocado,
          restante: Math.max(0, total - s.alocado),
          count: s.count,
          indireto_id: indiretoId,
          venda_total: vendaTotal,
          custo_unitario: custoUnit
        }
      })
    }
  })
}

// ─── Import seletivo (multi-row) ────────────────────────────────────────
/**
 * Linha de uma operação de import: cria uma tarefa-folha referenciando um
 * item_orcamentario com quantidade/trecho/parent específicos. Diferente do
 * antigo `useSincronizarComOrcamento`, permite:
 *   - N tarefas do mesmo item (quantidade_alocada parcial)
 *   - escolher trecho por linha (não o "primeiro da obra" fixo)
 *   - anexar a um grupo da EAP (parent_id) por linha
 *   - data de início opcional (sugerida em recálculo)
 */
export interface ImportarItemRow {
  item_orcamentario_id: string
  trecho_id: string
  quantidade_alocada: number
  /** Pai opcional (grupo). NULL = raiz (nivel=1). */
  parent_id?: string | null
  /**
   * Nível na EAP. O caller (NewTarefaDialog) calcula a partir do parent:
   *   parent_id ? parent.nivel + 1 : 1
   * Trigger fn_tarefa_validar_nivel valida consistência.
   */
  nivel?: 1 | 2 | 3
  data_inicio?: string | null
  /** ASAP (default) | ALAP — agendamento dentro da folga. */
  schedule_mode?: 'asap' | 'alap'
  /** Constraint formal MS Project. NULL = sem constraint. */
  constraint_type?: 'snet' | 'snlt' | 'fnet' | 'fnlt' | 'mso' | 'mfo' | null
  /** Data-alvo da constraint. Obrigatória se constraint_type não-nulo. */
  constraint_date?: string | null
}

export interface ImportarItensInput {
  planejamento_id: string
  itens: ImportarItemRow[]
}

export function useImportarItensSelecionados(): ReturnType<
  typeof useMutation<{ criadas: number }, Error, ImportarItensInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ planejamento_id, itens }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      if (itens.length === 0) return { criadas: 0 }
      const rows = itens.map((it, idx) => ({
        planejamento_id,
        item_orcamentario_id: it.item_orcamentario_id,
        trecho_id: it.trecho_id,
        quantidade_alocada: it.quantidade_alocada,
        tipo_no: 'tarefa',
        nivel: it.nivel ?? 1,
        parent_id: it.parent_id ?? null,
        data_inicio: it.data_inicio ?? null,
        data_inicio_manual: !!it.data_inicio,
        schedule_mode: it.schedule_mode ?? 'asap',
        constraint_type: it.constraint_type ?? null,
        constraint_date: it.constraint_date ?? null,
        ordem: idx
      }))
      const { error } = await supabase.from('planejamento_tarefa').insert(rows)
      if (error) throw error
      return { criadas: rows.length }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
      void qc.invalidateQueries({ queryKey: ['planejamento', 'itens-sincronizaveis'] })
      emitCpm(vars.planejamento_id, 'useImportarItensSelecionados')
    }
  })
}

// ─── Sincronização com orçamento (LEGADO — deprecated) ──────────────────
/**
 * @deprecated Substituído por `useItensSincronizaveis` + `useImportarItensSelecionados`.
 * Mantido por compatibilidade temporária. Uso em produção: o novo
 * `NewTarefaDialog` (Fase 7) é a UI canônica para importação seletiva.
 *
 * Comportamento legado: cria 1 tarefa-folha por servico_grupo da obra que
 * ainda não tem nenhuma tarefa no planejamento. Usa o primeiro trecho da
 * obra como default. Quantidade alocada = quantidade_referencia (100%).
 */
export function useSincronizarComOrcamento(): ReturnType<
  typeof useMutation<
    { criadas: number; ja_existentes: number },
    Error,
    { planejamento_id: string; obra_id: string }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ planejamento_id, obra_id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data: gruposExistentes, error: tarErr } = await supabase
        .from('planejamento_tarefa')
        .select('item_orcamentario_id')
        .eq('planejamento_id', planejamento_id)
      if (tarErr) throw tarErr
      const existentes = new Set((gruposExistentes ?? []).map((t) => t.item_orcamentario_id))

      const { data: grupos, error: grErr } = await supabase
        .from('item_orcamentario')
        .select('id, codigo')
        .eq('obra_id', obra_id)
        .eq('tipo', 'servico_grupo')
        .order('codigo')
      if (grErr) throw grErr

      const novos = (grupos ?? []).filter((g) => !existentes.has(g.id))
      if (novos.length === 0) return { criadas: 0, ja_existentes: existentes.size }

      // Trecho default = primeiro trecho da obra (menor ordem). NOT NULL, sempre
      // existe (create-obra cria 'Principal' ao criar a obra). Operador pode
      // remapear tarefa-a-tarefa depois via LocalizacaoTab.
      const { data: trechos, error: trErr } = await supabase
        .from('obra_trecho')
        .select('id')
        .eq('obra_id', obra_id)
        .order('ordem', { ascending: true })
        .limit(1)
      if (trErr) throw trErr
      const trechoDefaultId = trechos?.[0]?.id
      if (!trechoDefaultId) {
        throw new Error(
          'Obra sem trecho. Crie um trecho em Calendário antes de sincronizar tarefas.'
        )
      }

      const insertRows = novos.map((g, idx) => ({
        planejamento_id,
        item_orcamentario_id: g.id,
        trecho_id: trechoDefaultId,
        ordem: existentes.size + idx
      }))
      const { error: insErr } = await supabase.from('planejamento_tarefa').insert(insertRows)
      if (insErr) throw insErr
      return { criadas: novos.length, ja_existentes: existentes.size }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
      emitCpm(vars.planejamento_id, 'useSincronizarComOrcamento')
    }
  })
}

// ─── Alocação de equipes ──────────────────────────────────────────────
export interface AlocarEquipeInput {
  tarefa_id: string
  equipe_id: string
  qtd_equipes: number
  planejamento_id: string
}

export function useAlocarEquipe(): ReturnType<typeof useMutation<void, Error, AlocarEquipeInput>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ tarefa_id, equipe_id, qtd_equipes }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('planejamento_tarefa_equipe')
        .upsert(
          { tarefa_id, equipe_id, qtd_equipes },
          { onConflict: 'tarefa_id,equipe_id' }
        )
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
      emitCpm(vars.planejamento_id, 'useAlocarEquipe')
    }
  })
}

export function useDesalocarEquipe(): ReturnType<
  typeof useMutation<
    void,
    Error,
    { tarefa_id: string; equipe_id: string; planejamento_id: string }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ tarefa_id, equipe_id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('planejamento_tarefa_equipe')
        .delete()
        .eq('tarefa_id', tarefa_id)
        .eq('equipe_id', equipe_id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
      emitCpm(vars.planejamento_id, 'useDesalocarEquipe')
    }
  })
}
