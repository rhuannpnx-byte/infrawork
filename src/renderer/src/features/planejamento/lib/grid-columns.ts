// Config das 15 colunas do Grid do redesign Gantt (Fase 2).
//
// Em arquivo separado de `gantt-columns.ts` (que continua dando suporte ao
// GanttChart legado durante a transição). Quando GanttChart for removido na
// Fase 4, gantt-columns.ts pode ser deletado também.
//
// Estrutura: 15 colunas em 5 grupos semânticos exibidos como header de 2
// tiers (faixa superior = grupos, inferior = nomes). 3 primeiras colunas
// frozen (sticky-left durante scroll horizontal).
//
// Persistência: localStorage `gantt-cols:v2`. Versionamento isola usuários
// antigos do v1 (que era do GanttChart legado).

export type GridColumnGroup =
  | 'identificacao'
  | 'localizacao'
  | 'quantitativos'
  | 'cronograma'
  | 'alocacao'

export const GROUP_LABEL: Record<GridColumnGroup, string> = {
  identificacao: 'Identificação',
  localizacao: 'Localização',
  quantitativos: 'Quantitativos',
  cronograma: 'Cronograma',
  alocacao: 'Alocação'
}

export type GridColumnKey =
  | 'numero'
  | 'eap'
  | 'descricao'
  | 'trecho'
  | 'pos_inicio'
  | 'pos_fim'
  | 'qtd_alocada'
  | 'unidade'
  | 'producao'
  | 'duracao'
  | 'inicio'
  | 'fim'
  | 'equipes'
  | 'predecessoras'
  | 'notas'

export interface GridColumnConfig {
  key: GridColumnKey
  label: string
  group: GridColumnGroup
  width: number
  minWidth: number
  maxWidth: number
  visible: boolean
  /** True = sticky-left durante scroll horizontal (3 primeiras). */
  frozen?: boolean
  align?: 'left' | 'right' | 'center'
  /** Não aparece no menu show/hide (descricao é obrigatória). */
  alwaysVisible?: boolean
}

export const DEFAULT_COLUMNS: GridColumnConfig[] = [
  // ─── Identificação (frozen) ─────────────────────────────────────────────
  {
    key: 'numero',
    label: 'Nº',
    group: 'identificacao',
    width: 38,
    minWidth: 32,
    maxWidth: 64,
    visible: true,
    frozen: true,
    align: 'right',
    alwaysVisible: true
  },
  {
    key: 'eap',
    label: 'EAP',
    group: 'identificacao',
    width: 56,
    minWidth: 40,
    maxWidth: 120,
    visible: true,
    frozen: true,
    align: 'left'
  },
  {
    key: 'descricao',
    label: 'Descrição',
    group: 'identificacao',
    width: 280,
    minWidth: 140,
    maxWidth: 600,
    visible: true,
    frozen: true,
    align: 'left',
    alwaysVisible: true
  },
  // ─── Localização ────────────────────────────────────────────────────────
  {
    key: 'trecho',
    label: 'Trecho',
    group: 'localizacao',
    width: 90,
    minWidth: 60,
    maxWidth: 200,
    visible: true,
    align: 'left'
  },
  {
    key: 'pos_inicio',
    label: 'Pos. Ini',
    group: 'localizacao',
    width: 96,
    minWidth: 70,
    maxWidth: 160,
    visible: true,
    align: 'right'
  },
  {
    key: 'pos_fim',
    label: 'Pos. Fim',
    group: 'localizacao',
    width: 96,
    minWidth: 70,
    maxWidth: 160,
    visible: true,
    align: 'right'
  },
  // ─── Quantitativos ──────────────────────────────────────────────────────
  {
    key: 'qtd_alocada',
    label: 'Qtd Alocada',
    group: 'quantitativos',
    width: 120,
    minWidth: 80,
    maxWidth: 200,
    visible: true,
    align: 'right'
  },
  {
    key: 'unidade',
    label: 'Un',
    group: 'quantitativos',
    width: 44,
    minWidth: 36,
    maxWidth: 80,
    visible: true,
    align: 'center'
  },
  {
    key: 'producao',
    label: 'Prod/Dia',
    group: 'quantitativos',
    width: 96,
    minWidth: 70,
    maxWidth: 160,
    visible: true,
    align: 'right'
  },
  // ─── Cronograma ─────────────────────────────────────────────────────────
  {
    key: 'duracao',
    label: 'Duração',
    group: 'cronograma',
    width: 64,
    minWidth: 50,
    maxWidth: 100,
    visible: true,
    align: 'right'
  },
  {
    key: 'inicio',
    label: 'Início',
    group: 'cronograma',
    width: 102,
    minWidth: 88,
    maxWidth: 160,
    visible: true,
    align: 'left'
  },
  {
    key: 'fim',
    label: 'Fim',
    group: 'cronograma',
    width: 84,
    minWidth: 72,
    maxWidth: 160,
    visible: true,
    align: 'left'
  },
  // ─── Alocação ───────────────────────────────────────────────────────────
  {
    key: 'equipes',
    label: 'Equipes',
    group: 'alocacao',
    width: 168,
    minWidth: 110,
    maxWidth: 360,
    visible: true,
    align: 'left'
  },
  {
    key: 'predecessoras',
    label: 'Predecessoras',
    group: 'alocacao',
    width: 140,
    minWidth: 100,
    maxWidth: 320,
    visible: true,
    align: 'left'
  },
  {
    key: 'notas',
    label: 'Notas',
    group: 'alocacao',
    width: 48,
    minWidth: 44,
    maxWidth: 60,
    visible: true,
    align: 'center'
  }
]

