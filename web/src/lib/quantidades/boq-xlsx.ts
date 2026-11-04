/**
 * Planilha de quantidades por local (o "Quantity Import" do DynaRoad, adaptado ao InfraWork).
 *
 * Cada aba é um local. O cabeçalho é achado varrendo as células (sem acento nem caixa):
 * - **por ponto** (DynaRoad): a célula "Estaca" (Station, Est, km, Posição, PK) e, à direita, uma coluna por serviço;
 *   cada linha é uma estaca com a quantidade de cada serviço naquele ponto. A quantidade vale de meio caminho da
 *   estaca anterior a meio caminho da seguinte (nas pontas, a própria estaca); o zero fecha a sequência.
 * - **por faixa** (modelo do InfraWork): "Início" e "Fim" (+ "Unid inicial/final" opcionais) e os serviços.
 * - **áreas**: "Área" e os serviços, uma linha por área (Estaca/Distância do DynaRoad são ignoradas).
 * Linha de unidades opcional entre o cabeçalho e os dados. Erros sempre citam aba e célula.
 */
import ExcelJS from 'exceljs'
import { loadWorkbookFromFile } from '@/lib/xlsx/download'
import { marcadorToMetros, parseMarcador, type TrechoCtx } from '@/lib/format/posicao'
import { type TrechoUnidadeConfig } from './grade'
import { faixasDosPontos, type SegmentoValores } from './segmentos'

export type LayoutAba = 'ponto' | 'faixa' | 'areas'

export interface ColunaBoq {
  /** coluna (1-based) */
  col: number
  titulo: string
  unidade: string | null
}
export interface LinhaPonto {
  linha: number
  estaca: number | string
  /** col → valor */
  valores: Record<number, number>
}
export interface LinhaFaixa {
  linha: number
  ini: number | string
  fim: number | string
  valores: Record<number, number>
}
export interface LinhaArea {
  linha: number
  nome: string
  valores: Record<number, number>
}
export interface AbaBoq {
  nome: string
  layout: LayoutAba
  colunas: ColunaBoq[]
  /** coluna da estaca (ponto) ou do início (faixa) */
  colEstaca: number
  /** cabeçalhos "(m)": início/fim em metros internos; senão, valor do marcador (km, estaca…) */
  emMetros: boolean
  pontos: LinhaPonto[]
  faixas: LinhaFaixa[]
  areas: LinhaArea[]
}
export interface ErroBoq {
  aba: string
  celula: string
  mensagem: string
}
export interface LeituraBoq {
  abas: AbaBoq[]
  /** abas sem tabela de quantidades */
  ignoradas: string[]
  erros: ErroBoq[]
}

export const normalizarTexto = (v: unknown): string =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

const ESTACA = new Set([
  'estaca',
  'estacas',
  'station',
  'est',
  'km',
  'posicao',
  'pk',
  'estaqueamento',
  'estaca (m)',
  'posicao (m)'
])
const AREA = new Set(['area', 'areas', 'local', 'praca', 'location'])
const IGNORAR = /^(unid|unidade|rotulo|label|distancia|distance|obs|observac)/
const INICIO = /^(inicio|in[ií]cio|de|start)\b/
const FIM = /^(fim|final|ate|at[eé]|end|finish)\b/
const TOTAL = /^(total|soma|subtotal)\b/

export const ref = (linha: number, col: number): string => {
  let s = ''
  let c = col
  while (c > 0) {
    const m = (c - 1) % 26
    s = String.fromCharCode(65 + m) + s
    c = Math.floor((c - 1) / 26)
  }
  return `${s}${linha}`
}

/** Número de uma célula (número, fórmula com resultado ou texto pt-BR/en). */
export function numeroCelula(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'object' && v && 'result' in v)
    return numeroCelula((v as { result: unknown }).result)
  if (typeof v === 'object' && v && 'richText' in v)
    return numeroCelula(
      (v as { richText: { text: string }[] }).richText.map((x) => x.text).join('')
    )
  const s = String(v).trim().replace(/\s/g, '')
  if (!s || !/^-?[\d.,]+$/.test(s)) return null
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s)
  return Number.isFinite(n) ? n : null
}

