/**
 * Tempo-caminho — a `RoadTimeView` (tempo-local) do ApeX no visual do InfraWork.
 *
 * - Estacas na horizontal (os trechos escolhidos, lado a lado, cada um com o seu estaqueamento), tempo na vertical
 *   comprimido pelo calendário de interface (fins de semana e feriados como no Gantt), com o calendário à esquerda.
 * - Cada tarefa é a "escada" dos seus trechos de trabalho (RN-042): avanço linear nas horas de trabalho do calendário
 *   da tarefa, degraus verticais onde ela para e o eixo mostra o tempo.
 * - `DWorkSiteLine`: arrastar os 50 px iniciais da linha move o início (tarefa não ASAP); os 50 px finais esticam o
 *   término; faixas de restrição durante o arraste; duplo clique abre as propriedades.
 * - Marcos com filtro de estacas (linhas horizontais no início e no fim, nas faixas do marco), dependências entre os
 *   pontos de início, meio e fim das linhas, bandeiras de violação, linha de hoje e mira com estaca e data.
 * - Modo controle: por cima do planejado, as séries realizado (pontilhada) e previsão (tracejada) das frentes do
 *   `ForecastCalculator` e a linha da data de controle (`DControlDateLine`).
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
import { Calendar } from '@apex/calendar'
import type { TimingBands } from '@apex/engine'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { CalculoCronograma } from '../../hooks/calculo'
import { useCronogramaUi } from '../../store'
import {
  calendarioInterface,
  celulas,
  DIA,
  EixoTempo,
  HORA,
  intervalos,
  PARES_NIVEIS,
  periodosNaoUteis,
  snapData
} from '../../visoes/eixo'
import {
  alvoPredecessora,
  alvoSucessora,
  alvoValido,
  caminhoSvg,
  setaSvg,
  pontoViolacaoDependencia,
  tipoPelosAlvos,
  tracarDependencia,
  type Alvo
} from '../../visoes/dependencias'
import {
  distanciaLinhas,
  ESTADIO,
  EixoEstacas,
  fechoConvexo,
  juntarLinhas,
  linhaDoPedaco,
  pedacosDaFrente,
  pedacosPlanejados,
  pontoAoLongo,
  zonaDaLinha,
  type Pedaco,
  type Ponto
} from '../../visoes/tempo-caminho'
import {
  coresServicos,
  fmtDataHora,
  fmtDataLonga,
  fmtDias,
  fmtEstaca,
  fmtEstacaCompacta,
  fmtNum,
  PALETA
} from '../../visoes/formato'
import { isoParaSeg } from '../../motor/tempo'
import type { ViolacaoTarefa } from '../../motor/calculo'
import type { TarefaEntrada, TipoDependencia } from '../../motor/tipos'
import { useMenusCronograma, type AcoesCronograma } from '../menus'
import { DicaFlutuante, type ConteudoDica } from '../DicaFlutuante'
import type { ModoGantt } from '../gantt/GanttLinhaTempo'

const ESQ = 112
const COL_FINA = 46
const TOPO_BASE = 52
const VAO = 14
const RAIO_ALVO = 5
/** largura fixa de uma área (local sem estacas) no eixo */
const LARG_AREA = 80

/** modos da visão: os do Gantt + "Dividir" (clique na estaca corta as tarefas que a cruzam) */
export type ModoTempoCaminho = ModoGantt | 'dividir'

interface LinhaTarefa {
  id: string
  t: TarefaEntrada
  linhas: Ponto[][]
  /** modo controle: séries realizado (pontilhada) e previsão (tracejada) — `DWorkSiteLine` [O] */
  realizado: Ponto[][]
  previsao: Ponto[][]
  cor: string
  moverInicio: boolean
  pontos: Record<Alvo, Ponto>
}

interface Arrasto {
  tarefaId: string
  tipo: 'inicio' | 'fim'
  y0: number
  dy: number
  /** y do ponto que dá a data (início ou fim da linha) */
  alvoY: number
  yIni: number
  yFim: number
  faixas: TimingBands | null
  movido: boolean
}

interface Criacao {
  tarefaId: string
  alvo: Alvo
  p0: Ponto
  p: Ponto
  sobre: { tarefaId: string; alvo: Alvo; p: Ponto } | null
}

interface Props {
  calc: CalculoCronograma
  modo: ModoTempoCaminho
  somenteLeitura: boolean
  acoes: AcoesCronograma
  irPara: { t: number; seq: number } | null
  /** escala efetiva (para o zoom do pai partir dela) */
  onEscala?: (e: { pxPorHora: number; pxPorMetro: number }) => void
}

const larguraTexto = (s: string): number => s.length * 6 + 4

const textoViolacao = (v: ViolacaoTarefa): string =>
  v.tipo === 'dependencia'
    ? 'Atraso máximo da dependência violado'
    : v.tipo === 'restricao'
      ? `Restrição de ${v.ponto === 'inicio' ? 'início' : 'término'} violada`
      : v.tipo === 'marco'
        ? 'Marco violado'
        : v.ponto === 'fim'
          ? 'Prazo do projeto violado'
          : 'Início do projeto violado'

