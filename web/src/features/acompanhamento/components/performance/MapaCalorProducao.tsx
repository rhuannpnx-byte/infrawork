import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { Vazio } from '@/components/ui/estado'
import { formatNumber } from '@/lib/format'
import { contar } from '@/lib/rotulos'
import { cn } from '@/lib/utils'

interface Props {
  /** Produção por dia (ISO → qtd) da entidade focada (ou geral). */
  porDia: Map<string, number>
  /** Dias do período (ISO), em ordem. */
  dias: string[]
  unidade: string | null
}

const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const JANELA = 30

const dow = (iso: string): number => new Date(iso + 'T00:00:00').getDay()
const fmtBR = (iso: string): string => iso.split('-').reverse().join('/').slice(0, 5)

// Rampa do verde de "realizado" sobre a folha. Até o nível 3 a tinta do texto tem contraste; no nível 4
// (cor cheia) o texto usa a cor da folha. As proporções foram medidas nos dois temas.
const FUNDO = ['bg-bg', 'bg-success/15', 'bg-success/30', 'bg-success/45', 'bg-success']
function nivel(qtd: number, max: number): number {
  if (qtd <= 0) return 0
  const r = qtd / max
  if (r < 0.25) return 1
  if (r < 0.5) return 2
  if (r < 0.75) return 3
  return 4
}
/** Mapa de calor da produção diária: janela de 30 dias, navegável quando o período é maior. */
export function MapaCalorProducao({ porDia, dias, unidade }: Props): ReactNode {
  const [offset, setOffset] = useState(0)
  const totalJanelas = Math.max(1, Math.ceil(dias.length / JANELA))

  const resetKey = `${dias[0] ?? ''}|${dias.length}`
  useEffect(() => {
    setOffset(0)
  }, [resetKey])

  const maxPeriodo = useMemo(() => {
    let m = 1
    for (const d of dias) {
      const q = porDia.get(d) ?? 0
      if (q > m) m = q
    }
    return m
  }, [porDia, dias])

  const { celulas, range, iniIdx, total, diasTrab } = useMemo(() => {
    const fimIdx = dias.length - offset * JANELA
    const ini = Math.max(0, fimIdx - JANELA)
    const slice = dias.slice(ini, fimIdx)
    const cels: Array<{ iso: string; qtd: number } | null> = []
    if (slice.length > 0) {
      for (let i = 0; i < dow(slice[0]); i++) cels.push(null) // alinha 1º dia à coluna
      for (const iso of slice) cels.push({ iso, qtd: porDia.get(iso) ?? 0 })
    }
    let t = 0,
      dt = 0
    for (const iso of slice) {
      const q = porDia.get(iso) ?? 0
      if (q > 0) {
        t += q
        dt++
      }
    }
    return {
      celulas: cels,
      iniIdx: ini,
      total: t,
      diasTrab: dt,
      range: slice.length ? { de: slice[0], ate: slice[slice.length - 1] } : null
    }
  }, [dias, offset, porDia])

  if (dias.length === 0 || !range) {
    return <Vazio>Sem produção no período escolhido.</Vazio>
  }

  const un = unidade ?? ''
  const canOlder = iniIdx > 0
  const canNewer = offset > 0

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 mb-2 min-h-7">
        <span className="text-sm text-text-muted tabular">
          {fmtBR(range.de)} a {fmtBR(range.ate)}
        </span>
        {totalJanelas > 1 ? (
          <div className="flex items-center gap-1">
            <span className="text-sm text-text-muted tabular mr-1">
              {totalJanelas - offset} de {totalJanelas}
            </span>
            <IconButton
              size="sm"
              onClick={() => setOffset((o) => o + 1)}
              disabled={!canOlder}
              className="border border-border-strong"
              aria-label="30 dias anteriores"
              title="30 dias anteriores"
            >
              <ChevronLeft size={14} />
            </IconButton>
            <IconButton
              size="sm"
              onClick={() => setOffset((o) => Math.max(0, o - 1))}
              disabled={!canNewer}
              className="border border-border-strong"
              aria-label="30 dias seguintes"
              title="30 dias seguintes"
            >
              <ChevronRight size={14} />
            </IconButton>
          </div>
        ) : null}
      </div>

      <div
        className="grid grid-cols-7 gap-1 mb-1 text-2xs font-semibold text-text-dim text-center"
        aria-hidden
      >
        {WEEK.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {celulas.map((c, i) => {
          if (!c) return <div key={i} className="aspect-square" />
          const n = nivel(c.qtd, maxPeriodo)
          const tinta = n === 4 ? 'text-bg-panel' : 'text-text'
          return (
            <div
              key={i}
              className={cn(
                'rounded-sm aspect-square min-h-9 flex flex-col justify-between overflow-hidden px-1 py-0.5',
                FUNDO[n]
              )}
              title={`${c.iso.split('-').reverse().join('/')}: ${formatNumber(c.qtd, 1)} ${un}`}
            >
              <span
                className={cn('text-2xs tabular leading-none', n === 0 ? 'text-text-muted' : tinta)}
              >
                {Number(c.iso.split('-')[2])}
              </span>
              {c.qtd > 0 ? (
                <span
                  className={cn('text-xs tabular font-semibold leading-none text-center', tinta)}
                >
                  {formatNumber(c.qtd, 0)}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="pt-3 mt-auto text-sm text-text-muted flex flex-wrap items-center justify-between gap-x-3">
        <span className="tabular">
          {formatNumber(total, 0)} {un} nestes dias
        </span>
        <span>{contar(diasTrab, 'dia com produção', 'dias com produção')}</span>
      </div>
    </div>
  )
}
