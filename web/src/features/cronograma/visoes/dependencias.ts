/**
 * Dependências nas visões, copiado do ApeX (`views/common/dependencies.ts`): alvos de início, meio e fim de cada
 * tarefa, tipo pela combinação dos alvos e o traçado em "L" com o canto arredondado e a seta (`GetLineInfo`,
 * `AvoidBorders`, `DrawArrow`).
 */
import type { TipoDependencia } from '../motor/tipos'

export type Alvo = 'inicio' | 'meio' | 'fim'

export interface Ponto {
  x: number
  y: number
}

/** `GetPredecessorType` [O]: de onde sai a seta na predecessora. */
export function alvoPredecessora(t: TipoDependencia): Alvo {
  return t === 'SS' || t === 'SF' ? 'inicio' : t === 'FF' || t === 'FS' ? 'fim' : 'meio'
}
/** `GetSuccessorType` [O]: onde chega a seta na sucessora. */
export function alvoSucessora(t: TipoDependencia): Alvo {
  return t === 'SS' || t === 'FS' ? 'inicio' : t === 'FF' || t === 'SF' ? 'fim' : 'meio'
}

/** `DependencyCreationHelper::End` [O]: (I,I) SS, (I,F) SF, (F,I) FS, (F,F) FF; meio → por estacas. */
export function tipoPelosAlvos(origem: Alvo, destino: Alvo): TipoDependencia {
  if (origem === 'inicio' && destino === 'inicio') return 'SS'
  if (origem === 'inicio' && destino === 'fim') return 'SF'
  if (origem === 'fim' && destino === 'inicio') return 'FS'
  if (origem === 'fim' && destino === 'fim') return 'FF'
  return 'EST'
}

/**
 * Ponto da bandeira de violação de dependência (`violationPoint` / `ViolationHelper::AddViolations` [I]): FF e SF no
 * fim do sucessor, as demais no início. O tipo vem da dependência do usuário ou, sem ela, da derivada dos serviços
 * (`automaticas`, tipo numérico do ApeX: 0 FF, 1 SF).
 */
export function pontoViolacaoDependencia(
  predecessora: string,
  sucessora: string,
  usuario: readonly { predecessora_id: string; sucessora_id: string; tipo: TipoDependencia }[],
  automaticas: readonly { predecessora_id: string; sucessora_id: string; tipo: number }[]
): 'inicio' | 'fim' {
  const d = usuario.find((x) => x.predecessora_id === predecessora && x.sucessora_id === sucessora)
  if (d) return d.tipo === 'FF' || d.tipo === 'SF' ? 'fim' : 'inicio'
  const a = automaticas.find(
    (x) => x.predecessora_id === predecessora && x.sucessora_id === sucessora
  )
  return a && (a.tipo === 0 || a.tipo === 1) ? 'fim' : 'inicio'
}

/**
 * `ValidateDependencyTargets` [O]: a própria tarefa não; do meio só para o meio de tarefas que dividem estacas; de
 * início/fim só para início/fim.
 */
export function alvoValido(
  origem: Alvo,
  destino: Alvo,
  mesmaTarefa: boolean,
  cruzam: boolean
): boolean {
  if (mesmaTarefa) return false
  if (origem === 'meio') return destino === 'meio' && cruzam
  return destino !== 'meio'
}

export interface Tracado {
  canto: Ponto
  p1: Ponto
  p2: Ponto
  p3: Ponto
  p4: Ponto
  /** raio do arco (0 = sem arco) */
  raio: number
  /** sentido do arco no SVG (1 = horário na tela) */
  horario: boolean
}

const sub = (a: Ponto, b: Ponto): Ponto => ({ x: a.x - b.x, y: a.y - b.y })
const len = (a: Ponto): number => Math.hypot(a.x, a.y)
const norm = (a: Ponto): Ponto => {
  const l = len(a)
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 }
}

/**
 * `GetLineInfo` + `AvoidBorders` [O]: pontas a ≥ 2 px das bordas; canto = (p1.x, p4.y), ou (p4.x, p1.y) se o fim está
 * a ≤ 5 px na horizontal; r = min(|p4 − canto|, |canto − p1|)·0,5 − 2 (sem arco se < 2), no máximo 100.
 */
export function tracarDependencia(
  p1: Ponto,
  p4: Ponto,
  bordas: { x0: number; x1: number } | null
): Tracado {
  const evita = (p: Ponto): Ponto => {
    if (!bordas) return p
    let x = p.x
    if (x - bordas.x0 <= 2) x = bordas.x0 + 2
    if (bordas.x1 - x <= 2) x = bordas.x1 - 2
    return { x, y: p.y }
  }
  const a = evita(p1),
    d = evita(p4)
  let canto = { x: a.x, y: d.y }
  if (Math.abs(d.x - canto.x) <= 5) canto = { x: d.x, y: a.y }
  let r = Math.min(len(sub(d, canto)), len(sub(canto, a))) * 0.5 - 2
  if (r < 2) return { canto, p1: a, p2: canto, p3: canto, p4: d, raio: 0, horario: true }
  r = Math.min(r, 100)
  const n1 = norm(sub(canto, a)),
    n2 = norm(sub(d, canto))
  const cross = n1.x * n2.y - n1.y * n2.x
  return {
    canto,
    p1: a,
    p2: { x: canto.x - n1.x * r, y: canto.y - n1.y * r },
    p3: { x: canto.x + n2.x * r, y: canto.y + n2.y * r },
    p4: d,
    raio: r,
    horario: cross > 0
  }
}

/** Caminho SVG p1 → p2 → arco → p4. */
export function caminhoSvg(t: Tracado): string {
  const f = (p: Ponto): string => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`
  if (t.raio === 0) return `M ${f(t.p1)} L ${f(t.p2)} L ${f(t.p4)}`
  return `M ${f(t.p1)} L ${f(t.p2)} A ${t.raio.toFixed(1)} ${t.raio.toFixed(1)} 0 0 ${t.horario ? 1 : 0} ${f(t.p3)} L ${f(t.p4)}`
}

/** `DrawArrow` [O]: triângulo de 5 px × ±4 px apontando de p3 para p4 (ou do canto, sem arco). */
export function setaSvg(t: Tracado): string | null {
  const de = t.raio === 0 ? (t.p2.x === t.p4.x && t.p2.y === t.p4.y ? t.p1 : t.p2) : t.p3
  if (de.x === t.p4.x && de.y === t.p4.y) return null
  const dir = norm(sub(t.p4, de))
  const perp = { x: -dir.y, y: dir.x }
  const base = { x: t.p4.x - dir.x * 5, y: t.p4.y - dir.y * 5 }
  const pts = [
    { x: base.x + perp.x * 4, y: base.y + perp.y * 4 },
    { x: base.x - perp.x * 4, y: base.y - perp.y * 4 },
    t.p4
  ]
  return pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z'
}

export const NOME_TIPO: Record<TipoDependencia, string> = {
  FS: 'Término → início',
  SS: 'Início → início',
  FF: 'Término → término',
  SF: 'Início → término',
  EST: 'Por estacas'
}
