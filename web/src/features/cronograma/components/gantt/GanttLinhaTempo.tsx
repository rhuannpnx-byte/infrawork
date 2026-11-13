/**
 * Linha do tempo do Gantt (a parte gráfica da `GanttView` do ApeX) em SVG, no visual do InfraWork.
 *
 * - Cabeçalho do calendário em dois níveis (`DCalendar`), fixo no topo; sombreamento dos dias não úteis.
 * - Barras (`DGanttRect`): tarefas arrastáveis — miolo/borda esquerda move o início (tarefa não ASAP), borda direita
 *   (10 px) estica o término; snap por dia (hora com o cabeçalho em horas), faixas de restrição durante o arraste
 *   (`DrawTimingConstraints`) e etiqueta com a data.
 * - Dependências (`DDependency`): sólidas (do usuário) e tracejadas (derivadas dos tipos), roteadas em "L".
 * - Modo dependências (`DDependencyTarget` + `DependencyCreationHelper`): alvos de início, meio e fim; arrastar de um
 *   alvo a outro cria a dependência com o tipo pela combinação.
 * - Marcos (`DMilestone`), violações (`DViolation`, bandeiras), linha de hoje.
 *
 * Virtualizado: só as linhas e as células do calendário na área visível são desenhadas.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as RPointerEvent
} from 'react'
import type { Calendar } from '@apex/calendar'
import type { TimingBands } from '@apex/engine'
import { cn } from '@/lib/utils'
import { niveisCabecalho, periodosNaoUteis, snapData, type EixoTempo } from '../../visoes/eixo'
import {
  alvoPredecessora,
  alvoSucessora,
  alvoValido,
  caminhoSvg,
  setaSvg,
  tipoPelosAlvos,
  tracarDependencia,
  type Alvo,
  type Ponto
} from '../../visoes/dependencias'
import type { DadosGantt, DependenciaGantt, LinhaGantt } from '../../visoes/gantt-dados'
import { fmtDataHora, fmtDataLonga } from '../../visoes/formato'
import type { TipoDependencia } from '../../motor/tipos'

export const ALTURA_LINHA = 26
export const ALTURA_CABECALHO = 44
const BARRA_TAREFA = 12
const BARRA_GRUPO = 8
const ZONA_ESTICAR = 10
const RAIO_ALVO = 5

export type ModoGantt = 'selecionar' | 'dependencias'

export interface InfoBarra {
  /** cor de preenchimento da tarefa */
  cor: string
  /** pode mover o início (não ASAP) */
  moverInicio: boolean
  /** caminho crítico (folga nula) */
  critica: boolean
  rotulo: string
  /** modo controle: grau de execução (0…1); null fora do controle */
  grau: number | null
  /** modo controle: término previsto pela previsão */
  fimPrevisto: number | null
  /** número de equipes da tarefa (esticar o término muda as equipes, não a produtividade); null fora do motor */
  equipes: number | null
}

export interface ArrasteFim {
  tarefaId: string
  tipo: 'inicio' | 'fim'
  data: number
}

interface Props {
  linhas: LinhaGantt[]
  dados: DadosGantt
  eixo: EixoTempo
  global: Calendar | null
  infoBarra: (l: LinhaGantt) => InfoBarra
  /** tarefas que se cruzam no espaço (dependência por estacas) */
  cruzam: (a: string, b: string) => boolean
  modo: ModoGantt
  somenteLeitura: boolean
  mostrarAutomaticas: boolean
  mostrarRotulos: boolean
  mostrarNumeros: boolean
  selecionadas: ReadonlySet<string>
  depSelecionada: string | null
  /**
   * posição vertical pedida de fora (roda do mouse ou foco na grade). A linha do tempo é a dona da rolagem: aplica só
   * pedidos novos (`seq`), nunca o eco da própria posição — que chega um quadro atrasado e fazia a tela tremer.
   */
  pedidoTop: { top: number; seq: number } | null
  onScroll: (top: number, left: number) => void
  onSelecionarLinha: (l: LinhaGantt, e: { ctrl: boolean; shift: boolean }) => void
  onAbrirLinha: (l: LinhaGantt) => void
  onMenuLinha: (l: LinhaGantt, x: number, y: number) => void
  onMenuFundo: (x: number, y: number) => void
  onSelecionarDependencia: (d: DependenciaGantt | null) => void
  onAbrirDependencia: (d: DependenciaGantt) => void
  onMenuDependencia: (d: DependenciaGantt, x: number, y: number) => void
  /** comando do arraste; a promessa termina quando a prévia chegou (ou o comando não mudou nada) */
  onArrastar: (a: ArrasteFim) => Promise<void> | void
  onNovaDependencia: (pred: string, succ: string, tipo: TipoDependencia) => void
  faixas: (tarefaId: string) => Promise<TimingBands | null>
  onDica: (d: { x: number; y: number; linha: LinhaGantt } | null) => void
  /** rolar para um instante (centraliza) — muda a cada pedido */
  irPara?: { t: number; seq: number } | null
  /** modo controle: a data de controle (linha vermelha e linha de progresso) */
  dataControle: number | null
}

