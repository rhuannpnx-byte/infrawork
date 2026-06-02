import type { ReactNode } from 'react'
import type { TracoTarefa } from '@/types/planejamento'

interface MarchaTempoLegendasProps {
  tracos: TracoTarefa[]
}

interface ItemLegenda {
  codigo: string
  label: string
  cor: string
  count: number
}

/**
 * Lista compacta de serviços únicos presentes nos traçados, agrupados por
 * código (`servico_grupo_codigo` ou `codigo_eap`). Mostra cor da linha +
 * nome do serviço + contagem de tarefas. Ordenada por código.
 */
export function MarchaTempoLegendas({ tracos }: MarchaTempoLegendasProps): ReactNode {
  if (tracos.length === 0) return null

  const map = new Map<string, ItemLegenda>()
  for (const t of tracos) {
    const chave = t.codigo ?? t.tarefaId
    const atual = map.get(chave)
    if (atual) {
      atual.count++
    } else {
      map.set(chave, {
        codigo: chave,
        label: t.label,
        cor: t.cor,
        count: 1
      })
    }
  }
  const items = Array.from(map.values()).sort((a, b) => a.codigo.localeCompare(b.codigo))

  return (
    <div className="rounded border border-border bg-bg-panel p-3">
      <div className="text-2xs font-mono text-text-dim uppercase tracking-wider mb-2">
        Legenda · {items.length} {items.length === 1 ? 'serviço' : 'serviços'}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {items.map((item) => (
          <div key={item.codigo} className="inline-flex items-center gap-1.5 text-xs font-mono">
            <span
              className="inline-block w-4 h-1.5 rounded-sm"
              style={{ background: item.cor }}
            />
            <span className="text-text">{item.label}</span>
            {item.count > 1 ? (
              <span className="text-text-faint">×{item.count}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
