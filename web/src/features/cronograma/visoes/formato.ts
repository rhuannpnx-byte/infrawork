/**
 * Formatos e cores das visões do cronograma (visual do InfraWork). Os instantes do motor são segundos "ingênuos"
 * (horário local da obra gravado como UTC): sempre formatar com fuso UTC.
 */
import {
  formatMarcador,
  formatMarcadorCompacto,
  parseMarcador,
  type TrechoCtx
} from '@/lib/format/posicao'
import type { TrechoEntrada } from '../motor/tipos'

const nf = (casas: number): Intl.NumberFormat =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
const NF0 = nf(0)
const NF1 = nf(1)
const NF2 = nf(2)
const NF_AUTO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

export function fmtNum(v: number | null | undefined, casas: 0 | 1 | 2 | 'auto' = 'auto'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return ''
  if (casas === 'auto') return NF_AUTO.format(v)
  return (casas === 0 ? NF0 : casas === 1 ? NF1 : NF2).format(v)
}

const DATA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  timeZone: 'UTC'
})
const DATA_LONGA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC'
})
const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC'
})

export const fmtData = (seg: number | null | undefined): string =>
  seg === null || seg === undefined ? '' : DATA.format(new Date(seg * 1000))
export const fmtDataLonga = (seg: number | null | undefined): string =>
  seg === null || seg === undefined ? '' : DATA_LONGA.format(new Date(seg * 1000))
export const fmtDataHora = (seg: number | null | undefined): string =>
  seg === null || seg === undefined ? '' : DATA_HORA.format(new Date(seg * 1000)).replace(',', '')

/** Dias (1 casa) com o sufixo. */
export const fmtDias = (d: number | null | undefined): string =>
  d === null || d === undefined || !Number.isFinite(d) ? '' : `${fmtNum(d, 1)} d`

/** Contexto de estaqueamento de um trecho do plano. */
export function ctxTrecho(t: TrechoEntrada | undefined): TrechoCtx {
  return {
    unidade_espaco_padrao: t?.exib?.unidade_espaco_padrao ?? 'm',
    unidade_custom_label: t?.exib?.unidade_custom_label ?? null,
    unidade_custom_divisor_m: t?.exib?.unidade_custom_divisor_m ?? null,
    marcador_valor_inicial: t?.exib?.marcador_valor_inicial ?? 0,
    geometry_sentido: t?.exib?.geometry_sentido ?? 'natural',
    geometry_comprimento_m: t?.comprimento_m ?? null
  }
}

/** Estaca formatada no padrão do trecho (com reserva em metros quando o marcador não se aplica). */
export function fmtEstaca(m: number, t: TrechoEntrada | undefined): string {
  const s = formatMarcador(m, ctxTrecho(t))
  return s || `${fmtNum(m, 0)} m`
}

/** O estaqueamento do trecho é utilizável (marcadores não negativos nas pontas). */
export function estaqueamentoValido(t: TrechoEntrada | undefined): boolean {
  const c = ctxTrecho(t)
  return (
    formatMarcador(0, c) !== '' &&
    (t?.comprimento_m ? formatMarcador(t.comprimento_m, c) !== '' : true)
  )
}

/** Texto editável de uma posição: o marcador do trecho, ou metros quando o estaqueamento não se aplica. */
export function textoEstaca(m: number, t: TrechoEntrada | undefined): string {
  return estaqueamentoValido(t)
    ? formatMarcador(m, ctxTrecho(t))
    : fmtNum(m, 'auto').replace(/\./g, '')
}

/** Posição (metros internos) a partir do texto digitado; null = inválido ou fora do trecho. */
export function lerEstaca(s: string, t: TrechoEntrada | undefined): number | null {
  if (estaqueamentoValido(t)) return parseMarcador(s, ctxTrecho(t)).metros
  const x = s.trim().replace(/\./g, '').replace(',', '.')
  const n = x ? Number(x) : NaN
  if (!Number.isFinite(n) || n < 0) return null
  if (t?.comprimento_m && n > t.comprimento_m + 0.01) return null
  return n
}

export function fmtEstacaCompacta(m: number, t: TrechoEntrada | undefined): string {
  const s = formatMarcadorCompacto(m, ctxTrecho(t))
  return s || `${fmtNum(m, 0)} m`
}

/** Paleta das séries (serviços), na ordem estável do InfraWork. As cores vêm do tema (`--serie-N` em theme.css). */
export const PALETA = Array.from({ length: 10 }, (_, i) => `var(--serie-${i + 1})`)

/** Cor de cada serviço pela ordem do código (a mesma em todas as visões). */
export function coresServicos(servicos: { id: string; codigo: string }[]): Map<string, string> {
  const ordem = [...servicos].sort((a, b) =>
    a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true })
  )
  return new Map(ordem.map((s, i) => [s.id, PALETA[i % PALETA.length]!]))
}

/** "Agora" no relógio da obra (os instantes do motor são o horário local gravado como UTC). */
export function agoraLocal(): number {
  return Date.now() / 1000 - new Date().getTimezoneOffset() * 60
}
