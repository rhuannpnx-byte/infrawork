// Relatório por serviço (Previsto × Realizado) — 1 página A4 paisagem por serviço.
//
// Duas responsabilidades, ambas puras:
//   - computarServico(): deriva as séries (semanais/diárias/heatmap/projeção) de
//     um item a partir da curva-S — alimenta tanto o PDF quanto as abas do Excel.
//   - buildRelatorioHtml(): monta o HTML+SVG auto-contido do relatório, impresso
//     no main via printToPDF. Réplica do padrão aprovado pela engenharia.
//
// Projeções terminam ao atingir 100% (sem segmento horizontal no topo); a curva
// estende o eixo até o cruzamento mais tardio (proj. atual costuma passar do fim).

import type { CurvaSPonto, PrevistoRealizadoItem } from '@/types/acompanhamento'

const DAY = 86_400_000

// ── Identidade InfraWork (adaptada p/ fundo claro de impressão) ──
const C = {
  accent: 'oklch(55% 0.18 255)',
  accentSoft: 'oklch(67% 0.18 255)',
  success: 'oklch(58% 0.16 145)',
  warn: 'oklch(64% 0.16 55)',
  danger: 'oklch(60% 0.20 25)',
  violet: 'oklch(58% 0.16 295)',
  ink: 'oklch(28% 0.02 255)',
  text: 'oklch(38% 0.015 255)',
  dim: 'oklch(58% 0.012 255)',
  faint: 'oklch(72% 0.008 255)',
  panelBorder: 'oklch(90% 0.008 255)',
  grid: 'oklch(93% 0.006 255)',
  zebra: 'oklch(98% 0.004 255)'
} as const

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  em_risco: { label: 'Em risco', bg: 'oklch(95% 0.06 80)', fg: 'oklch(45% 0.12 70)' },
  atrasado: { label: 'Atrasado', bg: 'oklch(95% 0.05 25)', fg: 'oklch(50% 0.18 25)' },
  nao_iniciado: { label: 'Não iniciado', bg: 'oklch(95% 0.004 255)', fg: 'oklch(55% 0.01 255)' },
  no_prazo: { label: 'No prazo', bg: 'oklch(95% 0.06 145)', fg: 'oklch(45% 0.14 145)' },
  em_andamento: { label: 'Em andamento', bg: 'oklch(95% 0.05 215)', fg: 'oklch(48% 0.12 230)' },
  adiantado: { label: 'Adiantado', bg: 'oklch(95% 0.05 295)', fg: 'oklch(50% 0.14 295)' },
  concluido: { label: 'Concluído', bg: 'oklch(95% 0.05 195)', fg: 'oklch(45% 0.10 195)' },
  sem_plano: { label: 'Sem plano', bg: 'oklch(95% 0.004 255)', fg: 'oklch(55% 0.01 255)' }
}

const nf = (n: number, d = 1): string =>
  Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtBR = (iso: string): string => { const [y, m, dd] = iso.split('-'); return `${dd}/${m}/${y}` }
