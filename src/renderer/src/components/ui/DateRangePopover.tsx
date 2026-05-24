import { type ReactNode, useMemo, useState } from 'react'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Popover } from './popover'
import { cn } from '@/lib/utils'

interface Props {
  from: string | null
  to: string | null
  onChange: (from: string | null, to: string | null) => void
  placeholder?: string
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const DIAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

function parse(s: string | null): Date | null {
  if (!s) return null
  const d = new Date(s + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? null : d
}
function fmtIso(d: Date | null): string | null {
  if (!d) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtBR(d: Date | null): string {
  if (!d) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function DateRangePopover({ from, to, onChange, placeholder = 'Selecionar período' }: Props): ReactNode {
  const [open, setOpen] = useState(false)
  const fromD = parse(from)
  const toD = parse(to)

  const initialMonth = useMemo(() => {
    const d = fromD ?? toD ?? new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  }, [from, to])

  const [mes, setMes] = useState<Date>(initialMonth)
  const [hoverDay, setHoverDay] = useState<Date | null>(null)
  const [picking, setPicking] = useState<'from' | 'to'>(fromD && !toD ? 'to' : 'from')

  const grid = useMemo(() => buildGrid(mes), [mes])

  function onClickDay(d: Date): void {
    if (picking === 'from') {
      onChange(fmtIso(d), null)
      setPicking('to')
    } else {
      if (fromD && d.getTime() < fromD.getTime()) {
        // user clicou antes do "from" → reseta como novo from
        onChange(fmtIso(d), null)
        setPicking('to')
      } else {
        onChange(from, fmtIso(d))
        setPicking('from')
        setOpen(false)
      }
    }
  }

  function isInRange(d: Date): boolean {
    if (!fromD) return false
    const end = toD ?? (picking === 'to' && hoverDay && hoverDay.getTime() >= fromD.getTime() ? hoverDay : null)
    if (!end) return false
    return d.getTime() >= fromD.getTime() && d.getTime() <= end.getTime()
  }

  function preset(kind: '7d' | '30d' | 'mes' | 'mes_passado' | 'limpar'): void {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    if (kind === 'limpar') { onChange(null, null); setOpen(false); return }
    let f: Date; let t: Date = today
    if (kind === '7d') { f = new Date(today); f.setDate(f.getDate() - 6) }
    else if (kind === '30d') { f = new Date(today); f.setDate(f.getDate() - 29) }
    else if (kind === 'mes') { f = new Date(today.getFullYear(), today.getMonth(), 1) }
    else { f = new Date(today.getFullYear(), today.getMonth() - 1, 1); t = new Date(today.getFullYear(), today.getMonth(), 0) }
    onChange(fmtIso(f), fmtIso(t))
    setOpen(false)
  }

  const trigger = (
    <button
      onClick={() => setOpen((o) => !o)}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded border text-2xs font-mono transition-colors min-w-[180px]',
        from || to
          ? 'border-accent/50 text-text bg-accent/5 hover:border-accent'
          : 'border-border text-text-dim hover:text-text hover:border-border-strong'
      )}
    >
      <CalendarIcon size={11} />
      <span className="flex-1 text-left truncate">
        {from || to
          ? `${fmtBR(fromD) || '…'} → ${fmtBR(toD) || '…'}`
          : placeholder}
      </span>
      {(from || to) && (
        <X
          size={10}
          className="text-text-dim hover:text-text"
          onClick={(e) => { e.stopPropagation(); onChange(null, null) }}
        />
      )}
    </button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen} trigger={trigger} className="p-3 w-[280px]">
      <div className="flex items-center gap-1 mb-3 border-b border-border pb-2">
        {(['7d', '30d', 'mes', 'mes_passado'] as const).map((k) => (
          <button
            key={k}
            onClick={() => preset(k)}
            className="px-1.5 py-0.5 rounded text-2xs font-mono text-text-dim hover:text-text hover:bg-bg-hover"
          >
            {k === '7d' ? '7d' : k === '30d' ? '30d' : k === 'mes' ? 'mês' : 'mês ant.'}
          </button>
        ))}
        <button
          onClick={() => preset('limpar')}
          className="px-1.5 py-0.5 rounded text-2xs font-mono text-text-dim hover:text-danger ml-auto"
        >
          limpar
        </button>
      </div>

      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}
          className="p-1 rounded hover:bg-bg-hover text-text-dim hover:text-text"
        >
          <ChevronLeft size={12} />
        </button>
        <span className="text-xs font-mono text-text capitalize">
          {MESES[mes.getMonth()]} {mes.getFullYear()}
        </span>
        <button
          onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}
          className="p-1 rounded hover:bg-bg-hover text-text-dim hover:text-text"
        >
          <ChevronRight size={12} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DIAS.map((d, i) => (
          <div key={i} className="text-center text-2xs font-mono text-text-dim h-5 flex items-center justify-center">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {grid.map((cell, idx) => {
          if (!cell) return <div key={idx} className="h-6" />
          const isFrom = fromD && sameDay(cell, fromD)
          const isTo = toD && sameDay(cell, toD)
          const inRange = isInRange(cell)
          const isToday = sameDay(cell, new Date())
          return (
            <button
              key={idx}
              onClick={() => onClickDay(cell)}
              onMouseEnter={() => setHoverDay(cell)}
              onMouseLeave={() => setHoverDay(null)}
              className={cn(
                'h-6 rounded text-2xs font-mono transition-colors',
                inRange && !isFrom && !isTo && 'bg-accent/20 text-text',
                (isFrom || isTo) && 'bg-accent text-bg font-semibold',
                !inRange && !isFrom && !isTo && 'text-text-muted hover:bg-bg-hover hover:text-text',
                isToday && !isFrom && !isTo && 'ring-1 ring-accent/50'
              )}
            >
              {cell.getDate()}
            </button>
          )
        })}
      </div>

      <div className="text-2xs font-mono text-text-dim mt-2 pt-2 border-t border-border">
        {picking === 'from' ? 'Selecione a data inicial' : 'Selecione a data final'}
      </div>
    </Popover>
  )
}

function buildGrid(mes: Date): (Date | null)[] {
  const ano = mes.getFullYear()
  const m = mes.getMonth()
  const inicio = new Date(ano, m, 1)
  const ult = new Date(ano, m + 1, 0)
  const out: (Date | null)[] = []
  for (let i = 0; i < inicio.getDay(); i++) out.push(null)
  for (let d = 1; d <= ult.getDate(); d++) out.push(new Date(ano, m, d))
  while (out.length % 7 !== 0) out.push(null)
  return out
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
