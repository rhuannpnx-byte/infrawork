import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent
} from 'react'
import type {
  MarchaTempoOpcoes,
  PlanejamentoDependencia,
  PlanejamentoTarefaCompleta,
  PontoTraco,
  TracoTarefa
} from '@/types/planejamento'
import type { ObraTrecho } from '@/types/gerencial'
import type { TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'
import { formatMarcador } from '@/lib/format/posicao'
import {
  gerarTicksPosicao,
  gerarTicksTempo,
  granularidadeEfetiva
} from '@/features/planejamento/lib/marcha-tempo-pure'
import { MarchaTempoTooltip } from './MarchaTempoTooltip'
import { MarchaTempoFaixaQuantidades } from './MarchaTempoFaixaQuantidades'

// ─── Escala linear simples ──────────────────────────────────────────────────

interface Escala {
  (valor: number): number
  invert(pixel: number): number
  domain: [number, number]
  range: [number, number]
}

function escalaLinear(domain: [number, number], range: [number, number]): Escala {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0
  const rangeSpan = r1 - r0
  const fn = ((valor: number): number => {
    if (span === 0) return r0
    return r0 + ((valor - d0) / span) * rangeSpan
  }) as Escala
  fn.invert = (pixel: number): number => {
    if (rangeSpan === 0) return d0
    return d0 + ((pixel - r0) / rangeSpan) * span
  }
  fn.domain = domain
  fn.range = range
  return fn
}

// ─── Label formatters ───────────────────────────────────────────────────────

const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']

function fmtTickTempo(ms: number, granEfetiva: 'diario' | 'semanal' | 'mensal'): string {
  const d = new Date(ms)
  if (granEfetiva === 'mensal') {
    return `${MESES[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`
  }
  const dia = String(d.getUTCDate()).padStart(2, '0')
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dia}/${mes}`
}

function dataMs(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime()
}

function formatarDataLabelBR(ms: number): string {
  const d = new Date(ms)
  const dia = String(d.getUTCDate()).padStart(2, '0')
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dia}/${mes}`
}

// ─── Componente ─────────────────────────────────────────────────────────────

interface MarchaTempoPainelProps {
  trecho: ObraTrecho
  template: TrechoQuantidadeVersaoCompleta | null
  tarefas: PlanejamentoTarefaCompleta[]
  tracos: TracoTarefa[]
  dependencias: PlanejamentoDependencia[]
  dominioTempo: [number, number]
  dataDate: string | null
  opcoes: MarchaTempoOpcoes
  /**
   * Altura mínima do PLOT INTERNO (innerH). O SVG total cresce conforme
   * faixas de quantidade são adicionadas — área do plot permanece constante.
   */
  altura?: number
}

// Margens: right + bottom ampliados pra acomodar labels espelhados nos 4 lados
// sem cropping. Top também acomoda labels superiores do eixo X.
const MARGEM_BASE = { top: 30, right: 96, bottom: 44, left: 96 }
const FONT_TICK = 11
const FONT_HEADER = 12
const LARGURA_FAIXA_QTD = 30
const HEADER_VERTICAL_FAIXA = 54
// Faixa horizontal: header (texto largo acima) + faixa de blocos com valores
// rotacionados a 90°. Total por coluna = HEADER_LINHA_H + ALTURA_FAIXA + GAP.
const ALTURA_FAIXA_HORIZONTAL = 56
const HEADER_LINHA_FAIXA_H = 18
const GAP_FAIXA_HORIZONTAL = 6
// Espaço reservado entre as faixas horizontais e o plot pra acomodar o
// rótulo superior do eixo X colado ao gráfico.
const ESPACO_LABEL_X_TOPO = 24

