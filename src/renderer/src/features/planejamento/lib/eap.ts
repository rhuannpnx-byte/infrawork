/**
 * Helpers da EAP (Estrutura Analítica do Projeto) do módulo Planejamento.
 *
 * Constrói árvore hierárquica a partir da lista flat de tarefas vinda da
 * view `vw_planejamento_tarefa_completa`, computa rollup (datas/custo/qtd) de
 * grupos a partir dos filhos, atribui código EAP derivado por posição, e
 * valida operações de drag-drop (não permitir descendente como pai, nível
 * máximo = 3).
 *
 * O servidor armazena `parent_id` (FK autoref), `nivel` (1..3) e `tipo_no`
 * ('tarefa' | 'grupo' | 'marco'). Rollup e código EAP são derivados aqui no
 * cliente — manter persistido também daria sincronização cara a cada drag.
 *
 * Espelha o padrão de `buildPlanOrcTree` em
 * src/renderer/src/features/orcamento/hooks/plan-orc.ts (sort por ordem +
 * código, DFS para flat ordenado).
 */

import type { PlanejamentoTarefaCompleta } from '@/types/planejamento'

export interface PlanejamentoTarefaNode extends PlanejamentoTarefaCompleta {
  children: PlanejamentoTarefaNode[]
  /** Profundidade na árvore (0 = raiz). Igual a `nivel - 1`. */
  depth: number
  /** Rollup (grupo): mínimo de data_inicio dos descendentes. NULL se vazio. */
  data_inicio_rollup: string | null
  /** Rollup (grupo): máximo de data_fim dos descendentes. NULL se vazio. */
  data_fim_rollup: string | null
  /** Rollup (grupo): soma do custo_total_tarefa dos descendentes (tarefas-folha). */
  custo_total_rollup: number
  /** Rollup (grupo): soma de quantidade_alocada dos descendentes (tarefas-folha). */
  quantidade_alocada_rollup: number
}

export interface TaskTreeResult {
  /** Árvore (apenas raízes nivel=1). */
  tree: PlanejamentoTarefaNode[]
  /** Lista flat em ordem DFS (já com depth atribuído). */
  flat: PlanejamentoTarefaNode[]
  /** Lookup auxiliar por id. */
  byId: Map<string, PlanejamentoTarefaNode>
}

/**
 * Constrói a árvore + flat ordenado.
 *
 * Sort interno (entre irmãos): primeiro por `ordem` ASC, depois por
 * `codigo_eap` se houver (estabilidade visual para tarefas legadas que
 * compartilham ordem=0).
 */
