// Tipos compartilhados das cells do Grid.
// Cada cell recebe o mesmo CellProps; diferenciação por col.key fica no
// GridRow.tsx (switch que renderiza cell apropriada).

import type {
  Equipe,
  EquipeAlocada,
  PlanejamentoTarefaCompleta
} from '@/types/planejamento'
import type { ObraTrecho } from '@/types/gerencial'

/** Nó da árvore EAP visível (com depth e hasChildren). */
export interface VisibleNode extends PlanejamentoTarefaCompleta {
  depth: number
  hasChildren: boolean
  /** Rollup do EAP (grupos): mínimo de data_inicio dos descendentes. NULL em folhas. */
  data_inicio_rollup?: string | null
  /** Rollup do EAP (grupos): máximo de data_fim dos descendentes. NULL em folhas. */
  data_fim_rollup?: string | null
}

export interface CellCommitHandlers {
  commitNomeCustom: (id: string, value: string) => Promise<void>
  commitQuantidade: (id: string, value: number | null) => Promise<void>
  commitProducao: (id: string, value: number | null) => Promise<void>
  commitDataInicio: (id: string, data: string | null) => Promise<void>
  commitDataFim: (id: string, data: string | null) => Promise<void>
  commitPosicao: (
    id: string,
    field: 'posicao_inicio_m' | 'posicao_fim_m',
    raw: string,
    trechoId: string | null
  ) => Promise<void>
  commitTrecho: (id: string, trechoId: string) => Promise<void>
  commitQtdLink: (id: string, qtdLink: string | null) => Promise<void>
  removerEquipe: (tarefaId: string, equipeId: string) => void
  removerPredecessora: (depId: string) => void
}

export interface CellContext extends CellCommitHandlers {
  readOnly: boolean
  /** Lista completa de trechos da obra (pra popover/lookup). */
  trechos: ObraTrecho[]
  /** Mapa id→tarefa pra renderizar nome de predecessoras. */
  tarefasById: Map<string, PlanejamentoTarefaCompleta>
  /** Mapa id→equipe da obra (pra render de chip por ID alocado). */
  equipesById: Map<string, Equipe>
  /** Numeração por id (pra mostrar "Nº" da predecessora em pill). */
  numeroById: Map<string, number>
  /** Abre dialog de adicionar predecessora a esta tarefa. */
  abrirAddDep: (tarefaId: string) => void
  /** Abre dialog de alocar equipe (popover). */
  abrirAddEquipe: (tarefaId: string, anchorRect: DOMRect) => void
  /** Abre popover de trocar trecho. */
  abrirTrecho: (tarefaId: string, anchorRect: DOMRect) => void
  /** Abre popover de escolher Pos. Ini / Pos. Fim por busca na grade do trecho. */
  abrirPosicao: (
    tarefaId: string,
    field: 'posicao_inicio_m' | 'posicao_fim_m',
    anchorRect: DOMRect
  ) => void
  /** Abre popover de vincular qtd ao template do trecho. */
  abrirQtdLink: (tarefaId: string, anchorRect: DOMRect) => void
  /** Abre modal de notas. */
  abrirNotas: (tarefaId: string) => void
}

export interface CellProps {
  node: VisibleNode
  ctx: CellContext
}

/** Helper consistente para classes de cell (alinhamento + padding). */
export function cellClass(align?: 'left' | 'right' | 'center'): string {
  if (align === 'right') return 'justify-end text-right'
  if (align === 'center') return 'justify-center text-center'
  return 'justify-start text-left'
}

/** Pra grupos/marcos: extrai o "nome" exibido (nome_custom > descricao). */
export function getDisplayNome(node: VisibleNode): string {
  return node.nome_custom ?? node.servico_grupo_descricao ?? '(sem nome)'
}

/** Pra tarefas-folha: usa apenas descricao do item (com fallback nome_custom). */
export function getTarefaNome(node: VisibleNode): string {
  return node.nome_custom ?? node.servico_grupo_descricao ?? '(sem nome)'
}

/** Equipes alocadas via lookup do array EquipeAlocada[]. */
export function getEquipes(node: VisibleNode): EquipeAlocada[] {
  return node.equipes ?? []
}