export function TempoCaminhoVista({
  calc,
  modo,
  somenteLeitura,
  acoes,
  irPara,
  onEscala
}: Props): ReactNode {
  const { entrada: e, resultado: r } = calc
  const controle = r?.controle ?? null
  const ui = useCronogramaUi()
  const o = ui.tc
  const menus = useMenusCronograma(calc, somenteLeitura, acoes)
  const ref = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ w: 1200, h: 700 })
  const [vista, setVista] = useState({ top: 0, left: 0 })
  /** seleção (ctrl+clique acrescenta: combinar/remover várias) */
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [verFora, setVerFora] = useState(false)
  const [arrasto, setArrasto] = useState<Arrasto | null>(null)
  // arraste solto à espera da prévia do motor: o fantasma fica até as linhas novas chegarem (sem "volta e salta")
  const [soltando, setSoltando] = useState<Arrasto | null>(null)
  const [criacao, setCriacao] = useState<Criacao | null>(null)
  const [mira, setMira] = useState<Ponto | null>(null)
  const [cursor, setCursor] = useState('')
  const [dica, setDica] = useState<{ x: number; y: number; conteudo: ConteudoDica } | null>(null)
  const [hoje] = useState(() => Date.now() / 1000 - new Date().getTimezoneOffset() * 60)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const medir = (): void => setArea({ w: el.clientWidth, h: el.clientHeight })
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── locais e eixo das estacas: eixos lado a lado e, à direita, as áreas como colunas estreitas (0…1) ──
  const trechos = useMemo(() => {
    if (!e || !r) return []
    const comTarefas = new Set<string>()
    for (const t of r.tarefas.values())
      for (const w of t.wps) if (w.trecho_id) comTarefas.add(w.trecho_id)
    const locais = e.trechos.filter((t) => t.tipo === 'eixo' || o.areas)
    const escolhidos =
      o.trechos?.filter((id) => locais.some((t) => t.id === id)) ??
      locais.filter((t) => comTarefas.has(t.id)).map((t) => t.id)
    const tipoDe = (id: string): string => e.trechos.find((t) => t.id === id)?.tipo ?? 'eixo'
    const ordenados = [
      ...escolhidos.filter((id) => tipoDe(id) === 'eixo'),
      ...escolhidos.filter((id) => tipoDe(id) === 'area')
    ]
    return ordenados.map((id) => {
      const tr = e.trechos.find((t) => t.id === id)!
      if (tr.tipo === 'area') return { tr, ini: 0, fim: 1, area: true }
      let fim = Number(tr.comprimento_m) || 0
      for (const t of r.tarefas.values())
        for (const w of t.wps) if (w.trecho_id === id) fim = Math.max(fim, w.fim_m)
      return { tr, ini: 0, fim: Math.max(1, fim), area: false }
    })
  }, [e, r, o.trechos, o.areas])
  const areasIds = useMemo(
    () => new Set(trechos.filter((t) => t.area).map((t) => t.tr.id)),
    [trechos]
  )
  const nAreas = areasIds.size
  const totalMetros = trechos.filter((t) => !t.area).reduce((s, t) => s + (t.fim - t.ini), 0)
  const larguraUtil = Math.max(
    200,
    area.w - ESQ - 16 - VAO * Math.max(0, trechos.length - 1) - nAreas * LARG_AREA
  )
  const pxPorMetro = ui.tcZoom.pxPorMetro ?? (totalMetros > 0 ? larguraUtil / totalMetros : 1)
  const eixoE = useMemo(() => {
    const out: { id: string; ini: number; fim: number; x0: number; x1: number }[] = []
    for (const [i, t] of trechos.entries()) {
      const x0 = i ? out[i - 1]!.x1 + VAO : 0
      const larg = t.area ? LARG_AREA : (t.fim - t.ini) * pxPorMetro
      out.push({ id: t.tr.id, ini: t.ini, fim: t.fim, x0, x1: x0 + larg })
    }
    return new EixoEstacas(out)
  }, [trechos, pxPorMetro])

  const topo = TOPO_BASE

  // ── eixo do tempo ──
  const specPadrao = r ? r.calendarios[r.calendarioPadraoId] : undefined
  const global = useMemo(() => (specPadrao ? new Calendar(specPadrao) : null), [specPadrao])
  const calUi = useMemo(
    () => (specPadrao ? calendarioInterface(specPadrao, o.fimDeSemana, o.feriados, true) : null),
    [specPadrao, o.fimDeSemana, o.feriados]
  )
  const periodo = useMemo(() => {
    if (!e || !r) return null
    const visiveis = new Set(trechos.map((t) => t.tr.id))
    let b = Infinity,
      f = -Infinity
    for (const t of r.tarefas.values())
      for (const w of t.wps) {
        if (!w.trecho_id || !visiveis.has(w.trecho_id)) continue
        b = Math.min(b, w.inicio)
        f = Math.max(f, w.fim)
      }
    // `GetDateSpan(…, forecast)` [O]: em controle, também a previsão (lugares das frentes) e a data de controle, no
    // início e no fim; sem tarefas, o início e o prazo do projeto; margem trunc(0,1·dias) entre 1 e 100 dias
    const ctl = r.controle
    if (ctl) {
      for (const c of Object.values(ctl.tarefas))
        for (const fr of c.frentes)
          for (const l of fr.lugares) {
            if (!l.trecho_id || !visiveis.has(l.trecho_id)) continue
            b = Math.min(b, l.inicio)
            f = Math.max(f, l.fim)
          }
      b = Math.min(b, ctl.data)
      f = Math.max(f, ctl.data)
    }
    if (!(b <= f)) {
      b = isoParaSeg(e.plano.inicio)
      f = e.plano.prazo ? isoParaSeg(e.plano.prazo) : b + 180 * DIA
      if (f < b) f = b
    }
    const folga = Math.min(100, Math.max(1, Math.trunc(((f - b) / DIA) * 0.1)))
    return { b: Math.floor(b / DIA - folga) * DIA, f: Math.ceil(f / DIA + folga) * DIA }
  }, [e, r, trechos])
  const alturaUtil = Math.max(200, area.h - topo - 8)
  const eixoT = useMemo(() => {
    if (!calUi || !periodo) return null
    const horas = (calUi.AS2WS(periodo.f) - calUi.AS2WS(periodo.b)) / HORA
    const px = ui.tcZoom.pxPorHora ?? (horas > 0 ? alturaUtil / horas : 1)
    return new EixoTempo(calUi, periodo.b, periodo.f, Math.max(0.002, Math.min(200, px)))
  }, [calUi, periodo, ui.tcZoom.pxPorHora, alturaUtil])
  useEffect(() => {
    if (eixoT) onEscala?.({ pxPorHora: eixoT.pxPorHora, pxPorMetro })
  }, [eixoT, pxPorMetro, onEscala])
  useEffect(() => {
    const el = ref.current
    if (!el || !irPara || !eixoT) return
    el.scrollTop = Math.max(0, eixoT.x(irPara.t) - el.clientHeight / 3)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irPara?.seq])

  // ── linhas das tarefas (a escada) ──
  const cores = useMemo(() => coresServicos(e?.servicos ?? []), [e])
  const calendarios = useMemo(() => {
    const m = new Map<string, Calendar>()
    for (const [id, s] of Object.entries(r?.calendarios ?? {})) m.set(id, new Calendar(s))
    return m
  }, [r])
  const linhas = useMemo((): LinhaTarefa[] => {
    if (!e || !r || !eixoT) return []
    const porId = new Map(e.tarefas.map((t) => [t.id, t]))
    // área: cada tarefa é uma barra vertical (início → fim) na coluna da área, lado a lado na ordem de início
    const vagas = new Map<string, Map<string, number>>()
    for (const id of areasIds) {
      const ts = [...r.tarefas.values()]
        .filter((x) => x.wps.some((w) => w.trecho_id === id))
        .sort((a, b) => a.inicio - b.inicio)
        .map((x) => x.id)
      vagas.set(id, new Map(ts.map((tid, k) => [tid, (k + 1) / (ts.length + 1)])))
    }
    const linhaArea = (tarefaId: string, p: Pedaco): Ponto[][] => {
      const col = eixoE.porId.get(p.trecho)
      const f = vagas.get(p.trecho)?.get(tarefaId) ?? 0.5
      if (!col) return []
      const x = col.x0 + (col.x1 - col.x0) * f
      return [
        [
          { x, y: eixoT.x(Math.min(p.tA, p.tB)) },
          { x, y: eixoT.x(Math.max(p.tA, p.tB)) }
        ]
      ]
    }
    const desenhar = (cal: Calendar, tarefaId: string, p: Pedaco): Ponto[][] =>
      areasIds.has(p.trecho) ? linhaArea(tarefaId, p) : linhaDoPedaco(cal, eixoT, eixoE, p)
    const out: LinhaTarefa[] = []
    for (const res of r.tarefas.values()) {
      const t = porId.get(res.id)
      if (!t) continue
      const cal = calendarios.get(res.calendario_id) ?? global
      if (!cal) continue
      const pcs = pedacosPlanejados(res, t.sentido !== 'decrescente').filter((p) =>
        eixoE.porId.has(p.trecho)
      )
      const ls = juntarLinhas(pcs.flatMap((p) => desenhar(cal, res.id, p)))
      if (!ls.length) continue
      const plano = ls.flat()
      const realizado: Ponto[][] = []
      const previsao: Ponto[][] = []
      const naVista = (p: { trecho: string }): boolean => eixoE.porId.has(p.trecho)
      for (const f of r.controle?.tarefas[res.id]?.frentes ?? []) {
        realizado.push(
          ...pedacosDaFrente(f, true)
            .filter(naVista)
            .flatMap((p) => desenhar(cal, res.id, p))
        )
        previsao.push(
          ...juntarLinhas(
            pedacosDaFrente(f, false)
              .filter(naVista)
              .flatMap((p) => desenhar(cal, res.id, p))
          )
        )
      }
      out.push({
        id: res.id,
        t,
        linhas: ls,
        realizado,
        previsao,
        cor:
          t.exib?.aparencia?.cor ||
          (t.servico_id ? cores.get(t.servico_id) : undefined) ||
          'var(--text-muted)',
        moverInicio: !t.asap,
        pontos: {
          inicio: ls[0]![0]!,
          fim: ls[ls.length - 1]![ls[ls.length - 1]!.length - 1]!,
          meio: pontoAoLongo(plano, 0.5)?.p ?? ls[0]![0]!
        }
      })
    }
    return out
  }, [e, r, eixoT, eixoE, calendarios, global, cores, areasIds])
  const porTarefa = useMemo(() => new Map(linhas.map((l) => [l.id, l])), [linhas])
  useEffect(() => {
    setSoltando(null)
  }, [linhas])

  // ── áreas das tarefas-resumo (`SHOW_SUM_TASK_AREAS`): fecho convexo das linhas das tarefas de cada grupo ──
  const fechos = useMemo(() => {
    if (!e || !o.areasResumo) return []
    const porId = new Map(e.tarefas.map((t) => [t.id, t]))
    const pontosDe = new Map<string, Ponto[]>()
    for (const l of linhas) {
      const pts = l.linhas.flat()
      for (let g = l.t.parent_id; g; g = porId.get(g)?.parent_id ?? null) {
        if (porId.get(g)?.tipo_no !== 'grupo') break
        pontosDe.set(g, [...(pontosDe.get(g) ?? []), ...pts])
      }
    }
    const out: { id: string; nome: string; pts: Ponto[]; cor: string; cx: number; cy: number }[] =
      []
    let k = 0
    for (const [gid, pts] of pontosDe) {
      let h = fechoConvexo(pts)
      // `DSumTaskArea` [O]: sem envoltória com área (linha reta, um ponto), o retângulo dos pontos (mínimo 4 px)
      if (h.length < 3) {
        if (!pts.length) continue
        const xs = pts.map((p) => p.x),
          ys = pts.map((p) => p.y)
        const x0 = Math.min(...xs) - 2,
          x1 = Math.max(...xs) + 2,
          y0 = Math.min(...ys) - 2,
          y1 = Math.max(...ys) + 2
        h = [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 }
        ]
      }
      out.push({
        id: gid,
        nome: porId.get(gid)?.nome ?? '',
        pts: h,
        cor: PALETA[k++ % PALETA.length]!,
        cx: h.reduce((s, p) => s + p.x, 0) / h.length,
        cy: h.reduce((s, p) => s + p.y, 0) / h.length
      })
    }
    return out
  }, [e, linhas, o.areasResumo])

  // ── tarefas fora da visão: sem local, ou com locais só em trechos/áreas que não estão na seleção ──
  const foraDaVista = useMemo(() => {
    if (!e) return []
    const mostrados = new Set(trechos.map((t) => t.tr.id))
    return e.tarefas
      .filter(
        (t) => t.tipo_no === 'tarefa' && !t.is_indireto && t.servico_id && !porTarefa.has(t.id)
      )
      .map((t) => {
        const ids = [...new Set(t.locais.map((l) => l.trecho_id).filter((x): x is string => !!x))]
        const ocultos = ids.filter((id) => !mostrados.has(id))
        return {
          t,
          ocultos,
          motivo:
            ids.length === 0
              ? 'sem local'
              : ocultos.length
                ? `local fora da seleção: ${ocultos.map((id) => e.trechos.find((x) => x.id === id)?.nome ?? '?').join(', ')}`
                : 'sem resultado do cálculo'
        }
      })
  }, [e, trechos, porTarefa])

  // ── cabeçalhos ──
  const W = Math.max(eixoE.largura, 10)
  const H = eixoT ? Math.max(eixoT.largura, 10) : 10
  const y0 = vista.top - 100,
    y1 = vista.top + area.h + 100
  const tempo = useMemo(() => {
    if (!eixoT) return { fino: [], grosso: [], horas: false, temFino: false }
    const b = eixoT.data(Math.max(0, y0)),
      f = eixoT.data(Math.min(H, y1))
    const ivs = intervalos(eixoT.calendario)
    const px = (t: number): number => eixoT.x(t)
    const cabeFino = (i: number): boolean =>
      celulas(ivs[i]!, b, f, px, () => 13, true).cabe &&
      celulas(ivs[i]!, b, f, px, () => 0, false).celulas.every(
        (c) => larguraTexto(c.rotulo) <= COL_FINA
      )
    const cabeGrosso = (i: number): boolean => celulas(ivs[i]!, b, f, px, () => 13, true).cabe
    let escolha: { fino: number | null; grosso: number | null } = { fino: null, grosso: null }
    for (const [fi, gr] of PARES_NIVEIS) {
      if ((fi === 10 || cabeFino(fi)) && (gr === 10 || cabeGrosso(gr))) {
        escolha = { fino: fi === 10 ? null : fi, grosso: gr === 10 ? null : gr }
        break
      }
    }
    return {
      fino:
        escolha.fino === null ? [] : celulas(ivs[escolha.fino]!, b, f, px, () => 0, false).celulas,
      grosso:
        escolha.grosso === null
          ? []
          : celulas(ivs[escolha.grosso]!, b, f, px, () => 0, false).celulas,
      horas: escolha.fino === 0,
      temFino: escolha.fino !== null
    }
  }, [eixoT, y0, y1, H])
  const naoUteis = useMemo(() => {
    if (!global || !eixoT) return []
    return periodosNaoUteis(global, eixoT, eixoT.data(Math.max(0, y0)), eixoT.data(Math.min(H, y1)))
  }, [global, eixoT, y0, y1, H])
  const marcasEstacas = useMemo(() => {
    const out: { x: number; rotulo: string; ancora: 'start' | 'middle' | 'end' }[] = []
    for (const t of eixoE.trechos) {
      if (areasIds.has(t.id)) continue
      const tr = e?.trechos.find((x) => x.id === t.id)
      const passos = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]
      const passo = passos.find((p) => p * pxPorMetro >= 72) ?? 100000
      for (let m = Math.ceil(t.ini / passo) * passo; m <= t.fim + 1e-6; m += passo) {
        const x = eixoE.x(t.id, m)!
        // nas pontas do trecho o rótulo encosta para dentro (não invade o vizinho nem some na borda)
        const ancora = x - t.x0 < 30 ? 'start' : t.x1 - x < 30 ? 'end' : 'middle'
        out.push({ x, rotulo: fmtEstacaCompacta(m, tr), ancora })
      }
    }
    return out
  }, [eixoE, e, pxPorMetro, areasIds])

  // ── marcos (só com filtro de estacas, como no ApeX) ──
  const marcos = useMemo(() => {
    if (!e || !eixoT || !o.marcos) return []
    const out: { id: string; nome: string; y: number; x0: number; x1: number; t: number }[] = []
    for (const m of e.marcos) {
      if (!m.filtro_estacas) continue
      for (const tIso of [m.inicio, m.fim]) {
        if (!tIso) continue
        const t = isoParaSeg(tIso)
        for (const f of m.faixas) {
          for (const [a, b] of eixoE.pedacos(f.trecho_id, f.inicio_m, f.fim_m)) {
            const xa = eixoE.x(f.trecho_id, Math.min(a, b))!,
              xb = eixoE.x(f.trecho_id, Math.max(a, b))!
            out.push({ id: m.id, nome: m.nome, y: eixoT.x(t), x0: xa, x1: xb, t })
          }
        }
      }
    }
    return out
  }, [e, eixoT, eixoE, o.marcos])

  // ── dependências e violações ──
  const deps = useMemo(() => {
    if (!e || !o.dependencias) return []
    const out: {
      chave: string
      id: string | null
      pred: string
      succ: string
      tipo: TarefaEntrada['sentido'] | string
      usuario: boolean
      path: string
      seta: string | null
    }[] = []
    const add = (
      id: string | null,
      pred: string,
      succ: string,
      tipo: Parameters<typeof alvoPredecessora>[0],
      usuario: boolean
    ): void => {
      const a = porTarefa.get(pred),
        b = porTarefa.get(succ)
      if (!a || !b) return
      const tr = tracarDependencia(
        a.pontos[alvoPredecessora(tipo)],
        b.pontos[alvoSucessora(tipo)],
        null
      )
      out.push({
        chave: `${id ?? 'a'}:${pred}:${succ}`,
        id,
        pred,
        succ,
        tipo,
        usuario,
        path: caminhoSvg(tr),
        seta: setaSvg(tr)
      })
    }
    for (const d of e.dependencias) add(d.id, d.predecessora_id, d.sucessora_id, d.tipo, true)
    if (o.automaticas)
      for (const d of r?.automaticas ?? [])
        add(
          null,
          d.predecessora_id,
          d.sucessora_id,
          ({ 0: 'FF', 1: 'SF', 2: 'FS', 3: 'SS', 4: 'EST' } as const)[d.tipo as 0] ?? 'EST',
          false
        )
    return out
  }, [e, r, porTarefa, o.dependencias, o.automaticas])
  const violacoes = useMemo(() => {
    // `violationPoint` [O]: dependência FF/SF no fim do sucessor, as outras no início; empilhadas por (tarefa, ponto)
    const out: { x: number; y: number; texto: string; k: number }[] = []
    for (const l of linhas) {
      const pilha = new Map<string, number>()
      for (const v of r?.tarefas.get(l.id)?.violacoes ?? []) {
        const ponto =
          v.tipo === 'dependencia'
            ? pontoViolacaoDependencia(
                v.dependencia_predecessora,
                l.id,
                e?.dependencias ?? [],
                r?.automaticas ?? []
              )
            : v.ponto
        const n = pilha.get(ponto) ?? 0
        pilha.set(ponto, n + 1)
        const p = l.pontos[ponto]
        out.push({ x: p.x + n * 5, y: p.y, texto: textoViolacao(v), k: n })
      }
    }
    return out
  }, [linhas, r, e])

  // ── interação ──
  const noPlot = (ev: { clientX: number; clientY: number }): Ponto => {
    const el = ref.current!
    const b = el.getBoundingClientRect()
    return {
      x: ev.clientX - b.left + el.scrollLeft - ESQ,
      y: ev.clientY - b.top + el.scrollTop - topo
    }
  }
  /** rótulo do lugar sob o x: a estaca do eixo, ou o nome da área */
  const rotuloLugar = (x: number): string => {
    const est = eixoE.estaca(x)
    if (!est) return ''
    const tr = e?.trechos.find((t) => t.id === est.trecho)
    return areasIds.has(est.trecho) ? `Área ${tr?.nome ?? ''}` : fmtEstaca(est.st, tr)
  }
  /** modo Dividir: as tarefas que cruzam a estaca sob o ponto vão para o diálogo de divisão */
  const dividirEm = (p: Ponto): void => {
    const est = eixoE.estaca(p.x)
    if (!est || areasIds.has(est.trecho) || !r) {
      toast.info('Clique sobre um eixo, na estaca do corte.')
      return
    }
    const ids = [...r.tarefas.values()]
      .filter((res) =>
        res.wps.some(
          (w) => w.trecho_id === est.trecho && w.inicio_m < est.st - 0.5 && w.fim_m > est.st + 0.5
        )
      )
      .map((res) => res.id)
    if (!ids.length) {
      toast.info('Nenhuma tarefa cruza essa estaca.')
      return
    }
    acoes.dividirEstaca({ tarefaIds: ids, trechoId: est.trecho, estacaM: Math.round(est.st) })
  }
  const linhaSob = useCallback(
    (p: Ponto): { l: LinhaTarefa; d: number } | null => {
      let melhor: { l: LinhaTarefa; d: number } | null = null
      for (const l of linhas) {
        // `HitTest` [O]: < 5 px de cada polilinha separada (a lacuna entre pedaços não conta), incluindo as séries
        // do controle
        const d = distanciaLinhas(p, [...l.linhas, ...l.realizado, ...l.previsao])
        if (d < ESTADIO.raio && (!melhor || d < melhor.d)) melhor = { l, d }
      }
      return melhor
    },
    [linhas]
  )
  const conteudoDica = (l: LinhaTarefa, p: Ponto): ConteudoDica => {
    const res = r?.tarefas.get(l.id)
    const s = l.t.servico_id ? e?.servicos.find((x) => x.id === l.t.servico_id) : undefined
    const est = eixoE.estaca(p.x)
    const tr = est ? e?.trechos.find((x) => x.id === est.trecho) : undefined
    const linhasD: [string, string][] = []
    if (s) linhasD.push(['Serviço', `${s.codigo} ${s.nome}`])
    if (l.t.quantidade)
      linhasD.push(['Quantidade', `${fmtNum(l.t.quantidade, 'auto')} ${s?.unidade ?? ''}`])
    if (res) {
      linhasD.push(['Período', `${fmtDataHora(res.inicio)} → ${fmtDataHora(res.fim)}`])
      linhasD.push(['Duração', fmtDias(res.duracao_dias_uteis)])
    }
    if (est && eixoT)
      linhasD.push([
        'Aqui',
        `${areasIds.has(est.trecho) ? `Área ${tr?.nome ?? ''}` : fmtEstaca(est.st, tr)} · ${fmtDataLonga(eixoT.data(p.y))}`
      ])
    const ls = [...l.t.locais].filter((x) => x.trecho_id).sort((a, b) => a.ordem - b.ordem)
    ls.forEach((x, k) => {
      const trl = e?.trechos.find((y) => y.id === x.trecho_id)
      const faixa =
        trl?.tipo === 'area' || x.inicio_m === null || x.fim_m === null
          ? 'área inteira'
          : `${fmtEstacaCompacta(x.inicio_m, trl)} – ${fmtEstacaCompacta(x.fim_m, trl)}`
      linhasD.push([
        ls.length > 1 ? `Local ${k + 1}` : 'Local',
        `${trl?.nome ?? ''} · ${faixa} · ${fmtNum(x.quantidade, 'auto')}${x.qtd_origem === 'trecho' ? ' (do template)' : ''}`
      ])
    })
    linhasD.push([
      'Sentido',
      l.t.sentido === 'decrescente' ? 'estacas decrescentes' : 'estacas crescentes'
    ])
    const ctl = r?.controle?.tarefas[l.id]
    if (ctl) {
      const un = s?.unidade ?? ''
      linhasD.push([
        'Executado',
        `${fmtNum(ctl.realizado, 'auto')} ${un} (${fmtNum(ctl.grau * 100, 0)} %)`
      ])
      if (ctl.taxa_real) linhasD.push(['Taxa real', `${fmtNum(ctl.taxa_real, 'auto')} ${un}/dia`])
      if (ctl.concluida) linhasD.push(['Situação', 'concluída'])
      else if (ctl.fim_previsto && res) {
        const atraso = (ctl.fim_previsto - res.fim) / DIA
        const txt =
          Math.abs(atraso) >= 0.5 ? ` (${atraso > 0 ? '+' : ''}${fmtNum(atraso, 0)} d)` : ''
        linhasD.push(['Previsão', `${fmtDataHora(ctl.fim_previsto)}${txt}`])
      }
    }
    return { titulo: l.t.nome, linhas: linhasD, avisos: (res?.violacoes ?? []).map(textoViolacao) }
  }

  const iniciar = (ev: RPointerEvent<SVGSVGElement>): void => {
    if (ev.button !== 0 || !eixoT) return
    const p = noPlot(ev)
    if (modo === 'dividir') {
      if (!somenteLeitura) dividirEm(p)
      return
    }
    const hit = linhaSob(p)
    if (hit && (ev.ctrlKey || ev.metaKey)) {
      setSel((s) => {
        const n = new Set(s)
        if (n.has(hit.l.id)) n.delete(hit.l.id)
        else n.add(hit.l.id)
        return n
      })
      return
    }
    setSel(hit ? new Set([hit.l.id]) : new Set())
    if (!hit || somenteLeitura || modo !== 'selecionar') return
    const z = zonaDaLinha(p, hit.l.linhas)
    if (!z) return
    const mover = z.inicio && hit.l.moverInicio
    if (!mover && !z.fim) return
    setDica(null)
    ev.currentTarget.setPointerCapture(ev.pointerId)
    const a: Arrasto = {
      tarefaId: hit.l.id,
      tipo: mover ? 'inicio' : 'fim',
      y0: ev.clientY,
      dy: 0,
      alvoY: mover ? hit.l.pontos.inicio.y : hit.l.pontos.fim.y,
      yIni: hit.l.pontos.inicio.y,
      yFim: hit.l.pontos.fim.y,
      faixas: null,
      movido: false
    }
    setArrasto(a)
    void calc
      .faixas(hit.l.id)
      .then((f) =>
        setArrasto((cur) => (cur && cur.tarefaId === a.tarefaId ? { ...cur, faixas: f } : cur))
      )
  }
  const alvoArrasto = (a: Arrasto): { data: number; porHora: boolean; y: number } | null => {
    if (!eixoT) return null
    const s = snapData(eixoT.data(a.alvoY + a.dy), {
      horas: tempo.horas,
      redimensionar: a.tipo === 'fim',
      qualquerHora: false,
      tarefa: true
    })
    return { ...s, y: eixoT.x(s.data) }
  }
  const mover = (ev: RPointerEvent<SVGSVGElement>): void => {
    const p = noPlot(ev)
    if (arrasto) {
      const dy = ev.clientY - arrasto.y0
      setArrasto({ ...arrasto, dy, movido: arrasto.movido || Math.abs(dy) > 1 })
      return
    }
    if (criacao) {
      let sobre: Criacao['sobre'] = null
      for (const l of linhas)
        for (const alvo of ['inicio', 'meio', 'fim'] as Alvo[]) {
          const q = l.pontos[alvo]
          if (Math.hypot(q.x - p.x, q.y - p.y) <= RAIO_ALVO + 3 && valido(criacao, l.id, alvo))
            sobre = { tarefaId: l.id, alvo, p: q }
        }
      setCriacao({ ...criacao, p, sobre })
      return
    }
    setMira(p)
    const hit = linhaSob(p)
    setDica(hit ? { x: ev.clientX, y: ev.clientY, conteudo: conteudoDica(hit.l, p) } : null)
    // `RoadTimeView::OnMouseMove` [O]: cursor pela zona — mover, esticar, ou "proibido" no início de tarefa ASAP
    let c = ''
    if (hit && !somenteLeitura && modo === 'selecionar') {
      const z = zonaDaLinha(p, hit.l.linhas)
      if (z?.inicio && hit.l.moverInicio) c = 'move'
      else if (z?.fim) c = 'ns-resize'
      else if (z?.inicio) c = 'not-allowed'
      else c = 'pointer'
    }
    setCursor(c)
  }
  const soltar = (ev: RPointerEvent<SVGSVGElement>): void => {
    if (arrasto) {
      ev.currentTarget.releasePointerCapture?.(ev.pointerId)
      const a = arrasto
      setArrasto(null)
      const alvo = alvoArrasto(a)
      if (!a.movido || !alvo) return
      setSoltando(a)
      void menus
        .executar(
          a.tipo === 'inicio'
            ? { tipo: 'inicio', tarefaId: a.tarefaId, em: alvo.data }
            : { tipo: 'fim', tarefaId: a.tarefaId, em: alvo.data }
        )
        .finally(() => setSoltando((cur) => (cur === a ? null : cur)))
      return
    }
    if (criacao) {
      ev.currentTarget.releasePointerCapture?.(ev.pointerId)
      const c = criacao
      setCriacao(null)
      if (c.sobre)
        acoes.abrirDependencia({
          id: null,
          pred: c.tarefaId,
          succ: c.sobre.tarefaId,
          tipo: tipoPelosAlvos(c.alvo, c.sobre.alvo)
        })
    }
  }
  const cruzam = (a: string, b: string): boolean => {
    const wa = r?.tarefas.get(a)?.wps ?? [],
      wb = r?.tarefas.get(b)?.wps ?? []
    return wa.some((x) =>
      wb.some(
        (y) =>
          x.trecho_id && x.trecho_id === y.trecho_id && x.inicio_m < y.fim_m && y.inicio_m < x.fim_m
      )
    )
  }
  const valido = (c: Criacao, id: string, alvo: Alvo): boolean =>
    alvoValido(
      c.alvo,
      alvo,
      c.tarefaId === id,
      c.alvo === 'meio' && alvo === 'meio' ? cruzam(c.tarefaId, id) : true
    )

  useEffect(() => {
    if (!arrasto && !criacao) return
    const esc = (k: KeyboardEvent): void => {
      if (k.key === 'Escape') {
        setArrasto(null)
        setCriacao(null)
      }
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [arrasto, criacao])
  useEffect(() => {
    const tecla = (k: KeyboardEvent): void => {
      if (somenteLeitura || k.key !== 'Delete' || !sel.size) return
      if ((k.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
      void menus.remover([...sel])
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [sel, somenteLeitura, menus])

  if (!e) return null
  const painelFora =
    foraDaVista.length > 0 ? (
      <div className="pointer-events-none absolute bottom-3 right-4 z-40 flex flex-col items-end gap-1">
        {verFora ? (
          <div className="pointer-events-auto max-h-64 w-[380px] overflow-auto rounded-md border border-border-strong bg-bg-elevated p-2 text-xs shadow-xl">
            <div className="mb-1 text-2xs font-mono uppercase tracking-wider text-text-dim">
              Fora da visão
            </div>
            {foraDaVista.map(({ t, motivo, ocultos }) => (
              <div
                key={t.id}
                className="flex items-center gap-2 border-t border-border py-1 first:border-t-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-text">{t.nome}</div>
                  <div className="truncate text-2xs text-text-dim">{motivo}</div>
                </div>
                {ocultos.length ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      ui.setTc({ trechos: [...trechos.map((x) => x.tr.id), ...ocultos] })
                    }
                  >
                    Mostrar
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => acoes.abrirTarefa(t.id)}>
                    Definir local…
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className="pointer-events-auto rounded-full border border-warn/40 bg-warn/10 px-2.5 py-0.5 text-2xs font-mono text-warn shadow hover:bg-warn/20"
          onClick={() => setVerFora((v) => !v)}
          title="Tarefas sem local ou com locais fora dos trechos escolhidos"
        >
          {foraDaVista.length} {foraDaVista.length === 1 ? 'tarefa' : 'tarefas'} fora da visão
        </button>
      </div>
    ) : null
  if (!trechos.length)
    return (
      <div className="relative h-full w-full">
        <div className="flex h-full items-center justify-center p-6 text-center text-xs text-text-dim">
          Nenhuma tarefa com local num trecho. Crie as tarefas a partir das quantidades por local
          (Criar tarefas), defina os locais (Propriedades › Locais) ou escolha os trechos em Exibir.
        </div>
        {painelFora}
      </div>
    )
  if (!eixoT) return null

  const fantasma = arrasto ?? soltando
  const alvoAtual = fantasma ? alvoArrasto(fantasma) : null
  const estMira = mira ? eixoE.estaca(mira.x) : null
  const dividindo = modo === 'dividir' && !somenteLeitura

  return (
    <div data-density="compact" className="relative h-full w-full">
      <div
        ref={ref}
        className="relative h-full w-full overflow-auto bg-bg"
        onScroll={(ev) =>
          setVista({
            top: (ev.currentTarget as HTMLDivElement).scrollTop,
            left: (ev.currentTarget as HTMLDivElement).scrollLeft
          })
        }
      >
        <div style={{ width: ESQ + W + 16, height: topo + H + 8 }} className="relative">
          {/* faixa de cima: canto + eixo das estacas (+ a faixa de quantidades por estaca) */}
          <div className="sticky top-0 z-20 flex" style={{ height: topo }}>
            <div
              className="sticky left-0 z-30 flex shrink-0 items-end border-b border-r border-border-strong bg-bg-panel px-2 pb-1 text-2xs font-mono uppercase tracking-wider text-text-dim"
              style={{ width: ESQ }}
            >
              Tempo × caminho
            </div>
            <svg
              width={W + 16}
              height={topo}
              className="block shrink-0"
              style={{ background: 'var(--bg-panel)' }}
            >
              {eixoE.trechos.map((t) => {
                const tr = e.trechos.find((x) => x.id === t.id)
                const cor = tr?.exib?.cor ?? 'var(--accent)'
                const ehArea = areasIds.has(t.id)
                const nome = ehArea ? `Área ${tr?.nome ?? ''}` : (tr?.nome ?? '')
                const larg = t.x1 - t.x0
                const vis0 = Math.max(t.x0, vista.left),
                  vis1 = Math.min(t.x1, vista.left + area.w - ESQ)
                return (
                  <g key={t.id}>
                    <rect x={t.x0} y={0} width={larg} height={20} fill={cor} fillOpacity={0.12} />
                    <rect x={t.x0} y={18} width={larg} height={2} fill={cor} />
                    {vis1 - vis0 > larguraTexto(nome) || ehArea ? (
                      <text
                        x={(vis0 + vis1) / 2}
                        y={13}
                        textAnchor="middle"
                        className={cn('font-medium', ehArea ? 'text-[9.5px]' : 'text-[11px]')}
                        fill="var(--text)"
                      >
                        {ehArea && larguraTexto(nome) > larg ? (tr?.nome ?? '').slice(0, 12) : nome}
                      </text>
                    ) : null}
                    {ehArea ? (
                      <text
                        x={(t.x0 + t.x1) / 2}
                        y={topo - 10}
                        textAnchor="middle"
                        className="fill-[var(--text-dim)] font-mono text-[9px]"
                      >
                        sem estacas
                      </text>
                    ) : null}
                  </g>
                )
              })}
              {marcasEstacas.map((m, i) => (
                <g key={i}>
                  <line x1={m.x} x2={m.x} y1={topo - 6} y2={topo} stroke="var(--border-strong)" />
                  <text
                    x={m.x + (m.ancora === 'start' ? 3 : m.ancora === 'end' ? -3 : 0)}
                    y={topo - 10}
                    textAnchor={m.ancora}
                    className="fill-[var(--text-dim)] font-mono text-[10px]"
                  >
                    {m.rotulo}
                  </text>
                </g>
              ))}
              <line
                x1={0}
                x2={W + 16}
                y1={topo - 0.5}
                y2={topo - 0.5}
                stroke="var(--border-strong)"
              />
              {estMira && mira ? (
                <g>
                  <rect
                    x={mira.x - 46}
                    y={topo - 30}
                    width={92}
                    height={15}
                    rx={3}
                    fill="var(--bg-elevated)"
                    stroke={dividindo ? 'var(--accent)' : 'var(--accent-line)'}
                  />
                  <text
                    x={mira.x}
                    y={topo - 19}
                    textAnchor="middle"
                    className="fill-[var(--text)] font-mono text-[10px]"
                  >
                    {rotuloLugar(mira.x)}
                  </text>
                </g>
              ) : null}
            </svg>
          </div>

          <div className="flex">
            {/* calendário à esquerda */}
            <svg
              width={ESQ}
              height={H + 8}
              className="sticky left-0 z-10 block shrink-0"
              style={{ background: 'var(--bg-panel)' }}
            >
              {tempo.grosso.map((c) => {
                const a = Math.max(c.x0, vista.top),
                  b = Math.min(c.x1, vista.top + area.h)
                return (
                  <g key={`g${c.de}`}>
                    <line
                      x1={0}
                      x2={tempo.temFino ? ESQ - COL_FINA : ESQ}
                      y1={c.x0}
                      y2={c.x0}
                      stroke="var(--border-strong)"
                    />
                    {b - a > 14 ? (
                      <text
                        x={6}
                        y={Math.min(b - 4, a + 13)}
                        className="fill-[var(--text-muted)] text-[11px] font-medium capitalize"
                      >
                        {c.rotulo.replace(' de ', ' ')}
                      </text>
                    ) : null}
                  </g>
                )
              })}
              {tempo.temFino ? (
                <line
                  x1={ESQ - COL_FINA}
                  x2={ESQ - COL_FINA}
                  y1={0}
                  y2={H + 8}
                  stroke="var(--border)"
                />
              ) : null}
              {tempo.fino.map((c) => (
                <g key={`f${c.de}`}>
                  <line x1={ESQ - COL_FINA} x2={ESQ} y1={c.x0} y2={c.x0} stroke="var(--border)" />
                  {c.x1 - c.x0 > 13 ? (
                    <text
                      x={ESQ - COL_FINA + 5}
                      y={(c.x0 + c.x1) / 2 + 3.5}
                      className="fill-[var(--text-dim)] font-mono text-[10px] capitalize"
                    >
                      {c.rotulo}
                    </text>
                  ) : null}
                </g>
              ))}
              <line x1={ESQ - 0.5} x2={ESQ - 0.5} y1={0} y2={H + 8} stroke="var(--border-strong)" />
              {mira ? (
                <g>
                  <rect
                    x={4}
                    y={mira.y - 8}
                    width={ESQ - 8}
                    height={16}
                    rx={3}
                    fill="var(--bg-elevated)"
                    stroke="var(--accent-line)"
                  />
                  <text
                    x={ESQ / 2}
                    y={mira.y + 3.5}
                    textAnchor="middle"
                    className="fill-[var(--text)] font-mono text-[10px]"
                  >
                    {tempo.horas
                      ? fmtDataHora(eixoT.data(mira.y))
                      : fmtDataLonga(eixoT.data(mira.y))}
                  </text>
                </g>
              ) : null}
            </svg>

            {/* área do gráfico */}
            <svg
              width={W + 16}
              height={H + 8}
              className={cn(
                'block shrink-0 select-none',
                (criacao || dividindo) && 'cursor-crosshair',
                arrasto && 'cursor-ns-resize'
              )}
              style={!criacao && !dividindo && !arrasto && cursor ? { cursor } : undefined}
              onPointerDown={iniciar}
              onPointerMove={mover}
              onPointerUp={soltar}
              onPointerLeave={() => {
                setMira(null)
                setDica(null)
                setCursor('')
              }}
              onDoubleClick={(ev) => {
                if (modo === 'dividir') return
                const hit = linhaSob(noPlot(ev))
                if (hit) acoes.abrirTarefa(hit.l.id)
              }}
              onContextMenu={(ev) => {
                ev.preventDefault()
                const hit = linhaSob(noPlot(ev))
                if (hit) {
                  const ids = sel.has(hit.l.id) ? [...sel] : [hit.l.id]
                  if (!sel.has(hit.l.id)) setSel(new Set([hit.l.id]))
                  menus.menuTarefas(ids, ev.clientX, ev.clientY)
                }
              }}
            >
              {/* colunas das áreas */}
              {eixoE.trechos
                .filter((t) => areasIds.has(t.id))
                .map((t) => (
                  <rect
                    key={`a${t.id}`}
                    x={t.x0}
                    y={0}
                    width={t.x1 - t.x0}
                    height={H + 8}
                    fill="var(--bg-panel)"
                    fillOpacity={0.55}
                  />
                ))}
              {/* dias não úteis que aparecem no eixo */}
              {naoUteis.map(([a, b]) => (
                <rect
                  key={a}
                  x={0}
                  y={eixoT.x(a)}
                  width={W}
                  height={Math.max(0, eixoT.x(b) - eixoT.x(a))}
                  fill="var(--mt-nao-trab)"
                />
              ))}
              {/* grade */}
              {tempo.grosso.map((c) => (
                <line
                  key={`h${c.de}`}
                  x1={0}
                  x2={W}
                  y1={c.x0}
                  y2={c.x0}
                  stroke="var(--mt-grid-major)"
                  strokeOpacity={0.6}
                />
              ))}
              {tempo.fino.map((c) => (
                <line
                  key={`hf${c.de}`}
                  x1={0}
                  x2={W}
                  y1={c.x0}
                  y2={c.x0}
                  stroke="var(--mt-grid-minor)"
                  strokeOpacity={0.5}
                />
              ))}
              {marcasEstacas.map((m, i) => (
                <line
                  key={`v${i}`}
                  x1={m.x}
                  x2={m.x}
                  y1={0}
                  y2={H}
                  stroke="var(--mt-grid-minor)"
                  strokeOpacity={0.6}
                />
              ))}
              {eixoE.trechos.map((t, i) =>
                i ? (
                  <rect
                    key={t.id}
                    x={t.x0 - VAO}
                    y={0}
                    width={VAO}
                    height={H + 8}
                    fill="var(--bg-panel)"
                  />
                ) : null
              )}
              {/* hoje */}
              {hoje >= eixoT.inicio && hoje <= eixoT.fim ? (
                <line
                  x1={0}
                  x2={W}
                  y1={eixoT.x(hoje)}
                  y2={eixoT.x(hoje)}
                  stroke="var(--accent)"
                  strokeOpacity={0.6}
                  strokeDasharray="4 3"
                />
              ) : null}

              {/* data de controle (`DControlDateLine`) */}
              {controle && controle.data >= eixoT.inicio && controle.data <= eixoT.fim ? (
                <line
                  x1={0}
                  x2={W}
                  y1={eixoT.x(controle.data)}
                  y2={eixoT.x(controle.data)}
                  stroke="var(--danger)"
                  strokeWidth={1.5}
                  pointerEvents="none"
                />
              ) : null}

              {/* faixas de restrição do arraste (na vertical) */}
              {arrasto?.faixas ? (
                <FaixasVerticais
                  f={arrasto.faixas}
                  mover={arrasto.tipo === 'inicio'}
                  eixo={eixoT}
                  largura={W}
                  altura={H}
                />
              ) : null}

              {/* marcos */}
              {marcos.map((m, i) => (
                <g key={`${m.id}${i}`}>
                  <line
                    x1={m.x0}
                    x2={m.x1}
                    y1={m.y}
                    y2={m.y}
                    stroke="var(--milestone)"
                    strokeWidth={2}
                  />
                  {m.x1 - m.x0 > larguraTexto(m.nome) ? (
                    <text
                      x={(m.x0 + m.x1) / 2}
                      y={m.y - 4}
                      textAnchor="middle"
                      className="fill-[var(--milestone)] text-[10px] font-medium"
                    >
                      {m.nome}
                    </text>
                  ) : null}
                  <title>{`${m.nome} — ${fmtDataLonga(m.t)}`}</title>
                </g>
              ))}

              {/* áreas das tarefas-resumo */}
              {fechos.map((f) => (
                <g key={`f${f.id}`} pointerEvents="none">
                  <polygon
                    points={f.pts.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill={f.cor}
                    fillOpacity={0.12}
                    stroke={f.cor}
                    strokeOpacity={0.45}
                    strokeDasharray="5 3"
                  />
                  <text
                    x={f.cx}
                    y={f.cy}
                    textAnchor="middle"
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    fill={f.cor}
                    fillOpacity={0.7}
                  >
                    {f.nome}
                  </text>
                </g>
              ))}

              {/* caixas das tarefas */}
              {o.caixas
                ? linhas.map((l) =>
                    l.linhas.map((pl, k) => {
                      const xs = pl.map((p) => p.x),
                        ys = pl.map((p) => p.y)
                      const x = Math.min(...xs),
                        y = Math.min(...ys)
                      return (
                        <rect
                          key={`${l.id}b${k}`}
                          x={x}
                          y={y}
                          width={Math.max(1, Math.max(...xs) - x)}
                          height={Math.max(1, Math.max(...ys) - y)}
                          fill={l.cor}
                          fillOpacity={0.14}
                          stroke={l.cor}
                          strokeOpacity={0.5}
                        />
                      )
                    })
                  )
                : null}

              {/* dependências */}
              {deps.map((d) => (
                <g
                  key={d.chave}
                  className="cursor-pointer"
                  onDoubleClick={(ev) => {
                    // `DDependency::OnLButtonDblClk` [O]: o diálogo da dependência; a derivada abre a regra entre serviços
                    ev.stopPropagation()
                    acoes.abrirDependencia({
                      id: d.usuario ? d.id : null,
                      pred: d.pred,
                      succ: d.succ,
                      tipo: d.usuario ? (d.tipo as TipoDependencia) : 'EST',
                      derivada: !d.usuario
                    })
                  }}
                >
                  <path d={d.path} fill="none" stroke="transparent" strokeWidth={9} />
                  <path
                    d={d.path}
                    fill="none"
                    stroke={d.usuario ? 'var(--text-muted)' : 'var(--text-dim)'}
                    strokeWidth={1.2}
                    strokeDasharray={d.usuario ? undefined : '4 3'}
                    pointerEvents="none"
                  />
                  {d.seta ? (
                    <path d={d.seta} fill={d.usuario ? 'var(--text-muted)' : 'var(--text-dim)'} />
                  ) : null}
                </g>
              ))}

              {/* linhas das tarefas */}
              {linhas.map((l) => (
                <g
                  key={l.id}
                  className={cn(!somenteLeitura && modo === 'selecionar' && 'cursor-pointer')}
                >
                  {sel.has(l.id)
                    ? l.linhas.map((pl, k) => (
                        <polyline
                          key={`h${k}`}
                          points={pl.map((p) => `${p.x},${p.y}`).join(' ')}
                          fill="none"
                          stroke={l.cor}
                          strokeOpacity={0.25}
                          strokeWidth={9}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      ))
                    : null}
                  {l.linhas.map((pl, k) => (
                    <polyline
                      key={k}
                      points={pl.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="none"
                      stroke={l.cor}
                      strokeOpacity={controle ? 0.45 : 1}
                      strokeWidth={sel.has(l.id) ? 3 : 2.25}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ))}
                  {/* controle: realizado (DOT) e previsão (DASH), com um contorno do fundo para destacar do plano */}
                  {[
                    ...l.realizado.map((pl) => ({ pl, tipo: 'r' as const })),
                    ...(o.previsao ? l.previsao.map((pl) => ({ pl, tipo: 'p' as const })) : [])
                  ].map(({ pl, tipo }, k) => {
                    const pts = pl.map((p) => `${p.x},${p.y}`).join(' ')
                    return (
                      <g key={`c${k}`} pointerEvents="none">
                        <polyline
                          points={pts}
                          fill="none"
                          stroke="var(--bg)"
                          strokeOpacity={0.8}
                          strokeWidth={tipo === 'r' ? 6 : 4.5}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                        <polyline
                          points={pts}
                          fill="none"
                          stroke={l.cor}
                          strokeWidth={tipo === 'r' ? 3.25 : 2.25}
                          strokeDasharray={tipo === 'r' ? '0.1 4.5' : '6 4'}
                          strokeLinejoin="round"
                          strokeLinecap={tipo === 'r' ? 'round' : 'butt'}
                        />
                      </g>
                    )
                  })}
                </g>
              ))}

              {/* rótulos ao longo da linha (DIT padrão 0,5) */}
              {o.rotulos
                ? linhas.map((l) => {
                    const pt = pontoAoLongo(l.linhas.flat(), 0.5)
                    if (!pt) return null
                    let ang = (pt.ang * 180) / Math.PI
                    if (ang > 90) ang -= 180
                    if (ang < -90) ang += 180
                    return (
                      <text
                        key={`r${l.id}`}
                        transform={`translate(${pt.p.x} ${pt.p.y}) rotate(${ang})`}
                        y={-5}
                        textAnchor="middle"
                        pointerEvents="none"
                        className="text-[10.5px] font-medium"
                        fill="var(--text)"
                        stroke="var(--bg)"
                        strokeWidth={3}
                        paintOrder="stroke"
                      >
                        {l.t.nome}
                      </text>
                    )
                  })
                : null}

              {/* bandeiras de violação */}
              {violacoes.map((v, i) => (
                <g key={i} transform={`translate(${v.x} ${v.y + v.k * 10})`} pointerEvents="all">
                  <rect x={-1} y={-17} width={2} height={20} rx={1} fill="oklch(48% 0.07 60)" />
                  <path d="M 1 -17 h 9 l -2 3.5 l 2 3.5 h -9 z" fill="var(--danger)" />
                  <title>{v.texto}</title>
                </g>
              ))}

              {/* fantasma do arraste */}
              {fantasma && alvoAtual
                ? (() => {
                    const l = porTarefa.get(fantasma.tarefaId)
                    if (!l) return null
                    const desloca = (p: Ponto): Ponto => {
                      if (fantasma.tipo === 'inicio') return { x: p.x, y: p.y + fantasma.dy }
                      const f =
                        fantasma.yFim !== fantasma.yIni
                          ? (p.y - fantasma.yIni) / (fantasma.yFim - fantasma.yIni)
                          : 1
                      return { x: p.x, y: p.y + fantasma.dy * f }
                    }
                    const ponta = fantasma.tipo === 'inicio' ? l.pontos.inicio : l.pontos.fim
                    const rot = alvoAtual.porHora
                      ? fmtDataHora(alvoAtual.data)
                      : fmtDataLonga(alvoAtual.data - (fantasma.tipo === 'fim' ? 1 : 0))
                    const w = larguraTexto(rot) + 8
                    return (
                      <g pointerEvents="none">
                        {l.linhas.map((pl, k) => (
                          <polyline
                            key={k}
                            points={pl
                              .map(desloca)
                              .map((p) => `${p.x},${p.y}`)
                              .join(' ')}
                            fill="none"
                            stroke="var(--accent)"
                            strokeDasharray="5 3"
                            strokeWidth={1.75}
                          />
                        ))}
                        <line
                          x1={ponta.x - 14}
                          x2={ponta.x + 14}
                          y1={alvoAtual.y}
                          y2={alvoAtual.y}
                          stroke="var(--accent)"
                        />
                        <g transform={`translate(${ponta.x + 10} ${alvoAtual.y - 9})`}>
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
                            className="fill-[var(--text)] font-mono text-[11px]"
                          >
                            {rot}
                          </text>
                        </g>
                      </g>
                    )
                  })()
                : null}

              {/* alvos do modo dependências */}
              {modo === 'dependencias' && !somenteLeitura
                ? linhas.map((l) =>
                    (['inicio', 'meio', 'fim'] as Alvo[]).map((alvo) => {
                      const q = l.pontos[alvo]
                      const ok = !criacao || valido(criacao, l.id, alvo)
                      const ativo = criacao?.sobre?.tarefaId === l.id && criacao.sobre.alvo === alvo
                      return (
                        <circle
                          key={`${l.id}${alvo}`}
                          data-alvo={`${l.id}:${alvo}`}
                          cx={q.x}
                          cy={q.y}
                          r={ativo ? RAIO_ALVO + 1.5 : RAIO_ALVO}
                          fill={ok ? 'var(--success)' : 'transparent'}
                          fillOpacity={ok ? 0.3 : 0}
                          stroke={ok ? 'var(--success)' : 'var(--text-faint)'}
                          strokeOpacity={ok ? 1 : 0.5}
                          onPointerDown={(ev) => {
                            if (ev.button !== 0 || criacao) return
                            ev.stopPropagation()
                            ;(
                              ev.currentTarget.ownerSVGElement ?? ev.currentTarget
                            ).setPointerCapture(ev.pointerId)
                            setCriacao({ tarefaId: l.id, alvo, p0: q, p: q, sobre: null })
                          }}
                        />
                      )
                    })
                  )
                : null}
              {criacao
                ? (() => {
                    const tr = tracarDependencia(criacao.p0, criacao.sobre?.p ?? criacao.p, null)
                    const seta = setaSvg(tr)
                    return (
                      <g pointerEvents="none">
                        <path
                          d={caminhoSvg(tr)}
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth={1.5}
                        />
                        {seta ? <path d={seta} fill="var(--accent)" /> : null}
                      </g>
                    )
                  })()
                : null}

              {/* mira (no modo Dividir, a linha do corte) */}
              {mira && !arrasto && !criacao ? (
                <g pointerEvents="none">
                  <line
                    x1={mira.x}
                    x2={mira.x}
                    y1={0}
                    y2={H}
                    stroke={dividindo ? 'var(--accent)' : 'var(--mt-cross)'}
                    strokeWidth={dividindo ? 1.5 : 1}
                    strokeDasharray={dividindo ? undefined : '2 3'}
                  />
                  {!dividindo ? (
                    <line
                      x1={0}
                      x2={W}
                      y1={mira.y}
                      y2={mira.y}
                      stroke="var(--mt-cross)"
                      strokeDasharray="2 3"
                    />
                  ) : null}
                </g>
              ) : null}
            </svg>
          </div>
        </div>
        {dica && !arrasto && !criacao && !dividindo ? (
          <DicaFlutuante x={dica.x} y={dica.y} conteudo={dica.conteudo} />
        ) : null}
        {menus.elemento}
      </div>
      {painelFora}
    </div>
  )
}

/** `drawBandsVertical` [O]: as faixas do arraste na vertical (o tempo corre para baixo). */
function FaixasVerticais({
  f,
  mover,
  eixo,
  largura,
  altura
}: {
  f: TimingBands
  mover: boolean
  eixo: EixoTempo
  largura: number
  altura: number
}): ReactNode {
  const y = (t: number): number => Math.max(-10, Math.min(altura + 10, eixo.x(t)))
  const faixa = (cor: string, de: number | null, ate: number | null, k: string): ReactNode => {
    const a = de === null ? 0 : y(de),
      b = ate === null ? altura : y(ate)
    return b > a ? (
      <rect
        key={k}
        x={0}
        y={a}
        width={largura}
        height={b - a}
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
