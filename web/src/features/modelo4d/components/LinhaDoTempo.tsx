import { useMemo, type ReactNode } from 'react'
import { Pause, Play, SkipBack } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import type { PontoCurvaS } from '@/components/charts/CurvaS'
import { dataBR, toLocalISO } from '@/lib/format/local-date'

export const DIA = 86_400_000

interface Props {
  inicio: number
  fim: number
  hoje: number
  t: number
  aoMudar: (t: number) => void
  tocando: boolean
  aoAlternar: () => void
  /** Dias de obra por segundo de simulação. */
  velocidade: number
  aoVelocidade: (v: number) => void
  /** Curva S em valor, desenhada por trás do cursor. */
  curva: PontoCurvaS[]
}

const VELOCIDADES: [number, string][] = [
  [7, '1 semana por segundo'],
  [30, '1 mês por segundo'],
  [90, '3 meses por segundo']
]

const iso = (t: number): string => toLocalISO(new Date(t))

/** Cursor da data, com tocar e pausar. A curva S em valor fica por trás, para situar a data na obra. */
export function LinhaDoTempo({
  inicio,
  fim,
  hoje,
  t,
  aoMudar,
  tocando,
  aoAlternar,
  velocidade,
  aoVelocidade,
  curva
}: Props): ReactNode {
  const dias = Math.max(1, Math.round((fim - inicio) / DIA))
  const dia = Math.max(0, Math.min(dias, Math.round((t - inicio) / DIA)))
  const naData = (n: number): number => inicio + n * DIA

  const tracos = useMemo(() => {
    const max = Math.max(1, ...curva.map((p) => Math.max(p.previsto ?? 0, p.realizado ?? 0)))
    const x = (data: string): number =>
      ((new Date(`${data}T12:00:00`).getTime() - inicio) / (fim - inicio || 1)) * 100
    const linha = (campo: 'previsto' | 'realizado'): string =>
      curva
        .filter((p) => p[campo] != null)
        .map((p) => `${x(p.data).toFixed(2)},${(100 - ((p[campo] ?? 0) / max) * 100).toFixed(2)}`)
        .join(' ')
    return { previsto: linha('previsto'), realizado: linha('realizado') }
  }, [curva, inicio, fim])

  const xHoje = ((hoje - inicio) / (fim - inicio || 1)) * 100

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-bg-panel px-4 py-2">
      <div className="flex items-center gap-1">
        <IconButton aria-label="Voltar ao início do plano" onClick={() => aoMudar(naData(0))}>
          <SkipBack size={14} />
        </IconButton>
        <IconButton
          aria-label={tocando ? 'Pausar a simulação' : 'Tocar a simulação'}
          onClick={aoAlternar}
        >
          {tocando ? <Pause size={14} /> : <Play size={14} />}
        </IconButton>
      </div>
      <div className="w-[5.5rem] text-sm font-semibold tabular text-text" aria-live="off">
        {dataBR(iso(naData(dia)))}
      </div>
      <div className="relative h-9 min-w-[12rem] flex-1">
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-x-0 top-0 h-full w-full"
        >
          {tracos.previsto ? (
            <polyline
              points={tracos.previsto}
              fill="none"
              stroke="var(--text-faint)"
              strokeWidth="1.5"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {tracos.realizado ? (
            <polyline
              points={tracos.realizado}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {xHoje >= 0 && xHoje <= 100 ? (
            <line
              x1={xHoje}
              x2={xHoje}
              y1="0"
              y2="100"
              stroke="var(--text-muted)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
        <input
          type="range"
          min={0}
          max={dias}
          step={1}
          value={dia}
          aria-label="Data mostrada"
          aria-valuetext={dataBR(iso(naData(dia)))}
          onChange={(e) => aoMudar(naData(Number(e.target.value)))}
          className="absolute inset-0 h-full w-full cursor-pointer accent-[color:var(--accent)]"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted tabular">
          {dataBR(iso(inicio))} a {dataBR(iso(fim))}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={hoje < inicio || hoje > fim}
          title={hoje < inicio || hoje > fim ? 'Hoje está fora do período do plano' : undefined}
          onClick={() => aoMudar(hoje)}
        >
          Hoje
        </Button>
        <div className="w-44">
          <Select
            aria-label="Velocidade da simulação"
            value={String(velocidade)}
            onChange={(e) => aoVelocidade(Number(e.target.value))}
            className="h-7 text-xs"
          >
            {VELOCIDADES.map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  )
}
