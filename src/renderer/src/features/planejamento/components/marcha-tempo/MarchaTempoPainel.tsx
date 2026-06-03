// MarchaTempoPainel — TILOS plot redesenhado (port do Claude Design).
//
// Orientação fixa X=Caminho · Y=Tempo (convenção TILOS / Turbo-Chart).
// Visual: grid hierárquico + zebra mensal + sombreamento não-trabalhado +
// trajetórias com halo + anéis de conflito + crosshair com chips estaca/data
// + faixas de quantidade ancoradas via guia compartilhada + zoom + minimapa.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode
} from 'react'
import type {
  EstiloSerie,
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
  bandasNaoTrabalhadas,
  detectarConflitos,
  fmtDataBR,
  fmtDataLonga,
  formatMarcadorCurto,
  gerarMesesGrid,
  meiaNoite,
  pathReto,
  pathSuave
} from '@/features/planejamento/lib/marcha-tempo-pure'
import { MarchaTempoTooltip } from './MarchaTempoTooltip'
import {
  FX_BAND,
  FX_GAP,
  FX_HEAD,
  MarchaTempoFaixaQuantidades
} from './MarchaTempoFaixaQuantidades'

const DAY = 86400000

// ─── Escala linear ──────────────────────────────────────────────────────────

interface Escala {
  (v: number): number
  invert(px: number): number
  domain: [number, number]
}

function escalaLinear(d0: number, d1: number, r0: number, r1: number): Escala {
  const span = d1 - d0
  const rangeSpan = r1 - r0
  const fn = ((v: number): number =>
    span === 0 ? r0 : r0 + ((v - d0) / span) * rangeSpan) as Escala
  fn.invert = (px: number): number =>
    rangeSpan === 0 ? d0 : d0 + ((px - r0) / rangeSpan) * span
  fn.domain = [d0, d1]
  return fn
}

// ─── Presets fixos (Compacto · Técnico · Carbono) ───────────────────────────
//
// Tweaks removidos da UI — defaults canônicos hardcoded. Compacto pra
// densidade de engenheiro, Técnico pra trajetória crisp/degrau-cru, Carbono
// pra ambiente cinza-neutro padrão do produto.
const DENS = {
  band: 26,
  head: 15,
  gap: 8,
  font: 0.88,
  tickGapX: 58,
  tickGapY: 20
} as const

const TRAJ = {
  mult: 1.0,
  halo: 3.2,
  smooth: false
} as const

const DASHES: Record<EstiloSerie['dash'], string> = {
  solido: '',
  tracejado: '7 5',
  pontilhado: '1.5 5'
}

const MARGEM = { top: 36, right: 92, bottom: 48, left: 92 }
const TOL_HOVER = 9

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
  /** Altura mínima do plot interno. SVG total cresce conforme faixas se adicionam. */
  altura?: number
}

interface BrushState {
  x0: number
  y0: number
  x1: number
  y1: number
}

interface ViewState {
  px0: number
  px1: number
  ms0: number
  ms1: number
}

interface HoverState {
  cx: number
  cy: number
  traco: TracoTarefa
  posM: number
  dateMs: number
  qtdAcc: number
  qtdDia: number
  projX: number
  projY: number
}

interface BandTipState {
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
}

function dataMs(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime()
}

function obterEstilo(opcoes: MarchaTempoOpcoes, codigo: string | null, fallback: string): EstiloSerie {
  const k = codigo ?? ''
  const e = opcoes.estilosSerie[k]
  return e ?? { visivel: true, cor: fallback, dash: 'solido', width: 2.4 }
}