const STORAGE_KEY = 'gantt-cols:v2'

interface StoredCol {
  width: number
  visible: boolean
}
interface StoredConfig {
  order?: GridColumnKey[]
  cols?: Partial<Record<GridColumnKey, StoredCol>>
}

export function loadGridColumns(): GridColumnConfig[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (!raw) return DEFAULT_COLUMNS.map((c) => ({ ...c }))
    const stored = JSON.parse(raw) as StoredConfig
    const byKey = new Map<GridColumnKey, GridColumnConfig>(
      DEFAULT_COLUMNS.map((c) => [c.key, { ...c }])
    )
    if (stored.cols) {
      for (const [key, s] of Object.entries(stored.cols)) {
        const c = byKey.get(key as GridColumnKey)
        if (!c || !s) continue
        c.width = Math.max(c.minWidth, Math.min(c.maxWidth, Number(s.width) || c.width))
        if (typeof s.visible === 'boolean' && !c.alwaysVisible) c.visible = s.visible
      }
    }
    const out: GridColumnConfig[] = []
    const consumed = new Set<GridColumnKey>()
    if (stored.order) {
      for (const key of stored.order) {
        const c = byKey.get(key)
        if (c && !consumed.has(key)) {
          out.push(c)
          consumed.add(key)
        }
      }
    }
    for (const c of DEFAULT_COLUMNS) {
      if (!consumed.has(c.key)) out.push(byKey.get(c.key)!)
    }
    return out
  } catch {
    return DEFAULT_COLUMNS.map((c) => ({ ...c }))
  }
}

export function saveGridColumns(cols: GridColumnConfig[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    const out: StoredConfig = { order: cols.map((c) => c.key), cols: {} }
    for (const c of cols) {
      out.cols![c.key] = { width: c.width, visible: c.visible }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out))
  } catch {
    // localStorage cheio ou bloqueado — ignora
  }
}

export function totalVisibleWidth(cols: GridColumnConfig[]): number {
  return cols.reduce((acc, c) => (c.visible ? acc + c.width : acc), 0)
}

export function frozenWidth(cols: GridColumnConfig[]): number {
  return cols.reduce((acc, c) => (c.visible && c.frozen ? acc + c.width : acc), 0)
}

/** Agrupa colunas visíveis por grupo na ordem em que aparecem. */
export interface GroupSpan {
  group: GridColumnGroup
  cols: GridColumnConfig[]
  width: number
}
export function groupSpans(cols: GridColumnConfig[]): GroupSpan[] {
  const out: GroupSpan[] = []
  for (const c of cols) {
    if (!c.visible) continue
    const last = out[out.length - 1]
    if (last && last.group === c.group) {
      last.cols.push(c)
      last.width += c.width
    } else {
      out.push({ group: c.group, cols: [c], width: c.width })
    }
  }
  return out
}