const fmtDM = (iso: string): string => { const [, m, dd] = iso.split('-'); return `${dd}/${m}` }
const ms = (iso: string): number => new Date(iso + 'T00:00:00').getTime()
const isoFromMs = (t: number): string => new Date(t).toISOString().slice(0, 10)
const esc = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function isoMonday(iso: string): string { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10) }
function addDays(iso: string, n: number): string { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
function dow(iso: string): number { return new Date(iso + 'T00:00:00').getDay() }
function hojeIso(): string { return new Date().toISOString().slice(0, 10) }

// ─── Tipos das séries derivadas ──────────────────────────────────────────────
export interface SemanaPrevReal { prev: number; real: number; range: string }
export interface SemanaMedia { media: number; range: string }
export interface DiaBarra { v: number; l1: string; l2: string }
export interface ProjStats {
  realHoje: number
  mediaAtual: number | null
  mediaNec: number | null
  crossA: number | null
  crossN: number | null
}
export interface ServicoReportData {
  weeklyPrevReal: SemanaPrevReal[]
  weeklyMedia: SemanaMedia[]
  lastWeekDaily: DiaBarra[]
  lastWeekRange: string | null
  /** Produção diária (unidade do serviço) p/ heatmap. */
  dailyHeat: Array<{ data: string; qtd: number }>
  proj: ProjStats
}
export interface RelatorioServicoInput {
  pr: PrevistoRealizadoItem
  cs: CurvaSPonto[]
}

// ─── Cálculo das séries (puro) ───────────────────────────────────────────────
export function computarServico(pr: PrevistoRealizadoItem, cs: CurvaSPonto[]): ServicoReportData {
  const HOJE = hojeIso()
  const rows = [...cs].sort((a, b) => a.data.localeCompare(b.data))
  const real = rows
    .filter((r) => Number(r.realizado_dia ?? 0) > 0)
    .map((r) => ({ data: r.data, v: Number(r.realizado_dia) }))
  const daily = new Map(real.map((r) => [r.data, r.v]))

  // semanas previsto × realizado (até hoje)
  const wpr = new Map<string, { mon: string; prev: number; real: number; dias: string[] }>()
  for (const r of rows) {
    if (r.data > HOJE) continue
    const mon = isoMonday(r.data)
    const w = wpr.get(mon) ?? { mon, prev: 0, real: 0, dias: [] }
    w.prev += Number(r.planejado_dia ?? 0)
    w.real += Number(r.realizado_dia ?? 0)
    w.dias.push(r.data)
    wpr.set(mon, w)
  }
  const weeksPR = [...wpr.values()]
    .sort((a, b) => a.mon.localeCompare(b.mon))
    .filter((w) => w.prev > 0 || w.real > 0)
    .slice(-8)
  const weeklyPrevReal: SemanaPrevReal[] = weeksPR.map((w) => ({
    prev: w.prev, real: w.real, range: `${fmtDM(w.dias[0])}–${fmtDM(w.dias[w.dias.length - 1])}`
  }))

  // média semanal (sobre dias trabalhados)
  const wmap = new Map<string, { dias: string[]; sum: number }>()
  for (const r of real) {
    const mon = isoMonday(r.data)
    const w = wmap.get(mon) ?? { dias: [], sum: 0 }
    w.dias.push(r.data); w.sum += r.v
    wmap.set(mon, w)
  }
  const weeksMon = [...wmap.keys()].sort()
  const weeklyMedia: SemanaMedia[] = weeksMon.map((mon) => {
    const w = wmap.get(mon)!
    return { media: w.sum / w.dias.length, range: `${fmtDM(w.dias[0])}–${fmtDM(w.dias[w.dias.length - 1])}` }
  })

  // dia-a-dia: última semana COM produção
  let lastWeekDaily: DiaBarra[] = []
  let lastWeekRange: string | null = null
  if (weeksMon.length) {
    const lastMon = weeksMon[weeksMon.length - 1]
    lastWeekDaily = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'].map((nome, i) => {
      const iso = addDays(lastMon, i)
      return { v: daily.get(iso) ?? 0, l1: nome, l2: fmtDM(iso) }
    })
    lastWeekRange = `${fmtDM(lastMon)}–${fmtDM(addDays(lastMon, 5))}`
  }

  // projeções
  let realHoje = 0
  for (const r of rows) if (r.data <= HOJE && Number(r.realizado_acumulado ?? 0) > 0) realHoje = Number(r.realizado_acumulado)
  const qtdTotal = pr.qtd_plan ?? 0
  const restante = Math.max(0, qtdTotal - realHoje)
  const diasRest = pr.data_fim_plan ? Math.max(1, Math.round((ms(pr.data_fim_plan) - ms(HOJE)) / DAY)) : 1
  const trab = real.map((r) => r.v).slice(-15)
  const mediaAtual = trab.length >= 2 ? trab.reduce((a, b) => a + b, 0) / trab.length : null
  const mediaNec = restante > 0 && pr.data_fim_plan ? restante / diasRest : null
  const crossA = mediaAtual && mediaAtual > 0 && restante > 0 ? ms(HOJE) + (restante / mediaAtual) * DAY : null
  const crossN = mediaNec && mediaNec > 0 && restante > 0 ? ms(HOJE) + (restante / mediaNec) * DAY : null

  return {
    weeklyPrevReal,
    weeklyMedia,
    lastWeekDaily,
    lastWeekRange,
    dailyHeat: real.map((r) => ({ data: r.data, qtd: r.v })),
    proj: { realHoje, mediaAtual, mediaNec, crossA, crossN }
  }
}

