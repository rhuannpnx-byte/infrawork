import { cn } from '@/lib/cn'
import { TOM_FUNDO, type Tom } from './lib'
import { diaDaSemana, nivelCalor, qtdCurta } from './producao'

/**
 * Gráficos da visão estratégica em SVG/HTML feitos à mão — sem biblioteca de gráficos (tudo vai para o cache
 * offline de todos os aparelhos, inclusive dos apontadores que nunca abrem o painel).
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))

/** Barra de avanço: preenchido = realizado; traço vertical = esperado hoje. */
export function BarraAvanco({
  real,
  esperado,
  tom = 'accent',
  className,
}: {
  real: number | null | undefined
  esperado?: number | null
  tom?: Tom
  className?: string
}) {
  const r = clamp01(Number(real ?? 0))
  const e = esperado == null ? null : clamp01(Number(esperado))
  return (
    <div
      className={cn('relative h-2 w-full overflow-hidden rounded-sm bg-bg-elevated', className)}
      role="img"
      aria-label={`Realizado ${Math.round(r * 100)}%${e != null ? `, esperado ${Math.round(e * 100)}%` : ''}`}
    >
      <div className={cn('h-full rounded-sm', TOM_FUNDO[tom])} style={{ width: `${r * 100}%` }} />
      {e != null && (
        <div
          className="absolute inset-y-[-2px] w-[2px] bg-on-surface"
          style={{ left: `calc(${e * 100}% - 1px)` }}
          aria-hidden
        />
      )}
    </div>
  )
}

/** Curva-S semanal acumulada: previsto (tracejado) × realizado (azul), com a linha de hoje. */
export function CurvaS({
  pontos,
  idxHoje,
  altura = 150,
}: {
  pontos: { s: string; p: number | null; r: number | null }[]
  idxHoje: number
  altura?: number
}) {
  const W = 320
  const H = altura
  // rótulos com 13 unidades num desenho de 320 de largura: 12 px ou mais numa tela de 360
  const pad = { l: 40, r: 8, t: 10, b: 22 }
  if (pontos.length < 2) {
    return (
      <p className="py-6 text-center text-xs text-on-surface-dim">
        A curva aparece quando houver linha de base com cronograma calculado.
      </p>
    )
  }
  const maxY = Math.max(1, ...pontos.map((p) => Math.max(p.p ?? 0, p.r ?? 0)))
  const x = (i: number) => pad.l + (i / (pontos.length - 1)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / maxY) * (H - pad.t - pad.b)
  const linha = (k: 'p' | 'r') =>
    pontos
      .map((p, i) => (p[k] == null ? null : `${x(i).toFixed(1)},${y(p[k]!).toFixed(1)}`))
      .filter(Boolean)
      .join(' ')
  const ano = (s: string) => s.slice(2, 4)
  const mes = (s: string) => `${s.slice(5, 7)}/${ano(s)}`
  const ultimoReal = [...pontos].reverse().find((p) => p.r != null)
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mx-auto h-auto w-full max-w-md"
      role="img"
      aria-label="Curva S: previsto e realizado acumulados"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={y(g * maxY)}
            y2={y(g * maxY)}
            stroke="var(--chart-grade)"
            strokeWidth={1}
          />
          <text
            x={pad.l - 4}
            y={y(g * maxY) + 4}
            textAnchor="end"
            fontSize={13}
            fill="var(--text-dim)"
          >
            {Math.round(g * maxY * 100)}%
          </text>
        </g>
      ))}
      <text x={pad.l} y={H - 4} fontSize={13} fill="var(--text-dim)">
        {mes(pontos[0]!.s)}
      </text>
      <text x={W - pad.r} y={H - 4} fontSize={13} fill="var(--text-dim)" textAnchor="end">
        {mes(pontos[pontos.length - 1]!.s)}
      </text>
      {idxHoje >= 0 && (
        <g>
          <line
            x1={x(idxHoje)}
            x2={x(idxHoje)}
            y1={pad.t}
            y2={H - pad.b}
            stroke="var(--text-dim)"
            strokeDasharray="2 3"
          />
          <text
            x={x(idxHoje) + 3}
            y={pad.t + 11}
            fontSize={13}
            fill="var(--text-muted)"
            textAnchor={idxHoje > pontos.length * 0.8 ? 'end' : 'start'}
            dx={idxHoje > pontos.length * 0.8 ? -6 : 0}
          >
            hoje
          </text>
        </g>
      )}
      <polyline
        points={linha('p')}
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <polyline points={linha('r')} fill="none" stroke="var(--chart-real)" strokeWidth={2} />
      {ultimoReal && (
        <circle
          cx={x(pontos.indexOf(ultimoReal))}
          cy={y(ultimoReal.r!)}
          r={3}
          fill="var(--chart-real)"
        />
      )}
    </svg>
  )
}