interface Arrasto {
  tarefaId: string
  tipo: 'inicio' | 'fim'
  x0: number
  dx: number
  esq: number
  dir: number
  y: number
  /** x do ponto que dá a data (borda esquerda ao mover, ponto clicado ao esticar) */
  alvoX: number
  faixas: TimingBands | null
  movido: boolean
  /** período da barra no início do arraste (estimativa das equipes ao esticar) */
  inicioBarra: number
  fimBarra: number
  equipes: number | null
}

interface Criacao {
  tarefaId: string
  alvo: Alvo
  p0: Ponto
  p: Ponto
  sobre: { tarefaId: string; alvo: Alvo; p: Ponto } | null
}

const larguraTexto = (s: string): number => s.length * 6.2 + 6

export function GanttLinhaTempo(p: Props): ReactNode {
  const { linhas, dados, eixo, global, modo } = p
  const ref = useRef<HTMLDivElement>(null)
  const [vista, setVista] = useState({ top: 0, left: 0, w: 800, h: 600 })
  const [arrasto, setArrasto] = useState<Arrasto | null>(null)
  /**
   * arraste solto, à espera da prévia do motor: o fantasma fica na tela até o resultado novo chegar (sem isso a barra
   * volta à posição antiga por um instante e depois salta para a nova)
   */
  const [soltando, setSoltando] = useState<Arrasto | null>(null)
  useEffect(() => {
    setSoltando(null)
  }, [dados])
  const [criacao, setCriacao] = useState<Criacao | null>(null)

  // tamanho da área e rolagem
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const medir = (): void => setVista((v) => ({ ...v, w: el.clientWidth, h: el.clientHeight }))
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el || !p.pedidoTop) return
    if (Math.abs(el.scrollTop - p.pedidoTop.top) > 1) el.scrollTop = p.pedidoTop.top
    // o navegador limita ao máximo: devolve a posição real (sem evento de rolagem quando não mudou)
    p.onScroll(el.scrollTop, el.scrollLeft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.pedidoTop?.seq])
  useEffect(() => {
    const el = ref.current
    if (!el || !p.irPara) return
    el.scrollLeft = Math.max(0, eixo.x(p.irPara.t) - el.clientWidth / 3)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.irPara?.seq])

  const largura = Math.max(eixo.largura, vista.w)
  const alturaCorpo = Math.max(linhas.length * ALTURA_LINHA, vista.h - ALTURA_CABECALHO)
  const i0 = Math.max(0, Math.floor(vista.top / ALTURA_LINHA) - 4)
  const i1 = Math.min(linhas.length - 1, Math.ceil((vista.top + vista.h) / ALTURA_LINHA) + 4)
  const x0 = vista.left - 150
  const x1 = vista.left + vista.w + 150

  // ── cabeçalho do calendário (DrawIntervals) ──
  const cabecalho = useMemo(
    () => niveisCabecalho(eixo, eixo.data(Math.max(0, x0)), eixo.data(Math.min(largura, x1))),
    [eixo, x0, x1, largura]
  )

  const naoUteis = useMemo(() => {
    if (!global) return []
    const b = eixo.data(Math.max(0, x0)),
      e = eixo.data(Math.min(largura, x1))
    return periodosNaoUteis(global, eixo, b, e)
  }, [global, eixo, x0, x1, largura])

  // ── geometria das barras ──
  const indice = useMemo(() => {
    const m = new Map<string, number>()
    linhas.forEach((l, i) => {
      if (l.tipo === 'tarefa' && l.id) m.set(l.id, i)
    })
    return m
  }, [linhas])
  const geo = useCallback(
    (i: number): { esq: number; dir: number; yc: number } | null => {
      const l = linhas[i]
      if (!l?.barra) return null
      return {
        esq: eixo.x(l.barra.inicio),
        dir: eixo.x(l.barra.fim),
        yc: i * ALTURA_LINHA + ALTURA_LINHA / 2
      }
    },
    [linhas, eixo]
  )
  const ponto = useCallback(
    (tarefaId: string, alvo: Alvo): Ponto | null => {
      const i = indice.get(tarefaId)
      if (i === undefined) return null
      const g = geo(i)
      if (!g) return null
      const x = alvo === 'inicio' ? g.esq : alvo === 'fim' ? g.dir : (g.esq + g.dir) / 2
      return { x, y: g.yc }
    },
    [indice, geo]
  )

  // ── rolagem ──
  const onScroll = (): void => {
    const el = ref.current
    if (!el) return
    setVista((v) => ({ ...v, top: el.scrollTop, left: el.scrollLeft }))
    p.onScroll(el.scrollTop, el.scrollLeft)
  }

  // coordenadas do corpo a partir do evento
  const noCorpo = (e: { clientX: number; clientY: number }): Ponto => {
    const el = ref.current!
    const r = el.getBoundingClientRect()
    return {
      x: e.clientX - r.left + el.scrollLeft,
      y: e.clientY - r.top + el.scrollTop - ALTURA_CABECALHO
    }
  }

  // ── arraste de barras (DGanttRect) ──
  const iniciarArrasto = (e: RPointerEvent, l: LinhaGantt, i: number): void => {
    if (e.button !== 0 || p.somenteLeitura || modo !== 'selecionar' || !l.barra?.tarefa || !l.id)
      return
    const g = geo(i)!
    const pt = noCorpo(e)
    const zona = Math.min(ZONA_ESTICAR, (g.dir - g.esq) * 0.5)
    const info = p.infoBarra(l)
    const esticar = pt.x > g.dir - zona
    if (!esticar && !info.moverInicio) return
    e.stopPropagation()
    p.onDica(null)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const a: Arrasto = {
      tarefaId: l.id,
      tipo: esticar ? 'fim' : 'inicio',
      x0: e.clientX,
      dx: 0,
      esq: g.esq,
      dir: g.dir,
      y: i * ALTURA_LINHA,
      alvoX: esticar ? pt.x : g.esq,
      faixas: null,
      movido: false,
      inicioBarra: l.barra.inicio,
      fimBarra: l.barra.fim,
      equipes: info.equipes
    }
    setArrasto(a)
    void p
      .faixas(l.id)
      .then((f) =>
        setArrasto((cur) => (cur && cur.tarefaId === a.tarefaId ? { ...cur, faixas: f } : cur))
      )
  }
  const alvoArrasto = (a: Arrasto): { data: number; porHora: boolean; x: number } => {
    const bruto = eixo.data(a.alvoX + a.dx)
    const s = snapData(bruto, {
      horas: cabecalho.horas,
      redimensionar: a.tipo === 'fim',
      qualquerHora: false,
      tarefa: true
    })
    return { ...s, x: eixo.x(s.data) }
  }
  const moverArrasto = (e: RPointerEvent): void => {
    if (!arrasto) return
    const dx = e.clientX - arrasto.x0
    setArrasto({ ...arrasto, dx, movido: arrasto.movido || Math.abs(dx) > 1 })
  }
  const soltarArrasto = (e: RPointerEvent): void => {
    if (!arrasto) return
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
    const a = arrasto
    setArrasto(null)
    if (!a.movido) return
    const t = alvoArrasto(a)
    setSoltando(a)
    void Promise.resolve(
      p.onArrastar({ tarefaId: a.tarefaId, tipo: a.tipo, data: t.data })
    ).finally(() => setSoltando((cur) => (cur === a ? null : cur)))
  }
  /** `fim`: equipes estimadas para o término pedido (duração ∝ 1/equipes; o motor dá o término real) */
  const equipesEstimadas = (a: Arrasto, alvo: number): number | null => {
    if (a.tipo !== 'fim' || !a.equipes || !global) return null
    const atual = global.AS2WS(a.fimBarra) - global.AS2WS(a.inicioBarra)
    const pedida = global.AS2WS(alvo) - global.AS2WS(a.inicioBarra)
    if (!(atual > 0)) return null
    if (!(pedida > 0)) return 50
    return Math.max(1, Math.min(50, Math.round((a.equipes * atual) / pedida)))
  }
  useEffect(() => {
    if (!arrasto && !criacao) return
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setArrasto(null)
        setCriacao(null)
      }
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [arrasto, criacao])

  // ── criação de dependência (DependencyCreationHelper) ──
  const validoPara = (c: Criacao, tarefaId: string, alvo: Alvo): boolean =>
    alvoValido(
      c.alvo,
      alvo,
      c.tarefaId === tarefaId,
      c.alvo === 'meio' && alvo === 'meio' ? p.cruzam(c.tarefaId, tarefaId) : true
    )
  const iniciarCriacao = (e: RPointerEvent, tarefaId: string, alvo: Alvo): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    const pt = ponto(tarefaId, alvo)
    if (!pt) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setCriacao({ tarefaId, alvo, p0: pt, p: pt, sobre: null })
  }
  const moverCriacao = (e: RPointerEvent): void => {
    if (!criacao) return
    const pt = noCorpo(e)
    let sobre: Criacao['sobre'] = null
    const i = Math.floor(pt.y / ALTURA_LINHA)
    for (const k of [i - 1, i, i + 1]) {
      const l = linhas[k]
      if (!l?.id || l.tipo !== 'tarefa' || !l.barra?.tarefa) continue
      for (const alvo of ['inicio', 'meio', 'fim'] as Alvo[]) {
        const q = ponto(l.id, alvo)
        if (
          q &&
          Math.hypot(q.x - pt.x, q.y - pt.y) <= RAIO_ALVO + 3 &&
          validoPara(criacao, l.id, alvo)
        )
          sobre = { tarefaId: l.id, alvo, p: q }
      }
    }
    setCriacao({ ...criacao, p: pt, sobre })
  }
  const soltarCriacao = (e: RPointerEvent): void => {
    if (!criacao) return
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
    const c = criacao
    setCriacao(null)
    if (c.sobre)
      p.onNovaDependencia(c.tarefaId, c.sobre.tarefaId, tipoPelosAlvos(c.alvo, c.sobre.alvo))
  }

  // ── dependências visíveis ──
  const deps = useMemo(() => {
    const out: { d: DependenciaGantt; path: string; seta: string | null }[] = []
    for (const d of dados.dependencias) {
      if (!d.usuario && !p.mostrarAutomaticas) continue
      const ia = indice.get(d.pred),
        ib = indice.get(d.succ)
      if (ia === undefined || ib === undefined) continue
      if (Math.max(ia, ib) < i0 - 2 || Math.min(ia, ib) > i1 + 2) continue
      const a = ponto(d.pred, alvoPredecessora(d.tipo)),
        b = ponto(d.succ, alvoSucessora(d.tipo))
      if (!a || !b) continue
      const t = tracarDependencia(a, b, { x0: 0, x1: largura })
      out.push({ d, path: caminhoSvg(t), seta: setaSvg(t) })
    }
    return out
  }, [dados.dependencias, indice, i0, i1, ponto, largura, p.mostrarAutomaticas])

  const hoje = useMemo(() => {
    const n = new Date()
    return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes()) / 1000
  }, [])

  // ── marcos ──
  const marcos = useMemo(
    () =>
      dados.marcos
        .map((m) => {
          const is = m.tarefas.map((t) => indice.get(t)).filter((x): x is number => x !== undefined)
          if (!is.length) return null
          const topo = Math.min(...is) * ALTURA_LINHA + 4,
            base = (Math.max(...is) + 1) * ALTURA_LINHA - 4
          return { m, topo, base }
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    [dados.marcos, indice]
  )

  // violações por tarefa (pilha por ponto)
  const violacoes = useMemo(() => {
    const out: { x: number; y: number; texto: string; n: number }[] = []
    const pilha = new Map<string, number>()
    for (const v of dados.violacoes) {
      const i = indice.get(v.tarefaId)
      if (i === undefined || i < i0 || i > i1) continue
      const pt = ponto(v.tarefaId, v.ponto)
      if (!pt) continue
      const k = `${v.tarefaId}:${v.ponto}`
      const n = pilha.get(k) ?? 0
      pilha.set(k, n + 1)
      out.push({ x: pt.x + n * 5, y: pt.y, texto: v.texto, n })
    }
    return out
  }, [dados.violacoes, indice, i0, i1, ponto])

  // `DCompletionLine::Update` [O]: por linha com barra, o x do executado; a linha fica vertical em cada linha
  const progresso = useMemo(() => {
    if (p.dataControle === null) return null
    const ctrl = p.dataControle
    const xc = eixo.x(ctrl)
    const pts: { x: number; y0: number; y1: number }[] = []
    let x = 0
    let visto = false
    linhas.forEach((l, i) => {
      if (l.barra) {
        const g = geo(i)!
        const c = p.infoBarra(l).grau
        if (c !== null) {
          visto = true
          if (c <= 1e-9) x = l.barra.inicio <= ctrl ? g.esq - 3 : xc
          else if (c >= 1 - 1e-9) x = l.barra.fim >= ctrl ? g.dir + 3 : xc
          else x = g.esq + (g.dir - g.esq) * c
        }
      }
      if (visto) pts.push({ x, y0: i * ALTURA_LINHA, y1: (i + 1) * ALTURA_LINHA })
    })
    return { xc, pts }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.dataControle, linhas, eixo, geo, p.infoBarra])

  const linhasVisiveis = linhas.slice(i0, i1 + 1)
  const fantasma = arrasto ?? soltando
  const alvoAtual = fantasma ? alvoArrasto(fantasma) : null

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="region"
      aria-label="Linha do tempo do cronograma"
      className="relative h-full w-full overflow-auto bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      onScroll={onScroll}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onMenuFundo(e.clientX, e.clientY)
      }}
    >
      <div style={{ width: largura, height: alturaCorpo + ALTURA_CABECALHO }} className="relative">
        {/* ── cabeçalho fixo ── */}
        <svg
          width={largura}
          height={ALTURA_CABECALHO}
          className="sticky top-0 z-10 block"
          style={{ background: 'var(--bg-panel)' }}
        >
          {cabecalho.grosso.map((c) => {
            // rótulo no meio da parte visível da célula (não some quando a célula começa fora da tela)
            const a = Math.max(c.x0, vista.left),
              b = Math.min(c.x1, vista.left + vista.w)
            const cabe = b - a > larguraTexto(c.rotulo)
            return (
              <g key={`g${c.de}`}>
                <line
                  x1={c.x0}
                  x2={c.x0}
                  y1={0}
                  y2={cabecalho.temFino ? ALTURA_CABECALHO / 2 : ALTURA_CABECALHO}
                  stroke="var(--border-strong)"
                />
                {cabe ? (
                  <text
                    x={(a + b) / 2}
                    y={cabecalho.temFino ? 15 : 27}
                    textAnchor="middle"
                    className="fill-[var(--text-muted)] text-[11px] font-medium"
                  >
                    {c.rotulo}
                  </text>
                ) : null}
              </g>
            )
          })}
          {cabecalho.temFino ? (
            <line
              x1={0}
              x2={largura}
              y1={ALTURA_CABECALHO / 2}
              y2={ALTURA_CABECALHO / 2}
              stroke="var(--border)"
            />
          ) : null}
          {cabecalho.fino.map((c) => (
            <g key={`f${c.de}`}>
              <line
                x1={c.x0}
                x2={c.x0}
                y1={ALTURA_CABECALHO / 2}
                y2={ALTURA_CABECALHO}
                stroke="var(--border)"
              />
              {c.x1 - c.x0 > larguraTexto(c.rotulo) ? (
                <text
                  x={(c.x0 + c.x1) / 2}
                  y={ALTURA_CABECALHO / 2 + 15}
                  textAnchor="middle"
                  className="fill-[var(--text-dim)] text-[10px] font-mono"
                >
                  {c.rotulo}
                </text>
              ) : null}
            </g>
          ))}
          <line
            x1={0}
            x2={largura}
            y1={ALTURA_CABECALHO - 0.5}
            y2={ALTURA_CABECALHO - 0.5}
            stroke="var(--border-strong)"
          />
          {hoje >= eixo.inicio && hoje <= eixo.fim ? (
            <path
              d={`M ${eixo.x(hoje) - 4} ${ALTURA_CABECALHO - 5} l 4 5 l 4 -5 z`}
              fill="var(--accent)"
            />
          ) : null}
        </svg>

        {/* ── corpo ── */}
        <svg
          width={largura}
          height={alturaCorpo}
          className={cn('block select-none', criacao && 'cursor-crosshair')}
          onPointerMove={(e) => {
            if (arrasto) moverArrasto(e)
            else if (criacao) moverCriacao(e)
          }}
          onPointerUp={(e) => {
            if (arrasto) soltarArrasto(e)
            else if (criacao) soltarCriacao(e)
          }}
          onPointerDown={(e) => {
            if (e.button === 0 && e.target === e.currentTarget) p.onSelecionarDependencia(null)
          }}
        >
          {/* sombreamento dos dias não úteis que aparecem no eixo */}
          {naoUteis.map(([a, b]) => (
            <rect
              key={a}
              x={eixo.x(a)}
              y={0}
              width={Math.max(0, eixo.x(b) - eixo.x(a))}
              height={alturaCorpo}
              fill="var(--mt-nao-trab)"
            />
          ))}
          {/* grade vertical do nível grosso */}
          {cabecalho.grosso.map((c) => (
            <line
              key={`v${c.de}`}
              x1={c.x0}
              x2={c.x0}
              y1={0}
              y2={alturaCorpo}
              stroke="var(--mt-grid-minor)"
            />
          ))}
          {/* linhas: seleção e separadores */}
          {linhasVisiveis.map((l, k) => {
            const i = i0 + k
            const sel = !!(l.id && p.selecionadas.has(l.id)) || p.selecionadas.has(l.chave)
            return (
              <g key={l.chave}>
                {sel ? (
                  <rect
                    x={0}
                    y={i * ALTURA_LINHA}
                    width={largura}
                    height={ALTURA_LINHA}
                    fill="var(--accent-glow)"
                  />
                ) : null}
                <line
                  x1={0}
                  x2={largura}
                  y1={(i + 1) * ALTURA_LINHA - 0.5}
                  y2={(i + 1) * ALTURA_LINHA - 0.5}
                  stroke="var(--mt-grid-minor)"
                  strokeOpacity={0.55}
                />
              </g>
            )
          })}
          {/* linha de hoje */}
          {hoje >= eixo.inicio && hoje <= eixo.fim ? (
            <line
              x1={eixo.x(hoje)}
              x2={eixo.x(hoje)}
              y1={0}
              y2={alturaCorpo}
              stroke="var(--accent)"
              strokeOpacity={0.55}
              strokeDasharray="3 3"
            />
          ) : null}

          {/* faixas de restrição do arraste */}
          {arrasto?.faixas ? (
            <Faixas
              f={arrasto.faixas}
              mover={arrasto.tipo === 'inicio'}
              eixo={eixo}
              altura={alturaCorpo}
              largura={largura}
            />
          ) : null}

          {/* marcos */}
          {marcos.map(({ m, topo, base }) =>
            [m.inicio, m.fim]
              .filter((t): t is number => t !== null)
              .map((t, k) => (
                <g key={`${m.id}${k}`}>
                  <line
                    x1={eixo.x(t)}
                    x2={eixo.x(t)}
                    y1={topo}
                    y2={base}
                    stroke="var(--milestone)"
                    strokeWidth={2}
                  />
                  <path
                    d={`M ${eixo.x(t)} ${topo - 6} l 5 5 l -5 5 l -5 -5 z`}
                    fill="var(--milestone)"
                  />
                  <title>{`${m.nome}: ${t === m.inicio ? 'início' : 'fim'} em ${fmtDataLonga(t)}`}</title>
                  {k === 0 && base - topo > 60 ? (
                    <text
                      transform={`translate(${eixo.x(t) - 4} ${(topo + base) / 2}) rotate(-90)`}
                      textAnchor="middle"
                      className="fill-[var(--milestone)] text-[10px] font-medium"
                    >
                      {m.nome}
                    </text>
                  ) : null}
                </g>
              ))
          )}

          {/* dependências */}
          {deps.map(({ d, path, seta }) => {
            const sel = !!d.id && d.id === p.depSelecionada
            const cor = sel ? 'var(--warn)' : d.usuario ? 'var(--text-muted)' : 'var(--text-dim)'
            return (
              <g
                key={`${d.id ?? 'a'}:${d.pred}:${d.succ}`}
                className="cursor-pointer"
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  p.onSelecionarDependencia(d)
                }}
                onDoubleClick={() => p.onAbrirDependencia(d)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  p.onSelecionarDependencia(d)
                  p.onMenuDependencia(d, e.clientX, e.clientY)
                }}
              >
                <path d={path} fill="none" stroke="transparent" strokeWidth={9} />
                <path
                  d={path}
                  fill="none"
                  stroke={cor}
                  strokeWidth={sel ? 2 : 1.25}
                  strokeDasharray={d.usuario ? undefined : '4 3'}
                />
                {seta ? <path d={seta} fill={cor} /> : null}
                <title>{`${d.usuario ? 'Dependência' : 'Dependência derivada dos serviços'}: ${d.tipo}`}</title>
              </g>
            )
          })}

          {/* barras */}
          {linhasVisiveis.map((l, k) => {
            const i = i0 + k
            if (!l.barra) return null
            const g = geo(i)!
            const info = p.infoBarra(l)
            const larg = Math.max(1, g.dir - g.esq)
            const sel = !!(l.id && p.selecionadas.has(l.id)) || p.selecionadas.has(l.chave)
            if (l.tipo !== 'tarefa' || !l.barra.tarefa) {
              const h = l.tipo === 'tarefa' ? BARRA_TAREFA : BARRA_GRUPO
              const y = g.yc - h / 2
              const forte = l.tipo === 'plano' || l.tipo === 'grupo'
              return (
                <g
                  key={l.chave}
                  onPointerDown={(e) =>
                    e.button === 0 &&
                    p.onSelecionarLinha(l, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })
                  }
                  onDoubleClick={() => p.onAbrirLinha(l)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    p.onMenuLinha(l, e.clientX, e.clientY)
                  }}
                  onPointerEnter={(e) => p.onDica({ x: e.clientX, y: e.clientY, linha: l })}
                  onPointerLeave={() => p.onDica(null)}
                >
                  {l.tipo === 'tarefa' ? (
                    <rect
                      x={g.esq}
                      y={y}
                      width={larg}
                      height={h}
                      rx={3}
                      fill={info.cor}
                      fillOpacity={0.45}
                      stroke={info.cor}
                      strokeDasharray="3 2"
                    />
                  ) : (
                    <>
                      <rect
                        x={g.esq}
                        y={y}
                        width={larg}
                        height={h - 3}
                        fill={forte ? 'var(--text-muted)' : info.cor}
                        fillOpacity={forte ? 0.9 : 0.55}
                      />
                      <path
                        d={`M ${g.esq} ${y} v ${h} l 4 -3 z M ${g.dir} ${y} v ${h} l -4 -3 z`}
                        fill={forte ? 'var(--text-muted)' : info.cor}
                        fillOpacity={forte ? 0.9 : 0.55}
                      />
                    </>
                  )}
                  {p.mostrarNumeros && l.numero ? (
                    <text
                      x={g.esq - 5}
                      y={g.yc + 3.5}
                      textAnchor="end"
                      className="fill-[var(--text-faint)] text-[9px] font-mono"
                    >
                      {l.numero}
                    </text>
                  ) : null}
                </g>
              )
            }
            const y = g.yc - BARRA_TAREFA / 2
            const zona = Math.min(ZONA_ESTICAR, larg * 0.5)
            return (
              <g
                key={l.chave}
                data-barra={l.id ?? undefined}
                className={cn(
                  !p.somenteLeitura &&
                    modo === 'selecionar' &&
                    (info.moverInicio ? 'cursor-grab' : 'cursor-default')
                )}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  p.onSelecionarLinha(l, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })
                  iniciarArrasto(e, l, i)
                }}
                onDoubleClick={() => p.onAbrirLinha(l)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  p.onMenuLinha(l, e.clientX, e.clientY)
                }}
                onPointerEnter={(e) =>
                  !arrasto && !criacao && p.onDica({ x: e.clientX, y: e.clientY, linha: l })
                }
                onPointerMove={(e) =>
                  !arrasto && !criacao && p.onDica({ x: e.clientX, y: e.clientY, linha: l })
                }
                onPointerLeave={() => p.onDica(null)}
              >
                {info.critica ? (
                  <rect
                    x={g.esq - 2}
                    y={y - 2}
                    width={larg + 4}
                    height={BARRA_TAREFA + 4}
                    rx={4}
                    fill="none"
                    stroke="var(--danger)"
                    strokeWidth={1.5}
                  />
                ) : null}
                <rect
                  x={g.esq}
                  y={y}
                  width={larg}
                  height={BARRA_TAREFA}
                  rx={larg > 6 ? 3 : 0}
                  fill={info.cor}
                />
                <rect
                  x={g.esq}
                  y={y}
                  width={larg}
                  height={BARRA_TAREFA / 2}
                  rx={larg > 6 ? 3 : 0}
                  fill="white"
                  fillOpacity={0.14}
                  pointerEvents="none"
                />
                {sel ? (
                  <rect
                    x={g.esq - 1}
                    y={y - 1}
                    width={larg + 2}
                    height={BARRA_TAREFA + 2}
                    rx={4}
                    fill="none"
                    stroke="var(--text)"
                    strokeWidth={1.25}
                  />
                ) : null}
                {info.grau !== null && info.grau > 0 ? (
                  <rect
                    x={g.esq}
                    y={g.yc - 2}
                    width={Math.max(1, larg * Math.min(1, info.grau))}
                    height={4}
                    rx={1}
                    fill="var(--bg)"
                    fillOpacity={0.75}
                    pointerEvents="none"
                  />
                ) : null}
                {info.fimPrevisto !== null && Math.abs(info.fimPrevisto - l.barra.fim) > 60 ? (
                  <g pointerEvents="none">
                    <line
                      x1={g.dir}
                      x2={eixo.x(info.fimPrevisto)}
                      y1={g.yc}
                      y2={g.yc}
                      stroke={info.fimPrevisto > l.barra.fim ? 'var(--warn)' : 'var(--success)'}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                    <path
                      d={`M ${eixo.x(info.fimPrevisto)} ${g.yc - 4} l 4 4 l -4 4 l -4 -4 z`}
                      fill={info.fimPrevisto > l.barra.fim ? 'var(--warn)' : 'var(--success)'}
                    />
                  </g>
                ) : null}
                {/* zona de esticar (cursor) */}
                {!p.somenteLeitura && modo === 'selecionar' ? (
                  <rect
                    x={g.dir - zona}
                    y={y - 2}
                    width={zona}
                    height={BARRA_TAREFA + 4}
                    fill="transparent"
                    className="cursor-ew-resize"
                  />
                ) : null}
                {p.mostrarNumeros && l.numero ? (
                  <text
                    x={g.esq - 5}
                    y={g.yc + 3.5}
                    textAnchor="end"
                    className="fill-[var(--text-faint)] text-[9px] font-mono"
                    pointerEvents="none"
                  >
                    {l.numero}
                  </text>
                ) : null}
                {p.mostrarRotulos && info.rotulo ? (
                  <text
                    x={
                      // depois do losango do término previsto, quando ele fica à direita da barra
                      (info.fimPrevisto !== null && Math.abs(info.fimPrevisto - l.barra.fim) > 60
                        ? Math.max(g.dir, eixo.x(info.fimPrevisto) + 4)
                        : g.dir) + 6
                    }
                    y={g.yc + 3.5}
                    className="fill-[var(--text-muted)] text-[11px]"
                    pointerEvents="none"
                  >
                    {info.rotulo}
                  </text>
                ) : null}
              </g>
            )
          })}

          {/* modo controle: data de controle (vermelha) e linha de progresso (`DCompletionLine`, vermelha, 2 px) */}
          {progresso ? (
            <g pointerEvents="none">
              <line
                x1={progresso.xc}
                x2={progresso.xc}
                y1={0}
                y2={alturaCorpo}
                stroke="var(--danger)"
              />
              {progresso.pts.length > 1 ? (
                <polyline
                  points={progresso.pts
                    .flatMap((q) => [`${q.x},${q.y0}`, `${q.x},${q.y1}`])
                    .join(' ')}
                  fill="none"
                  stroke="var(--danger)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
              ) : null}
            </g>
          ) : null}

          {/* bandeiras de violação */}
          {violacoes.map((v, k) => (
            <g key={k} transform={`translate(${v.x} ${v.y + v.n * 4})`}>
              <rect x={-1} y={-17} width={2} height={20} rx={1} fill="oklch(48% 0.07 60)" />
              <path d="M 1 -17 h 9 l -2 3.5 l 2 3.5 h -9 z" fill="var(--danger)" />
              <title>{v.texto}</title>
            </g>
          ))}

          {/* fantasma do arraste */}
          {fantasma && alvoAtual
            ? (() => {
                const esq = fantasma.tipo === 'inicio' ? fantasma.esq + fantasma.dx : fantasma.esq
                const dir =
                  fantasma.tipo === 'inicio'
                    ? fantasma.dir + fantasma.dx
                    : Math.max(fantasma.esq, fantasma.dir + fantasma.dx)
                const y = fantasma.y + ALTURA_LINHA / 2 - BARRA_TAREFA / 2
                const data = alvoAtual.porHora
                  ? fmtDataHora(alvoAtual.data)
                  : fmtDataLonga(alvoAtual.data - (fantasma.tipo === 'fim' ? 1 : 0))
                const n = equipesEstimadas(fantasma, alvoAtual.data)
                const rot =
                  n === null
                    ? data
                    : n === fantasma.equipes
                      ? `${data} · ${n} equipe${n === 1 ? '' : 's'} (sem mudança)`
                      : `${data} · ${fantasma.equipes} → ${n} equipe${n === 1 ? '' : 's'}`
                const w = larguraTexto(rot) + 8
                return (
                  <g pointerEvents="none">
                    <rect
                      x={esq}
                      y={y}
                      width={Math.max(1, dir - esq)}
                      height={BARRA_TAREFA}
                      rx={3}
                      fill="none"
                      stroke="var(--accent)"
                      strokeDasharray="4 2"
                      strokeWidth={1.5}
                    />
                    <line
                      x1={alvoAtual.x}
                      x2={alvoAtual.x}
                      y1={y - 10}
                      y2={y + BARRA_TAREFA + 4}
                      stroke="var(--accent)"
                    />
                    <g transform={`translate(${alvoAtual.x - w / 2} ${Math.max(2, y - 30)})`}>
                      <rect
                        width={w}
                        height={18}
                        rx={3}
                        fill="var(--bg-elevated)"
                        stroke="var(--accent-line)"
                      />
                      <text
                        x={w / 2}
                        y={12.5}
                        textAnchor="middle"
                        className="fill-[var(--text)] text-[11px] font-mono"
                      >
                        {rot}
                      </text>
                    </g>
                  </g>
                )
              })()
            : null}

          {/* alvos do modo dependências */}
          {modo === 'dependencias' && !p.somenteLeitura
            ? linhasVisiveis.map((l) => {
                if (l.tipo !== 'tarefa' || !l.id || !l.barra?.tarefa) return null
                return (['inicio', 'meio', 'fim'] as Alvo[]).map((alvo) => {
                  const q = ponto(l.id!, alvo)!
                  const valido = !criacao || validoPara(criacao, l.id!, alvo)
                  const ativo = criacao?.sobre?.tarefaId === l.id && criacao.sobre.alvo === alvo
                  return (
                    <circle
                      key={`${l.id}${alvo}`}
                      data-alvo={`${l.id}:${alvo}`}
                      cx={q.x}
                      cy={q.y}
                      r={ativo ? RAIO_ALVO + 1.5 : RAIO_ALVO}
                      fill={valido ? 'var(--success)' : 'transparent'}
                      fillOpacity={valido ? 0.3 : 0}
                      stroke={valido ? 'var(--success)' : 'var(--text-faint)'}
                      strokeOpacity={valido ? 1 : 0.5}
                      className={cn(valido && 'cursor-crosshair')}
                      onPointerDown={(e) => !criacao && iniciarCriacao(e, l.id!, alvo)}
                    >
                      <title>
                        {alvo === 'meio'
                          ? 'Arraste até o meio de outra tarefa: dependência por estacas'
                          : 'Arraste até o início ou o fim de outra tarefa'}
                      </title>
                    </circle>
                  )
                })
              })
            : null}

          {/* linha temporária da criação */}
          {criacao
            ? (() => {
                const t = tracarDependencia(criacao.p0, criacao.sobre?.p ?? criacao.p, null)
                const seta = setaSvg(t)
                return (
                  <g pointerEvents="none">
                    <path d={caminhoSvg(t)} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
                    {seta ? <path d={seta} fill="var(--accent)" /> : null}
                  </g>
                )
              })()
            : null}
        </svg>
      </div>
    </div>
  )
}