// ─── SVG: curva-S ────────────────────────────────────────────────────────────
let CLIP_SEQ = 0
function svgCurvaS(cs: CurvaSPonto[], pr: PrevistoRealizadoItem, proj: ProjStats): string {
  const HOJE = hojeIso()
  const W = 1040, Hh = 168, ml = 52, mr = 60, mt = 22, mb = 24
  const iw = W - ml - mr, ih = Hh - mt - mb
  const clip = 'plot' + ++CLIP_SEQ
  const rows = [...cs]
    .sort((a, b) => a.data.localeCompare(b.data))
    .map((p) => ({ t: ms(p.data), plan: Number(p.planejado_acumulado ?? 0), real: Number(p.realizado_acumulado ?? 0) }))
  if (!rows.length) return ''
  const qtdTotal = pr.qtd_plan ?? 0, maxY = qtdTotal * 1.04 || 1
  const t0 = rows[0].t, lastDataT = rows[rows.length - 1].t
  const fimPlanT = pr.data_fim_plan ? ms(pr.data_fim_plan) : lastDataT
  let t1 = Math.max(lastDataT, fimPlanT, proj.crossN ?? 0, proj.crossA ?? 0)
  t1 = Math.min(t1, fimPlanT + 150 * DAY)
  if (t1 <= t0) t1 = t0 + DAY
  const x = (t: number): number => ml + ((t - t0) / (t1 - t0)) * iw
  const yRaw = (v: number): number => mt + ih - (v / maxY) * ih
  const y = (v: number): number => Math.max(mt, Math.min(mt + ih, yRaw(v)))

  const planPts = rows.map((r) => `${x(r.t).toFixed(1)},${y(r.plan).toFixed(1)}`).join(' ')
  const planFlat = lastDataT < t1 ? ` ${x(t1).toFixed(1)},${y(qtdTotal).toFixed(1)}` : ''
  const realRows = rows.filter((r) => r.t <= ms(HOJE) && r.real > 0)
  const realPts = realRows.map((r) => `${x(r.t).toFixed(1)},${y(r.real).toFixed(1)}`).join(' ')
  const areaPlan = `${x(t0).toFixed(1)},${y(0)} ${planPts}${planFlat} ${x(t1).toFixed(1)},${y(0)}`
  const areaReal = realPts ? `${x(realRows[0].t).toFixed(1)},${y(0)} ${realPts} ${x(realRows[realRows.length - 1].t).toFixed(1)},${y(0)}` : ''

  const hojeT = ms(HOJE)
  const projA = proj.crossA != null ? `${x(hojeT).toFixed(1)},${y(proj.realHoje).toFixed(1)} ${x(Math.min(proj.crossA, t1)).toFixed(1)},${y(qtdTotal).toFixed(1)}` : ''
  const projN = proj.crossN != null ? `${x(hojeT).toFixed(1)},${y(proj.realHoje).toFixed(1)} ${x(Math.min(proj.crossN, t1)).toFixed(1)},${y(qtdTotal).toFixed(1)}` : ''

  const yticks = [0, .25, .5, .75, 1].map((f) => { const v = maxY * f; return `<line x1="${ml}" y1="${yRaw(v).toFixed(1)}" x2="${W - mr}" y2="${yRaw(v).toFixed(1)}" stroke="${C.grid}"/><text x="${ml - 6}" y="${(yRaw(v) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="${C.dim}">${nf(v, 0)}</text>` }).join('')
  const monthsLbl = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  let xticks = ''
  for (let t = isoMonday(isoFromMs(t0)); ms(t) <= t1; t = addDays(t, 1)) {
    if (t.endsWith('-01')) {
      const mm = Number(t.split('-')[1])
      xticks += `<text x="${x(ms(t)).toFixed(1)}" y="${Hh - 8}" text-anchor="middle" font-size="9" fill="${C.dim}">${monthsLbl[mm - 1]}</text>`
    }
  }

  const tag = (t: number, label: string, color: string, yTop: number): string => {
    const cx = x(t), cw = label.length * 5.2 + 10
    let rx = cx + 4
    if (rx + cw > W - 2) rx = cx - cw - 4
    rx = Math.max(ml + 1, Math.min(rx, W - cw - 1))
    return `<line x1="${cx.toFixed(1)}" y1="${mt}" x2="${cx.toFixed(1)}" y2="${mt + ih}" stroke="${color}" stroke-width="1" stroke-dasharray="3 3"/>
      <rect x="${rx.toFixed(1)}" y="${yTop}" width="${cw.toFixed(1)}" height="14" rx="3" fill="#fff" stroke="${color}" stroke-width="1"/>
      <text x="${(rx + cw / 2).toFixed(1)}" y="${yTop + 10}" font-size="9" font-weight="700" text-anchor="middle" fill="${color}">${label}</text>`
  }
  let markers = tag(hojeT, 'Hoje', C.warn, mt + 2)
  if (pr.data_fim_plan) markers += tag(fimPlanT, 'Fim plan.', C.accent, mt + 2)
  if (proj.crossA != null && Math.abs(proj.crossA - fimPlanT) > DAY && proj.crossA <= t1) markers += tag(proj.crossA, 'Fim proj.', C.warn, mt + 19)

  return `<svg viewBox="0 0 ${W} ${Hh}" width="100%" preserveAspectRatio="xMidYMid meet">
    <defs><clipPath id="${clip}"><rect x="${ml}" y="${mt}" width="${iw}" height="${ih}"/></clipPath>
    <linearGradient id="gp${clip}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${C.accentSoft}" stop-opacity="0.16"/><stop offset="100%" stop-color="${C.accentSoft}" stop-opacity="0"/></linearGradient>
    <linearGradient id="gr${clip}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${C.success}" stop-opacity="0.22"/><stop offset="100%" stop-color="${C.success}" stop-opacity="0"/></linearGradient></defs>
    ${yticks}${xticks}
    <g clip-path="url(#${clip})">
      <polygon points="${areaPlan}" fill="url(#gp${clip})"/><polyline points="${planPts}${planFlat}" fill="none" stroke="${C.accentSoft}" stroke-width="1.6"/>
      ${areaReal ? `<polygon points="${areaReal}" fill="url(#gr${clip})"/>` : ''}${realPts ? `<polyline points="${realPts}" fill="none" stroke="${C.success}" stroke-width="2"/>` : ''}
      ${projN ? `<polyline points="${projN}" fill="none" stroke="${C.violet}" stroke-width="1.6" stroke-dasharray="6 3"/>` : ''}
      ${projA ? `<polyline points="${projA}" fill="none" stroke="${C.warn}" stroke-width="1.6" stroke-dasharray="6 3"/>` : ''}
    </g>
    ${markers}
  </svg>`
}