/** Produção dos últimos 14 dias (o último é hoje). */
export function Barras14({ valores, unidade }: { valores: number[]; unidade?: string | null }) {
  const vs = valores.map((v) => Number(v ?? 0))
  const max = Math.max(...vs, 0)
  const W = 280
  const H = 64
  const gap = 3
  const bw = (W - gap * (vs.length - 1)) / Math.max(vs.length, 1)
  return (
    <svg
      viewBox={`0 0 ${W} ${H + 17}`}
      className="mx-auto h-auto w-full max-w-md"
      role="img"
      aria-label={`Produção dos últimos ${vs.length} dias${unidade ? ` em ${unidade}` : ''}`}
    >
      {vs.map((v, i) => {
        const h = max > 0 ? Math.max(v > 0 ? 2 : 0, (v / max) * H) : 0
        const hoje = i === vs.length - 1
        return (
          <g key={i}>
            <rect
              x={i * (bw + gap)}
              y={H - h}
              width={bw}
              height={h}
              rx={1.5}
              fill="var(--chart-real)"
              fillOpacity={hoje ? 1 : 0.5}
            />
            {v === 0 && (
              <rect
                x={i * (bw + gap)}
                y={H - 1}
                width={bw}
                height={1}
                fill="var(--border-strong)"
              />
            )}
          </g>
        )
      })}
      <text x={0} y={H + 14} fontSize={12} fill="var(--text-dim)">
        {vs.length} dias atrás
      </text>
      <text x={W} y={H + 14} fontSize={12} fill="var(--text-muted)" textAnchor="end">
        hoje
      </text>
    </svg>
  )
}

const SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
// degraus do verde do tema (classe inteira, para o Tailwind gerar) e o texto que contrasta com cada um
const FUNDO_CALOR = ['bg-bg-elevated', 'bg-ok/20', 'bg-ok/35', 'bg-ok/50', 'bg-ok']

/**
 * Mapa de calor da produção diária (mesmo desenho da Performance do web): uma semana por linha, cor mais forte
 * quanto mais perto do maior dia do período. Toque num dia para ver o detalhe.
 */
export function MapaCalor({
  porDia,
  dias,
  max,
  selecionado,
  onSelecionar,
}: {
  porDia: Map<string, number>
  dias: string[]
  max: number
  selecionado: string | null
  onSelecionar: (dia: string) => void
}) {
  const vazias = dias.length ? diaDaSemana(dias[0]!) : 0
  return (
    // avança 12 px sobre o respiro do bloco: numa tela de 360 cada dia fica com 44 px de toque
    <div className="-mx-3">
      <div className="mb-1 grid grid-cols-7 gap-px text-center text-2xs text-on-surface-muted">
        {SEMANA.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px" data-testid="mapa-calor">
        {Array.from({ length: vazias }, (_, i) => (
          <div key={`v${i}`} className="aspect-square" />
        ))}
        {dias.map((d) => {
          const q = porDia.get(d) ?? 0
          const n = nivelCalor(q, max)
          // só o degrau cheio pede texto claro; nos outros a tinta normal passa de 4,5:1 nos dois temas
          const forte = n >= 4
          return (
            <button
              key={d}
              type="button"
              onClick={() => onSelecionar(d)}
              data-dia={d}
              data-qtd={q}
              aria-label={`${d.split('-').reverse().join('/')}: ${q > 0 ? qtdCurta(q) : 'sem produção'}`}
              aria-pressed={selecionado === d}
              className={cn(
                'relative flex aspect-square items-center justify-center overflow-hidden rounded-sm',
                FUNDO_CALOR[n],
                selecionado === d && 'ring-2 ring-on-surface',
              )}
            >
              <span
                className={cn(
                  'tabular absolute left-1 top-0.5 text-2xs leading-none',
                  forte ? 'text-on-status' : n === 0 ? 'text-on-surface-muted' : 'text-on-surface',
                )}
              >
                {Number(d.slice(8, 10))}
              </span>
              {q > 0 && (
                <span
                  className={cn(
                    'tabular mt-2 text-2xs font-semibold leading-none',
                    forte ? 'text-on-status' : 'text-on-surface',
                  )}
                >
                  {qtdCurta(q)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