const texto = (v: unknown): string => {
  if (v == null) return ''
  if (typeof v === 'object' && v && 'richText' in v)
    return (v as { richText: { text: string }[] }).richText.map((x) => x.text).join('')
  if (typeof v === 'object' && v && 'result' in v) return texto((v as { result: unknown }).result)
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

function lerAba(ws: ExcelJS.Worksheet, erros: ErroBoq[]): AbaBoq | null {
  const nome = ws.name
  const maxR = Math.min(ws.rowCount, 80)
  const maxC = Math.min(ws.columnCount || 40, 60)
  const cel = (r: number, c: number): string =>
    normalizarTexto(texto(ws.getRow(r).getCell(c).value))
  const bruto = (r: number, c: number): unknown => ws.getRow(r).getCell(c).value
  let hdr: { r: number; c: number; layout: LayoutAba } | null = null
  for (let c = 1; c <= maxC && !hdr; c++)
    for (let r = 1; r <= maxR && !hdr; r++) {
      const t = cel(r, c)
      if (!t) continue
      if (INICIO.test(t) && FIM.test(cel(r, c + 1))) hdr = { r, c, layout: 'faixa' }
      else if (AREA.has(t)) hdr = { r, c, layout: 'areas' }
      else if (ESTACA.has(t) || /^estaca\b/.test(t)) hdr = { r, c, layout: 'ponto' }
    }
  if (!hdr) return null
  const { r, c, layout } = hdr
  const primeiraServ = layout === 'faixa' ? c + 2 : c + 1
  const colunas: ColunaBoq[] = []
  for (let k = primeiraServ; k <= maxC; k++) {
    const t = texto(bruto(r, k)).trim()
    if (!t) continue
    const n = normalizarTexto(t)
    if (IGNORAR.test(n) || (layout === 'areas' && (ESTACA.has(n) || n === 'distancia'))) continue
    colunas.push({ col: k, titulo: t, unidade: null })
  }
  if (colunas.length === 0) {
    erros.push({
      aba: nome,
      celula: ref(r, c),
      mensagem: 'Cabeçalho sem colunas de serviço à direita'
    })
    return null
  }
  const emMetros = /\(m\)/.test(normalizarTexto(bruto(r, c))) || /\(m\)/.test(cel(r, c + 1))
  const ehDado = (rr: number): boolean => {
    const v = bruto(rr, c)
    if (layout === 'areas') return texto(v).trim() !== '' && !TOTAL.test(normalizarTexto(v))
    if (numeroCelula(v) !== null) return true
    const t = texto(v).trim()
    return /\d/.test(t) && !TOTAL.test(normalizarTexto(t))
  }
  // linha de unidades (opcional): a única não vazia entre o cabeçalho e o primeiro dado
  let ini = r + 1
  const unidades: number[] = []
  while (ini <= ws.rowCount && !ehDado(ini)) {
    const vazia =
      colunas.every((k) => texto(bruto(ini, k.col)).trim() === '') &&
      texto(bruto(ini, c)).trim() === ''
    if (!vazia) unidades.push(ini)
    ini++
  }
  if (unidades.length > 1) {
    erros.push({
      aba: nome,
      celula: ref(unidades[1]!, c),
      mensagem: 'Mais de uma linha entre o cabeçalho e os dados (só a linha de unidades é aceita)'
    })
    return null
  }
  if (unidades.length === 1)
    for (const k of colunas) k.unidade = texto(bruto(unidades[0]!, k.col)).trim() || null

  const aba: AbaBoq = {
    nome,
    layout,
    colunas,
    colEstaca: c,
    emMetros,
    pontos: [],
    faixas: [],
    areas: []
  }
  const valoresDe = (rr: number): Record<number, number> | null => {
    const out: Record<number, number> = {}
    for (const k of colunas) {
      const v = bruto(rr, k.col)
      if (v == null || v === '') continue
      const n = numeroCelula(v)
      if (n === null) {
        erros.push({
          aba: nome,
          celula: ref(rr, k.col),
          mensagem: `Quantidade não numérica: "${texto(v).trim()}"`
        })
        return null
      }
      if (n < 0) {
        erros.push({ aba: nome, celula: ref(rr, k.col), mensagem: 'Quantidade negativa' })
        return null
      }
      out[k.col] = n
    }
    return out
  }
  for (let rr = ini; rr <= ws.rowCount; rr++) {
    const chave = bruto(rr, c)
    const chaveTxt = texto(chave).trim()
    const vals = valoresDe(rr)
    if (vals === null) continue
    const algum = Object.keys(vals).length > 0
    if (layout === 'areas') {
      if (!chaveTxt && !algum) continue
      if (!chaveTxt) {
        erros.push({ aba: nome, celula: ref(rr, c), mensagem: 'Área sem nome' })
        continue
      }
      if (TOTAL.test(normalizarTexto(chaveTxt))) {
        erros.push({
          aba: nome,
          celula: ref(rr, c),
          mensagem: 'Linha de soma dentro da tabela — remova as linhas de total'
        })
        continue
      }
      aba.areas.push({ linha: rr, nome: chaveTxt, valores: vals })
      continue
    }
    if (!chaveTxt) {
      if (algum) erros.push({ aba: nome, celula: ref(rr, c), mensagem: 'Quantidade sem estaca' })
      continue
    }
    if (TOTAL.test(normalizarTexto(chaveTxt))) {
      erros.push({
        aba: nome,
        celula: ref(rr, c),
        mensagem: 'Linha de soma abaixo da tabela — remova as linhas de total'
      })
      continue
    }
    const est = numeroCelula(chave) ?? chaveTxt
    if (layout === 'ponto') {
      aba.pontos.push({ linha: rr, estaca: est, valores: vals })
    } else {
      const fimB = bruto(rr, c + 1)
      const fimTxt = texto(fimB).trim()
      if (!fimTxt) {
        erros.push({ aba: nome, celula: ref(rr, c + 1), mensagem: 'Faixa sem fim' })
        continue
      }
      aba.faixas.push({ linha: rr, ini: est, fim: numeroCelula(fimB) ?? fimTxt, valores: vals })
    }
  }
  return aba
}

export function lerPlanilhaQuantidades(wb: ExcelJS.Workbook): LeituraBoq {
  const erros: ErroBoq[] = []
  const abas: AbaBoq[] = []
  const ignoradas: string[] = []
  for (const ws of wb.worksheets) {
    if (ws.state === 'hidden' || ws.state === 'veryHidden') continue
    if (normalizarTexto(ws.name) === 'servicos') continue
    const aba = lerAba(ws, erros)
    if (aba) abas.push(aba)
    else ignoradas.push(ws.name)
  }
  return { abas, ignoradas, erros }
}

export async function lerPlanilhaQuantidadesArquivo(file: File): Promise<LeituraBoq> {
  const wb = await loadWorkbookFromFile(file)
  return lerPlanilhaQuantidades(wb)
}

// ── conversão em faixas do local ───────────────────────────────────────────────────────────────────────────────

export interface ConversaoAba {
  segmentos: SegmentoValores[]
  erros: ErroBoq[]
  /** item_orcamentario_id → total */
  totais: Record<string, number>
  /** menor e maior estaca lidas (metros internos) */
  minM: number | null
  maxM: number | null
}

/** Estaca da planilha (número = valor do marcador; texto = "125+10", "EST 125", "2+500") → metros internos. */
export function estacaParaMetros(v: number | string, ctx: TrechoCtx): number | null {
  if (typeof v === 'number') {
    const m = marcadorToMetros(v, ctx)
    return Number.isFinite(m) ? Math.round(m * 1000) / 1000 : null
  }
  const r = parseMarcador(
    String(v)
      .trim()
      .replace(/^km\s*/i, ''),
    { ...ctx, geometry_comprimento_m: null }
  )
  return r.metros === null ? null : Math.round(r.metros * 1000) / 1000
}

/**
 * Converte uma aba (ponto ou faixa) em faixas do local, com o mapeamento coluna → serviço. `umaUnidade` = metros de
 * uma unidade do estaqueamento (a faixa de um ponto isolado). Abas de área não passam por aqui.
 */
export function converterAba(
  aba: AbaBoq,
  ctx: TrechoCtx,
  cfg: Pick<TrechoUnidadeConfig, 'geometry_comprimento_m'>,
  mapa: ReadonlyMap<number, string>,
  umaUnidade: number
): ConversaoAba {
  const erros: ErroBoq[] = []
  const segmentos: SegmentoValores[] = []
  const comp = Number(cfg.geometry_comprimento_m) || 0
  const cols = aba.colunas.filter((k) => mapa.has(k.col))
  const valoresMapeados = (v: Record<number, number>): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const k of cols) {
      const x = v[k.col]
      if (x && x > 0) out[mapa.get(k.col)!] = (out[mapa.get(k.col)!] ?? 0) + x
    }
    return out
  }
  if (aba.layout === 'ponto') {
    let pontos = aba.pontos
    let metros = pontos.map((p) => estacaParaMetros(p.estaca, ctx))
    // eixo de numeração decrescente com a planilha em ordem de marcador: em metros internos fica decrescente
    if (
      metros.length > 1 &&
      metros.every((m, i) => m !== null && (i === 0 || m < (metros[i - 1] as number)))
    ) {
      pontos = [...pontos].reverse()
      metros = [...metros].reverse()
    }
    const estacas: number[] = []
    pontos.forEach((p, i) => {
      const m = metros[i]!
      if (m === null || m < -0.005) {
        erros.push({
          aba: aba.nome,
          celula: ref(p.linha, aba.colEstaca),
          mensagem: `Estaca inválida: "${p.estaca}"`
        })
        return
      }
      if (estacas.length && m <= estacas[estacas.length - 1]! + 1e-6) {
        erros.push({
          aba: aba.nome,
          celula: ref(p.linha, aba.colEstaca),
          mensagem: 'As estacas precisam ser crescentes (linha de soma abaixo da tabela?)'
        })
        return
      }
      estacas.push(Math.max(0, m))
    })
    if (erros.length === 0 && estacas.length) {
      const faixas = faixasDosPontos(estacas, umaUnidade)
      pontos.forEach((p, i) => {
        const f = faixas[i]!
        segmentos.push({
          ini: f[0],
          fim: f[1],
          label_ini: '',
          label_fim: '',
          valores: valoresMapeados(p.valores)
        })
      })
    }
  } else if (aba.layout === 'faixa') {
    for (const fx of aba.faixas) {
      const a = aba.emMetros && typeof fx.ini === 'number' ? fx.ini : estacaParaMetros(fx.ini, ctx)
      const b = aba.emMetros && typeof fx.fim === 'number' ? fx.fim : estacaParaMetros(fx.fim, ctx)
      if (a === null) {
        erros.push({
          aba: aba.nome,
          celula: ref(fx.linha, aba.colEstaca),
          mensagem: `Início inválido: "${fx.ini}"`
        })
        continue
      }
      if (b === null) {
        erros.push({
          aba: aba.nome,
          celula: ref(fx.linha, aba.colEstaca + 1),
          mensagem: `Fim inválido: "${fx.fim}"`
        })
        continue
      }
      const ini = Math.max(0, Math.min(a, b)),
        fim = Math.max(a, b)
      if (!(fim > ini)) {
        erros.push({
          aba: aba.nome,
          celula: ref(fx.linha, aba.colEstaca),
          mensagem: 'Faixa de comprimento zero'
        })
        continue
      }
      segmentos.push({
        ini,
        fim,
        label_ini: '',
        label_fim: '',
        valores: valoresMapeados(fx.valores)
      })
    }
    segmentos.sort((x, y) => x.ini - y.ini)
    for (let i = 1; i < segmentos.length; i++)
      if (segmentos[i]!.ini < segmentos[i - 1]!.fim - 0.005) {
        erros.push({
          aba: aba.nome,
          celula: ref(aba.faixas[i]?.linha ?? 0, aba.colEstaca),
          mensagem: 'Faixas sobrepostas'
        })
        break
      }
  }
  if (comp > 0)
    for (const s of segmentos)
      if (s.fim > comp + 0.005) {
        erros.push({
          aba: aba.nome,
          celula: '',
          mensagem: `Faixa até ${s.fim} m passa do comprimento do local (${comp} m)`
        })
        break
      }
  const totais: Record<string, number> = {}
  for (const s of segmentos)
    for (const [id, v] of Object.entries(s.valores)) totais[id] = (totais[id] ?? 0) + v
  const ms = segmentos.flatMap((s) => [s.ini, s.fim])
  return {
    segmentos,
    erros,
    totais,
    minM: ms.length ? Math.min(...ms) : null,
    maxM: ms.length ? Math.max(...ms) : null
  }
}

