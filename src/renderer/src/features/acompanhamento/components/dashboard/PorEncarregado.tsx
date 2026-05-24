import { type ReactNode, useMemo } from 'react'
import { UserCircle2 } from 'lucide-react'
import type { ProducaoEnriquecida } from '@/types/acompanhamento'
import { cn } from '@/lib/utils'

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
    const map = new Map<string, Agg & { dataSet: Set<string>; servicoSet: Set<number> }>()
    for (const p of filt) {
      const nome = (p.encarregado_display_nome ?? p.siga_encarregado_nome ?? '—').trim() || '—'
      const cur = map.get(nome) ?? {
        nome,
        registros: 0,
        dias: 0,
        qtd: 0,
        servicos: 0,
        ultimaData: null as string | null,
        dataSet: new Set<string>(),
        servicoSet: new Set<number>()
      }
      cur.registros += 1
      cur.qtd += Number(p.qtd ?? 0)
      if (p.data) {
        cur.dataSet.add(p.data)
        if (!cur.ultimaData || p.data > cur.ultimaData) cur.ultimaData = p.data
      }
      if (p.siga_servico_id != null) cur.servicoSet.add(p.siga_servico_id)
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
    return out.sort((a, b) => b.qtd - a.qtd).slice(0, 8)
  }, [producoes, filtroItemId])

  const max = Math.max(1, ...linhas.map((l) => l.qtd))

  return (
    <div className="rounded border border-border bg-bg-panel flex flex-col" style={{ height: altura }}>
      <div className="px-3 pt-3 pb-2 flex items-center justify-between shrink-0">
        <h4 className="text-xs font-semibold text-text flex items-center gap-1.5">
          <UserCircle2 size={11} /> Por encarregado
        </h4>
        <span className="text-2xs font-mono text-text-dim">qtd · dias</span>
      </div>
      <div className="flex-1 overflow-auto px-3 pb-3 space-y-1.5">
        {linhas.length === 0 && (
          <div className="text-text-dim text-2xs font-mono flex items-center justify-center h-full">
            Sem dados
          </div>
        )}
        {linhas.map((l) => (
          <div key={l.nome} className={cn('space-y-0.5')}>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-text truncate" title={l.nome}>{l.nome}</span>
              <span className="text-text-dim tabular-nums shrink-0 ml-2">
                {l.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="h-1 rounded bg-bg overflow-hidden">
              <div
                className="h-full bg-accent"
                style={{ width: `${Math.max(4, (l.qtd / max) * 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-2xs font-mono text-text-dim">
              <span>{l.dias} dias · {l.servicos} serviços</span>
              <span>{l.ultimaData ?? ''}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