export function MarchaTempoPainel({
  trecho,
  template,
  tarefas,
  tracos,
  dependencias,
  dominioTempo,
  dataDate,
  opcoes,
  altura = 520
}: MarchaTempoPainelProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const patternIdBase = useId()
  const [hoverTraco, setHoverTraco] = useState<TracoTarefa | null>(null)
  const [hoverXY, setHoverXY] = useState<{ x: number; y: number } | null>(null)
  const [width, setWidth] = useState(800)

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = e.contentRect.width
        if (w > 0) setWidth(Math.floor(w))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Domínio de posição (bounds das tarefas DO trecho + 5% pad)
  const dominioPos = useMemo<[number, number]>(() => {
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const t of tarefas) {
      if (t.trecho_id !== trecho.id) continue
      if (t.posicao_inicio_m == null || t.posicao_fim_m == null) continue
      lo = Math.min(lo, t.posicao_inicio_m, t.posicao_fim_m)
      hi = Math.max(hi, t.posicao_inicio_m, t.posicao_fim_m)
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
      return [0, 1000]
    }
    const pad = (hi - lo) * 0.05
    return [Math.max(0, lo - pad), hi + pad]
  }, [tarefas, trecho.id])

  // Faixas de quantidade ocupam espaço à esquerda (modo eixoXTempo=true)
  // ou em cima (modo eixoXTempo=false).
  const nColunasFaixa =
    opcoes.colunasQuantidade && template
      ? opcoes.colunasQuantidade.filter((nome) =>
          template.colunas.some((c) => c.nome === nome)
        ).length
      : 0

  // Espaço lateral (eixoXTempo=true): N faixas × (largura + gap)
  const espacoFaixaLateral =
    opcoes.eixoXTempo && nColunasFaixa > 0
      ? nColunasFaixa * (LARGURA_FAIXA_QTD + 4) + 8
      : 0
  // Espaço acima (eixoXTempo=true): header das faixas verticais
  const espacoHeaderVertical = opcoes.eixoXTempo && nColunasFaixa > 0 ? HEADER_VERTICAL_FAIXA : 0
  // Espaço acima (eixoXTempo=false): N faixas horizontais empilhadas, cada
  // uma com 1 linha de header (texto largo) + faixa de blocos com valores
  // rotacionados a 90° + gap pra próxima. Acrescenta ESPACO_LABEL_X_TOPO pra
  // o rótulo superior do eixo X caber colado ao plot (não acima das faixas).
  const espacoFaixaHorizontal =
    !opcoes.eixoXTempo && nColunasFaixa > 0
      ? nColunasFaixa * (HEADER_LINHA_FAIXA_H + ALTURA_FAIXA_HORIZONTAL + GAP_FAIXA_HORIZONTAL) +
        ESPACO_LABEL_X_TOPO
      : 0

  const margemLeft = MARGEM_BASE.left + espacoFaixaLateral
  const margemTop = MARGEM_BASE.top + espacoHeaderVertical + espacoFaixaHorizontal

  // PLOT FIXO: innerH não diminui ao adicionar faixas — SVG total cresce.
  const innerW = Math.max(50, width - margemLeft - MARGEM_BASE.right)
  const innerH = Math.max(80, altura - MARGEM_BASE.top - MARGEM_BASE.bottom)
  const alturaSvg = innerH + margemTop + MARGEM_BASE.bottom

  const escalaTempo = opcoes.eixoXTempo
    ? escalaLinear(dominioTempo, [0, innerW])
    : escalaLinear(dominioTempo, [0, innerH])
  const escalaPos = opcoes.eixoXTempo
    ? escalaLinear(dominioPos, [innerH, 0])
    : escalaLinear(dominioPos, [0, innerW])

  const projetar = (data: string, posM: number): { x: number; y: number } => {
    const t = dataMs(data)
    if (opcoes.eixoXTempo) {
      return { x: escalaTempo(t), y: escalaPos(posM) }
    }
    return { x: escalaPos(posM), y: escalaTempo(t) }
  }

  const TOLERANCIA_HOVER = 8

  const handleMouseMove = (e: MouseEvent<SVGSVGElement>): void => {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const mx = e.clientX - rect.left - margemLeft
    const my = e.clientY - rect.top - margemTop
    if (mx < 0 || my < 0 || mx > innerW || my > innerH) {
      setHoverTraco(null)
      setHoverXY(null)
      return
    }
    let best: { traco: TracoTarefa; dist: number } | null = null
    for (const traco of tracos) {
      if (traco.trechoId !== trecho.id) continue
      for (const ilha of traco.ilhas) {
        for (let i = 0; i < ilha.length - 1; i++) {
          const a = projetar(ilha[i].data, ilha[i].posicaoM)
          const b = projetar(ilha[i + 1].data, ilha[i + 1].posicaoM)
          const d = distanciaPontoSegmento(mx, my, a.x, a.y, b.x, b.y)
          if (d < TOLERANCIA_HOVER && (!best || d < best.dist)) {
            best = { traco, dist: d }
          }
        }
      }
    }
    if (best) {
      setHoverTraco(best.traco)
      setHoverXY({ x: e.clientX, y: e.clientY })
    } else {
      setHoverTraco(null)
      setHoverXY(null)
    }
  }

  const ticksTempo = useMemo(
    () => gerarTicksTempo(dominioTempo[0], dominioTempo[1], opcoes.granularidadeTempo),
    [dominioTempo, opcoes.granularidadeTempo]
  )
  const ticksPos = useMemo(
    () => gerarTicksPosicao(dominioPos[0], dominioPos[1], opcoes.passoPosicaoM),
    [dominioPos, opcoes.passoPosicaoM]
  )

  const granEfet = useMemo(
    () => granularidadeEfetiva(dominioTempo[0], dominioTempo[1], opcoes.granularidadeTempo),
    [dominioTempo, opcoes.granularidadeTempo]
  )

  // ─── Pattern SVG para grid (minor) ───────────────────────────────────────
  // Calcula passo em pixels (px/tick) — alinha o pattern com o tick #0 via
  // x/y offset.
  const passoTempoMs =
    ticksTempo.length >= 2 ? ticksTempo[1] - ticksTempo[0] : dominioTempo[1] - dominioTempo[0]
  const passoTempoPx =
    opcoes.eixoXTempo
      ? (passoTempoMs / (dominioTempo[1] - dominioTempo[0])) * innerW
      : (passoTempoMs / (dominioTempo[1] - dominioTempo[0])) * innerH
  const passoPosVal =
    ticksPos.length >= 2 ? ticksPos[1] - ticksPos[0] : dominioPos[1] - dominioPos[0]
  const passoPosPx =
    opcoes.eixoXTempo
      ? (passoPosVal / (dominioPos[1] - dominioPos[0])) * innerH
      : (passoPosVal / (dominioPos[1] - dominioPos[0])) * innerW

  // Offset do primeiro tick (alinha pattern no eixo)
  const offsetTempoPx =
    ticksTempo.length > 0
      ? opcoes.eixoXTempo
        ? escalaTempo(ticksTempo[0]) % passoTempoPx
        : escalaTempo(ticksTempo[0]) % passoTempoPx
      : 0
  const offsetPosPx =
    ticksPos.length > 0
      ? opcoes.eixoXTempo
        ? escalaPos(ticksPos[0]) % passoPosPx
        : escalaPos(ticksPos[0]) % passoPosPx
      : 0

  // Today line: usa data_date do planejamento, OU data atual real (memo)
  const [agoraMs] = useState<number>(() => Date.now())
  const todayMs = dataDate ? dataMs(dataDate) : agoraMs
  const todayLabel = formatarDataLabelBR(todayMs)

  const marcos = useMemo(
    () =>
      tarefas.filter(
        (t) =>
          t.tipo_no === 'marco' &&
          t.data_inicio &&
          (t.trecho_id == null || t.trecho_id === trecho.id)
      ),
    [tarefas, trecho.id]
  )

  const tracoPorTarefa = useMemo(() => {
    const m = new Map<string, TracoTarefa>()
    for (const t of tracos) m.set(t.tarefaId, t)
    return m
  }, [tracos])

  // Legenda do trecho: serviços únicos presentes NESTE trecho
  const itensLegenda = useMemo(() => {
    const map = new Map<string, { codigo: string; label: string; cor: string; count: number }>()
    for (const t of tracos) {
      if (t.trechoId !== trecho.id) continue
      const chave = t.codigo ?? t.tarefaId
      const atual = map.get(chave)
      if (atual) atual.count++
      else map.set(chave, { codigo: chave, label: t.label, cor: t.cor, count: 1 })
    }
    return Array.from(map.values()).sort((a, b) => a.codigo.localeCompare(b.codigo))
  }, [tracos, trecho.id])

  const pontoExtremo = (
    traco: TracoTarefa,
    qual: 'inicio' | 'fim'
  ): PontoTraco | null => {
    if (!traco.ilhas.length) return null
    if (qual === 'inicio') {
      const ilha = traco.ilhas[0]
      return ilha[0] ?? null
    }
    const ilha = traco.ilhas[traco.ilhas.length - 1]
    return ilha[ilha.length - 1] ?? null
  }

  // Skip de label dinâmico
  const espacoTempo = opcoes.eixoXTempo ? innerW : innerH
  const espacoPos = opcoes.eixoXTempo ? innerH : innerW
  const minPxTempo = granEfet === 'mensal' ? 56 : granEfet === 'semanal' ? 64 : 60
  const minPxPos = 64
  const maxLabelsTempo = Math.max(2, Math.floor(espacoTempo / minPxTempo))
  const maxLabelsPos = Math.max(2, Math.floor(espacoPos / minPxPos))
  const stepTickLabel = Math.max(1, Math.ceil(ticksTempo.length / maxLabelsTempo))
  const stepTickPosLabel = Math.max(1, Math.ceil(ticksPos.length / maxLabelsPos))

  const idGridTempo = `gt-${patternIdBase}`
  const idGridPos = `gp-${patternIdBase}`
  const idClip = `clip-${patternIdBase}`

  return (
    <div
      ref={containerRef}
      className="relative w-full bg-bg-panel border border-border rounded overflow-hidden"
      style={{ minHeight: alturaSvg + 28 + (itensLegenda.length > 0 ? 52 : 0) }}
    >
      <div
        className="absolute top-0 left-0 right-0 px-3 py-2 flex items-center justify-between bg-bg-elevated border-b border-border z-10 font-mono"
        style={{ fontSize: FONT_HEADER }}
      >
        <div className="text-text font-semibold">{trecho.nome}</div>
        <div className="text-text-muted">
          {formatMarcador(dominioPos[0], trecho)} → {formatMarcador(dominioPos[1], trecho)}
        </div>
      </div>

      <svg
        width={width}
        height={alturaSvg}
        style={{ marginTop: 28 }}
        className="block"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          setHoverTraco(null)
          setHoverXY(null)
        }}
      >
        <defs>
          {/* Pattern de grid temporal (minor) — sempre visível, sem desbotar */}
          {passoTempoPx >= 2 ? (
            <pattern
              id={idGridTempo}
              x={offsetTempoPx}
              y={0}
              width={opcoes.eixoXTempo ? passoTempoPx : innerW}
              height={opcoes.eixoXTempo ? innerH : passoTempoPx}
              patternUnits="userSpaceOnUse"
            >
              {opcoes.eixoXTempo ? (
                <line
                  x1={0}
                  y1={0}
                  x2={0}
                  y2={innerH}
                  stroke="var(--border-accent)"
                  strokeWidth={1}
                  opacity={0.95}
                />
              ) : (
                <line
                  x1={0}
                  y1={0}
                  x2={innerW}
                  y2={0}
                  stroke="var(--border-accent)"
                  strokeWidth={1}
                  opacity={0.95}
                />
              )}
            </pattern>
          ) : null}

          {/* Pattern de grid de posição (minor) — sempre visível, sem desbotar */}
          {passoPosPx >= 2 ? (
            <pattern
              id={idGridPos}
              x={0}
              y={offsetPosPx}
              width={opcoes.eixoXTempo ? innerW : passoPosPx}
              height={opcoes.eixoXTempo ? passoPosPx : innerH}
              patternUnits="userSpaceOnUse"
            >
              {opcoes.eixoXTempo ? (
                <line
                  x1={0}
                  y1={0}
                  x2={innerW}
                  y2={0}
                  stroke="var(--border-accent)"
                  strokeWidth={1}
                  opacity={0.95}
                />
              ) : (
                <line
                  x1={0}
                  y1={0}
                  x2={0}
                  y2={innerH}
                  stroke="var(--border-accent)"
                  strokeWidth={1}
                  opacity={0.95}
                />
              )}
            </pattern>
          ) : null}

          <clipPath id={idClip}>
            <rect x={0} y={0} width={innerW} height={innerH} />
          </clipPath>
        </defs>

        <g transform={`translate(${margemLeft},${margemTop})`}>
          {/* Faixas de quantidades — render fora do clip do plot */}
          <MarchaTempoFaixaQuantidades
            template={template}
            nomesColunas={opcoes.colunasQuantidade}
            dominioPos={dominioPos}
            innerH={innerH}
            innerW={innerW}
            eixoXTempo={opcoes.eixoXTempo}
            larguraFaixa={opcoes.eixoXTempo ? LARGURA_FAIXA_QTD : ALTURA_FAIXA_HORIZONTAL}
            margemLeft={margemLeft}
            topOffset={opcoes.eixoXTempo ? espacoHeaderVertical : espacoFaixaHorizontal}
          />

          {/* Background do plot — mais escuro pra dar contraste ao grid */}
          <rect x={0} y={0} width={innerW} height={innerH} fill="var(--bg)" opacity={0.85} />

          {/* Grid via pattern (minor) */}
          {passoTempoPx >= 2 ? (
            <rect x={0} y={0} width={innerW} height={innerH} fill={`url(#${idGridTempo})`} />
          ) : null}
          {passoPosPx >= 2 ? (
            <rect x={0} y={0} width={innerW} height={innerH} fill={`url(#${idGridPos})`} />
          ) : null}

          {/* Linhas major (com label) — destaque */}
          {ticksTempo.map((t, i) => {
            if (i % stepTickLabel !== 0) return null
            if (opcoes.eixoXTempo) {
              const x = escalaTempo(t)
              return (
                <line
                  key={`mt-${i}`}
                  x1={x}
                  x2={x}
                  y1={0}
                  y2={innerH}
                  stroke="var(--border-strong)"
                  strokeWidth={1}
                  opacity={0.95}
                />
              )
            }
            const y = escalaTempo(t)
            return (
              <line
                key={`mt-${i}`}
                x1={0}
                x2={innerW}
                y1={y}
                y2={y}
                stroke="var(--text-faint)"
                strokeWidth={1.4}
                opacity={1}
              />
            )
          })}
          {ticksPos.map((p, i) => {
            if (i % stepTickPosLabel !== 0) return null
            if (opcoes.eixoXTempo) {
              const y = escalaPos(p)
              return (
                <line
                  key={`mp-${i}`}
                  x1={0}
                  x2={innerW}
                  y1={y}
                  y2={y}
                  stroke="var(--border-strong)"
                  strokeWidth={1}
                  opacity={0.95}
                />
              )
            }
            const x = escalaPos(p)
            return (
              <line
                key={`mp-${i}`}
                x1={x}
                x2={x}
                y1={0}
                y2={innerH}
                stroke="var(--text-faint)"
                strokeWidth={1.4}
                opacity={1}
              />
            )
          })}

          {/* Dependências */}
          {opcoes.mostrarDependencias
            ? dependencias.map((d) => {
                const tPred = tracoPorTarefa.get(d.predecessora_id)
                const tSuc = tracoPorTarefa.get(d.sucessora_id)
                if (!tPred || !tSuc) return null
                if (tPred.trechoId !== trecho.id || tSuc.trechoId !== trecho.id) return null
                const predPt =
                  d.tipo === 'SS' || d.tipo === 'SF'
                    ? pontoExtremo(tPred, 'inicio')
                    : pontoExtremo(tPred, 'fim')
                const sucPt =
                  d.tipo === 'SS' || d.tipo === 'FS'
                    ? pontoExtremo(tSuc, 'inicio')
                    : pontoExtremo(tSuc, 'fim')
                if (!predPt || !sucPt) return null
                const p1 = projetar(predPt.data, predPt.posicaoM)
                const p2 = projetar(sucPt.data, sucPt.posicaoM)
                return (
                  <line
                    key={d.id}
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke="var(--text-faint)"
                    strokeWidth={0.6}
                    strokeDasharray="3 2"
                    opacity={0.6}
                    clipPath={`url(#${idClip})`}
                  />
                )
              })
            : null}

          {/* Polilinhas (segmentos retos) — 1 polyline por ilha */}
          <g clipPath={`url(#${idClip})`}>
            {tracos
              .filter((t) => t.trechoId === trecho.id)
              .map((traco) => {
                const isHover = hoverTraco?.tarefaId === traco.tarefaId
                return (
                  <g key={traco.tarefaId}>
                    {traco.ilhas.map((ilha, idxIlha) => {
                      const pts = ilha
                        .map((p) => {
                          const xy = projetar(p.data, p.posicaoM)
                          return `${xy.x.toFixed(2)},${xy.y.toFixed(2)}`
                        })
                        .join(' ')
                      return (
                        <polyline
                          key={`${traco.tarefaId}-${idxIlha}`}
                          points={pts}
                          fill="none"
                          stroke={traco.cor}
                          strokeWidth={isHover ? 3 : 2.2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeDasharray={traco.modo === 'uniforme' ? '5 4' : undefined}
                          opacity={hoverTraco && !isHover ? 0.3 : 1}
                        />
                      )
                    })}
                    {/* Marcadores extremos */}
                    {(() => {
                      const ini = pontoExtremo(traco, 'inicio')
                      const fim = pontoExtremo(traco, 'fim')
                      if (!ini || !fim) return null
                      const iniXY = projetar(ini.data, ini.posicaoM)
                      const fimXY = projetar(fim.data, fim.posicaoM)
                      return (
                        <>
                          <circle
                            cx={iniXY.x}
                            cy={iniXY.y}
                            r={isHover ? 4 : 3}
                            fill={traco.cor}
                            opacity={hoverTraco && !isHover ? 0.3 : 1}
                          />
                          <circle
                            cx={fimXY.x}
                            cy={fimXY.y}
                            r={isHover ? 4 : 3}
                            fill={traco.cor}
                            opacity={hoverTraco && !isHover ? 0.3 : 1}
                          />
                        </>
                      )
                    })()}
                  </g>
                )
              })}
          </g>

          {/* Eixos — bordas do plot (4 lados) */}
          <line x1={0} y1={innerH} x2={innerW} y2={innerH} stroke="var(--border-strong)" />
          <line x1={0} y1={0} x2={innerW} y2={0} stroke="var(--border-strong)" />
          <line x1={0} y1={0} x2={0} y2={innerH} stroke="var(--border-strong)" />
          <line x1={innerW} y1={0} x2={innerW} y2={innerH} stroke="var(--border-strong)" />

          {/* X axis (TEMPO ou CAMINHO) — labels em BAIXO + EM CIMA */}
          {/* Top labels SEMPRE colados ao plot (y=-10) — quando há faixas
              horizontais, elas se deslocam pra cima criando uma faixa de gap
              de ESPACO_LABEL_X_TOPO px logo acima do plot pros labels. */}
          {(opcoes.eixoXTempo ? ticksTempo : ticksPos).map((v, i) => {
            const stepLabel = opcoes.eixoXTempo ? stepTickLabel : stepTickPosLabel
            const x = opcoes.eixoXTempo ? escalaTempo(v) : escalaPos(v)
            const showLabel = i % stepLabel === 0
            const label = opcoes.eixoXTempo
              ? fmtTickTempo(v, granEfet)
              : formatMarcador(v, trecho)
            return (
              <g key={`x-${i}`}>
                {/* tick bottom */}
                <line
                  x1={x}
                  y1={innerH}
                  x2={x}
                  y2={innerH + (showLabel ? 6 : 3)}
                  stroke="var(--border-strong)"
                />
                {/* tick top (mirror) — sempre colado ao plot */}
                <line
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={0 - (showLabel ? 6 : 3)}
                  stroke="var(--border-strong)"
                />
                {showLabel ? (
                  <>
                    <text
                      x={x}
                      y={innerH + 20}
                      textAnchor="middle"
                      fontSize={FONT_TICK}
                      fill="var(--text)"
                      fontFamily="ui-monospace, monospace"
                    >
                      {label}
                    </text>
                    <text
                      x={x}
                      y={-10}
                      textAnchor="middle"
                      fontSize={FONT_TICK}
                      fill="var(--text)"
                      fontFamily="ui-monospace, monospace"
                    >
                      {label}
                    </text>
                  </>
                ) : null}
              </g>
            )
          })}

          {/* Y axis (CAMINHO ou TEMPO) — labels à ESQUERDA + À DIREITA */}
          {(opcoes.eixoXTempo ? ticksPos : ticksTempo).map((v, i) => {
            const stepLabel = opcoes.eixoXTempo ? stepTickPosLabel : stepTickLabel
            const y = opcoes.eixoXTempo ? escalaPos(v) : escalaTempo(v)
            const showLabel = i % stepLabel === 0
            const label = opcoes.eixoXTempo
              ? formatMarcador(v, trecho)
              : fmtTickTempo(v, granEfet)
            return (
              <g key={`y-${i}`}>
                {/* tick left */}
                <line
                  x1={showLabel ? -6 : -3}
                  y1={y}
                  x2={0}
                  y2={y}
                  stroke="var(--border-strong)"
                />
                {/* tick right (mirror) */}
                <line
                  x1={innerW}
                  y1={y}
                  x2={innerW + (showLabel ? 6 : 3)}
                  y2={y}
                  stroke="var(--border-strong)"
                />
                {showLabel ? (
                  <>
                    <text
                      x={-9}
                      y={y + 4}
                      textAnchor="end"
                      fontSize={FONT_TICK}
                      fill="var(--text)"
                      fontFamily="ui-monospace, monospace"
                    >
                      {label}
                    </text>
                    <text
                      x={innerW + 9}
                      y={y + 4}
                      textAnchor="start"
                      fontSize={FONT_TICK}
                      fill="var(--text)"
                      fontFamily="ui-monospace, monospace"
                    >
                      {label}
                    </text>
                  </>
                ) : null}
              </g>
            )
          })}

          {/* ─── Camada TOP: Marcos + Today (acima de tudo) ─────────────── */}
          {/* Marcos + pílula com nome COMPLETO (opacidade leve, alto contraste) */}
          {opcoes.mostrarMarcos
            ? marcos.map((m) => {
                if (!m.data_inicio) return null
                const ms = dataMs(m.data_inicio)
                const labelText =
                  m.nome_custom ?? m.servico_grupo_descricao ?? m.codigo_eap ?? '◆'
                // Largura adaptada ao tamanho real do texto (sem truncar)
                const labelW = labelText.length * 6.8 + 16
                const labelH = 18
                if (opcoes.eixoXTempo) {
                  const x = escalaTempo(ms)
                  if (x < 0 || x > innerW) return null
                  return (
                    <g key={m.id}>
                      <line
                        x1={x}
                        x2={x}
                        y1={0}
                        y2={innerH}
                        stroke="var(--accent)"
                        strokeWidth={1.8}
                        strokeDasharray="4 3"
                        opacity={0.9}
                      />
                      <polygon
                        points={`${x - 6},0 ${x + 6},0 ${x},10`}
                        fill="var(--accent)"
                        opacity={0.85}
                      />
                      {/* Pílula com opacidade mais leve, ainda legível */}
                      <rect
                        x={x - labelW / 2}
                        y={innerH - labelH - 6}
                        width={labelW}
                        height={labelH}
                        rx={3}
                        fill="var(--accent)"
                        stroke="var(--accent)"
                        strokeWidth={1}
                        opacity={0.78}
                      />
                      <text
                        x={x}
                        y={innerH - 6 - labelH / 2 + 4}
                        textAnchor="middle"
                        fontSize={11}
                        fill="#fff"
                        fontFamily="ui-monospace, monospace"
                        fontWeight={700}
                      >
                        {labelText}
                      </text>
                    </g>
                  )
                }
                const y = escalaTempo(ms)
                if (y < 0 || y > innerH) return null
                return (
                  <g key={m.id}>
                    <line
                      x1={0}
                      x2={innerW}
                      y1={y}
                      y2={y}
                      stroke="var(--accent)"
                      strokeWidth={1.8}
                      strokeDasharray="4 3"
                      opacity={0.9}
                    />
                    <polygon
                      points={`0,${y - 6} 0,${y + 6} 10,${y}`}
                      fill="var(--accent)"
                      opacity={0.85}
                    />
                    <rect
                      x={innerW - labelW - 6}
                      y={y - labelH / 2}
                      width={labelW}
                      height={labelH}
                      rx={3}
                      fill="var(--accent)"
                      stroke="var(--accent)"
                      strokeWidth={1}
                      opacity={0.78}
                    />
                    <text
                      x={innerW - labelW / 2 - 6}
                      y={y + 4}
                      textAnchor="middle"
                      fontSize={11}
                      fill="#fff"
                      fontFamily="ui-monospace, monospace"
                      fontWeight={700}
                    >
                      {labelText}
                    </text>
                  </g>
                )
              })
            : null}

          {/* Today line + pílula SÓLIDA com data (sempre por cima) */}
          {opcoes.mostrarTodayLine
            ? (() => {
                const labelText = `HOJE · ${todayLabel}`
                const labelW = labelText.length * 7 + 16
                const labelH = 20
                if (opcoes.eixoXTempo) {
                  const x = escalaTempo(todayMs)
                  if (x < 0 || x > innerW) return null
                  return (
                    <g>
                      <line
                        x1={x}
                        x2={x}
                        y1={0}
                        y2={innerH}
                        stroke="var(--warn)"
                        strokeWidth={2.4}
                        strokeDasharray="6 4"
                      />
                      <rect
                        x={x - labelW / 2}
                        y={6}
                        width={labelW}
                        height={labelH}
                        rx={4}
                        fill="var(--warn)"
                        stroke="var(--warn)"
                        strokeWidth={1.2}
                        opacity={0.85}
                      />
                      <text
                        x={x}
                        y={20}
                        textAnchor="middle"
                        fontSize={12}
                        fill="#0a0b0d"
                        fontFamily="ui-monospace, monospace"
                        fontWeight={800}
                      >
                        {labelText}
                      </text>
                    </g>
                  )
                }
                const y = escalaTempo(todayMs)
                if (y < 0 || y > innerH) return null
                return (
                  <g>
                    <line
                      x1={0}
                      x2={innerW}
                      y1={y}
                      y2={y}
                      stroke="var(--warn)"
                      strokeWidth={2.4}
                      strokeDasharray="6 4"
                    />
                    <rect
                      x={6}
                      y={y - labelH / 2}
                      width={labelW}
                      height={labelH}
                      rx={4}
                      fill="var(--warn)"
                      stroke="var(--warn)"
                      strokeWidth={1.2}
                      opacity={0.85}
                    />
                    <text
                      x={6 + labelW / 2}
                      y={y + 4}
                      textAnchor="middle"
                      fontSize={12}
                      fill="#0a0b0d"
                      fontFamily="ui-monospace, monospace"
                      fontWeight={800}
                    >
                      {labelText}
                    </text>
                  </g>
                )
              })()
            : null}
        </g>
      </svg>

      {/* Legenda do trecho — abaixo do rótulo inferior do eixo X */}
      {itensLegenda.length > 0 ? (
        <div className="border-t border-border bg-bg-elevated px-3 py-2">
          <div className="text-2xs font-mono text-text-dim uppercase tracking-wider mb-1">
            Legenda · {itensLegenda.length}{' '}
            {itensLegenda.length === 1 ? 'serviço' : 'serviços'}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {itensLegenda.map((item) => (
              <div
                key={item.codigo}
                className="inline-flex items-center gap-1.5 text-xs font-mono"
              >
                <span
                  className="inline-block w-4 h-1.5 rounded-sm"
                  style={{ background: item.cor }}
                />
                <span className="text-text">{item.label}</span>
                {item.count > 1 ? (
                  <span className="text-text-faint">×{item.count}</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {hoverTraco && hoverXY ? (
        <MarchaTempoTooltip
          traco={hoverTraco}
          x={hoverXY.x}
          y={hoverXY.y}
          trecho={trecho}
        />
      ) : null}
    </div>
  )
}

function distanciaPontoSegmento(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) {
    return Math.hypot(px - x1, py - y1)
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const projx = x1 + t * dx
  const projy = y1 + t * dy
  return Math.hypot(px - projx, py - projy)
}
