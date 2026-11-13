import { type ReactNode, useMemo } from 'react'
import type { ProducaoEnriquecida } from '@/types/acompanhamento'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/format'
import { contar } from '@/lib/rotulos'

const dataBR = (iso: string | null | undefined): string =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : ''

interface Props {
  producoes: ProducaoEnriquecida[]
  /** Filtra para 1 item_orcamentario_id se informado */
  filtroItemId?: string | null
  altura?: number
}

interface Agg {
  nome: string
  registros: number
  dias: number
  qtd: number
  servicos: number
  ultimaData: string | null
}

export function PorEncarregado({ producoes, filtroItemId, altura = 200 }: Props): ReactNode {
  const linhas = useMemo<Agg[]>(() => {
    const filt = filtroItemId
      ? producoes.filter((p) => p.item_orcamentario_id === filtroItemId)
      : producoes
    const map = new Map<string, Agg & { dataSet: Set<string>; servicoSet: Set<string> }>()
    for (const p of filt) {
      const nome = (p.encarregado_display_nome ?? '—').trim() || '—'
      const cur = map.get(nome) ?? {
        nome,
        registros: 0,
        dias: 0,
        qtd: 0,
        servicos: 0,
        ultimaData: null as string | null,
        dataSet: new Set<string>(),
        servicoSet: new Set<string>()
      }
      cur.registros += 1
      cur.qtd += Number(p.qtd ?? 0)
      if (p.data) {
        cur.dataSet.add(p.data)
        if (!cur.ultimaData || p.data > cur.ultimaData) cur.ultimaData = p.data
      }
      if (p.item_orcamentario_id) cur.servicoSet.add(p.item_orcamentario_id)
      map.set(nome, cur)
    }
    const out: Agg[] = []
    for (const v of map.values()) {
      out.push({
        nome: v.nome,
        registros: v.registros,
        dias: v.dataSet.size,
        qtd: v.qtd,
        servicos: v.servicoSet.size,
        ultimaData: v.ultimaData
      })
    }
    const medida = (a: Agg): number => (filtroItemId ? a.qtd : a.dias)
    return out.sort((a, b) => medida(b) - medida(a)).slice(0, 8)
  }, [producoes, filtroItemId])

  // Quantidade só se compara dentro de um serviço; sem filtro a régua é de dias com lançamento.
  const medida = (a: Agg): number => (filtroItemId ? a.qtd : a.dias)
  const max = Math.max(1, ...linhas.map(medida))

  return (
    <div
      className="rounded border border-border bg-bg-panel flex flex-col"
      style={{ height: altura }}
    >
      <div className="px-4 pt-3 pb-2 flex items-baseline justify-between gap-3 shrink-0">
        <h4 className="text-md font-semibold text-text flex items-center gap-1.5">
          Por encarregado
        </h4>
        <span className="text-xs text-text-muted">
          {filtroItemId ? 'quantidade no período' : 'dias com lançamento'}
        </span>
      </div>
      <div
        tabIndex={0}
        role="region"
        aria-label="Lançamentos por encarregado"
        className="flex-1 overflow-auto px-4 pb-3 space-y-1.5"
      >
        {linhas.length === 0 && (
          <div className="text-sm text-text-muted flex items-center justify-center h-full text-center px-3">
            Nenhum lançamento no período.
          </div>
        )}
        {linhas.map((l) => (
          <div key={l.nome} className={cn('space-y-0.5')}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text truncate" title={l.nome}>
                {l.nome}
              </span>
              <span className="text-text-muted tabular-nums shrink-0 ml-2">
                {filtroItemId ? formatNumber(l.qtd, 0) : contar(l.dias, 'dia', 'dias')}
              </span>
            </div>
            <div className="h-1.5 bg-bg-elevated overflow-hidden">
              <div
                className="h-full bg-accent"
                style={{ width: `${Math.max(4, (medida(l) / max) * 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span>
                {contar(l.registros, 'lançamento', 'lançamentos')} ·{' '}
                {contar(l.servicos, 'serviço', 'serviços')}
              </span>
              <span>{dataBR(l.ultimaData)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