/** Uma área da aba de áreas → o segmento único 0–1 do template da área. */
export function converterArea(
  linha: LinhaArea,
  mapa: ReadonlyMap<number, string>
): SegmentoValores {
  const valores: Record<string, number> = {}
  for (const [col, v] of Object.entries(linha.valores)) {
    const id = mapa.get(Number(col))
    if (id && v > 0) valores[id] = (valores[id] ?? 0) + v
  }
  return { ini: 0, fim: 1, label_ini: 'área', label_fim: 'área', valores }
}

// ── escrita (ida e volta): uma aba por eixo no layout por faixa + aba de áreas ────────────────────────────────

export interface ServicoPlanilha {
  id: string
  codigo: string
  descricao: string
  unidade: string
}
export interface LocalPlanilha {
  nome: string
  tipo: 'eixo' | 'area'
  segmentos: SegmentoValores[]
}

export const cabecalhoServico = (s: ServicoPlanilha): string =>
  `${s.codigo} ${s.descricao} (${s.unidade || '—'})`

const nomeAba = (s: string, usados: Set<string>): string => {
  const base =
    s
      .replace(/[[\]*?:/\\]/g, '-')
      .trim()
      .slice(0, 28) || 'Local'
  let nome = base
  let k = 2
  while (usados.has(nome.toLowerCase())) nome = `${base.slice(0, 25)} ${k++}`
  usados.add(nome.toLowerCase())
  return nome
}

