import { type ReactNode, useMemo } from 'react'
import { formatNumber } from '@/lib/format'
import { COR } from '../../lib/performance-calc'

interface Props {
  /** Produção por dia (ISO → qtd) da entidade focada (ou geral). */
  porDia: Map<string, number>
  /** Dias do período (ISO), em ordem. */
  dias: string[]
  unidade: string | null
}

const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10)
}
const dow = (iso: string): number => new Date(iso + 'T00:00:00').getDay()

interface Cel { iso: string; qtd: number; dentro: boolean }

/** Mapa de calor estilo "contribuições": dias da semana em LINHAS (altura fixa),
 *  semanas em COLUNAS (rola na horizontal). Cor = intensidade do realizado. */
export function MapaCalorProducao({ porDia, dias, unidade }: Props): ReactNode {
  const { semanas, max } = useMemo(() => {
    if (dias.length === 0) return { semanas: [] as Cel[][], max: 1 }
    const ini = addDays(dias[0], -dow(dias[0]))
    let fim = dias[dias.length - 1]
    while (dow(fim) !== 6) fim = addDays(fim, 1)
    const dentroSet = new Set(dias)
    const cols: Cel[][] = []
    let cur = ini
    let mx = 1
    let guard = 0
    while (cur <= fim && guard < 800) {
      const semana: Cel[] = []
      for (let i = 0; i < 7; i++) {
        const dentro = dentroSet.has(cur)
        const qtd = porDia.get(cur) ?? 0
        if (dentro && qtd > mx) mx = qtd
        semana.push({ iso: cur, qtd, dentro })
        cur = addDays(cur, 1)
        guard++
      }
      cols.push(semana)
    }
    return { semanas: cols, max: mx }
  }, [porDia, dias])

  if (semanas.length === 0) {
    return <div className="h-24 flex items-center justify-center text-2xs font-mono text-text-dim">Sem período.</div>
  }

  const un = unidade ?? ''
  const CELL = 14
  const GAP = 3

  return (
    <div className="overflow-x-auto pb-1">
      <div className="inline-flex flex-col gap-1 min-w-min">
        {/* rótulos de mês alinhados às colunas de semana */}
        <div className="flex" style={{ gap: GAP, marginLeft: 18 }}>
          {semanas.map((s, i) => {
            const primeiroDoMes = s.find((c) => c.dentro && Number(c.iso.split('-')[2]) <= 7)
            const label = primeiroDoMes ? MES[Number(primeiroDoMes.iso.split('-')[1]) - 1] : ''
            return (
              <div key={i} className="text-[8px] font-mono text-text-dim text-left" style={{ width: CELL }}>
                {label}
              </div>
            )
          })}
        </div>
        <div className="flex" style={{ gap: GAP }}>
          {/* coluna de rótulos de dia da semana */}
          <div className="flex flex-col" style={{ gap: GAP }}>
            {WEEK.map((l, i) => (
              <div key={i} className="text-[8px] font-mono text-text-dim flex items-center justify-end pr-1"
                style={{ height: CELL, width: 15 }}>
                {i % 2 === 1 ? l : ''}
              </div>
            ))}
          </div>
          {/* colunas de semanas */}
          {semanas.map((s, wi) => (
            <div key={wi} className="flex flex-col" style={{ gap: GAP }}>
              {s.map((c, di) => {
                if (!c.dentro) {
                  return <div key={di} className="rounded-[2px] bg-transparent" style={{ width: CELL, height: CELL }} />
                }
                const ratio = c.qtd > 0 ? c.qtd / max : 0
                const op = 0.16 + 0.84 * ratio
                return (
                  <div
                    key={di}
                    className="rounded-[2px] border border-border/40"
                    style={{ width: CELL, height: CELL, background: c.qtd > 0 ? COR.realizado : 'var(--bg)', opacity: c.qtd > 0 ? op : 1 }}
                    title={`${c.iso.split('-').reverse().join('/')} — ${formatNumber(c.qtd, 1)} ${un}`}
                  />
                )
              })}
            </div>
          ))}
        </div>
        {/* legenda */}
        <div className="flex items-center gap-1.5 text-[8px] font-mono text-text-dim mt-0.5" style={{ marginLeft: 18 }}>
          <span>menos</span>
          {[0.16, 0.4, 0.65, 1].map((o, i) => (
            <span key={i} className="rounded-[2px] border border-border/40" style={{ width: CELL - 3, height: CELL - 3, background: COR.realizado, opacity: o }} />
          ))}
          <span>mais</span>
          <span className="ml-auto">máx {formatNumber(max, 0)} {un}/dia</span>
        </div>
      </div>
    </div>
  )
}
