import { type ReactNode, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { HistogramaResult, UnidadeTempo } from '../lib/histograma-recursos'
import { RECURSO_GRUPO_LABEL, unidadeEfetiva } from '../lib/histograma-recursos'
import type { RecursoGrupo } from '@/types/orcamento'
import { segundaDaSemanaISO } from '../hooks/cronograma'
import { fmtDataMonoBR } from '../lib/dates'
import { formatNumber } from '@/lib/format'
import { CHART_THEME, axisStyle } from '@/components/charts/theme'
import { ChartEmptyState } from '@/components/charts/ChartEmptyState'
import { cn } from '@/lib/utils'

type Visao = 'semanal' | 'geral'

interface Props {
  result: HistogramaResult
  unidadeTempo: UnidadeTempo
  height?: number
}

const AZUL = CHART_THEME.series[0]
const CURSOR_FILL = 'rgba(120,150,200,.06)'

const ORDEM: RecursoGrupo[] = ['MO', 'MVE', 'COMBUSTIVEL', 'MATERIAL', 'ADM']

function fmtQtd(v: number): string {
  return formatNumber(v, Number.isInteger(v) ? 0 : 1)
}

/** Tick do eixo X que quebra o nome do recurso em até 3 linhas (sem rotação). */
function WrapTick(props: {
  x?: number
  y?: number
  payload?: { value?: string | number }
}): ReactNode {
  const { x = 0, y = 0, payload } = props
  const text = String(payload?.value ?? '')
  const lines: string[] = []
  let cur = ''
  for (const w of text.split(' ')) {
    const t = cur ? `${cur} ${w}` : w
    if (t.length > 13 && cur) {
      lines.push(cur)
      cur = w
    } else cur = t
  }
  if (cur) lines.push(cur)
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        textAnchor="middle"
        fill={CHART_THEME.axisLabel}
        fontSize={9}
        fontFamily='"IBM Plex Mono", ui-monospace, monospace'
      >
        {lines.slice(0, 3).map((l, i) => (
          <tspan key={i} x={0} dy={i === 0 ? 11 : 10}>
            {l}
          </tspan>
        ))}
      </text>
    </g>
  )
}

function rotuloUnidadeGrupo(grupo: RecursoGrupo, unidadeTempo: UnidadeTempo): string {
  if (grupo === 'MO' || grupo === 'MVE') {
    if (unidadeTempo === 'horas') return 'horas'
    if (unidadeTempo === 'dias') return 'dias'
    return 'recursos ativos'
  }
  if (grupo === 'COMBUSTIVEL') return 'litros'
  return 'quantidade'
}

