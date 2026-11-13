import { type ReactNode, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { contar } from '@/lib/rotulos'

interface Props {
  data: Array<{ data: string; qtd: number }>
  altura?: number
}

const WEEK_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

export function CalendarHeatmap({ data, altura = 200 }: Props): ReactNode {
  const grid = useMemo(() => {
    const hoje = new Date()
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
    const ultDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)
    const dias: Array<{ data: string; qtd: number; isFuture: boolean } | null> = []
    // Preenche placeholders pra alinhar dia 1 com sua coluna correta (D=0)
    for (let i = 0; i < inicioMes.getDay(); i++) dias.push(null)
    const map = new Map(data.map((d) => [d.data, d.qtd]))
    for (let d = 1; d <= ultDia.getDate(); d++) {
      const dt = new Date(hoje.getFullYear(), hoje.getMonth(), d)
      const iso = dt.toISOString().slice(0, 10)
      dias.push({
        data: iso,
        qtd: map.get(iso) ?? 0,
        isFuture: dt > hoje
      })
    }
    return { dias, mesLabel: hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) }
  }, [data])

  const max = Math.max(
    1,
    ...grid.dias.filter((d): d is NonNullable<typeof d> => !!d).map((d) => d.qtd)
  )

  function cor(qtd: number, isFuture: boolean): string {
    if (isFuture) return 'bg-bg/60'
    if (qtd === 0) return 'bg-bg'
    const ratio = qtd / max
    if (ratio < 0.25) return 'bg-success/25'
    if (ratio < 0.5) return 'bg-success/50'
    if (ratio < 0.75) return 'bg-success/75'
    return 'bg-success'
  }

  const totalFotos = grid.dias.reduce((s, d) => s + (d?.qtd ?? 0), 0)
  const diasComFoto = grid.dias.filter((d) => d && !d.isFuture && d.qtd > 0).length
  const diasUteisAteHoje = grid.dias.filter((d) => d && !d.isFuture).length

  return (
    <div
      className="rounded border border-border bg-bg-panel flex flex-col"
      style={{ height: altura }}
    >
      <div className="px-4 pt-3 pb-2 flex items-baseline justify-between gap-3">
        <h4 className="text-md font-semibold text-text flex items-center gap-1.5">
          Cobertura de fotos
        </h4>
        <span className="text-xs text-text-muted first-letter:uppercase">{grid.mesLabel}</span>
      </div>
      <div className="flex-1 px-3 pb-3 flex flex-col overflow-hidden">
        <div className="grid grid-cols-7 gap-0.5 mb-1 text-xs text-text-muted text-center shrink-0">
          {WEEK_LABELS.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5 flex-1 min-h-0" style={{ gridAutoRows: '1fr' }}>
          {grid.dias.map((d, idx) => (
            <div
              key={idx}
              className={cn('rounded-sm min-h-0', d ? cor(d.qtd, d.isFuture) : 'bg-transparent')}
              title={
                d
                  ? `${d.data.split('-').reverse().join('/')}: ${contar(d.qtd, 'foto', 'fotos')}`
                  : undefined
              }
            />
          ))}
        </div>
        <div className="pt-2 text-xs text-text-muted flex items-center justify-between shrink-0">
          <span>{contar(totalFotos, 'foto', 'fotos')} no mês</span>
          <span>
            {diasComFoto} de {contar(diasUteisAteHoje, 'dia', 'dias')} com foto
          </span>
        </div>
      </div>
    </div>
  )
}
