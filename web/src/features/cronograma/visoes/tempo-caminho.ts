/**
 * Tempo-caminho: a `RoadTimeView` (tempo-local) do ApeX sobre os resultados do motor, copiado de
 * `views/time/roadtime.ts` e adaptado ao InfraWork (trechos lado a lado em vez do eixo ativo + áreas).
 *
 * - Tempo na vertical (comprimido pelo calendário de interface, como no Gantt), estacas na horizontal.
 * - Cada trecho de tarefa (work place) vira uma "escada" (RN-042): `t0 = WS2AS(AS2WS(tA) + (s0 − stA)/(stB − stA)·W)`
 *   — o avanço é linear nos segundos de trabalho do calendário da tarefa; o segmento é subdividido em cada mudança
 *   útil/não útil do calendário da tarefa e do de interface (vertical onde a tarefa para e o eixo mostra o tempo).
 * - Pedaços consecutivos que se tocam na mesma estaca viram uma polilinha só (`AddMissingVerticalLines`).
 */
import type { Calendar } from '@apex/calendar'
import type { TarefaResultado, WpResultado } from '../motor/calculo'
import type { FrentePrevisao, LugarPrevisao } from '../motor/controle'
import type { EixoTempo } from './eixo'

export interface Ponto {
  x: number
  y: number
}

const EPS = 1e-9

/** Instantes de mudança útil/não útil de um calendário estritamente dentro de (t0, t1). */
function transicoes(cal: Calendar, t0: number, t1: number, out: Set<number>): void {
  if (!(t1 > t0)) return
  for (const [a, b] of cal.workPeriods(t0, t1)) {
    if (a > t0 && a < t1) out.add(a)
    if (b > t0 && b < t1) out.add(b)
  }
}

/**
 * `CreateLineBetweenXCoords(x0, x1, t0, t1)` [O]: pontos nas mudanças útil/não útil do calendário da tarefa e do de
 * interface; y = posição do instante no eixo do tempo; x = fração dos segundos úteis da tarefa. Sem segundos úteis no
 * intervalo, x interpolado pelo tempo corrido.
 */
export function linhaEntreX(
  tarefa: Calendar,
  tempo: EixoTempo,
  x0: number,
  x1: number,
  t0: number,
  t1: number
): Ponto[] {
  if (t1 < t0) [t0, t1] = [t1, t0]
  const cortes = new Set<number>([t0, t1])
  transicoes(tarefa, t0, t1, cortes)
  transicoes(tempo.calendario, t0, t1, cortes)
  const ts = [...cortes].sort((a, b) => a - b)
  const w0 = tarefa.AS2WS(t0),
    w1 = tarefa.AS2WS(t1)
  const frac = (t: number): number =>
    w1 > w0 ? (tarefa.AS2WS(t) - w0) / (w1 - w0) : t1 > t0 ? (t - t0) / (t1 - t0) : 0
  return ts.map((t) => ({ x: x0 + (x1 - x0) * frac(t), y: tempo.x(t) }))
}

/** `RemoveZeroLengthLines` + `RemoveUnnecessaryIntermediatePoints`: pontos repetidos e colineares saem. */
export function simplificar(pts: readonly Ponto[]): Ponto[] {
  const out: Ponto[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) <= EPS && Math.abs(last.y - p.y) <= EPS) continue
    out.push(p)
    while (out.length >= 3) {
      const a = out[out.length - 3]!,
        b = out[out.length - 2]!,
        c = out[out.length - 1]!
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
      const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)
      if (Math.abs(cross) <= 1e-7 * Math.max(1, Math.hypot(c.x - a.x, c.y - a.y)) && dot >= 0)
        out.splice(out.length - 2, 1)
      else break
    }
  }
  return out
}

/** Pedaço de uma tarefa: estaca de partida e de chegada na direção de execução, e o intervalo de tempo. */
export interface Pedaco {
  trecho: string
  stA: number
  stB: number
  tA: number
  tB: number
}

/**
 * Pedaços planejados de uma tarefa: os trechos de tarefa com trecho, invertidos se a execução começa pela estaca alta
 * (`IsLow`) [O]. Sem trecho ("Sem local") não entra no tempo-caminho.
 */
export function pedacosPlanejados(r: TarefaResultado, crescente: boolean): Pedaco[] {
  const lista: Pedaco[] = r.wps
    .filter((w): w is WpResultado & { trecho_id: string } => !!w.trecho_id)
    .map((w) =>
      crescente
        ? { trecho: w.trecho_id, stA: w.inicio_m, stB: w.fim_m, tA: w.inicio, tB: w.fim }
        : { trecho: w.trecho_id, stA: w.fim_m, stB: w.inicio_m, tA: w.inicio, tB: w.fim }
    )
  // num eixo só, a ordem do ApeX (pela estaca, invertida no decrescente). Com vários trechos (extensão do InfraWork,
  // D-20) a estaca de trechos diferentes não se compara: a ordem é a do tempo, para que o 1.º e o último ponto (âncoras
  // de dependências, bandeiras e arraste) sejam mesmo o começo e o fim do trabalho
  if (new Set(lista.map((p) => p.trecho)).size > 1) {
    const sinal = crescente ? 1 : -1
    return lista.sort(
      (a, b) => a.tA - b.tA || sinal * (Math.min(a.stA, a.stB) - Math.min(b.stA, b.stB))
    )
  }
  lista.sort((a, b) => Math.min(a.stA, a.stB) - Math.min(b.stA, b.stB))
  return crescente ? lista : lista.reverse()
}