export function MarchaTempoPainel({
  trecho,
  template,
  tarefas,
  tracos,
  dependencias: _dependencias,
  dominioTempo,
  dataDate,
  opcoes,
  altura = 560
}: MarchaTempoPainelProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{
    x0: number
    y0: number
    x1: number
    y1: number
    moved: boolean
  } | null>(null)
  const patternId = useId()

  const [width, setWidth] = useState(1200)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [vguide, setVguide] = useState<number | null>(null)
  const [bandTip, setBandTip] = useState<BandTipState | null>(null)
  const [view, setView] = useState<ViewState | null>(null)
  const [brush, setBrush] = useState<BrushState | null>(null)

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((ents) => {
      for (const e of ents) {
        const w = e.contentRect.width
        if (w > 0) setWidth(Math.floor(w))
      }
    })
    ro.observe(el)
    return (): void => ro.disconnect()
  }, [])

  // Domínio de posição vindo dos tracos deste trecho (com pad 5%)
  const [dominioPos] = useMemo(() => {
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const t of tarefas) {
      if (t.trecho_id !== trecho.id) continue
      if (t.posicao_inicio_m == null || t.posicao_fim_m == null) continue
      lo = Math.min(lo, t.posicao_inicio_m, t.posicao_fim_m)
      hi = Math.max(hi, t.posicao_inicio_m, t.posicao_fim_m)
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
      const dom: [number, number] = [0, 1000]
      return [dom]
    }
    const pad = (hi - lo) * 0.05
    const dom: [number, number] = [Math.max(0, lo - pad), hi + pad]
    return [dom]
  }, [tarefas, trecho.id])

  const dens = DENS
  const trajPreset = TRAJ

  // Tracos deste trecho + estilo aplicado
  const tracosTrecho = useMemo(
    () => tracos.filter((t) => t.trechoId === trecho.id),
    [tracos, trecho.id]
  )

  // Faixas: nColunas válidas
  const nColunasFaixa = useMemo(() => {
    if (!template) return 0
    return opcoes.colunasQuantidade.filter((nome) =>
      template.colunas.some((c) => c.nome === nome)
    ).length
  }, [template, opcoes.colunasQuantidade])

  // Inner dimensions
  const innerW = Math.max(120, width - MARGEM.left - MARGEM.right)
  const innerH = Math.max(120, altura - MARGEM.top - MARGEM.bottom)

  // Altura das faixas (acima do plot) — empurra SVG total
  const F_PADTOP = 4
  // Folga entre o fim da última faixa de quantidade e o topo do plot —
  // acomoda os rótulos espelhados do eixo X (top tick labels) sem sobrepor
  // com a base dos blocos de quantidade.
  const F_GAP_LABEL_PLOT = 28
  // Dimensões da faixa de quantidade — independentes de `dens` (faixa precisa
  // ser legível mesmo com o plot em Compacto).
  const alturaFaixas =
    nColunasFaixa > 0
      ? F_PADTOP +
        nColunasFaixa * (FX_HEAD + FX_BAND) +
        Math.max(0, nColunasFaixa - 1) * FX_GAP +
        8 +
        F_GAP_LABEL_PLOT
      : 0

  const margemTop = MARGEM.top + alturaFaixas
  const alturaSvg = innerH + margemTop + MARGEM.bottom

  // Janela visível (zoom)
  const t0 = dominioTempo[0]
  const t1 = dominioTempo[1]
  const px0Dominio = dominioPos[0]
  const px1Dominio = dominioPos[1]
  const vx0 = view ? view.px0 : px0Dominio
  const vx1 = view ? view.px1 : px1Dominio
  const vy0 = view ? view.ms0 : t0
  const vy1 = view ? view.ms1 : t1

  // Escalas: X=posição (cresce →), Y=tempo (desce)
  const sx = useMemo(() => escalaLinear(vx0, vx1, 0, innerW), [vx0, vx1, innerW])
  const sy = useMemo(() => escalaLinear(vy0, vy1, 0, innerH), [vy0, vy1, innerH])

  // ─── Grids ───────────────────────────────────────────────────────────────
  const gridX = useMemo(() => {
    const span = vx1 - vx0
    if (span <= 0) return { majors: [], minors: [] }
    const cands = opcoes.passoPosicaoM != null
      ? [opcoes.passoPosicaoM]
      : [500, 1000, 2000, 5000, 10000, 25000, 50000]
    let major = cands[cands.length - 1]
    for (const c of cands) {
      if (innerW / (span / c) >= dens.tickGapX) {
        major = c
        break
      }
    }
    const minor = major / 5
    const majors: number[] = []
    const minors: number[] = []
    const start = Math.floor(vx0 / minor) * minor
    for (let m = start; m <= vx1 + 0.5; m += minor) {
      if (m < vx0 - 0.5 || m < 0) continue
      const isMajor = Math.abs(m - Math.round(m / major) * major) < 0.5
      if (isMajor) majors.push(m)
      else minors.push(m)
    }
    return { majors, minors }
  }, [vx0, vx1, innerW, dens.tickGapX, opcoes.passoPosicaoM])

  const meses = useMemo(() => gerarMesesGrid(vy0, vy1), [vy0, vy1])

  const semanas = useMemo(() => {
    const out: number[] = []
    const wDay = new Date(vy0).getDay()
    const shift = (wDay + 6) % 7
    let mon = meiaNoite(vy0 - shift * DAY)
    while (mon < vy0) mon += 7 * DAY
    const spacingDia = innerH / Math.max(1, (vy1 - vy0) / DAY)
    const passoSem =
      spacingDia * 7 >= dens.tickGapY ? 1 : spacingDia * 7 >= dens.tickGapY / 2 ? 2 : 4
    let k = 0
    while (mon <= vy1) {
      if (k % passoSem === 0) out.push(mon)
      mon += 7 * DAY
      k += 1
    }
    return out
  }, [vy0, vy1, innerH, dens.tickGapY])

  const bandas = useMemo(
    () => (opcoes.mostrarNaoTrabalhado ? bandasNaoTrabalhadas(vy0, vy1) : []),
    [vy0, vy1, opcoes.mostrarNaoTrabalhado]
  )

  const conflitos = useMemo(
    () => (opcoes.mostrarConflitos ? detectarConflitos(tracosTrecho) : []),
    [tracosTrecho, opcoes.mostrarConflitos]
  )

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

  // ─── Pré-cálculo de polilinhas em px ─────────────────────────────────────
  type IlhaPx = { pts: { x: number; y: number; src: PontoTraco }[]; d: string }
  const tracosPx = useMemo(() => {
    return tracosTrecho.map((t) => {
      const st = obterEstilo(opcoes, t.codigo, t.cor)
      const ilhasPx: IlhaPx[] = t.ilhas.map((ilha) => {
        const pts = ilha.map((p) => ({ x: sx(p.posicaoM), y: sy(dataMs(p.data)), src: p }))
        const d = trajPreset.smooth ? pathSuave(pts) : pathReto(pts)
        return { pts, d }
      })
      return { traco: t, estilo: st, ilhasPx }
    })
  }, [tracosTrecho, sx, sy, opcoes, trajPreset.smooth])

  // ─── Interação: hover ────────────────────────────────────────────────────
  const onMove = useCallback(
    (e: MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current
      if (!svg) return
      const r = svg.getBoundingClientRect()
      const x = e.clientX - r.left - MARGEM.left
      const y = e.clientY - r.top - margemTop
      if (dragRef.current) return
      if (x < -2 || y < -2 || x > innerW + 2 || y > innerH + 2) {
        setCursor(null)
        setHover(null)
        setVguide(null)
        return
      }
      const cx0 = Math.max(0, Math.min(innerW, x))
      const cy0 = Math.max(0, Math.min(innerH, y))
      setCursor({ x: cx0, y: cy0 })
      setVguide(cx0)

      interface BestMatch {
        traco: TracoTarefa
        ilhaIdx: number
        segIdx: number
        t: number
        dist: number
      }
      const bestRef: { value: BestMatch | null } = { value: null }
      for (const tx of tracosPx) {
        if (!tx.estilo.visivel) continue
        for (let ilhaIdx = 0; ilhaIdx < tx.ilhasPx.length; ilhaIdx++) {
          const ilha = tx.ilhasPx[ilhaIdx]
          for (let i = 0; i < ilha.pts.length - 1; i++) {
            const a = ilha.pts[i]
            const b = ilha.pts[i + 1]
            const dx = b.x - a.x
            const dy = b.y - a.y
            const l2 = dx * dx + dy * dy
            let tt = l2 ? ((x - a.x) * dx + (y - a.y) * dy) / l2 : 0
            tt = Math.max(0, Math.min(1, tt))
            const cx = a.x + tt * dx
            const cy = a.y + tt * dy
            const d = Math.hypot(x - cx, y - cy)
            if (d < TOL_HOVER && (!bestRef.value || d < bestRef.value.dist)) {
              bestRef.value = { traco: tx.traco, ilhaIdx, segIdx: i, t: tt, dist: d }
            }
          }
        }
      }

      const matched = bestRef.value
      if (matched) {
        const tx = tracosPx.find((it) => it.traco.tarefaId === matched.traco.tarefaId)!
        const ilha = tx.ilhasPx[matched.ilhaIdx]
        const a = ilha.pts[matched.segIdx]
        const b = ilha.pts[matched.segIdx + 1]
        const posM = a.src.posicaoM + (b.src.posicaoM - a.src.posicaoM) * matched.t
        const tA = dataMs(a.src.data)
        const tB = dataMs(b.src.data)
        const dateMs = tA + (tB - tA) * matched.t
        const qA = a.src.qtdAcc ?? 0
        const qB = b.src.qtdAcc ?? matched.traco.qtdTotal
        const qtdAcc = qA + (qB - qA) * matched.t
        const qtdDia = a.src.qtdDia ?? matched.traco.prodMediaPorDia
        const projX = a.x + (b.x - a.x) * matched.t
        const projY = a.y + (b.y - a.y) * matched.t
        setHover({
          cx: e.clientX,
          cy: e.clientY,
          traco: matched.traco,
          posM,
          dateMs,
          qtdAcc,
          qtdDia,
          projX,
          projY
        })
      } else {
        setHover(null)
      }
    },
    [tracosPx, innerW, innerH, margemTop]
  )

  const onLeave = useCallback(() => {
    if (dragRef.current) return
    setCursor(null)
    setHover(null)
    setVguide(null)
  }, [])

  // ─── Zoom: brush + wheel + dbl-click ─────────────────────────────────────
  const ptPlot = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const svg = svgRef.current!
      const r = svg.getBoundingClientRect()
      return { x: e.clientX - r.left - MARGEM.left, y: e.clientY - r.top - margemTop }
    },
    [margemTop]
  )

  const onDown = useCallback(
    (e: MouseEvent<SVGSVGElement>) => {
      if (e.button !== 0) return
      const { x, y } = ptPlot(e)
      if (x < 0 || y < 0 || x > innerW || y > innerH) return
      setCursor(null)
      setHover(null)
      setVguide(null)
      dragRef.current = { x0: x, y0: y, x1: x, y1: y, moved: false }
      setBrush({ x0: x, y0: y, x1: x, y1: y })
      const mv = (ev: globalThis.MouseEvent): void => {
        const d = dragRef.current
        if (!d) return
        const p = ptPlot(ev)
        const cx = Math.max(0, Math.min(innerW, p.x))
        const cy = Math.max(0, Math.min(innerH, p.y))
        if (Math.abs(cx - d.x0) > 3 || Math.abs(cy - d.y0) > 3) d.moved = true
        d.x1 = cx
        d.y1 = cy
        setBrush({ x0: d.x0, y0: d.y0, x1: cx, y1: cy })
      }
      const up = (): void => {
        const d = dragRef.current
        dragRef.current = null
        window.removeEventListener('mousemove', mv)
        window.removeEventListener('mouseup', up)
        setBrush(null)
        if (d && d.moved) {
          const ax = Math.min(d.x0, d.x1)
          const bx = Math.max(d.x0, d.x1)
          const ay = Math.min(d.y0, d.y1)
          const by = Math.max(d.y0, d.y1)
          if (bx - ax > 8 && by - ay > 8) {
            setView({
              px0: sx.invert(ax),
              px1: sx.invert(bx),
              ms0: sy.invert(ay),
              ms1: sy.invert(by)
            })
          }
        }
      }
      window.addEventListener('mousemove', mv)
      window.addEventListener('mouseup', up)
    },
    [innerW, innerH, sx, sy, ptPlot]
  )

  const fitToData = useCallback(() => {
    let x0 = Number.POSITIVE_INFINITY
    let x1 = Number.NEGATIVE_INFINITY
    let y0 = Number.POSITIVE_INFINITY
    let y1 = Number.NEGATIVE_INFINITY
    for (const tx of tracosPx) {
      if (!tx.estilo.visivel) continue
      for (const ilha of tx.traco.ilhas) {
        for (const p of ilha) {
          const ms = dataMs(p.data)
          x0 = Math.min(x0, p.posicaoM)
          x1 = Math.max(x1, p.posicaoM)
          y0 = Math.min(y0, ms)
          y1 = Math.max(y1, ms)
        }
      }
    }
    if (!Number.isFinite(x0)) return
    const padX = (x1 - x0) * 0.04 + 300
    const padY = (y1 - y0) * 0.04 + DAY
    setView({
      px0: Math.max(px0Dominio, x0 - padX),
      px1: Math.min(px1Dominio, x1 + padX),
      ms0: Math.max(t0, y0 - padY),
      ms1: Math.min(t1, y1 + padY)
    })
  }, [tracosPx, px0Dominio, px1Dominio, t0, t1])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent): void => {
      const r = svg.getBoundingClientRect()
      const x = e.clientX - r.left - MARGEM.left
      const y = e.clientY - r.top - margemTop
      if (x < 0 || y < 0 || x > innerW || y > innerH) return
      e.preventDefault()
      const dataX = sx.invert(x)
      const dataY = sy.invert(y)
      const f = e.deltaY > 0 ? 1.2 : 1 / 1.2
      let nx0 = dataX - (dataX - vx0) * f
      let nx1 = dataX + (vx1 - dataX) * f
      let ny0 = dataY - (dataY - vy0) * f
      let ny1 = dataY + (vy1 - dataY) * f
      nx0 = Math.max(px0Dominio, nx0)
      nx1 = Math.min(px1Dominio, nx1)
      ny0 = Math.max(t0, ny0)
      ny1 = Math.min(t1, ny1)
      if (nx1 - nx0 < 1200 || ny1 - ny0 < 2.5 * DAY) return
      if (
        nx0 <= px0Dominio + 1 &&
        nx1 >= px1Dominio - 1 &&
        ny0 <= t0 + 1 &&
        ny1 >= t1 - 1
      ) {
        setView(null)
        return
      }
      setView({ px0: nx0, px1: nx1, ms0: ny0, ms1: ny1 })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return (): void => svg.removeEventListener('wheel', onWheel)
  }, [sx, sy, vx0, vx1, vy0, vy1, innerW, innerH, px0Dominio, px1Dominio, t0, t1, margemTop])

  // ─── Renders auxiliares ───────────────────────────────────────────────────
  const todayMs = dataDate ? dataMs(dataDate) : Date.now()
  const todayY = sy(todayMs)

  const containerStyle: CSSProperties = {
    minHeight: alturaSvg + 28,
    ['--fs' as keyof CSSProperties]: dens.font
  } as CSSProperties

  return (
    <div
      ref={containerRef}
      className="relative w-full bg-bg-panel border border-border rounded overflow-hidden"
      style={containerStyle}
    >
      {/* Header (BR-XXX · range estaca) */}
      <div
        className="absolute top-0 left-0 right-0 px-3 py-2 flex items-center justify-between bg-bg-elevated border-b border-border z-10 font-mono"
        style={{ fontSize: 12 }}
      >
        <div className="text-text font-semibold">{trecho.nome}</div>
        <div className="text-text-muted">
          {formatMarcador(dominioPos[0], trecho)}
          <span className="text-text-faint mx-1">→</span>
          {formatMarcador(dominioPos[1], trecho)}
        </div>
      </div>

      <svg
        ref={svgRef}
        width={width}
        height={alturaSvg}
        style={{ marginTop: 28, display: 'block', cursor: brush ? 'crosshair' : undefined }}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onMouseDown={onDown}
        onDoubleClick={fitToData}
      >
        <defs>
          <pattern
            id={`hatch-${patternId}`}
            width="7"
            height="7"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <rect width="7" height="7" fill="none" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="7"
              stroke="var(--text-faint)"
              strokeWidth="1"
              opacity="0.5"
            />
          </pattern>
          <clipPath id={`plotClip-${patternId}`}>
            <rect x="0" y="0" width={innerW} height={innerH} />
          </clipPath>
          <clipPath id={`faixasClip-${patternId}`}>
            <rect x="0" y={-alturaFaixas} width={innerW} height={alturaFaixas} />
          </clipPath>
        </defs>

        <g transform={`translate(${MARGEM.left},${margemTop})`}>
          {/* Faixas de quantidade (acima do plot, via guia compartilhada) */}
          {nColunasFaixa > 0 && (
            <MarchaTempoFaixaQuantidades
              template={template}
              nomesColunas={opcoes.colunasQuantidade}
              dominioPos={[vx0, vx1]}
              sx={sx}
              innerW={innerW}
              majors={gridX.majors}
              alturaFaixas={alturaFaixas}
              dens={dens}
              estilosSerie={opcoes.estilosSerie}
              vguide={vguide}
              onBandTip={setBandTip}
            />
          )}

          {/* Fundo do plot */}
          <rect x="0" y="0" width={innerW} height={innerH} fill="var(--bg)" />

          {/* Zebra mensal */}
          <g clipPath={`url(#plotClip-${patternId})`}>
            {meses.map((m, i) =>
              m.zebra ? (
                <rect
                  key={`z${i}`}
                  x="0"
                  y={sy(m.ms)}
                  width={innerW}
                  height={Math.max(0, sy(m.fim) - sy(m.ms))}
                  fill="var(--mt-zebra)"
                />
              ) : null
            )}

            {/* Bandas não-trabalhadas */}
            {bandas.map((b, i) => (
              <g key={`b${i}`}>
                <rect
                  x="0"
                  y={sy(b.inicio)}
                  width={innerW}
                  height={Math.max(0, sy(b.fim) - sy(b.inicio))}
                  fill="var(--mt-nao-trab)"
                />
                <rect
                  x="0"
                  y={sy(b.inicio)}
                  width={innerW}
                  height={Math.max(0, sy(b.fim) - sy(b.inicio))}
                  fill={`url(#hatch-${patternId})`}
                  opacity={b.fer ? 0.55 : 0.32}
                />
              </g>
            ))}
          </g>

          {/* Grid minor */}
          <g clipPath={`url(#plotClip-${patternId})`}>
            {gridX.minors.map((m, i) => (
              <line
                key={`mnx${i}`}
                x1={sx(m)}
                y1="0"
                x2={sx(m)}
                y2={innerH}
                stroke="var(--mt-grid-minor)"
                strokeWidth="1"
              />
            ))}
            {semanas.map((d, i) => (
              <line
                key={`mny${i}`}
                x1="0"
                y1={sy(d)}
                x2={innerW}
                y2={sy(d)}
                stroke="var(--mt-grid-minor)"
                strokeWidth="1"
              />
            ))}
          </g>

          {/* Grid major */}
          <g clipPath={`url(#plotClip-${patternId})`}>
            {gridX.majors.map((m, i) => (
              <line
                key={`mjx${i}`}
                x1={sx(m)}
                y1="0"
                x2={sx(m)}
                y2={innerH}
                stroke="var(--mt-grid-major)"
                strokeWidth="1"
              />
            ))}
            {meses.map((m, i) =>
              i === 0 ? null : (
                <line
                  key={`mjy${i}`}
                  x1="0"
                  y1={sy(m.ms)}
                  x2={innerW}
                  y2={sy(m.ms)}
                  stroke="var(--mt-grid-major)"
                  strokeWidth="1"
                />
              )
            )}
          </g>

          {/* Rótulos de mês inline (no plot) */}
          {meses.map((m, i) =>
            sy(m.fim) - sy(m.ms) > 26 ? (
              <text
                key={`mlbl${i}`}
                x="7"
                y={sy(m.ms) + 14}
                fontSize={11 * dens.font}
                fontFamily="ui-monospace, monospace"
                fontWeight="600"
                letterSpacing="0.08em"
                fill="var(--text-dim)"
              >
                {m.nome}
              </text>
            ) : null
          )}

          {/* Trajetórias com halo */}
          <g clipPath={`url(#plotClip-${patternId})`}>
            {tracosPx.map(({ traco, estilo, ilhasPx }) => {
              if (!estilo.visivel) return null
              const ativo = hover?.traco.tarefaId === traco.tarefaId
              const dim = hover && !ativo
              const dash = DASHES[estilo.dash]
              const w = (ativo ? estilo.width + 0.9 : estilo.width) * trajPreset.mult
              return (
                <g
                  key={traco.tarefaId}
                  opacity={dim ? 0.2 : 1}
                  style={{ transition: 'opacity .12s' }}
                >
                  {ilhasPx.map((ilha, idxIlha) => (
                    <g key={idxIlha}>
                      {/* halo para destrinchar cruzamentos */}
                      <path
                        d={ilha.d}
                        fill="none"
                        stroke="var(--bg)"
                        strokeWidth={w + trajPreset.halo}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        opacity={0.92}
                      />
                      <path
                        d={ilha.d}
                        fill="none"
                        stroke={estilo.cor}
                        strokeWidth={w}
                        strokeDasharray={dash || undefined}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    </g>
                  ))}
                  {/* Marcadores de extremo (na 1ª e última ilha) */}
                  {ilhasPx.length > 0 && (
                    <>
                      <circle
                        cx={ilhasPx[0].pts[0].x}
                        cy={ilhasPx[0].pts[0].y}
                        r={ativo ? 4 : 2.8}
                        fill="var(--bg)"
                        stroke={estilo.cor}
                        strokeWidth={1.6}
                      />
                      <circle
                        cx={ilhasPx[ilhasPx.length - 1].pts.slice(-1)[0].x}
                        cy={ilhasPx[ilhasPx.length - 1].pts.slice(-1)[0].y}
                        r={ativo ? 4 : 2.8}
                        fill={estilo.cor}
                      />
                    </>
                  )}
                </g>
              )
            })}
          </g>

          {/* Conflitos (anéis vermelhos) */}
          {opcoes.mostrarConflitos && (
            <g clipPath={`url(#plotClip-${patternId})`}>
              {conflitos.map((c, i) => {
                const x = sx(c.posM)
                const y = sy(c.dateMs)
                const rel =
                  hover && (hover.traco.tarefaId === c.a || hover.traco.tarefaId === c.b)
                return (
                  <g key={`c${i}`} opacity={hover && !rel ? 0.25 : 1}>
                    <circle
                      cx={x}
                      cy={y}
                      r={rel ? 6.5 : 5}
                      fill="none"
                      stroke="var(--danger)"
                      strokeWidth={1.4}
                      opacity={rel ? 1 : 0.7}
                    />
                    <circle cx={x} cy={y} r={1.6} fill="var(--danger)" />
                  </g>
                )
              })}
            </g>
          )}

          {/* Marcos como linhas horizontais com pílula */}
          {opcoes.mostrarMarcos &&
            marcos.map((m) => {
              if (!m.data_inicio) return null
              const ms = dataMs(m.data_inicio)
              const y = sy(ms)
              if (y < -1 || y > innerH + 1) return null
              const nome = m.nome_custom ?? m.servico_grupo_descricao ?? m.codigo_eap ?? '◆'
              const labelW = nome.length * 6.6 + 16
              return (
                <g key={m.id}>
                  <line
                    x1="0"
                    y1={y}
                    x2={innerW}
                    y2={y}
                    stroke="var(--accent)"
                    strokeWidth={1.8}
                    strokeDasharray="4 3"
                    opacity={0.9}
                  />
                  <g transform={`translate(${innerW - 8},${Math.max(y, 4)})`}>
                    <rect
                      x={-labelW}
                      y="4"
                      width={labelW}
                      height={22}
                      rx={3}
                      fill="var(--accent)"
                      opacity={0.85}
                    />
                    <text
                      x={-labelW / 2}
                      y="19"
                      textAnchor="middle"
                      fontSize={11 * dens.font}
                      fontFamily="ui-monospace, monospace"
                      fontWeight="700"
                      fill="#06080d"
                    >
                      {nome}
                    </text>
                  </g>
                </g>
              )
            })}

          {/* Today line com pílula */}
          {opcoes.mostrarTodayLine && todayY >= -1 && todayY <= innerH + 1 && (
            <g>
              <line
                x1="0"
                y1={todayY}
                x2={innerW}
                y2={todayY}
                stroke="var(--warn)"
                strokeWidth={2.4}
                strokeDasharray="6 4"
              />
              <g transform={`translate(14,${todayY})`}>
                <rect x="0" y="-11" width="124" height="22" rx={4} fill="var(--warn)" />
                <text
                  x="12"
                  y="4"
                  fontSize={12 * dens.font}
                  fontFamily="ui-monospace, monospace"
                  fontWeight="800"
                  fill="#0a0b0d"
                >
                  HOJE · {fmtDataBR(todayMs)}
                </text>
              </g>
            </g>
          )}

          {/* Borda do plot */}
          <rect
            x="0"
            y="0"
            width={innerW}
            height={innerH}
            fill="none"
            stroke="var(--border-strong)"
            strokeWidth="1"
          />

          {/* Ticks X (estaca) — topo + base */}
          {gridX.majors.map((m, i) => {
            const x = sx(m)
            return (
              <g key={`xt${i}`}>
                <text
                  x={x}
                  y={-12}
                  textAnchor="middle"
                  fontSize={11 * dens.font}
                  fontFamily="ui-monospace, monospace"
                  fill="var(--text-muted)"
                >
                  {formatMarcadorCurto(m)}
                </text>
                <line
                  x1={x}
                  y1={-6}
                  x2={x}
                  y2={0}
                  stroke="var(--border-strong)"
                  strokeWidth={1}
                />
                {opcoes.eixosEspelhados && (
                  <>
                    <text
                      x={x}
                      y={innerH + 18}
                      textAnchor="middle"
                      fontSize={11 * dens.font}
                      fontFamily="ui-monospace, monospace"
                      fill="var(--text-muted)"
                    >
                      {formatMarcadorCurto(m)}
                    </text>
                    <line
                      x1={x}
                      y1={innerH}
                      x2={x}
                      y2={innerH + 6}
                      stroke="var(--border-strong)"
                      strokeWidth={1}
                    />
                  </>
                )}
              </g>
            )
          })}

          {/* Ticks Y (data) — esquerda + direita */}
          {semanas.map((d, i) => {
            const y = sy(d)
            return (
              <g key={`yt${i}`}>
                <text
                  x={-10}
                  y={y + 3}
                  textAnchor="end"
                  fontSize={11 * dens.font}
                  fontFamily="ui-monospace, monospace"
                  fill="var(--text-muted)"
                >
                  {fmtDataBR(d)}
                </text>
                <line x1={-6} y1={y} x2={0} y2={y} stroke="var(--border-strong)" strokeWidth={1} />
                {opcoes.eixosEspelhados && (
                  <>
                    <text
                      x={innerW + 10}
                      y={y + 3}
                      textAnchor="start"
                      fontSize={11 * dens.font}
                      fontFamily="ui-monospace, monospace"
                      fill="var(--text-muted)"
                    >
                      {fmtDataBR(d)}
                    </text>
                    <line
                      x1={innerW}
                      y1={y}
                      x2={innerW + 6}
                      y2={y}
                      stroke="var(--border-strong)"
                      strokeWidth={1}
                    />
                  </>
                )}
              </g>
            )
          })}

          {/* Ponto projetado sob o cursor */}
          {hover && (
            <g style={{ pointerEvents: 'none' }}>
              <circle
                cx={hover.projX}
                cy={hover.projY}
                r={5.5}
                fill="none"
                stroke="var(--bg)"
                strokeWidth={2.5}
              />
              <circle
                cx={hover.projX}
                cy={hover.projY}
                r={4.5}
                fill="none"
                stroke={hover.traco.cor}
                strokeWidth={1.6}
              />
              <circle cx={hover.projX} cy={hover.projY} r={2} fill={hover.traco.cor} />
            </g>
          )}

          {/* Crosshair vertical + chip estaca (base) */}
          {vguide != null && (
            <g style={{ pointerEvents: 'none' }}>
              <line
                x1={vguide}
                y1={-alturaFaixas}
                x2={vguide}
                y2={innerH}
                stroke="var(--mt-cross)"
                strokeWidth={1}
              />
              <g
                transform={`translate(${Math.max(46, Math.min(innerW - 46, vguide))},${innerH})`}
              >
                <rect
                  x={-46}
                  y={6}
                  width={92}
                  height={22}
                  rx={3}
                  fill="var(--bg-active)"
                  stroke="var(--accent-line)"
                  strokeWidth={1}
                />
                <text
                  x={0}
                  y={21}
                  textAnchor="middle"
                  fontSize={11 * dens.font}
                  fontFamily="ui-monospace, monospace"
                  fontWeight="600"
                  fill="var(--accent-hover)"
                >
                  {formatMarcador(sx.invert(vguide), trecho)}
                </text>
              </g>
            </g>
          )}

          {/* Crosshair horizontal + chip data (esquerda) */}
          {cursor && (
            <g style={{ pointerEvents: 'none' }}>
              <line
                x1={0}
                y1={cursor.y}
                x2={innerW}
                y2={cursor.y}
                stroke="var(--mt-cross)"
                strokeWidth={1}
              />
              <g transform={`translate(0,${cursor.y})`}>
                <rect
                  x={-86}
                  y={-11}
                  width={80}
                  height={22}
                  rx={3}
                  fill="var(--bg-active)"
                  stroke="var(--accent-line)"
                  strokeWidth={1}
                />
                <text
                  x={-46}
                  y={4}
                  textAnchor="middle"
                  fontSize={11 * dens.font}
                  fontFamily="ui-monospace, monospace"
                  fontWeight="600"
                  fill="var(--accent-hover)"
                >
                  {fmtDataLonga(sy.invert(cursor.y))}
                </text>
              </g>
              <circle cx={cursor.x} cy={cursor.y} r={2.5} fill="var(--accent)" />
            </g>
          )}

          {/* Retângulo de seleção (brush/zoom) */}
          {brush && (
            <g style={{ pointerEvents: 'none' }}>
              <rect
                x={Math.min(brush.x0, brush.x1)}
                y={Math.min(brush.y0, brush.y1)}
                width={Math.abs(brush.x1 - brush.x0)}
                height={Math.abs(brush.y1 - brush.y0)}
                fill="var(--accent-glow)"
                stroke="var(--accent)"
                strokeWidth={1}
                strokeDasharray="4 3"
              />
            </g>
          )}
        </g>
      </svg>

      {/* Minimapa (apenas com zoom ativo) */}
      {view && (
        <Minimap
          tracos={tracosPx}
          view={view}
          setView={setView}
          t0={t0}
          t1={t1}
          px0={px0Dominio}
          px1={px1Dominio}
          dataDate={dataDate}
        />
      )}

      {/* Indicador de zoom + botões inline */}
      {view && (
        <button
          className="absolute top-10 right-3 z-20 text-2xs font-mono uppercase tracking-wider px-2 py-1 rounded border border-warn/40 bg-warn/10 text-warn hover:bg-warn/20"
          onClick={() => setView(null)}
        >
          ⤢ Zoom · Tudo
        </button>
      )}

      {/* Tooltip */}
      {hover && (
        <MarchaTempoTooltip
          traco={hover.traco}
          x={hover.cx}
          y={hover.cy}
          trecho={trecho}
          ponto={{
            posM: hover.posM,
            dateMs: hover.dateMs,
            qtdAcc: hover.qtdAcc,
            qtdDia: hover.qtdDia
          }}
        />
      )}

      {/* BandTip */}
      {bandTip && <BandTip bandTip={bandTip} />}
    </div>
  )
}