// ─── Heatmap (janela rolante 30 dias / 5 semanas) ────────────────────────────
function heatColor(r: number): string {
  if (r <= 0) return 'oklch(97% 0.004 255)'
  if (r < 0.2) return 'oklch(94% 0.05 85)'
  if (r < 0.4) return 'oklch(88% 0.10 75)'
  if (r < 0.6) return 'oklch(80% 0.14 60)'
  if (r < 0.8) return 'oklch(70% 0.17 45)'
  return 'oklch(60% 0.20 30)'
}
function calendarioHeatmap(dailyMap: Map<string, number>): string {
  const HOJE = hojeIso()
  const janIni = addDays(HOJE, -29)
  let sat = HOJE; while (dow(sat) !== 6) sat = addDays(sat, 1)
  const start = addDays(sat, -34)
  const days: string[] = []
  for (let cur = start; cur <= sat; cur = addDays(cur, 1)) days.push(cur)
  let max = 0
  for (const iso of days) if (iso >= janIni && iso <= HOJE) max = Math.max(max, dailyMap.get(iso) ?? 0)
  max = max || 1
  const head = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((l) => `<div class="cal-h">${l}</div>`).join('')
  const body = days.map((iso) => {
    const dnum = Number(iso.split('-')[2])
    const fora = iso < janIni || iso > HOJE
    if (fora) return `<div class="cal-cell ${iso > HOJE ? 'future' : 'fora'}"><span class="cal-dnum">${dnum}</span></div>`
    const qtd = dailyMap.get(iso) ?? 0, ratio = qtd / max, dark = ratio >= 0.6
    return `<div class="cal-cell" style="background:${heatColor(ratio)}"><span class="cal-q" style="color:${dark ? '#fff' : C.ink}">${qtd > 0 ? nf(qtd, 0) : ''}</span><span class="cal-dnum" style="color:${dark ? 'rgba(255,255,255,.8)' : C.dim}">${dnum}</span></div>`
  }).join('')
  return `<div class="cal"><div class="cal-grid cal-head">${head}</div><div class="cal-grid cal-body">${body}</div></div>`
}

