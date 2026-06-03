// MarchaTempoFaixaQuantidades — faixas de quantidade ancoradas ao mesmo eixo
// de caminho do plot, com intensity fill (alpha cresce com o valor) + header
// inline não-rotacionado + Σ total + guia compartilhada com o plot. Cada bloco
// recebe um linearGradient vertical (mais opaco no topo) pra dar profundidade.

import { useCallback, useId, type ReactNode } from 'react'
import { fmtQtdCompact } from '@/features/planejamento/lib/marcha-tempo-pure'
import type { EstiloSerie } from '@/types/planejamento'
import type { TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'

interface DensPreset {
  band: number
  head: number
  gap: number
  font: number
}

// Dimensões da faixa — INDEPENDENTES do preset `dens` do plot.
// O plot pode estar em Compacto (denso, ~26px), mas a faixa precisa de mais
// altura pra exibir o valor real do bloco e ficar legível como banner
// analítico, não decoração.
export const FX_HEAD = 19 // linha de título (codigo · nome + Σ)
export const FX_BAND = 38 // altura da barra com os blocos
export const FX_GAP = 12 // espaço entre faixas sucessivas

interface MarchaTempoFaixaQuantidadesProps {
  template: TrechoQuantidadeVersaoCompleta | null
  nomesColunas: string[]
  dominioPos: [number, number]
  sx: (v: number) => number
  innerW: number
  majors: number[]
  alturaFaixas: number
  dens: DensPreset
  estilosSerie: Record<string, EstiloSerie>
  vguide: number | null
  onBandTip: (b: {
    cx: number
    cy: number
    colunaCodigo: string
    colunaNome: string
    colunaCor: string
    colunaUn: string | null
    colunaTotal: number
    segValor: number
    segIni: number
    segFim: number
  } | null) => void
}

function extrairCodigo(nome: string): string {
  const m = nome.match(/^\s*([\w.-]+)/)
  return m?.[1] ?? nome
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t))
}

