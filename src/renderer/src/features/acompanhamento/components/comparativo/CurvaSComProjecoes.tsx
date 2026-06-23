import { type ReactNode, useMemo } from 'react'
import {
  Area, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend
} from 'recharts'
import { CHART_THEME, axisStyle } from '@/components/charts/theme'
import { ChartEmptyState } from '@/components/charts/ChartEmptyState'
import type { CurvaSPonto, PrevistoRealizadoItem } from '@/types/acompanhamento'
import { formatNumber } from '@/lib/format'

interface Props {
  pontos: CurvaSPonto[]
  /** Item selecionado (1 servico_grupo) — projeções só fazem sentido pra 1 serviço */
  item?: PrevistoRealizadoItem | null
  altura?: number
  /** Cliente: esconde projeções de tendência (média atual/necessária, fim
   *  projetado). Mostra só planejado × realizado acumulados. */
  ocultarProjecoes?: boolean
}

interface RowChart {
  data: string
  planejado: number
  realizado: number | null
  proj_atual: number | null
  proj_necessaria: number | null
}

interface TooltipPayloadItem { value?: number | string | null; dataKey?: string | number; name?: string; color?: string }
function CustomTooltip(props: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string | number }): ReactNode {
  const { active, payload, label } = props
  if (!active || !payload?.length) return null
  return (
    <div className="rounded border border-border-strong bg-bg-elevated px-2 py-1.5 shadow-lg text-xs font-mono">
      <div className="text-text-dim mb-1">
        {label ? new Date(String(label) + 'T00:00:00').toLocaleDateString('pt-BR') : ''}
      </div>
      {payload.map((p) => {
        if (p.value == null) return null
        return (
          <div key={String(p.dataKey)} className="flex items-center gap-2">
            <span className="size-2 rounded-sm" style={{ background: p.color }} />
            <span className="text-text-dim">{p.name}</span>
            <span className="text-text tabular-nums ml-auto">
              {formatNumber(Number(p.value), 0)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function fmtNum(n: number): string {
  return formatNumber(Number(n), 0)
}

interface ProjecaoStats {
  media_atual: number | null
  media_necessaria: number | null
  fim_atual: string | null
  fim_necessario: string | null
  fim_planejado: string | null
  qtd_planejada_total: number | null
  qtd_realizada_atual: number | null
  dias_uteis_restantes_plan: number | null
}

export function CurvaSComProjecoes({ pontos, item, altura = 360, ocultarProjecoes = false }: Props): ReactNode {
  const { data, projStats } = useMemo<{ data: RowChart[]; projStats: ProjecaoStats }>(() => {
    if (!pontos || pontos.length === 0) {
      return { data: [], projStats: emptyStats() }
    }

    // Agrega por data (caso pontos venham de vários serviços). A view só emite
    // linha por item nos dias com atividade; somar cru afunda o acumulado em
    // dias onde um item não tem linha. Acumulado é função-degrau → forward-fill
    // o último valor de cada item antes de somar (monotônico).
    const datas = Array.from(new Set(pontos.map((p) => p.data))).sort((a, b) => a.localeCompare(b))
    const porItem = new Map<string, Map<string, { plan: number; real: number }>>()
    for (const p of pontos) {
      const k = p.item_orcamentario_id ?? '∅'
      let m = porItem.get(k)
      if (!m) { m = new Map(); porItem.set(k, m) }
      m.set(p.data, { plan: Number(p.planejado_acumulado ?? 0), real: Number(p.realizado_acumulado ?? 0) })
    }
    const ultimo = new Map<string, { plan: number; real: number }>()
    const rows = datas.map((data) => {
      let plan = 0
      let real = 0
      let hasReal = false
      for (const [k, serie] of porItem) {
        const v = serie.get(data)
        if (v) ultimo.set(k, v)
        const lv = ultimo.get(k)
        if (lv) { plan += lv.plan; real += lv.real; if (lv.real > 0) hasReal = true }
      }
      return { data, plan, real, hasReal }
    })

    const hojeIso = new Date().toISOString().slice(0, 10)

    // Encontra última data com produção real (>0) — para média móvel
    let idxUltimoReal = -1
    let qtdUltimoReal = 0
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].real > 0) { idxUltimoReal = i; qtdUltimoReal = rows[i].real; break }
    }
    // Encontra valor real até HOJE (para o ponto de ancoragem das projeções)
    let qtdRealAteHoje = 0
    for (const r of rows) {
      if (r.data <= hojeIso && r.real > 0) qtdRealAteHoje = r.real
    }

    // Projeções só fazem sentido pra 1 serviço — se for agregado, não geramos.
    // Para o Cliente (ocultarProjecoes) nunca geramos projeção de tendência.
    const renderProjecoes = !!item && !ocultarProjecoes

    // Média móvel 15 dias trabalhados (apenas com servico filtrado)
    let mediaAtual: number | null = null
    if (renderProjecoes && idxUltimoReal >= 0) {
      const trabalhados: number[] = []
      for (let i = idxUltimoReal; i >= 0 && trabalhados.length < 15; i--) {
        const ant = i > 0 ? rows[i - 1].real : 0
        const delta = rows[i].real - ant
        if (delta > 0) trabalhados.unshift(delta)
      }
      if (trabalhados.length >= 2) {
        mediaAtual = trabalhados.reduce((a, b) => a + b, 0) / trabalhados.length
      }
    }

    // Prazo / qtd total — para serviço usa item.qtd_plan/data_fim, agregado usa último ponto da curva
    let qtdTotal: number | null = null
    let dataFimPlan: string | null = null
    if (item) {
      qtdTotal = item.qtd_plan ?? null
      dataFimPlan = item.data_fim_plan ?? null
    } else {
      qtdTotal = rows.length ? rows[rows.length - 1].plan : null
      dataFimPlan = rows.length ? rows[rows.length - 1].data : null
    }

    // Dias restantes pra data_fim_plan
    let diasRestantesPlan: number | null = null
    if (dataFimPlan) {
      const fim = new Date(dataFimPlan + 'T00:00:00').getTime()
      const hoje = new Date(hojeIso + 'T00:00:00').getTime()
      diasRestantesPlan = Math.max(1, Math.round((fim - hoje) / 86_400_000))
    }

    // Quantidade restante (a partir de qtdRealAteHoje)
    let qtdRestante: number | null = null
    if (qtdTotal != null) qtdRestante = Math.max(0, qtdTotal - qtdRealAteHoje)

    // Média necessária: qtd_restante / dias_restantes
    let mediaNecessaria: number | null = null
    if (renderProjecoes && qtdRestante != null && diasRestantesPlan != null && diasRestantesPlan > 0) {
      mediaNecessaria = qtdRestante / diasRestantesPlan
    }

    // ── Monta dados do chart numa GRADE DIÁRIA uniforme ──
    // A curva-S vem com datas esparsas (só dias com atividade). No eixo
    // categórico do recharts cada data é uma categoria igualmente espaçada,
    // ignorando o intervalo real entre elas. Uma projeção de média constante é
    // uma reta no TEMPO; amostrada em categorias de espaçamento irregular ela
    // vira uma poligonal cheia de "pinotes". Reamostrando em passo diário, o
    // eixo fica uniforme no tempo e a projeção volta a ser uma reta.
    const planNoDia = (iso: string): number => {
      let last = 0
      for (const r of rows) {
        if (r.data <= iso) last = r.plan
        else break
      }
      return last
    }
    const realNoDia = (iso: string): number => {
      let last = 0
      for (const r of rows) {
        if (r.data <= iso) { if (r.real > 0) last = r.real }
        else break
      }
      return last
    }

    const ancoraValor = qtdRealAteHoje

    // Fim do horizonte renderizado: cobre o plano e, se projetando, também a
    // data de conclusão no ritmo atual (quando ela passa do fim do plano).
    const ultimaPlanData = rows.length ? rows[rows.length - 1].data : hojeIso
    const limitesData: Date[] = [new Date(ultimaPlanData + 'T00:00:00')]
    if (renderProjecoes) {
      if (dataFimPlan) limitesData.push(new Date(dataFimPlan + 'T00:00:00'))
      if (mediaAtual != null && qtdTotal != null && qtdRestante != null && mediaAtual > 0) {
        const diasParaCompletar = Math.ceil(qtdRestante / mediaAtual)
        const dt = new Date(hojeIso + 'T00:00:00')
        dt.setDate(dt.getDate() + diasParaCompletar)
        limitesData.push(dt)
      }
    }
    const fimRender = new Date(Math.max(...limitesData.map((d) => d.getTime())))

    const dataRowsRender: RowChart[] = []
    const cursor = new Date((rows.length ? rows[0].data : hojeIso) + 'T00:00:00')
    while (cursor <= fimRender) {
      const iso = cursor.toISOString().slice(0, 10)
      const realVal = realNoDia(iso)
      dataRowsRender.push({
        data: iso,
        planejado: planNoDia(iso),
        // Realizado: só pinta até HOJE (não extrapola pra frente)
        realizado: iso <= hojeIso && realVal > 0 ? realVal : null,
        proj_atual: null,
        proj_necessaria: null
      })
      cursor.setDate(cursor.getDate() + 1)
    }

    // Projeções partem de HOJE e crescem em ritmo constante (reta no tempo).
    // Cada uma TERMINA ao atingir 100% (último ponto = qtdTotal, depois null) —
    // sem segmento horizontal "deitado" no topo.
    if (renderProjecoes) {
      const idxHoje = dataRowsRender.findIndex((r) => r.data === hojeIso)
      if (idxHoje >= 0) {
        dataRowsRender[idxHoje].proj_atual = ancoraValor
        dataRowsRender[idxHoje].proj_necessaria = ancoraValor
        const hojeTime = new Date(hojeIso + 'T00:00:00').getTime()
        let doneA = false
        let doneN = false
        for (let i = idxHoje + 1; i < dataRowsRender.length; i++) {
          const diasFromHoje = Math.round(
            (new Date(dataRowsRender[i].data + 'T00:00:00').getTime() - hojeTime) / 86_400_000
          )
          if (mediaAtual != null && !doneA) {
            const v = ancoraValor + mediaAtual * diasFromHoje
            if (qtdTotal != null && v >= qtdTotal) { dataRowsRender[i].proj_atual = qtdTotal; doneA = true }
            else dataRowsRender[i].proj_atual = v
          }
          if (mediaNecessaria != null && !doneN) {
            const v = ancoraValor + mediaNecessaria * diasFromHoje
            if (qtdTotal != null && v >= qtdTotal) { dataRowsRender[i].proj_necessaria = qtdTotal; doneN = true }
            else dataRowsRender[i].proj_necessaria = v
          }
        }
      }
    }

    // Datas de término projetadas (quando atinge qtd_total)
    let fimAtual: string | null = null
    let fimNecessario: string | null = null
    if (renderProjecoes && qtdTotal != null) {
      for (const r of dataRowsRender) {
        if (fimAtual == null && r.proj_atual != null && r.proj_atual >= qtdTotal) fimAtual = r.data
        if (fimNecessario == null && r.proj_necessaria != null && r.proj_necessaria >= qtdTotal) fimNecessario = r.data
        if (fimAtual && fimNecessario) break
      }
    }

    return {
      data: dataRowsRender,
      projStats: {
        media_atual: mediaAtual,
        media_necessaria: mediaNecessaria,
        fim_atual: fimAtual,
        fim_necessario: fimNecessario,
        fim_planejado: dataFimPlan,
        qtd_planejada_total: qtdTotal,
        qtd_realizada_atual: qtdUltimoReal,
        dias_uteis_restantes_plan: diasRestantesPlan
      }
    }
  }, [pontos, item, ocultarProjecoes])

  const hojeIso = new Date().toISOString().slice(0, 10)

  if (data.length === 0) {
    return (
      <ChartEmptyState
        height={altura}
        message="Sem dados de curva-S, selecione um serviço com plano e produção"
      />
    )
  }

  return (
    <div className="rounded border border-border bg-bg-panel p-3 flex flex-col" style={{ height: altura }}>
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <h3 className="text-xs font-semibold text-text">
          {ocultarProjecoes ? 'Curva-S — Realizado × Previsto' : 'Curva-S — Realizado × Previsto × Projeções'}
          {item && <span className="ml-2 text-2xs font-mono text-accent">{item.codigo} — {item.descricao}</span>}
        </h3>
        <div className="flex items-center gap-3 text-2xs font-mono text-text-dim">
          {!ocultarProjecoes && projStats.media_atual != null && (
            <span>
              <span className="text-orange-400">●</span> média atual: <span className="text-text">{fmtNum(projStats.media_atual)}/dia</span>
            </span>
          )}
          {!ocultarProjecoes && projStats.media_necessaria != null && (
            <span>
              <span className="text-violet-400">●</span> média necessária: <span className="text-text">{fmtNum(projStats.media_necessaria)}/dia</span>
            </span>
          )}
          {projStats.fim_planejado && (
            <span>
              fim plan: <span className="text-text">{fmtBR(projStats.fim_planejado)}</span>
            </span>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 24, left: 4, bottom: 4 }}>
            <CartesianGrid stroke={CHART_THEME.gridStroke} strokeDasharray="2 3" />
            <XAxis
              dataKey="data"
              tick={axisStyle}
              stroke={CHART_THEME.axisStroke}
              tickFormatter={(d) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
              minTickGap={32}
            />
            <YAxis tick={axisStyle} stroke={CHART_THEME.axisStroke} tickFormatter={(v: number) => formatNumber(v, 0)} />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="top"
              height={24}
              iconSize={8}
              wrapperStyle={{ fontSize: 10, fontFamily: '"IBM Plex Mono", monospace' }}
            />
            <ReferenceLine x={hojeIso} stroke="oklch(82% 0.16 80)" strokeDasharray="3 3" label={{ value: 'Hoje', fontSize: 9, fill: 'oklch(82% 0.16 80)' }} />
            {projStats.fim_planejado && (
              <ReferenceLine x={projStats.fim_planejado} stroke="oklch(67% 0.18 255)" strokeDasharray="2 4" label={{ value: 'Fim plan.', fontSize: 9, fill: 'oklch(67% 0.18 255)' }} />
            )}
            {!ocultarProjecoes && projStats.fim_atual && (
              <ReferenceLine x={projStats.fim_atual} stroke="oklch(74% 0.16 50)" strokeDasharray="2 4" label={{ value: 'Fim proj.', fontSize: 9, fill: 'oklch(74% 0.16 50)' }} />
            )}
            <defs>
              <linearGradient id="g_plan" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_THEME.series[0]} stopOpacity={0.2} />
                <stop offset="100%" stopColor={CHART_THEME.series[0]} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="g_real" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_THEME.series[2]} stopOpacity={0.3} />
                <stop offset="100%" stopColor={CHART_THEME.series[2]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area name="Planejado acumulado" type="monotone" dataKey="planejado" stroke={CHART_THEME.series[0]} strokeWidth={1.4} fill="url(#g_plan)" isAnimationActive={false} />
            <Area name="Realizado acumulado" type="monotone" dataKey="realizado" stroke={CHART_THEME.series[2]} strokeWidth={1.8} fill="url(#g_real)" connectNulls isAnimationActive={false} />
            {!ocultarProjecoes && (
              <Line name="Projeção (média atual)" type="linear" dataKey="proj_atual" stroke="oklch(74% 0.16 50)" strokeWidth={1.5} strokeDasharray="6 3" dot={false} connectNulls isAnimationActive={false} />
            )}
            {!ocultarProjecoes && (
              <Line name="Projeção (média necessária)" type="linear" dataKey="proj_necessaria" stroke="oklch(74% 0.14 295)" strokeWidth={1.5} strokeDasharray="6 3" dot={false} connectNulls isAnimationActive={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function fmtBR(s: string): string {
  return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' })
}

function emptyStats(): ProjecaoStats {
  return {
    media_atual: null,
    media_necessaria: null,
    fim_atual: null,
    fim_necessario: null,
    fim_planejado: null,
    qtd_planejada_total: null,
    qtd_realizada_atual: null,
    dias_uteis_restantes_plan: null
  }
}
