import { type ReactNode } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { CHART_THEME, axisStyle } from './theme'
import { hojeLocalISO } from '@/lib/format/local-date'

export interface PontoCurvaS {
  /** Data ISO (dia ou segunda-feira da semana). */
  data: string
  previsto: number | null
  /** null depois de hoje: o realizado não se projeta. */
  realizado: number | null
}

interface Props {
  pontos: PontoCurvaS[]
  /** Formata os valores do eixo e da dica. */
  formatar: (v: number) => string
  /** Versão curta para o eixo (ex.: "R$ 12 mi"); o padrão é `formatar`. */
  formatarEixo?: (v: number) => string
  altura?: number
  rotuloPrevisto?: string
  rotuloRealizado?: string
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesAno = (iso: string): string => `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`
const diaMesAno = (iso: string): string =>
  `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

function Dica({
  active,
  payload,
  label,
  formatar
}: {
  active?: boolean
  payload?: Array<{ value?: number | null; dataKey?: string | number; name?: string }>
  label?: string | number
  formatar: (v: number) => string
}): ReactNode {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded border border-border-strong bg-[color:var(--popover)] px-2.5 py-2 shadow-[var(--sombra-flutuante)] text-xs">
      <div className="text-text-muted mb-1">{label ? diaMesAno(String(label)) : ''}</div>
      {payload.map((p) =>
        p.value == null ? null : (
          <div key={String(p.dataKey)} className="flex items-baseline gap-3">
            <span className="text-text-muted">{p.name}</span>
            <span className="ml-auto tabular font-semibold text-text">
              {formatar(Number(p.value))}
            </span>
          </div>
        )
      )}
    </div>
  )
}

/**
 * Curva S da obra: o previsto em linha de tinta e o realizado em azul, até hoje. A legenda vai em texto acima do
 * gráfico, com os mesmos traços das séries.
 */
export function CurvaS({
  pontos,
  formatar,
  formatarEixo,
  altura = 280,
  rotuloPrevisto = 'Previsto',
  rotuloRealizado = 'Realizado'
}: Props): ReactNode {
  const hoje = hojeLocalISO()
  const noIntervalo =
    pontos.length > 1 && hoje >= pontos[0].data && hoje <= pontos[pontos.length - 1].data
  // O marcador de hoje precisa de um ponto existente no eixo de categorias: usa o mais próximo.
  const xHoje = noIntervalo
    ? pontos.reduce((perto, p) => (p.data <= hoje ? p.data : perto), pontos[0].data)
    : null

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-1 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="w-5 border-t-2 border-dashed border-text-muted" />
          {rotuloPrevisto}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="w-5 border-t-[3px] border-accent" />
          {rotuloRealizado}
        </span>
        {xHoje ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-3 border-l border-text" />
            Hoje
          </span>
        ) : null}
      </div>
      <div style={{ height: altura }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={pontos} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid stroke={CHART_THEME.gridStroke} vertical={false} />
            <XAxis
              dataKey="data"
              tick={{ ...axisStyle, fontSize: 11 }}
              stroke={CHART_THEME.axisStroke}
              tickFormatter={mesAno}
              minTickGap={44}
              tickLine={false}
            />
            <YAxis
              tick={{ ...axisStyle, fontSize: 11 }}
              stroke={CHART_THEME.axisStroke}
              tickFormatter={formatarEixo ?? formatar}
              width={64}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              content={<Dica formatar={formatar} />}
              cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
            />
            {xHoje ? <ReferenceLine x={xHoje} stroke="var(--text)" strokeWidth={1} /> : null}
            <Line
              name={rotuloPrevisto}
              type="monotone"
              dataKey="previsto"
              stroke="var(--text-muted)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
            <Area
              name={rotuloRealizado}
              type="monotone"
              dataKey="realizado"
              stroke="var(--accent)"
              strokeWidth={2.5}
              fill="var(--accent)"
              fillOpacity={0.1}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/** "R$ 12,3 mi", "R$ 480 mil", "R$ 950". */
export function reaisCurto(v: number): string {
  const a = Math.abs(v)
  const n = (x: number, casas: number): string =>
    x.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas })
  if (a >= 1e9) return `R$ ${n(v / 1e9, 2)} bi`
  if (a >= 1e6) return `R$ ${n(v / 1e6, a >= 1e7 ? 1 : 2)} mi`
  if (a >= 1e3) return `R$ ${n(v / 1e3, 0)} mil`
  return `R$ ${n(v, 0)}`
}
