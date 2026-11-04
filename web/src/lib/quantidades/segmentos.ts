/**
 * Segmentos e faixas das quantidades por local (o BOQ por estaca do DynaRoad):
 * - geração da grade de faixas de um eixo em qualquer passo (unidade, N unidades, N metros);
 * - reamostragem de valores entre grades (conserva a soma);
 * - a regra ponto → faixa do importador do DynaRoad (pontos médios; a tabela termina na própria estaca);
 * - sequências contíguas (o zero fecha), janelas alinhadas a múltiplos de N, quantidade numa faixa e a estaca em
 *   que a massa acumulada atinge uma fração (inverso), usadas por "criar tarefas" e "dividir por estaca".
 */
import { distribuirProporcional } from './distribuir'
import { type SegmentoAnalitico, type TrechoUnidadeConfig } from './grade'

export interface SegmentoValores {
  ini: number
  fim: number
  label_ini: string
  label_fim: string
  /** item_orcamentario_id → valor */
  valores: Record<string, number>
}

export type Passo =
  { tipo: 'unidade' } | { tipo: 'unidades'; n: number } | { tipo: 'metros'; m: number }

const DIVISOR: Record<Exclude<TrechoUnidadeConfig['unidade_espaco_padrao'], 'custom'>, number> = {
  km: 1000,
  estaca: 20,
  m: 1
}
const LABEL: Record<Exclude<TrechoUnidadeConfig['unidade_espaco_padrao'], 'custom'>, string> = {
  km: 'km',
  estaca: 'EST',
  m: 'm'
}

/** Metros de uma unidade do estaqueamento (km = 1000, estaca = 20, m = 1, custom = divisor). */
export function divisorUnidade(cfg: TrechoUnidadeConfig): number {
  const d =
    cfg.unidade_espaco_padrao === 'custom'
      ? Number(cfg.unidade_custom_divisor_m)
      : DIVISOR[cfg.unidade_espaco_padrao]
  return Number.isFinite(d) && d > 0 ? d : 1
}

export function rotuloUnidade(cfg: TrechoUnidadeConfig): string {
  return cfg.unidade_espaco_padrao === 'custom'
    ? cfg.unidade_custom_label?.trim() || 'ref'
    : LABEL[cfg.unidade_espaco_padrao]
}

const fmtValor = (v: number): string =>
  Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '')

/** Rótulo curto do marcador numa posição ("km 5", "EST 125", "m 1500"). */
export function rotuloPosicao(pos: number, cfg: TrechoUnidadeConfig): string {
  const sinal = cfg.geometry_sentido === 'invertido' ? -1 : 1
  const valor = (Number(cfg.marcador_valor_inicial) || 0) + (sinal * pos) / divisorUnidade(cfg)
  return `${rotuloUnidade(cfg)} ${fmtValor(valor)}`
}

/** Passo em metros. */
export function passoEmMetros(cfg: TrechoUnidadeConfig, passo: Passo): number {
  if (passo.tipo === 'metros') return Math.max(0.01, passo.m)
  if (passo.tipo === 'unidades') return divisorUnidade(cfg) * Math.max(1, Math.round(passo.n))
  return divisorUnidade(cfg)
}

/** Grade de faixas do eixo no passo dado (a última pode ser parcial). */
export function gerarSegmentos(cfg: TrechoUnidadeConfig, passo: Passo): SegmentoAnalitico[] {
  const comp = Number(cfg.geometry_comprimento_m)
  if (!Number.isFinite(comp) || comp <= 0) return []
  const p = passoEmMetros(cfg, passo)
  const out: SegmentoAnalitico[] = []
  let ordem = 0
  for (let pos = 0; pos < comp - 1e-9; pos += p) {
    const fim = Math.min(pos + p, comp)
    out.push({
      ordem,
      posicao_inicio_m: Math.round(pos * 100) / 100,
      posicao_fim_m: Math.round(fim * 100) / 100,
      unidade_inicio_label: rotuloPosicao(pos, cfg),
      unidade_fim_label: rotuloPosicao(fim, cfg)
    })
    ordem++
  }
  return out
}