export function MarchaTempoFaixaQuantidades({
  template,
  nomesColunas,
  dominioPos,
  sx,
  innerW,
  majors,
  alturaFaixas,
  dens,
  estilosSerie,
  vguide,
  onBandTip
}: MarchaTempoFaixaQuantidadesProps): ReactNode {
  if (!template || nomesColunas.length === 0) return null

  const colunas = nomesColunas
    .map((nome) => template.colunas.find((c) => c.nome === nome))
    .filter((c): c is NonNullable<typeof c> => !!c)
  if (colunas.length === 0) return null

  const [lo, hi] = dominioPos
  const F_PADTOP = 4

  // Por coluna: agrupar segmentos com valor>0, computar total/min/max/p75
  const grupos = colunas.map((col) => {
    const codigo = extrairCodigo(col.nome)
    const cor = estilosSerie[codigo]?.cor ?? colorPorCodigo(codigo)
    const segsOk = template.segmentos
      .map((s) => {
        const v =
          typeof s.valores[col.id] === 'number' ? Number(s.valores[col.id]) : 0
        return {
          ini: Math.min(s.posicao_inicio_m, s.posicao_fim_m),
          fim: Math.max(s.posicao_inicio_m, s.posicao_fim_m),
          valor: v
        }
      })
      .filter((s) => s.fim > s.ini && s.valor > 0)
      .sort((a, b) => a.ini - b.ini)
    const total = segsOk.reduce((s, x) => s + x.valor, 0)
    const vals = segsOk.map((s) => s.valor)
    const vmin = vals.length ? Math.min(...vals) : 0
    const vmax = vals.length ? Math.max(...vals) : 1
    // Percentil 75 — blocos no top quartil forçam label mesmo em larguras pequenas
    const sorted = [...vals].sort((a, b) => a - b)
    const p75 = sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))]
      : 0
    return { col, codigo, cor, segsOk, total, vmin, vmax, p75 }
  })

  const rowTop = (i: number): number => -alturaFaixas + F_PADTOP + i * (FX_HEAD + FX_BAND + FX_GAP)

  const handleMove = useCallback(
    (e: React.MouseEvent<SVGGElement>, gIdx: number): void => {
      const group = grupos[gIdx]
      // identificar posição em metros sob o cursor pelo SVG
      const svg = e.currentTarget.ownerSVGElement
      if (!svg) {
        onBandTip(null)
        return
      }
      const rect = svg.getBoundingClientRect()
      // estimar posição em metros a partir de innerW + dominioPos (não precisa de transformação SVG complexa)
      const xRel = e.clientX - rect.left
      // Margem esquerda do plot: rect.left já é absoluto, e o <g> tem translate(MARGEM.left,...).
      // A maneira mais robusta: usar getBBox() ou medir via SVG point. Simplificação: pular fora se fora do plot.
      const xPlot = xRel - 92 // MARGEM.left = 92 (hardcoded — match Painel)
      if (xPlot < 0 || xPlot > innerW) {
        onBandTip(null)
        return
      }
      const posM = lo + (xPlot / innerW) * (hi - lo)
      const seg = group.segsOk.find((s) => posM >= s.ini && posM < s.fim)
      if (!seg) {
        onBandTip(null)
        return
      }
      onBandTip({
        cx: e.clientX,
        cy: e.clientY,
        colunaCodigo: group.codigo,
        colunaNome: group.col.nome,
        colunaCor: group.cor,
        colunaUn: group.col.unidade,
        colunaTotal: group.total,
        segValor: seg.valor,
        segIni: seg.ini,
        segFim: seg.fim
      })
    },
    [grupos, innerW, lo, hi, onBandTip]
  )

  const handleLeave = useCallback(() => onBandTip(null), [onBandTip])

  const gradId = useId().replace(/:/g, '')

  return (
    <g>
      {/* Gradientes verticais — 1 por cor, reusado em todos os blocos da faixa */}
      <defs>
        {grupos.map((g, i) => (
          <linearGradient
            key={`grad-${i}`}
            id={`bandgrad-${gradId}-${i}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor={g.cor} stopOpacity="1" />
            <stop offset="55%" stopColor={g.cor} stopOpacity="0.78" />
            <stop offset="100%" stopColor={g.cor} stopOpacity="0.42" />
          </linearGradient>
        ))}
      </defs>

      {/* Echo dos majors do plot pra conexão visual (linhas verticais discretas) */}
      {majors.map((m, i) => (
        <line
          key={`g${i}`}
          x1={sx(m)}
          y1={-alturaFaixas + F_PADTOP + FX_HEAD - 4}
          x2={sx(m)}
          y2={-4}
          stroke="var(--mt-grid-major)"
          strokeWidth={1}
          opacity={0.5}
        />
      ))}

      {grupos.map((g, i) => {
        const top = rowTop(i)
        const by = top + FX_HEAD
        return (
          <g
            key={g.col.id}
            onMouseMove={(e) => handleMove(e, i)}
            onMouseLeave={handleLeave}
          >
            {/* Header inline */}
            <rect x={0} y={top + 4} width={8} height={9} rx={1} fill={g.cor} />
            <text
              x={13}
              y={top + 12}
              fontSize={11 * dens.font}
              fontFamily="ui-monospace, monospace"
              fontWeight={600}
              letterSpacing="0.01em"
              fill="var(--text-muted)"
            >
              {g.codigo} · {g.col.nome}
            </text>
            <text
              x={innerW}
              y={top + 12}
              textAnchor="end"
              fontSize={10.5 * dens.font}
              fontFamily="ui-monospace, monospace"
              fill="var(--text-dim)"
            >
              Σ {fmtQtdCompact(g.total)} {g.col.unidade}
            </text>

            {/* Trilho da faixa */}
            <rect
              x={0}
              y={by}
              width={innerW}
              height={FX_BAND}
              fill="var(--bg)"
              stroke="var(--border)"
              strokeWidth={1}
            />

            {/* Blocos */}
            {g.segsOk.map((s, k) => {
              const rawX0 = sx(s.ini)
              const rawX1 = sx(s.fim)
              const x0 = Math.max(0, Math.min(innerW, rawX0))
              const x1 = Math.max(0, Math.min(innerW, rawX1))
              const w = Math.max(0, x1 - x0)
              if (w < 0.5) return null
              const t = g.vmax > g.vmin ? (s.valor - g.vmin) / (g.vmax - g.vmin) : 0.5
              // Alpha mais agressivo: até bloco com menor valor visível (0.42),
              // bloco com maior valor sólido (0.95). Combinado com o gradient
              // vertical, dá profundidade real.
              const alpha = lerp(0.42, 0.95, clamp01(t))
              const ctr = (rawX0 + rawX1) / 2
              // Threshold adaptativo: largura >= 22px exibe valor; blocos top
              // quartil (s.valor >= p75) forçam exibição mesmo abaixo desse
              // limite (preserva visibilidade dos blocos de maior impacto).
              const isTopQuartil = s.valor >= g.p75
              const showVal =
                ctr >= 0 && ctr <= innerW && (w >= 22 || (isTopQuartil && w >= 14))
              const fontSize = w >= 38 ? 11 : w >= 28 ? 10 : 9
              return (
                <g key={k}>
                  {/* Fundo com gradient vertical (top→bottom: 100% → 42% alpha) */}
                  <rect
                    x={x0}
                    y={by}
                    width={w}
                    height={FX_BAND}
                    fill={`url(#bandgrad-${gradId}-${i})`}
                    fillOpacity={alpha}
                  />
                  {/* Cap superior — fina barra sólida no topo do bloco */}
                  <rect x={x0} y={by} width={w} height={3} fill={g.cor} />
                  {/* Borda fina nas laterais quando bloco é largo o suficiente */}
                  {w > 6 && (
                    <rect
                      x={x0}
                      y={by}
                      width={w}
                      height={FX_BAND}
                      fill="none"
                      stroke={g.cor}
                      strokeWidth={0.6}
                      opacity={0.5}
                    />
                  )}
                  {showVal && (
                    <text
                      x={ctr}
                      y={by + FX_BAND / 2 + 4}
                      textAnchor="middle"
                      fontSize={fontSize * dens.font}
                      fontFamily="ui-monospace, monospace"
                      fontWeight={700}
                      fill="var(--text)"
                    >
                      {fmtQtdCompact(s.valor)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        )
      })}

      {/* Guia vertical compartilhada (plot ↔ faixas) */}
      {vguide != null && (
        <line
          x1={vguide}
          y1={-alturaFaixas + F_PADTOP}
          x2={vguide}
          y2={-4}
          stroke="var(--mt-cross)"
          strokeWidth={1}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  )
}

const PALETA = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#f472b6', '#2dd4bf', '#fb923c']
function colorPorCodigo(c: string): string {
  let h = 0
  for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) | 0
  return PALETA[Math.abs(h) % PALETA.length]
}