export function buildTaskTree(tarefas: PlanejamentoTarefaCompleta[]): TaskTreeResult {
  const byId = new Map<string, PlanejamentoTarefaNode>()
  for (const t of tarefas) {
    byId.set(t.id, {
      ...t,
      children: [],
      depth: 0,
      data_inicio_rollup: null,
      data_fim_rollup: null,
      custo_total_rollup: 0,
      quantidade_alocada_rollup: 0
    })
  }

  const roots: PlanejamentoTarefaNode[] = []
  for (const t of tarefas) {
    const node = byId.get(t.id)!
    if (t.parent_id && byId.has(t.parent_id)) {
      byId.get(t.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortRec = (arr: PlanejamentoTarefaNode[]): void => {
    arr.sort((a, b) => {
      if (a.ordem !== b.ordem) return a.ordem - b.ordem
      const ca = a.codigo_eap ?? a.servico_grupo_codigo ?? ''
      const cb = b.codigo_eap ?? b.servico_grupo_codigo ?? ''
      return ca.localeCompare(cb, undefined, { numeric: true, sensitivity: 'base' })
    })
    for (const n of arr) sortRec(n.children)
  }
  sortRec(roots)

  // Rollup post-order: min(data_inicio), max(data_fim), sum(custo), sum(qtd).
  // Grupos: agregam dos filhos. Tarefa-folha/marco: usam valores próprios.
  const rollup = (
    n: PlanejamentoTarefaNode
  ): { ini: string | null; fim: string | null; custo: number; qtd: number } => {
    if (n.children.length === 0) {
      const qtd = n.tipo_no === 'tarefa' ? (n.quantidade_alocada ?? 0) : 0
      return {
        ini: n.data_inicio,
        fim: n.data_fim,
        custo: n.custo_total_tarefa ?? 0,
        qtd
      }
    }
    let ini: string | null = null
    let fim: string | null = null
    let custo = 0
    let qtd = 0
    for (const c of n.children) {
      const s = rollup(c)
      if (s.ini && (!ini || s.ini < ini)) ini = s.ini
      if (s.fim && (!fim || s.fim > fim)) fim = s.fim
      custo += s.custo
      qtd += s.qtd
    }
    n.data_inicio_rollup = ini
    n.data_fim_rollup = fim
    n.custo_total_rollup = custo
    n.quantidade_alocada_rollup = qtd
    return { ini, fim, custo, qtd }
  }
  for (const r of roots) rollup(r)

  const flat: PlanejamentoTarefaNode[] = []
  const visit = (nodes: PlanejamentoTarefaNode[], depth: number): void => {
    for (const n of nodes) {
      n.depth = depth
      flat.push(n)
      if (n.children.length > 0) visit(n.children, depth + 1)
    }
  }
  visit(roots, 0)

  return { tree: roots, flat, byId }
}

/**
 * Retorna a lista visível em ordem DFS, respeitando colapso por id.
 *
 * Se um nó está colapsado em `expandedIds.has(id) === false`, seus
 * descendentes são omitidos. Folhas (sem children) sempre aparecem.
 */
export function flattenVisible(
  tree: PlanejamentoTarefaNode[],
  expandedIds: Set<string>
): PlanejamentoTarefaNode[] {
  const out: PlanejamentoTarefaNode[] = []
  const visit = (nodes: PlanejamentoTarefaNode[]): void => {
    for (const n of nodes) {
      out.push(n)
      if (n.children.length > 0 && expandedIds.has(n.id)) {
        visit(n.children)
      }
    }
  }
  visit(tree)
  return out
}

/**
 * Atribui `codigo_eap` derivado por posição na árvore: "1", "1.2", "1.2.3".
 * Aplica recursivamente. Substitui qualquer codigo_eap pré-existente — útil
 * pra renderização consistente após reordenação. Persistência ao DB é
 * opcional (snapshot pra auditoria).
 *
 * Returns: mapa id → codigo_eap_calculado (para o caller decidir se salva).
 */
export function computeEap(tree: PlanejamentoTarefaNode[]): Map<string, string> {
  const out = new Map<string, string>()
  const visit = (nodes: PlanejamentoTarefaNode[], prefix: string): void => {
    nodes.forEach((n, i) => {
      const code = prefix ? `${prefix}.${i + 1}` : `${i + 1}`
      out.set(n.id, code)
      if (n.children.length > 0) visit(n.children, code)
    })
  }
  visit(tree, '')
  return out
}

/**
 * Valida se uma operação de drag-drop é permitida.
 *
 * Regras:
 *   - draggedId não pode virar filho de si mesmo ou de descendentes (ciclo)
 *   - newParent não pode existir se isso forçaria nivel > 3
 *   - newParent (se preenchido) precisa ser tipo_no='grupo'
 *   - dragged tipo_no='grupo': não pode ir para um nivel onde ainda
 *     precisaria de filhos no nivel 4 (verificação rasa: max(nivel_descendente)
 *     + delta ≤ 3)
 *
 * Returns: null se OK, string com motivo se inválido.
 */
export function validateMoveTarget(
  draggedId: string,
  newParentId: string | null,
  byId: Map<string, PlanejamentoTarefaNode>
): string | null {
  const dragged = byId.get(draggedId)
  if (!dragged) return 'Tarefa arrastada não encontrada'

  // Determinar nivel-alvo
  let nivelNovo: number
  if (newParentId === null) {
    nivelNovo = 1
  } else {
    const parent = byId.get(newParentId)
    if (!parent) return 'Pai-alvo não encontrado'
    if (parent.tipo_no !== 'grupo') return 'Apenas grupos podem ter filhos'
    if (parent.planejamento_id !== dragged.planejamento_id) {
      return 'Não é possível mover entre planejamentos'
    }
    nivelNovo = parent.nivel + 1
    if (nivelNovo > 3) return 'Nível máximo da EAP é 3'

    // Ciclo: parent não pode ser descendente de dragged
    let p: PlanejamentoTarefaNode | undefined = parent
    while (p) {
      if (p.id === draggedId) return 'Não é possível mover um grupo para dentro de si mesmo'
      p = p.parent_id ? byId.get(p.parent_id) : undefined
    }
  }

  // Grupo: profundidade interna não pode ultrapassar 3 depois da mudança.
  if (dragged.tipo_no === 'grupo') {
    const deltaDescendentes = maxDepth(dragged)
    if (nivelNovo + deltaDescendentes > 3) {
      return 'Movimento estouraria nível máximo 3 nos descendentes'
    }
  }

  // Tarefa-folha/marco também devem caber em ≤ 3.
  if (nivelNovo > 3) return 'Nível máximo da EAP é 3'

  return null
}

/**
 * Profundidade máxima de descendentes a partir de um nó (0 = folha).
 * Usado por validateMoveTarget para grupo: simula o delta de aprofundamento.
 */
function maxDepth(node: PlanejamentoTarefaNode): number {
  if (node.children.length === 0) return 0
  let max = 0
  for (const c of node.children) {
    const d = maxDepth(c) + 1
    if (d > max) max = d
  }
  return max
}

/**
 * Calcula nivel destino + nome do parent (útil em feedback de drag-over).
 */
export function describeMoveTarget(
  newParentId: string | null,
  byId: Map<string, PlanejamentoTarefaNode>
): { nivelNovo: number; parentNome: string } {
  if (newParentId === null) {
    return { nivelNovo: 1, parentNome: '(raiz)' }
  }
  const parent = byId.get(newParentId)
  if (!parent) return { nivelNovo: 1, parentNome: '(raiz)' }
  return {
    nivelNovo: parent.nivel + 1,
    parentNome: parent.nome_custom ?? parent.servico_grupo_descricao ?? '(grupo)'
  }
}