export function HistogramaRecursosChart({ result, unidadeTempo, height = 360 }: Props): ReactNode {
  const gruposPresentes = useMemo(
    () => ORDEM.filter((g) => result.recursos.some((r) => r.grupo === g)),
    [result.recursos]
  )
  const [grupo, setGrupo] = useState<RecursoGrupo | null>(null)
  const grupoSel = grupo && gruposPresentes.includes(grupo) ? grupo : gruposPresentes[0] ?? null

  const [visao, setVisao] = useState<Visao>('semanal')

  const recursosG = useMemo(
    () => (grupoSel ? result.recursos.filter((r) => r.grupo === grupoSel) : []),
    [result.recursos, grupoSel]
  )

  // Semana atual (segunda ISO de hoje) p/ default e destaque.
  const semanaAtual = useMemo(() => segundaDaSemanaISO(new Date().toISOString().slice(0, 10)), [])
  const semanaDefault = useMemo(() => {
    if (result.semanas.length === 0) return ''
    if (result.semanas.includes(semanaAtual)) return semanaAtual
    const anteriores = result.semanas.filter((s) => s <= semanaAtual)
    return anteriores.length ? anteriores[anteriores.length - 1] : result.semanas[0]
  }, [result.semanas, semanaAtual])

  const [semanaSel, setSemanaSel] = useState<string | null>(null)
  const semanaEfetiva = semanaSel && result.semanas.includes(semanaSel) ? semanaSel : semanaDefault
  const idxSemana = result.semanas.indexOf(semanaEfetiva)
  const irSemana = (delta: number): void => {
    const ni = idxSemana + delta
    if (ni >= 0 && ni < result.semanas.length) setSemanaSel(result.semanas[ni])
  }

  // Dados — Semanal: 1 barra por recurso na semana escolhida.
  const dataSemanal = useMemo(
    () =>
      recursosG
        .map((r) => ({
          id: r.recurso_id,
          nome: r.nome,
          valor: r.porSemana[semanaEfetiva] ?? 0,
          unidade: unidadeEfetiva(r, unidadeTempo)
        }))
        .filter((d) => d.valor > 0),
    [recursosG, semanaEfetiva, unidadeTempo]
  )

  // Dados — Visão geral: 1 barra por semana, total agregado do grupo.
  const dataGeral = useMemo(
    () =>
      result.semanas.map((s) => ({
        periodo: s,
        total: recursosG.reduce((acc, r) => acc + (r.porSemana[s] ?? 0), 0)
      })),
    [result.semanas, recursosG]
  )

  if (result.recursos.length === 0) {
    return (
      <ChartEmptyState
        height={height}
        message="Sem recursos planejados — calcular o cronograma e alocar quantidades primeiro."
      />
    )
  }

  const unidadeGrupo = grupoSel ? rotuloUnidadeGrupo(grupoSel, unidadeTempo) : ''
  const materialNaGeral = grupoSel === 'MATERIAL' && visao === 'geral'
  // Para 'recursos' (efetivo), somar entre semanas não faz sentido → mostra o pico.
  const resumoComoPico = unidadeTempo === 'recursos' && grupoSel != null && (grupoSel === 'MO' || grupoSel === 'MVE')

  // Tooltips custom (legíveis), capturando escopo.
  const TooltipSemanal = ({
    active,
    payload
  }: {
    active?: boolean
    payload?: Array<{ payload?: { nome: string; valor: number; unidade: string } }>
  }): ReactNode => {
    if (!active || !payload?.length) return null
    const p = payload[0]?.payload
    if (!p) return null
    return (
      <div className="rounded border border-border-strong bg-bg-elevated px-2 py-1.5 shadow-lg text-xs font-mono">
        <div className="text-text font-semibold">{p.nome}</div>
        <div className="mt-0.5 text-accent">
          {fmtQtd(p.valor)} {p.unidade}
        </div>
      </div>
    )
  }

  const TooltipGeral = ({
    active,
    payload
  }: {
    active?: boolean
    payload?: Array<{ payload?: { periodo: string; total: number } }>
  }): ReactNode => {
    if (!active || !payload?.length) return null
    const p = payload[0]?.payload
    if (!p) return null
    return (
      <div className="rounded border border-border-strong bg-bg-elevated px-2 py-1.5 shadow-lg text-xs font-mono">
        <div className="text-text font-semibold">
          Semana de {fmtDataMonoBR(p.periodo)}
          {p.periodo === semanaAtual ? ' (atual)' : ''}
        </div>
        <div className="mt-0.5 text-accent">
          {fmtQtd(p.total)} {unidadeGrupo}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-0 h-full gap-3">
      {/* Controles: grupo + visão */}
      <div className="flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div className="flex items-center gap-1 flex-wrap">
          {gruposPresentes.map((g) => (
            <button
              key={g}
              onClick={() => setGrupo(g)}
              className={cn(
                'px-2.5 py-1 rounded text-2xs font-mono border transition-colors',
                g === grupoSel
                  ? 'bg-accent text-white border-accent'
                  : 'bg-bg-panel text-text-dim border-border hover:text-text hover:border-border-strong'
              )}
            >
              {RECURSO_GRUPO_LABEL[g]}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded border border-border overflow-hidden">
          {(['semanal', 'geral'] as Visao[]).map((v) => (
            <button
              key={v}
              onClick={() => setVisao(v)}
              className={cn(
                'px-2.5 py-1 text-2xs font-mono transition-colors',
                v === visao ? 'bg-accent text-white' : 'bg-bg-panel text-text-dim hover:text-text'
              )}
            >
              {v === 'semanal' ? 'Semanal' : 'Visão geral'}
            </button>
          ))}
        </div>
      </div>

      {/* Navegação de semana (só na visão semanal) */}
      {visao === 'semanal' ? (
        <div className="flex items-center gap-2">
          <button
            onClick={() => irSemana(-1)}
            disabled={idxSemana <= 0}
            className="size-6 rounded flex items-center justify-center text-text-dim hover:text-text hover:bg-bg-hover disabled:opacity-40"
            aria-label="Semana anterior"
          >
            <ChevronLeft size={14} />
          </button>
          <select
            value={semanaEfetiva}
            onChange={(e) => setSemanaSel(e.target.value)}
            className="bg-bg border border-border rounded px-2 py-1 text-xs font-mono"
          >
            {result.semanas.map((s) => (
              <option key={s} value={s}>
                Semana de {fmtDataMonoBR(s)}
                {s === semanaAtual ? ' (atual)' : ''}
              </option>
            ))}
          </select>
          <button
            onClick={() => irSemana(1)}
            disabled={idxSemana >= result.semanas.length - 1}
            className="size-6 rounded flex items-center justify-center text-text-dim hover:text-text hover:bg-bg-hover disabled:opacity-40"
            aria-label="Próxima semana"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      ) : null}

      {/* Gráfico — altura responsiva: encolhe em telas baixas p/ não espremer a
          tabela, com teto em `height` nas telas grandes. */}
      <div
        className="rounded border border-border bg-bg-panel p-3 shrink-0"
        style={{ height: `clamp(170px, 34vh, ${height}px)` }}
      >
        <ResponsiveContainer width="100%" height="100%">
          {visao === 'semanal' ? (
            <BarChart data={dataSemanal} margin={{ top: 18, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid stroke={CHART_THEME.gridStroke} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="nome"
                interval={0}
                height={56}
                stroke={CHART_THEME.axisStroke}
                tick={<WrapTick />}
              />
              <YAxis
                tick={axisStyle}
                stroke={CHART_THEME.axisStroke}
                width={52}
                allowDecimals={false}
                label={{
                  value: unidadeGrupo,
                  angle: -90,
                  position: 'insideLeft',
                  style: { ...axisStyle, textAnchor: 'middle' }
                }}
              />
              <Tooltip content={<TooltipSemanal />} cursor={{ fill: CURSOR_FILL }} />
              <Bar dataKey="valor" fill={AZUL} radius={[2, 2, 0, 0]} maxBarSize={56}>
                <LabelList
                  dataKey="valor"
                  position="top"
                  fill={CHART_THEME.tooltipText}
                  fontSize={10}
                  formatter={(v) => (Number(v) > 0 ? fmtQtd(Number(v)) : '')}
                />
              </Bar>
            </BarChart>
          ) : (
            <BarChart data={dataGeral} margin={{ top: 18, right: 16, bottom: 10, left: 8 }}>
              <CartesianGrid stroke={CHART_THEME.gridStroke} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="periodo"
                tickFormatter={(v) => fmtDataMonoBR(v as string)}
                stroke={CHART_THEME.axisStroke}
                tick={axisStyle}
              />
              <YAxis
                tick={axisStyle}
                stroke={CHART_THEME.axisStroke}
                width={52}
                allowDecimals={false}
                label={{
                  value: unidadeGrupo,
                  angle: -90,
                  position: 'insideLeft',
                  style: { ...axisStyle, textAnchor: 'middle' }
                }}
              />
              <Tooltip content={<TooltipGeral />} cursor={{ fill: CURSOR_FILL }} />
              <Bar dataKey="total" radius={[2, 2, 0, 0]} maxBarSize={36}>
                {dataGeral.map((d) => (
                  <Cell
                    key={d.periodo}
                    fill={AZUL}
                    fillOpacity={d.periodo === semanaAtual ? 1 : 0.4}
                  />
                ))}
                <LabelList
                  dataKey="total"
                  position="top"
                  fill={CHART_THEME.tooltipText}
                  fontSize={9}
                  formatter={(v) => (Number(v) > 0 ? fmtQtd(Number(v)) : '')}
                />
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {visao === 'geral' ? (
        <div className="flex items-center gap-4 text-2xs font-mono text-text-dim shrink-0">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: AZUL }} /> Semana atual
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: AZUL, opacity: 0.4 }} /> Demais
            semanas
          </span>
        </div>
      ) : null}

      {materialNaGeral ? (
        <p className="text-2xs font-mono text-amber-400/80 shrink-0">
          ⚠ Em Material, a “Visão geral” soma quantidades de recursos com unidades diferentes
          (kg, m³, un). Use a visão Semanal para leitura por recurso.
        </p>
      ) : null}

      {/* Tabela matriz (grupo selecionado) — única área com rolagem */}
      {grupoSel && recursosG.length > 0 ? (
        <div className="rounded border border-border bg-bg-panel overflow-hidden flex-1 min-h-[220px] flex flex-col">
          <div className="px-3 py-2 border-b border-border text-2xs font-mono text-text-dim uppercase shrink-0">
            {RECURSO_GRUPO_LABEL[grupoSel]} — distribuição semanal ({unidadeGrupo})
          </div>
          <div className="overflow-auto flex-1 min-h-0">
            <table className="text-2xs font-mono border-collapse">
              <thead>
                <tr>
                  {/* Canto: fixo no topo E à esquerda (z mais alto que os demais). */}
                  <th className="sticky top-0 left-0 z-30 bg-bg-elevated border border-border px-2 py-1 text-left w-[220px] min-w-[220px]">
                    Recurso
                  </th>
                  <th className="sticky top-0 z-20 bg-bg-elevated border border-border px-1 py-1 text-center min-w-[48px]">
                    Unid.
                  </th>
                  {result.semanas.map((s) => (
                    <th
                      key={s}
                      className={cn(
                        'sticky top-0 z-20 border border-border px-1 py-1 text-center min-w-[56px]',
                        s === semanaAtual ? 'bg-accent-glow text-accent' : 'bg-bg-elevated'
                      )}
                    >
                      {fmtDataMonoBR(s)}
                    </th>
                  ))}
                  <th className="sticky top-0 z-20 bg-bg-elevated border border-border px-2 py-1 text-center min-w-[70px]">
                    {resumoComoPico ? 'Pico' : 'Total'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {recursosG.map((r) => (
                  <tr key={r.recurso_id} className="hover:bg-bg-hover/40">
                    <td className="sticky left-0 z-10 bg-bg-panel border border-border px-2 py-1 text-left font-medium text-text w-[220px] min-w-[220px]">
                      {r.nome}
                    </td>
                    <td className="border border-border px-1 py-1 text-center text-text-dim">
                      {unidadeEfetiva(r, unidadeTempo)}
                    </td>
                    {result.semanas.map((s) => {
                      const v = r.porSemana[s] ?? 0
                      return (
                        <td
                          key={s}
                          className={cn(
                            'border border-border px-1 py-1 text-center tabular-nums',
                            s === semanaAtual && 'bg-accent-glow/40'
                          )}
                        >
                          {v > 0 ? fmtQtd(v) : ''}
                        </td>
                      )
                    })}
                    <td className="border border-border px-2 py-1 text-center tabular-nums font-semibold">
                      {fmtQtd(resumoComoPico ? r.pico : r.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
