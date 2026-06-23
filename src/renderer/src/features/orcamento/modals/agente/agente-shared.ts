// Tipos e helpers compartilhados entre o shell do workbench do Agente de
// Agrupamento e seus painéis (cobertura / proposta / chat).

import type { GrupoSugerido, PapelReceita, ReceitaNaoAgrupada } from '@/types/agrupamento'

/** Grupo proposto + estado de edição local (view-model do workbench). */
export interface GrupoVM extends GrupoSugerido {
  key: string
  aplicado: boolean
  editado: boolean
  qtdManual: string
  /**
   * Receitas escolhidas como referência de quantidade do grupo:
   *  - heranca: usa a 1ª (qual filho herdar — seleção única);
   *  - soma_filhos: soma todas as marcadas (subconjunto a incluir);
   *  - manual: ignorado.
   * Default: todas as receitas do grupo.
   */
  qtdRefFilhos: string[]
}

export const PAPEL_LABEL: Record<PapelReceita, string> = {
  principal: 'principal',
  transporte: 'transporte',
  material: 'material',
  mao_obra: 'mão de obra',
  outro: 'outro'
}

export function confiancaBadge(c: number | null): {
  variant: 'success' | 'warn' | 'danger' | 'default'
  txt: string
} {
  if (c === null) return { variant: 'default', txt: '—' }
  if (c >= 0.8) return { variant: 'success', txt: `${Math.round(c * 100)}%` }
  if (c >= 0.5) return { variant: 'warn', txt: `${Math.round(c * 100)}%` }
  return { variant: 'danger', txt: `${Math.round(c * 100)}%` }
}

// ─── Árvore da EAP dos itens omissos (não agrupados) ──────────────────────
// Mostra os índices (etapas) aninhados com as receitas omissas dentro, pra
// facilitar mapear de onde cada item vem e onde deve ser classificado.

export interface OmissoNode {
  id: string
  tipo: 'etapa' | 'receita'
  codigo: string
  descricao: string
  /** Só em receita. */
  motivo?: string
  venda?: number
  children: OmissoNode[]
}

interface ItemMinimo {
  id: string
  parent_id: string | null
  tipo: 'etapa' | 'servico_grupo' | 'receita'
  codigo: string
  descricao: string
}

/**
 * Monta a árvore (etapas → receitas omissas) a partir do flat do plano e da
 * lista de não-agrupados. Poda galhos sem nenhuma receita omissa.
 */
export function buildOmissosTree(
  itens: ItemMinimo[],
  naoAgrupados: ReceitaNaoAgrupada[],
  vendaPorReceita: Map<string, number>
): OmissoNode[] {
  const byId = new Map(itens.map((i) => [i.id, i]))
  const roots: OmissoNode[] = []
  const etapaNode = new Map<string, OmissoNode>()

  const ensureEtapa = (item: ItemMinimo): OmissoNode => {
    const existente = etapaNode.get(item.id)
    if (existente) return existente
    const node: OmissoNode = {
      id: item.id,
      tipo: 'etapa',
      codigo: item.codigo,
      descricao: item.descricao,
      children: []
    }
    etapaNode.set(item.id, node)
    const pai = item.parent_id ? byId.get(item.parent_id) : null
    if (pai && pai.tipo === 'etapa') ensureEtapa(pai).children.push(node)
    else roots.push(node)
    return node
  }

  for (const n of naoAgrupados) {
    const item = byId.get(n.receita_id)
    const recNode: OmissoNode = {
      id: n.receita_id,
      tipo: 'receita',
      codigo: n.codigo,
      descricao: n.descricao,
      motivo: n.motivo,
      venda: vendaPorReceita.get(n.receita_id) ?? 0,
      children: []
    }
    const pai = item?.parent_id ? byId.get(item.parent_id) : null
    if (pai && pai.tipo === 'etapa') ensureEtapa(pai).children.push(recNode)
    else roots.push(recNode)
  }

  const ordenar = (nodes: OmissoNode[]): void => {
    nodes.sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }))
    for (const nd of nodes) if (nd.children.length) ordenar(nd.children)
  }
  ordenar(roots)
  return roots
}

let keySeq = 0
export function toVM(g: GrupoSugerido): GrupoVM {
  return {
    ...g,
    key: `g${keySeq++}`,
    aplicado: false,
    editado: false,
    qtdManual: g.qtd_ref_sugerida != null ? String(g.qtd_ref_sugerida) : '',
    qtdRefFilhos: g.receitas.map((r) => r.id)
  }
}