/**
 * `frontPieces` [O]: pedaços de uma frente da previsão do controle — os lugares realizados (`realizado = true`) ou os
 * previstos —, na direção da frente. Lugar sem trecho (área) não entra no tempo-caminho.
 */
export function pedacosDaFrente(f: FrentePrevisao, realizado: boolean): Pedaco[] {
  const lista = f.lugares
    .filter(
      (x): x is LugarPrevisao & { trecho_id: string } =>
        x.realizado === realizado && x.fim >= x.inicio && !!x.trecho_id
    )
    .map((x) =>
      f.crescente
        ? { trecho: x.trecho_id, stA: x.inicio_m, stB: x.fim_m, tA: x.inicio, tB: x.fim }
        : { trecho: x.trecho_id, stA: x.fim_m, stB: x.inicio_m, tA: x.inicio, tB: x.fim }
    )
  return f.crescente ? lista : lista.reverse()
}

/** Eixo das estacas: trechos lado a lado, cada um com a sua faixa de estacas e a sua escala. */
export interface TrechoNoEixo {
  id: string
  /** faixa de estacas mostrada (metros internos) */
  ini: number
  fim: number
  /** pixels */
  x0: number
  x1: number
}

export class EixoEstacas {
  readonly porId: Map<string, TrechoNoEixo>
  constructor(readonly trechos: TrechoNoEixo[]) {
    this.porId = new Map(trechos.map((t) => [t.id, t]))
  }

  get largura(): number {
    return this.trechos.length ? this.trechos[this.trechos.length - 1]!.x1 : 0
  }

  /** x da estaca no trecho (fora da faixa: extrapolado) */
  x(trecho: string, st: number): number | undefined {
    const t = this.porId.get(trecho)
    if (!t) return undefined
    return t.fim > t.ini ? t.x0 + ((st - t.ini) / (t.fim - t.ini)) * (t.x1 - t.x0) : t.x0
  }

  /** estaca no x (trecho sob o ponto) */
  estaca(x: number): { trecho: string; st: number } | null {
    for (const t of this.trechos) {
      if (x >= t.x0 && x <= t.x1)
        return {
          trecho: t.id,
          st: t.ini + ((x - t.x0) / Math.max(1e-9, t.x1 - t.x0)) * (t.fim - t.ini)
        }
    }
    return null
  }

  /** pedaços visíveis [s0, s1] da faixa (stA → stB) no trecho, na direção da faixa */
  pedacos(trecho: string, stA: number, stB: number): [number, number][] {
    const t = this.porId.get(trecho)
    if (!t) return []
    const lo = Math.max(Math.min(stA, stB), t.ini),
      hi = Math.min(Math.max(stA, stB), t.fim)
    if (!(hi > lo)) return []
    return stA <= stB ? [[lo, hi]] : [[hi, lo]]
  }
}

/**
 * `CreateWorkPlaceLine` [O]: um trecho de linha por pedaço visível [s0, s1] da faixa:
 * `t0 = WS2AS(AS2WS(tA) + (s0 − stA)/(stB − stA)·W)`, `t1 = WS2AS(AS2WS(tB) − (stB − s1)/(stB − stA)·W)`.
 */
export function linhaDoPedaco(
  tarefa: Calendar,
  tempo: EixoTempo,
  eixo: EixoEstacas,
  pc: Pedaco
): Ponto[][] {
  const out: Ponto[][] = []
  const W = tarefa.AS2WS(pc.tB) - tarefa.AS2WS(pc.tA)
  const len = pc.stB - pc.stA
  for (const [s0, s1] of eixo.pedacos(pc.trecho, pc.stA, pc.stB)) {
    const f0 = Math.abs(len) > EPS ? (s0 - pc.stA) / len : 0
    const f1 = Math.abs(len) > EPS ? (pc.stB - s1) / len : 0
    const t0 = W > 0 ? tarefa.WS2AS(tarefa.AS2WS(pc.tA) + Math.round(f0 * W), true) : pc.tA
    const t1 = W > 0 ? tarefa.WS2AS(tarefa.AS2WS(pc.tB) - Math.round(f1 * W), false) : pc.tB
    const x0 = eixo.x(pc.trecho, s0),
      x1 = eixo.x(pc.trecho, s1)
    if (x0 === undefined || x1 === undefined) continue
    out.push(simplificar(linhaEntreX(tarefa, tempo, x0, x1, t0, Math.max(t0, t1))))
  }
  return out
}