/** `DrawTimingConstraints` [O ordem; cores do InfraWork]. */
function Faixas({
  f,
  mover,
  eixo,
  altura,
  largura
}: {
  f: TimingBands
  mover: boolean
  eixo: EixoTempo
  altura: number
  largura: number
}): ReactNode {
  const x = (t: number): number => Math.max(-10, Math.min(largura + 10, eixo.x(t)))
  const faixa = (cor: string, de: number | null, ate: number | null, k: string): ReactNode => {
    const a = de === null ? 0 : x(de),
      b = ate === null ? largura : x(ate)
    return b > a ? (
      <rect
        key={k}
        x={a}
        y={0}
        width={b - a}
        height={altura}
        fill={cor}
        fillOpacity={0.13}
        pointerEvents="none"
      />
    ) : null
  }
  const duro = f.earliestStartHard ?? f.earliestStart
  const brando = f.earliestStartSoft ?? duro
  return (
    <g>
      {faixa('var(--text)', null, mover ? duro : f.currentStart, 'c')}
      {mover && duro < brando ? faixa('var(--danger)', duro, brando, 'r0') : null}
      {faixa('var(--danger)', f.latestAllowedFinish, null, 'r')}
      {f.latestTotalFinish < f.latestAllowedFinish
        ? faixa('var(--warn)', f.latestTotalFinish, f.latestAllowedFinish, 'a')
        : null}
      {f.latestFreeFinish < f.latestTotalFinish
        ? faixa('var(--success)', f.latestFreeFinish, f.latestTotalFinish, 'v')
        : null}
    </g>
  )
}