function svgBars(items: DiaBarra[], color: string, decimals = 0): string {
  const W = 503, Hh = 150, ml = 8, mr = 8, mt = 18, mb = 30
  const iw = W - ml - mr, ih = Hh - mt - mb
  const max = Math.max(1, ...items.map((i) => i.v)) * 1.2, bw = iw / items.length
  const bars = items.map((it, idx) => {
    const h = (it.v / max) * ih, bx = ml + idx * bw + bw * 0.16, bwi = bw * 0.68, by = mt + ih - h
    return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bwi.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="2" fill="${color}"/>
      <text x="${(bx + bwi / 2).toFixed(1)}" y="${(by - 4).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="600" fill="${C.ink}">${it.v > 0 ? nf(it.v, decimals) : ''}</text>
      <text x="${(bx + bwi / 2).toFixed(1)}" y="${(mt + ih + 13).toFixed(1)}" text-anchor="middle" font-size="9" fill="${C.dim}">${it.l1}</text>
      <text x="${(bx + bwi / 2).toFixed(1)}" y="${(mt + ih + 24).toFixed(1)}" text-anchor="middle" font-size="8" fill="${C.faint}">${it.l2 || ''}</text>`
  }).join('')
  return `<svg viewBox="0 0 ${W} ${Hh}" width="100%" preserveAspectRatio="xMidYMid meet"><line x1="${ml}" y1="${mt + ih}" x2="${W - mr}" y2="${mt + ih}" stroke="${C.grid}"/>${bars}</svg>`
}

function svgPrevRealBars(weeks: SemanaPrevReal[]): string {
  const W = 503, Hh = 150, ml = 8, mr = 8, mt = 30, mb = 30
  const iw = W - ml - mr, ih = Hh - mt - mb
  const max = Math.max(1, ...weeks.flatMap((w) => [w.prev, w.real])) * 1.22
  const bw = iw / weeks.length
  const body = weeks.map((w, idx) => {
    const cx = ml + idx * bw + bw / 2
    const wideW = Math.min(52, bw * 0.62), thinW = Math.min(20, bw * 0.26)
    const hp = (w.prev / max) * ih, hr = (w.real / max) * ih
    const yp = mt + ih - hp, yr = mt + ih - hr
    const delta = w.real - w.prev, dColor = delta >= 0 ? C.success : C.danger
    const top = Math.min(yp, yr)
    return `<rect x="${(cx - wideW / 2).toFixed(1)}" y="${yp.toFixed(1)}" width="${wideW.toFixed(1)}" height="${Math.max(0, hp).toFixed(1)}" rx="2" fill="${C.accentSoft}" fill-opacity="0.15" stroke="${C.accentSoft}" stroke-width="1"/>
      <rect x="${(cx - thinW / 2).toFixed(1)}" y="${yr.toFixed(1)}" width="${thinW.toFixed(1)}" height="${Math.max(0, hr).toFixed(1)}" rx="1.5" fill="${C.success}"/>
      <text x="${cx.toFixed(1)}" y="${(top - 14).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${C.ink}">${nf(w.real, 0)}</text>
      <text x="${cx.toFixed(1)}" y="${(top - 4).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="${dColor}">${delta >= 0 ? '+' : ''}${nf(delta, 0)}</text>
      <text x="${cx.toFixed(1)}" y="${(mt + ih + 13).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="600" fill="${C.text}">Sem ${idx + 1}</text>
      <text x="${cx.toFixed(1)}" y="${(mt + ih + 24).toFixed(1)}" text-anchor="middle" font-size="8" fill="${C.faint}">${w.range}</text>`
  }).join('')
  return `<svg viewBox="0 0 ${W} ${Hh}" width="100%" preserveAspectRatio="xMidYMid meet"><line x1="${ml}" y1="${mt + ih}" x2="${W - mr}" y2="${mt + ih}" stroke="${C.grid}"/>${body}</svg>`
}

function svgMediaSemanal(weeks: SemanaMedia[], mediaNec: number): string {
  const W = 503, Hh = 150, ml = 40, mr = 18, mt = 24, mb = 30, pad = 16
  const iw = W - ml - mr, ih = Hh - mt - mb
  const max = Math.max(mediaNec, ...weeks.map((w) => w.media)) * 1.18 || 1
  const x = (i: number): number => ml + pad + (weeks.length === 1 ? (iw - 2 * pad) / 2 : (i / (weeks.length - 1)) * (iw - 2 * pad))
  const y = (v: number): number => mt + ih - (v / max) * ih
  const pts = weeks.map((w, i) => `${x(i).toFixed(1)},${y(w.media).toFixed(1)}`).join(' ')
  const dots = weeks.map((w, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(w.media).toFixed(1)}" r="3.5" fill="${C.success}"/>
    <text x="${x(i).toFixed(1)}" y="${(y(w.media) - 8).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="600" fill="${C.success}">${nf(w.media, 1)}</text>
    <text x="${x(i).toFixed(1)}" y="${(mt + ih + 13).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="600" fill="${C.text}">Sem ${i + 1}</text>
    <text x="${x(i).toFixed(1)}" y="${(mt + ih + 24).toFixed(1)}" text-anchor="middle" font-size="8" fill="${C.faint}">${w.range}</text>`).join('')
  const yNec = y(mediaNec)
  const yticks = [0, .5, 1].map((f) => { const v = max * f; return `<line x1="${ml}" y1="${y(v).toFixed(1)}" x2="${W - mr}" y2="${y(v).toFixed(1)}" stroke="${C.grid}"/><text x="${ml - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="${C.dim}">${nf(v, 0)}</text>` }).join('')
  return `<svg viewBox="0 0 ${W} ${Hh}" width="100%" preserveAspectRatio="xMidYMid meet">${yticks}
    <line x1="${ml}" y1="${yNec.toFixed(1)}" x2="${W - mr}" y2="${yNec.toFixed(1)}" stroke="${C.violet}" stroke-width="1.5" stroke-dasharray="7 4"/>
    <polyline points="${pts}" fill="none" stroke="${C.success}" stroke-width="2.2"/>${dots}</svg>`
}

function pagina(pr: PrevistoRealizadoItem, cs: CurvaSPonto[], d: ServicoReportData, obraNome: string, logoSrc: string): string {
  const HOJE = hojeIso()
  const st = STATUS[pr.status] ?? STATUS.nao_iniciado
  const un = pr.unidade ?? ''
  const temReal = (pr.qtd_real ?? 0) > 0
  const pct = (pr.pct_avanco ?? 0) * 100
  const daily = new Map(d.dailyHeat.map((x) => [x.data, x.qtd]))
  const kpi = (l: string, v: string, s?: string): string => `<div class="kpi"><div class="kpi-l">${l}</div><div class="kpi-v">${v}</div>${s ? `<div class="kpi-s">${s}</div>` : ''}</div>`
  const stats =
    `${d.proj.mediaAtual != null ? `<span><b style="color:${C.warn}">média atual</b> ${nf(d.proj.mediaAtual, 0)}/dia</span>` : ''}` +
    `${d.proj.mediaNec != null ? `<span><b style="color:${C.violet}">média necessária</b> ${nf(d.proj.mediaNec, 0)}/dia</span>` : ''}` +
    `${pr.data_fim_plan ? `<span><b style="color:${C.accent}">fim plan.</b> ${fmtBR(pr.data_fim_plan)}</span>` : ''}` +
    `${d.proj.crossA != null ? `<span><b style="color:${C.warn}">fim proj.</b> ${fmtBR(isoFromMs(d.proj.crossA))}</span>` : ''}`
  const legPR = `<span class="leg"><i class="wide"></i>Previsto <i class="thin"></i>Realizado</span>`
  const legMedia = `<span class="leg"><i style="background:${C.success}"></i>Produtiva <i class="dash" style="border-color:${C.violet}"></i>Necessária ${nf(d.proj.mediaNec ?? 0, 0)}</span>`
  const mesLabel = new Date(HOJE + 'T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  return `<section class="page">
    <header class="phead"><div class="phead-l"><img class="logo" src="${logoSrc}"/><div class="div"></div>
      <div><div class="svc-code">${esc(pr.codigo)} · <span class="svc-name">${esc(pr.descricao)}</span></div>
      <div class="svc-meta">Unidade ${esc(un)} · ${esc(obraNome)} · gerado em ${fmtBR(HOJE)}</div></div></div>
      <span class="chip" style="background:${st.bg};color:${st.fg}">${st.label}</span></header>
    <div class="kpis">
      ${kpi('Qtd planejada', nf(pr.qtd_plan ?? 0, 0) + ' ' + un)}${kpi('Qtd plan. período', nf(pr.qtd_plan_periodo ?? 0, 0) + ' ' + un)}
      ${kpi('Qtd realizada', nf(pr.qtd_real ?? 0, 0) + ' ' + un)}${kpi('Avanço', nf(pct, 1) + '%')}
      ${kpi('Dias plan', pr.dias_plan != null ? String(pr.dias_plan) : '—', pr.data_inicio_plan && pr.data_fim_plan ? `${fmtBR(pr.data_inicio_plan)} → ${fmtBR(pr.data_fim_plan)}` : undefined)}${kpi('Dias real', pr.dias_real != null ? String(pr.dias_real) : '—')}</div>
    <div class="panel"><div class="panel-t">Curva-S — Realizado × Previsto × Projeções
      <span class="leg"><i style="background:${C.accentSoft}"></i>Planejado <i style="background:${C.success}"></i>Realizado <i class="dash" style="border-color:${C.warn}"></i>Proj. atual <i class="dash" style="border-color:${C.violet}"></i>Proj. necessária</span></div>
      <div class="stats">${stats}</div>${svgCurvaS(cs, pr, d.proj)}</div>
    <div class="row2">
      <div class="panel"><div class="panel-t">Calor de produção — últimos 30 dias <span class="panel-sub">(${un}/dia · ${mesLabel})</span></div>
        ${temReal ? calendarioHeatmap(daily) : '<div class="empty-box">Sem produção apontada no período</div>'}</div>
      <div class="panel"><div class="panel-t">Produção dia-a-dia <span class="panel-sub">${d.lastWeekRange ? '· semana ' + d.lastWeekRange + ' (' + un + ')' : '(' + un + ')'}</span></div>
        ${temReal && d.lastWeekDaily.length ? svgBars(d.lastWeekDaily, C.accent, 1) : '<div class="empty-box">Sem produção apontada</div>'}</div></div>
    <div class="row2">
      <div class="panel"><div class="panel-t">Produção por semana — previsto × realizado <span class="panel-sub">(${un})</span>${legPR}</div>
        ${d.weeklyPrevReal.length ? svgPrevRealBars(d.weeklyPrevReal) : '<div class="empty-box">Sem dados de planejamento no período</div>'}</div>
      <div class="panel"><div class="panel-t">Média semanal × necessária <span class="panel-sub">(${un}/dia)</span>${legMedia}</div>
        ${temReal && d.weeklyMedia.length ? svgMediaSemanal(d.weeklyMedia, d.proj.mediaNec ?? 0) : '<div class="empty-box">Sem produção para calcular ritmo</div>'}</div></div>
    <footer class="pfoot"><span>InfraWork · Gestão integrada de obras rodoviárias</span></footer>
  </section>`
}

const CSS = `
  @page { size: A4 landscape; margin: 9mm; }
  * { box-sizing:border-box; } html,body { margin:0; padding:0; }
  body { font-family:"Segoe UI",system-ui,sans-serif; color:${C.text}; background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .page { width:100%; height:192mm; page-break-after:always; padding:0; display:flex; flex-direction:column; overflow:hidden; }
  .page:last-child { page-break-after:auto; }
  .phead { display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid ${C.accent}; padding-bottom:5px; margin-bottom:6px; }
  .phead-l { display:flex; align-items:center; gap:11px; }
  .logo { height:34px; width:34px; } .div { width:1px; height:30px; background:${C.panelBorder}; }
  .svc-code { font-size:15px; font-weight:700; color:${C.ink}; } .svc-name { font-weight:600; color:${C.accent}; }
  .svc-meta { font-size:8.5px; color:${C.dim}; margin-top:1px; }
  .chip { padding:3px 10px; border-radius:99px; font-size:9.5px; font-weight:700; }
  .kpis { display:grid; grid-template-columns:repeat(6,1fr); gap:5px; margin-bottom:6px; }
  .kpi { border:1px solid ${C.panelBorder}; border-radius:5px; padding:4px 8px; background:${C.zebra}; }
  .kpi-l { font-size:7.5px; text-transform:uppercase; letter-spacing:.4px; color:${C.dim}; }
  .kpi-v { font-size:13px; font-weight:700; color:${C.ink}; } .kpi-s { font-size:7px; color:${C.faint}; }
  .panel { border:1px solid ${C.panelBorder}; border-radius:6px; padding:5px 9px 3px; margin-bottom:6px; background:#fff; }
  .panel-t { font-size:10px; font-weight:600; color:${C.ink}; margin-bottom:2px; display:flex; align-items:center; gap:8px; }
  .panel-sub { font-size:8.5px; font-weight:400; color:${C.dim}; }
  .stats { display:flex; gap:14px; font-size:8.5px; color:${C.dim}; margin-bottom:2px; } .stats b { font-weight:700; }
  .leg { margin-left:auto; font-size:8px; color:${C.dim}; font-weight:400; display:flex; align-items:center; gap:5px; }
  .leg i { display:inline-block; width:9px; height:3px; border-radius:2px; margin-right:2px; }
  .leg i.dash { width:11px; height:0; border-top:2px dashed; border-radius:0; }
  .leg i.wide { width:12px; height:9px; background:${C.accentSoft}; opacity:.25; border:1px solid ${C.accentSoft}; border-radius:1px; }
  .leg i.thin { width:5px; height:11px; background:${C.success}; border-radius:1px; }
  .row2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .empty-box { height:118px; display:flex; align-items:center; justify-content:center; font-size:10px; color:${C.faint}; border:1px dashed ${C.panelBorder}; border-radius:5px; }
  .cal { padding:1px 0; } .cal-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; }
  .cal-h { text-align:center; font-size:7.5px; color:${C.dim}; font-weight:600; padding-bottom:1px; }
  .cal-cell { height:21px; border-radius:3px; border:1px solid ${C.grid}; position:relative; }
  .cal-cell.fora { background:${C.zebra}; opacity:.5; } .cal-cell.future { background:repeating-linear-gradient(45deg,#fafafa,#fafafa 3px,#f2f2f2 3px,#f2f2f2 6px); }
  .cal-q { position:absolute; top:50%; left:2px; transform:translateY(-50%); font-size:9px; font-weight:700; font-variant-numeric:tabular-nums; }
  .cal-dnum { position:absolute; bottom:1px; right:3px; font-size:6.5px; }
  .pfoot { margin-top:auto; padding-top:6px; border-top:1px solid ${C.grid}; display:flex; justify-content:space-between; font-size:7.5px; color:${C.faint}; }
`

/** HTML auto-contido do relatório (1 página por serviço). */
export function buildRelatorioHtml(
  servicos: RelatorioServicoInput[],
  opts: { obraNome: string; logoDataUrl: string }
): string {
  CLIP_SEQ = 0
  const paginas = servicos
    .map((s) => pagina(s.pr, s.cs, computarServico(s.pr, s.cs), opts.obraNome, opts.logoDataUrl))
    .join('')
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><style>${CSS}</style></head><body>${paginas}</body></html>`
}