/** Redistribui os valores de uma grade em outra, proporcionalmente ao comprimento (conserva a soma). */
export function reamostrarSegmentos(
  origem: readonly SegmentoValores[],
  grade: readonly SegmentoAnalitico[]
): SegmentoValores[] {
  const acc = grade.map(() => ({}) as Record<string, number>)
  for (const s of origem)
    for (const [id, v] of Object.entries(s.valores)) {
      if (!(v > 0)) continue
      for (const [ordem, parte] of distribuirProporcional(s.ini, s.fim, v, [...grade])) {
        const k = grade.findIndex((g) => g.ordem === ordem)
        if (k >= 0) acc[k]![id] = (acc[k]![id] ?? 0) + parte
      }
    }
  return grade.map((g, k) => ({
    ini: g.posicao_inicio_m,
    fim: g.posicao_fim_m,
    label_ini: g.unidade_inicio_label,
    label_fim: g.unidade_fim_label,
    valores: Object.fromEntries(
      Object.entries(acc[k]!).map(([id, v]) => [id, Math.round(v * 1000) / 1000])
    )
  }))
}

/**
 * Regra ponto → faixa do importador do DynaRoad (`ExcelImporter::AddQuantity`): a quantidade da estaca `s[i]` vale
 * de `(s[i-1]+s[i])/2` a `(s[i]+s[i+1])/2`; nas pontas da tabela, a própria estaca; tabela de um ponto só → `[s, s +
 * umaUnidade]`. As estacas precisam ser estritamente crescentes.
 */
export function faixasDosPontos(
  estacas: readonly number[],
  umaUnidade: number
): [number, number][] {
  const n = estacas.length
  if (n === 0) return []
  if (n === 1) return [[estacas[0]!, estacas[0]! + umaUnidade]]
  for (let i = 1; i < n; i++)
    if (!(estacas[i]! > estacas[i - 1]!))
      throw new Error(`estacas fora de ordem na posição ${i + 1}`)
  return estacas.map((s, i) => [
    i === 0 ? s : (estacas[i - 1]! + s) / 2,
    i === n - 1 ? s : (s + estacas[i + 1]!) / 2
  ])
}

/** Sequências contíguas de faixas com valor > 0 do serviço (o zero fecha a sequência, como no DynaRoad). */
export function sequenciasContiguas(
  segs: readonly SegmentoValores[],
  itemId: string
): { ini: number; fim: number; total: number }[] {
  const out: { ini: number; fim: number; total: number }[] = []
  let cur: { ini: number; fim: number; total: number } | null = null
  for (const s of [...segs].sort((a, b) => a.ini - b.ini)) {
    const v = s.valores[itemId] ?? 0
    if (!(v > 0)) {
      if (cur) out.push(cur)
      cur = null
      continue
    }
    if (cur && s.ini <= cur.fim + 0.005) {
      cur.fim = Math.max(cur.fim, s.fim)
      cur.total += v
    } else {
      if (cur) out.push(cur)
      cur = { ini: s.ini, fim: s.fim, total: v }
    }
  }
  if (cur) out.push(cur)
  return out
}

/** Janelas `[kN, (k+1)N)` alinhadas a múltiplos de N que cobrem `[ini, fim]` ("combine within N stations"). */
export function faixasDeDivisao(ini: number, fim: number, passoM: number): [number, number][] {
  if (!(passoM > 0) || !(fim > ini)) return [[ini, fim]]
  const out: [number, number][] = []
  let w0 = Math.floor(ini / passoM) * passoM
  while (w0 < fim - 0.005) {
    const w1 = w0 + passoM
    out.push([Math.max(w0, ini), Math.min(w1, fim)])
    w0 = w1
  }
  return out
}

/** Quantidade do serviço dentro de `[ini, fim]` pela sobreposição com as faixas (espelha `trecho_qtd_faixa`). */
export function quantidadeNaFaixa(
  segs: readonly SegmentoValores[],
  itemId: string,
  ini: number,
  fim: number
): number {
  const a = Math.min(ini, fim),
    b = Math.max(ini, fim)
  let q = 0
  for (const s of segs) {
    const v = s.valores[itemId] ?? 0
    if (!(v > 0) || !(s.fim > s.ini)) continue
    const lo = Math.max(a, s.ini),
      hi = Math.min(b, s.fim)
    if (hi > lo) q += (v * (hi - lo)) / (s.fim - s.ini)
  }
  return Math.round(q * 10000) / 10000
}

/**
 * Estaca em que a massa acumulada do serviço dentro de `[ini, fim]` atinge a fração (0…1): o inverso de
 * `quantidadeNaFaixa` (`GetStationAtPortion` do ApeX). Sem quantidade na faixa, linear no comprimento.
 */