/**
 * `AddMissingVerticalLines` [I]: polilinhas consecutivas que se tocam na mesma estaca são unidas (o trecho entre elas
 * fica vertical); com lacuna de estacas, ficam separadas.
 */
export function juntarLinhas(linhas: readonly Ponto[][]): Ponto[][] {
  const out: Ponto[][] = []
  for (const l of linhas) {
    if (!l.length) continue
    const last = out[out.length - 1]
    if (last && Math.abs(last[last.length - 1]!.x - l[0]!.x) <= 1e-6)
      out[out.length - 1] = simplificar([...last, ...l])
    else out.push([...l])
  }
  return out
}

/** Ponto ao longo da polilinha na fração (0…1) do comprimento, com a direção do segmento. */
export function pontoAoLongo(pts: readonly Ponto[], f: number): { p: Ponto; ang: number } | null {
  if (pts.length < 2) return pts[0] ? { p: pts[0], ang: 0 } : null
  const seg = pts.slice(1).map((q, i) => Math.hypot(q.x - pts[i]!.x, q.y - pts[i]!.y))
  const total = seg.reduce((a, b) => a + b, 0)
  let d = total * Math.min(1, Math.max(0, f))
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i]! || i === seg.length - 1) {
      const a = pts[i]!,
        b = pts[i + 1]!
      const k = seg[i]! > 0 ? Math.min(1, d / seg[i]!) : 0
      return {
        p: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k },
        ang: Math.atan2(b.y - a.y, b.x - a.x)
      }
    }
    d -= seg[i]!
  }
  return null
}

/** Distância de um ponto a uma polilinha. */
export function distanciaPolilinha(p: Ponto, pts: readonly Ponto[]): number {
  let best = Infinity
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!,
      b = pts[i + 1]!
    const dx = b.x - a.x,
      dy = b.y - a.y
    const l2 = dx * dx + dy * dy
    const k = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k)))
  }
  return pts.length === 1 ? Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y) : best
}

/** Distância a um conjunto de polilinhas, cada uma separada (a lacuna entre pedaços não é linha — `HitTest` [O]). */
export function distanciaLinhas(p: Ponto, linhas: readonly (readonly Ponto[])[]): number {
  let best = Infinity
  for (const l of linhas) if (l.length) best = Math.min(best, distanciaPolilinha(p, l))
  return best
}

/** `STADIUM` do ApeX: comprimento e raio das zonas de mover/esticar. */
export const ESTADIO = { comprimento: 50, raio: 5 }

/**
 * `IsMovableAtPoint` / `IsResizableAtPoint` → `IsWithinStadium` [O]: mover = perto (< 5 px) do **1.º segmento** da
 * linha planejada, cortado em 50 px a partir do início; esticar = o mesmo no **último** segmento, a partir do fim.
 * Numa linha curta valem os dois (no clique, mover ganha). Fora das duas zonas → null.
 */
export function zonaDaLinha(
  p: Ponto,
  linhas: readonly (readonly Ponto[])[]
): { inicio: boolean; fim: boolean } | null {
  const dentro = (inicio: boolean): boolean => {
    const prim = linhas.find((l) => l.length >= 2)
    const ult = [...linhas].reverse().find((l) => l.length >= 2)
    if (!prim || !ult) return false
    const [a, b] = inicio ? [prim[0]!, prim[1]!] : [ult[ult.length - 1]!, ult[ult.length - 2]!]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const c =
      len < ESTADIO.comprimento
        ? b
        : {
            x: a.x + ((b.x - a.x) / len) * ESTADIO.comprimento,
            y: a.y + ((b.y - a.y) / len) * ESTADIO.comprimento
          }
    return distanciaPolilinha(p, [a, c]) < ESTADIO.raio
  }
  const inicio = dentro(true),
    fim = dentro(false)
  return inicio || fim ? { inicio, fim } : null
}

/** Fecho convexo (cadeia monótona de Andrew) dos pontos — as áreas das tarefas-resumo do ApeX. */
export function fechoConvexo(pontos: readonly Ponto[]): Ponto[] {
  const pts = [...pontos]
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((p, i, arr) => i === 0 || p.x !== arr[i - 1]!.x || p.y !== arr[i - 1]!.y)
  if (pts.length < 3) return pts
  const cross = (o: Ponto, a: Ponto, b: Ponto): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const baixo: Ponto[] = []
  for (const p of pts) {
    while (baixo.length >= 2 && cross(baixo[baixo.length - 2]!, baixo[baixo.length - 1]!, p) <= 0)
      baixo.pop()
    baixo.push(p)
  }
  const cima: Ponto[] = []
  for (const p of [...pts].reverse()) {
    while (cima.length >= 2 && cross(cima[cima.length - 2]!, cima[cima.length - 1]!, p) <= 0)
      cima.pop()
    cima.push(p)
  }
  return [...baixo.slice(0, -1), ...cima.slice(0, -1)]
}