// ─── Minimapa CONTEXTO ──────────────────────────────────────────────────────

interface MinimapProps {
  tracos: Array<{
    traco: TracoTarefa
    estilo: EstiloSerie
    ilhasPx: Array<{ pts: { x: number; y: number; src: PontoTraco }[]; d: string }>
  }>
  view: ViewState
  setView: (v: ViewState | null) => void
  t0: number
  t1: number
  px0: number
  px1: number
  dataDate: string | null
}

function Minimap({
  tracos,
  view,
  setView,
  t0,
  t1,
  px0,
  px1,
  dataDate
}: MinimapProps): ReactNode {
  const ref = useRef<SVGSVGElement>(null)
  const PAD = 7
  const W = 168
  const H = 108
  const iw = W - 2 * PAD
  const ih = H - 2 * PAD
  const mx = (p: number): number => PAD + ((p - px0) / Math.max(1, px1 - px0)) * iw
  const my = (ms: number): number => PAD + ((ms - t0) / Math.max(1, t1 - t0)) * ih
  const spanX = view.px1 - view.px0
  const spanY = view.ms1 - view.ms0

  const setCenter = useCallback(
    (cx: number, cy: number): void => {
      const svg = ref.current
      if (!svg) return
      const r = svg.getBoundingClientRect()
      const px = px0 + ((cx - r.left - PAD) / iw) * (px1 - px0)
      const ms = t0 + ((cy - r.top - PAD) / ih) * (t1 - t0)
      const nx0 = Math.max(px0, Math.min(px1 - spanX, px - spanX / 2))
      const nms0 = Math.max(t0, Math.min(t1 - spanY, ms - spanY / 2))
      setView({ px0: nx0, px1: nx0 + spanX, ms0: nms0, ms1: nms0 + spanY })
    },
    [iw, ih, px0, px1, t0, t1, spanX, spanY, setView]
  )

  const onDown = useCallback(
    (e: MouseEvent<SVGSVGElement>): void => {
      e.preventDefault()
      setCenter(e.clientX, e.clientY)
      const mv = (ev: globalThis.MouseEvent): void => setCenter(ev.clientX, ev.clientY)
      const up = (): void => {
        window.removeEventListener('mousemove', mv)
        window.removeEventListener('mouseup', up)
      }
      window.addEventListener('mousemove', mv)
      window.addEventListener('mouseup', up)
    },
    [setCenter]
  )

  const vx = mx(view.px0)
  const vy = my(view.ms0)
  const vw = mx(view.px1) - mx(view.px0)
  const vh = my(view.ms1) - my(view.ms0)
  const todayMs = dataDate ? dataMs(dataDate) : Date.now()

  return (
    <div className="absolute top-10 left-3 z-20 p-1.5 rounded bg-bg-panel border border-border-strong shadow-lg">
      <div className="text-2xs font-mono uppercase tracking-widest text-text-dim ml-0.5 mb-1">
        CONTEXTO
      </div>
      <svg ref={ref} width={W} height={H} onMouseDown={onDown} style={{ cursor: 'move' }}>
        <rect
          x={0}
          y={0}
          width={W}
          height={H}
          fill="var(--bg)"
          stroke="var(--border)"
          strokeWidth={1}
          rx={3}
        />
        {todayMs >= t0 && todayMs <= t1 && (
          <line
            x1={PAD}
            y1={my(todayMs)}
            x2={W - PAD}
            y2={my(todayMs)}
            stroke="var(--warn)"
            strokeWidth={1}
            strokeDasharray="3 2"
            opacity={0.7}
          />
        )}
        {tracos.map(({ traco, estilo }) => {
          if (!estilo.visivel) return null
          const ds = traco.ilhas
            .map((ilha) => {
              const sample = ilha.filter((_, i) => i % 4 === 0)
              if (
                ilha.length > 0 &&
                sample[sample.length - 1] !== ilha[ilha.length - 1]
              ) {
                sample.push(ilha[ilha.length - 1])
              }
              return (
                'M' +
                sample
                  .map((p) => `${mx(p.posicaoM).toFixed(1)},${my(dataMs(p.data)).toFixed(1)}`)
                  .join(' L')
              )
            })
            .join(' ')
          return (
            <path
              key={traco.tarefaId}
              d={ds}
              fill="none"
              stroke={estilo.cor}
              strokeWidth={1}
              opacity={0.8}
              strokeLinejoin="round"
            />
          )
        })}
        <rect
          x={vx}
          y={vy}
          width={vw}
          height={vh}
          fill="var(--accent-glow)"
          stroke="var(--accent)"
          strokeWidth={1.2}
        />
      </svg>
    </div>
  )
}