export function estacaPorFracao(
  segs: readonly SegmentoValores[],
  itemId: string,
  ini: number,
  fim: number,
  fracao: number
): number {
  const f = Math.min(1, Math.max(0, fracao))
  const total = quantidadeNaFaixa(segs, itemId, ini, fim)
  if (!(total > 0)) return ini + (fim - ini) * f
  const alvo = total * f
  let acc = 0
  for (const s of [...segs].sort((a, b) => a.ini - b.ini)) {
    const v = s.valores[itemId] ?? 0
    if (!(v > 0) || !(s.fim > s.ini)) continue
    const lo = Math.max(ini, s.ini),
      hi = Math.min(fim, s.fim)
    if (!(hi > lo)) continue
    const dens = v / (s.fim - s.ini)
    const parte = dens * (hi - lo)
    if (acc + parte >= alvo - 1e-9) return lo + (alvo - acc) / dens
    acc += parte
  }
  return fim
}

/** Totais por serviço de um conjunto de faixas. */
export function totaisPorItem(segs: readonly SegmentoValores[]): Record<string, number> {
  const t: Record<string, number> = {}
  for (const s of segs) for (const [id, v] of Object.entries(s.valores)) t[id] = (t[id] ?? 0) + v
  return t
}

/** Grade com um segmento entre cada par de cortes consecutivos (união das bordas de todas as faixas). */
export function gradeDaUniao(
  cfg: TrechoUnidadeConfig,
  ...conjuntos: readonly (readonly SegmentoValores[])[]
): SegmentoAnalitico[] {
  const cortes = new Set<number>()
  for (const segs of conjuntos)
    for (const s of segs) {
      cortes.add(Math.round(s.ini * 1000) / 1000)
      cortes.add(Math.round(s.fim * 1000) / 1000)
    }
  const pts = [...cortes].sort((a, b) => a - b)
  const out: SegmentoAnalitico[] = []
  for (let i = 1; i < pts.length; i++) {
    const ini = pts[i - 1]!,
      fim = pts[i]!
    if (!(fim > ini + 1e-6)) continue
    out.push({
      ordem: out.length,
      posicao_inicio_m: ini,
      posicao_fim_m: fim,
      unidade_inicio_label: rotuloPosicao(ini, cfg),
      unidade_fim_label: rotuloPosicao(fim, cfg)
    })
  }
  return out
}

/**
 * Sobrepõe quantidades importadas às existentes (o Quantity Import do DynaRoad substitui só os tipos importados):
 * os serviços em `itensImportados` vêm do importado, os demais ficam como estavam. As duas grades são reamostradas
 * na união das bordas, então nenhuma soma muda.
 */
export function fundirSegmentos(
  cfg: TrechoUnidadeConfig,
  existentes: readonly SegmentoValores[],
  importados: readonly SegmentoValores[],
  itensImportados: ReadonlySet<string>
): SegmentoValores[] {
  const soOutros = existentes.map((s) => ({
    ...s,
    valores: Object.fromEntries(
      Object.entries(s.valores).filter(([id]) => !itensImportados.has(id))
    )
  }))
  const soImportados = importados.map((s) => ({
    ...s,
    valores: Object.fromEntries(Object.entries(s.valores).filter(([id]) => itensImportados.has(id)))
  }))
  if (soOutros.every((s) => Object.keys(s.valores).length === 0)) return soImportados
  const grade = gradeDaUniao(cfg, soOutros, soImportados)
  const a = reamostrarSegmentos(soOutros, grade)
  const b = reamostrarSegmentos(soImportados, grade)
  return grade.map((_, k) => ({ ...a[k]!, valores: { ...a[k]!.valores, ...b[k]!.valores } }))
}

/**
 * Faixas do serviço ainda livres: as partes dos segmentos com valor > 0 que nenhum intervalo de `cobertos` (locais
 * "do template" já criados) cobre, fundidas em sequências contíguas — o que "criar tarefas das quantidades" vai usar.
 */
export function faixasLivresDoServico(
  segs: readonly SegmentoValores[],
  itemId: string,
  cobertos: readonly (readonly [number, number])[]
): { ini: number; fim: number; total: number }[] {
  const pedacos: SegmentoValores[] = []
  for (const s of segs) {
    const v = s.valores[itemId] ?? 0
    if (!(v > 0) || !(s.fim > s.ini)) continue
    let livres: [number, number][] = [[s.ini, s.fim]]
    for (const [a, b] of cobertos) {
      const prox: [number, number][] = []
      for (const [x, y] of livres) {
        if (b <= x + 0.005 || a >= y - 0.005) prox.push([x, y])
        else {
          if (a > x + 0.005) prox.push([x, a])
          if (b < y - 0.005) prox.push([b, y])
        }
      }
      livres = prox
    }
    for (const [x, y] of livres)
      pedacos.push({ ...s, ini: x, fim: y, valores: { [itemId]: (v * (y - x)) / (s.fim - s.ini) } })
  }
  return sequenciasContiguas(pedacos, itemId)
}