export async function gerarPlanilhaQuantidades(opts: {
  obraNome: string
  servicos: ServicoPlanilha[]
  locais: LocalPlanilha[]
}): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'InfraWork'
  const usados = new Set<string>(['servicos', 'areas'])
  const estilo = (ws: ExcelJS.Worksheet, headers: string[], linha: number): void => {
    headers.forEach((h, i) => {
      const c = ws.getCell(linha, i + 1)
      c.value = h
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
      c.alignment = { wrapText: true, vertical: 'middle' }
    })
    ws.getRow(linha).height = 32
  }
  for (const l of opts.locais.filter((x) => x.tipo === 'eixo')) {
    const ws = wb.addWorksheet(nomeAba(l.nome, usados), { views: [{ state: 'frozen', ySplit: 3 }] })
    ws.getCell('A1').value = `Quantidades por estaca — ${l.nome} · ${opts.obraNome}`
    ws.getCell('A1').font = { bold: true, size: 12 }
    ws.getCell('A2').value =
      'Uma linha por faixa (Início e Fim em metros internos do eixo, ou o marcador nas colunas Unid). Sem linhas de total abaixo da tabela.'
    ws.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF6B7280' } }
    const headers = [
      'Início (m)',
      'Fim (m)',
      'Unid inicial',
      'Unid final',
      ...opts.servicos.map(cabecalhoServico)
    ]
    estilo(ws, headers, 3)
    ws.columns = headers.map((_, i) => ({ width: i < 2 ? 12 : i < 4 ? 14 : 22 }))
    let r = 4
    for (const sg of l.segmentos) {
      ws.getCell(r, 1).value = sg.ini
      ws.getCell(r, 2).value = sg.fim
      ws.getCell(r, 3).value = sg.label_ini
      ws.getCell(r, 4).value = sg.label_fim
      opts.servicos.forEach((s, k) => {
        const v = sg.valores[s.id]
        if (v) ws.getCell(r, 5 + k).value = v
      })
      ws.getCell(r, 1).numFmt = '#,##0.00'
      ws.getCell(r, 2).numFmt = '#,##0.00'
      for (let k = 0; k < opts.servicos.length; k++) ws.getCell(r, 5 + k).numFmt = '#,##0.000'
      r++
    }
  }
  const areas = opts.locais.filter((x) => x.tipo === 'area')
  if (areas.length) {
    const ws = wb.addWorksheet('Áreas', { views: [{ state: 'frozen', ySplit: 3 }] })
    ws.getCell('A1').value = `Quantidades das áreas · ${opts.obraNome}`
    ws.getCell('A1').font = { bold: true, size: 12 }
    ws.getCell('A2').value =
      'Uma linha por área (local sem estacas): a quantidade de cada serviço na área inteira.'
    ws.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF6B7280' } }
    const headers = ['Área', ...opts.servicos.map(cabecalhoServico)]
    estilo(ws, headers, 3)
    ws.columns = headers.map((_, i) => ({ width: i === 0 ? 28 : 22 }))
    let r = 4
    for (const a of areas) {
      ws.getCell(r, 1).value = a.nome
      const sg = a.segmentos[0]
      opts.servicos.forEach((s, k) => {
        const v = sg?.valores[s.id]
        if (v) ws.getCell(r, 2 + k).value = v
        ws.getCell(r, 2 + k).numFmt = '#,##0.000'
      })
      r++
    }
  }
  const sv = wb.addWorksheet('Servicos', { state: 'veryHidden' })
  sv.addRow(['cabecalho', 'item_orcamentario_id'])
  for (const s of opts.servicos) sv.addRow([cabecalhoServico(s), s.id])
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
}

/** Mapa cabeçalho → id gravado na aba oculta do modelo do sistema (ida e volta exata). */
export function mapeamentoDaPlanilha(wb: ExcelJS.Workbook): Map<string, string> {
  const out = new Map<string, string>()
  const sv = wb.getWorksheet('Servicos')
  if (!sv) return out
  sv.eachRow((row, i) => {
    if (i === 1) return
    const cab = texto(row.getCell(1).value).trim()
    const id = texto(row.getCell(2).value).trim()
    if (cab && id) out.set(normalizarTexto(cab), id)
  })
  return out
}