// ─── BandTip ────────────────────────────────────────────────────────────────

interface BandTipProps {
  bandTip: BandTipState
}

function BandTip({ bandTip }: BandTipProps): ReactNode {
  const pct = bandTip.colunaTotal ? Math.round((bandTip.segValor / bandTip.colunaTotal) * 100) : 0
  const style: CSSProperties = {
    position: 'fixed',
    left: Math.min(bandTip.cx + 16, window.innerWidth - 232),
    top: Math.min(bandTip.cy + 18, window.innerHeight - 150),
    zIndex: 40,
    width: 216,
    pointerEvents: 'none'
  }
  return (
    <div
      className="rounded border border-border-strong bg-bg-elevated px-3 py-2 shadow-xl font-mono"
      style={style}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-2 h-2 rounded-sm" style={{ background: bandTip.colunaCor }} />
        <span className="text-text font-semibold text-xs">
          {bandTip.colunaCodigo} · {bandTip.colunaNome}
        </span>
      </div>
      <div className="text-base font-semibold text-text">
        {formatNumeroCompacto(bandTip.segValor)}
        <span className="text-2xs font-normal text-text-muted ml-1">
          {bandTip.colunaUn ?? ''}
        </span>
      </div>
      <div className="text-2xs text-text-muted mt-0.5">
        {formatMarcadorCurto(bandTip.segIni)} → {formatMarcadorCurto(bandTip.segFim)}
      </div>
      <div className="text-2xs text-text-dim mt-0.5">{pct}% do total da faixa</div>
    </div>
  )
}

function formatNumeroCompacto(v: number): string {
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace('.', ',') + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace('.', ',') + 'k'
  return String(Math.round(v))
}
