// MarchaTempoFaixaQuantidades — faixas de quantidade ancoradas ao mesmo eixo
// de caminho do plot, com intensity fill (alpha cresce com o valor) + header
// inline não-rotacionado + Σ total + guia compartilhada com o plot. Cada bloco
// recebe um linearGradient vertical (mais opaco no topo) pra dar profundidade.

import { useCallback, useId, type ReactNode } from 'react'
import {
  corDoServico,
  fmtQtdCompact
} from '@/features/planejamento/lib/marcha-tempo-pure'
import type { EstiloSerie } from '@/types/planejamento'
import type { TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'

interface DensPreset {
  band: number
  head: number
  gap: number
  font: number
}

// Dimensões da faixa — INDEPENDENTES do preset `dens` do plot.
// Faixa precisa ser robusta como banner analítico, com altura suficiente pra
// exibir valor real do bloco e o caráter de cada serviço.
export const FX_HEAD = 22 // linha de título (codigo · nome + Σ)
export const FX_BAND = 52 // altura da barra com os blocos (era 26 → 38 → 52)
export const FX_GAP = 14 // espaço entre faixas sucessivas

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

/**
 * Cluster de segmentos contíguos com SEGREGAÇÃO por desvio + CAP anti-supercluster.
 *
 * Regras:
 *  1) Largura mínima: cluster precisa atingir `minLabelPx` antes de ser fechado
 *     (pra caber o valor escrito). Se não atingiu, força merge mesmo com gap.
 *  2) Segregação por desvio: se a média de valor por metro do PRÓXIMO segmento
 *     difere >1× std da média de valor por metro do cluster atual, fecha
 *     cluster — destaca regiões com mudança significativa de densidade.
 *  3) Cap anti-supercluster: cluster com largura >= `maxClusterPx` força
 *     fechamento — evita um cluster gigante engolir todos os segmentos.
 *  4) Gap visual: gaps > 1.5px na tela contam como separador (existente).
 */
interface Cluster {
  ini: number
  fim: number
  valor: number
  count: number
  vmin: number
  vmax: number
  /** Acumula soma de (valor/metro) por segmento, pra computar média densidade. */
  sumDensidade: number
}

function clusterizar(
  segs: Array<{ ini: number; fim: number; valor: number }>,
  sx: (m: number) => number,
  innerW: number,
  minLabelPx: number,
  /** Std-dev global da densidade da coluna (valor/m). */
  stdDensidade: number,
  /** Cap máximo de largura em px do cluster (evita supercluster). */
  maxClusterPx: number
): Cluster[] {
  if (segs.length === 0) return []
  const out: Cluster[] = []
  let atual: Cluster | null = null
  const GAP_PX = 1.5
  // Fator k: segmento que desvia > k * stdDensidade da média do cluster
  // atual quebra o cluster (segregação por mudança de densidade).
  const K_SEGREGA = 1.0
  // Tolerância mínima quando std = 0 (todos iguais): nunca segrega
  const stdEfetivo = Math.max(stdDensidade, 1e-9)

  for (const s of segs) {
    const xIni = sx(s.ini)
    const xFim = sx(s.fim)
    if (xFim < 0 || xIni > innerW) continue
    const compS = Math.max(1, s.fim - s.ini)
    const densS = s.valor / compS

    if (!atual) {
      atual = {
        ini: s.ini,
        fim: s.fim,
        valor: s.valor,
        count: 1,
        vmin: s.valor,
        vmax: s.valor,
        sumDensidade: densS
      }
      continue
    }

    const xAtualFim = sx(atual.fim)
    const gapPx = xIni - xAtualFim
    const wAtual = xAtualFim - sx(atual.ini)
    const mediaDensAtual = atual.sumDensidade / atual.count
    const desvio = Math.abs(densS - mediaDensAtual)
    const segregaPorDensidade = desvio > K_SEGREGA * stdEfetivo

    // 3 motivos pra fechar cluster:
    //  - Largura suficiente E (gap visível OU mudança de densidade significativa)
    //  - Cap de largura atingido (anti-supercluster) — força, mesmo sem label
    const podeFechar = wAtual >= minLabelPx
    const motivoNormal = podeFechar && (gapPx > GAP_PX || segregaPorDensidade)
    const motivoCap = wAtual >= maxClusterPx
    const fecha = motivoNormal || motivoCap
    if (fecha) {
      out.push(atual)
      atual = {
        ini: s.ini,
        fim: s.fim,
        valor: s.valor,
        count: 1,
        vmin: s.valor,
        vmax: s.valor,
        sumDensidade: densS
      }
    } else {
      atual.fim = s.fim
      atual.valor += s.valor
      atual.count += 1
      atual.vmin = Math.min(atual.vmin, s.valor)
      atual.vmax = Math.max(atual.vmax, s.valor)
      atual.sumDensidade += densS
    }
  }
  if (atual) out.push(atual)
  return out
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
    // Cor da faixa = cor da trajetória do mesmo código (mesma regra usada
    // no plot). Permite que mudar cor no SeriesPanel atualize ambos juntos.
    const cor = estilosSerie[codigo]?.cor ?? corDoServico(codigo)
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
    // Densidades (valor/m) por segmento — base pra segregação dos clusters.
    const densidades = segsOk.map((s) => s.valor / Math.max(1, s.fim - s.ini))
    const meanDens = densidades.length
      ? densidades.reduce((a, b) => a + b, 0) / densidades.length
      : 0
    const varDens = densidades.length
      ? densidades.reduce((a, b) => a + (b - meanDens) ** 2, 0) / densidades.length
      : 0
    const stdDens = Math.sqrt(varDens)
    // Percentil 75 — fallback semântico (mantido pra futura visualização)
    const sorted = [...vals].sort((a, b) => a - b)
    const p75 = sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))]
      : 0
    return { col, codigo, cor, segsOk, total, vmin, vmax, p75, stdDens }
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

            {/* Blocos com CLUSTERIZAÇÃO DINÂMICA — agrupa segmentos adjacentes
                até a largura comportar o valor escrito. Quando o usuário dá
                zoom, segmentos individuais ficam mais largos e a clusterização
                relaxa, mostrando mais blocos individuais. */}
            {(() => {
              const MIN_LABEL_PX = 22 // largura mínima pra label caber
              // Cap anti-supercluster: ~1/6 da largura interna ou 220px (o menor)
              const MAX_CLUSTER_PX = Math.min(220, innerW / 6)
              const clusters = clusterizar(
                g.segsOk,
                sx,
                innerW,
                MIN_LABEL_PX,
                g.stdDens,
                MAX_CLUSTER_PX
              )
              return clusters.map((c, k) => {
                const rawX0 = sx(c.ini)
                const rawX1 = sx(c.fim)
                const x0 = Math.max(0, Math.min(innerW, rawX0))
                const x1 = Math.max(0, Math.min(innerW, rawX1))
                const w = Math.max(0, x1 - x0)
                if (w < 0.5) return null
                // Intensidade baseada no VALOR DO CLUSTER (sum). Normaliza pelo
                // maior cluster da coluna (ou pelo vmax × count médio).
                const tCluster =
                  g.vmax > g.vmin
                    ? (c.valor / c.count - g.vmin) / (g.vmax - g.vmin)
                    : 0.5
                const alpha = lerp(0.42, 0.95, clamp01(tCluster))
                const ctr = (rawX0 + rawX1) / 2
                const showVal = w >= 16 && ctr >= 0 && ctr <= innerW
                const fontSize = w >= 44 ? 11 : w >= 32 ? 10 : w >= 22 ? 9 : 8
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
                    {/* Cap superior — fina barra sólida no topo */}
                    <rect x={x0} y={by} width={w} height={3} fill={g.cor} />
                    {/* Sub-divisões internas quando cluster tem múltiplos segmentos */}
                    {c.count > 1 && w > 14 && (
                      <g opacity={0.35}>
                        {g.segsOk
                          .filter((s) => s.ini >= c.ini && s.fim <= c.fim)
                          .slice(0, -1)
                          .map((s, j) => {
                            const xSub = sx(s.fim)
                            if (xSub < x0 + 2 || xSub > x1 - 2) return null
                            return (
                              <line
                                key={j}
                                x1={xSub}
                                x2={xSub}
                                y1={by + 4}
                                y2={by + FX_BAND - 3}
                                stroke={g.cor}
                                strokeWidth={0.6}
                              />
                            )
                          })}
                      </g>
                    )}
                    {/* Borda do cluster */}
                    {w > 6 && (
                      <rect
                        x={x0}
                        y={by}
                        width={w}
                        height={FX_BAND}
                        fill="none"
                        stroke={g.cor}
                        strokeWidth={0.6}
                        opacity={0.6}
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
                        {fmtQtdCompact(c.valor)}
                      </text>
                    )}
                  </g>
                )
              })
            })()}
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

