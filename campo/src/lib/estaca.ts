/**
 * Estacas nos locais da obra — a mesma regra do InfraWork Web (`features/acompanhamento/lib/local-producao.ts`):
 * eixo → as estacas digitadas no padrão do eixo (km 2+500, EST 125+10, metros…) viram a faixa em metros internos;
 * área → sem faixa.
 */
import {
  divisorMetrosPorUnidade,
  formatMarcadorCompacto,
  marcadorToMetros,
  metrosToMarcador,
  parseMarcador,
  type TrechoCtx,
} from './posicao'
import type { LocalDto } from '@/types/dtos'

export function comprimentoEfetivo(t: LocalDto): number {
  if (t.tipo === 'area') return 0
  const c = Number(t.comprimento_m ?? t.geometry_comprimento_m ?? 0)
  return Number.isFinite(c) && c > 0 ? c : 0
}

export function ctxLocal(t: LocalDto): TrechoCtx {
  return {
    unidade_espaco_padrao: t.unidade_espaco_padrao,
    unidade_custom_label: t.unidade_custom_label,
    unidade_custom_divisor_m: t.unidade_custom_divisor_m,
    marcador_valor_inicial: Number(t.marcador_valor_inicial ?? 0),
    geometry_sentido: t.geometry_sentido,
    geometry_comprimento_m: comprimentoEfetivo(t) || null,
  }
}

export const estacaInicialTexto = (t: LocalDto): string =>
  formatMarcadorCompacto(0, ctxLocal(t)) || '—'

export const estacaFinalTexto = (t: LocalDto): string => {
  const c = comprimentoEfetivo(t)
  return c > 0 ? formatMarcadorCompacto(c, ctxLocal(t)) || '—' : '—'
}

/** Nome da posição no eixo conforme a unidade do local: "Estaca", "Km", "Posição (m)" ou a unidade própria. */
export function nomePosicao(t: LocalDto): string {
  switch (t.unidade_espaco_padrao) {
    case 'km':
      return 'Km'
    case 'm':
      return 'Posição (m)'
    case 'custom':
      return t.unidade_custom_label?.trim() || 'Posição'
    default:
      return 'Estaca'
  }
}

/**
 * Teclado do celular para digitar a posição no eixo. Estaca e km aceitam dígitos, "+", vírgula e ponto ("125+10",
 * "2+500,5"): o teclado de telefone é o numérico que tem o "+" (o `decimal` do iOS não tem). Metros e unidade
 * própria são só número com decimal.
 */
export function tecladoPosicao(t: LocalDto): 'tel' | 'decimal' {
  return t.unidade_espaco_padrao === 'm' || t.unidade_espaco_padrao === 'custom' ? 'decimal' : 'tel'
}

export function rotuloLocal(t: LocalDto): string {
  return t.tipo === 'area'
    ? `Área ${t.nome}`
    : `${t.nome} (${estacaInicialTexto(t)} – ${estacaFinalTexto(t)})`
}

/** Uma estaca → metros internos do eixo (null = inválida ou fora do eixo). */
export function estacaParaMetros(t: LocalDto, texto: string): number | null {
  const r = parseMarcador(texto.trim(), ctxLocal(t))
  return r.metros
}

/** Número no padrão brasileiro, sem zeros à direita ("10,5", "12"). */
const numeroBR = (v: number, casas: number): string => {
  const [inteiro, dec = ''] = v.toFixed(casas).split('.')
  const limpo = dec.replace(/0+$/, '')
  return limpo ? `${inteiro},${limpo}` : (inteiro ?? '0')
}

/**
 * A posição `passos` adiante (ou atrás, se negativo) no eixo, como texto que o campo aceita. Um passo é uma estaca
 * (20 m); em km e em metros também são 20 m, e na unidade própria do local é 1 unidade. Anda no valor que o usuário
 * lê (EST 50 → EST 51), qualquer que seja o sentido do eixo. `null` quando o texto não é uma posição válida ou o
 * passo sai do eixo.
 */
export function avancarPosicao(t: LocalDto, texto: string, passos: number): string | null {
  const atual = texto.trim() ? estacaParaMetros(t, texto) : null
  if (atual === null) return null
  const ctx = ctxLocal(t)
  const divisor = divisorMetrosPorUnidade(ctx)
  const passoM = t.unidade_espaco_padrao === 'custom' ? divisor : 20
  const marcador =
    Math.round((metrosToMarcador(atual, ctx) + (passos * passoM) / divisor) * 1e6) / 1e6
  const metros = marcadorToMetros(marcador, ctx)
  const fim = comprimentoEfetivo(t)
  if (marcador < 0 || metros < -0.005 || (fim > 0 && metros > fim + 0.005)) return null
  let saida: string
  if (t.unidade_espaco_padrao === 'estaca' || t.unidade_espaco_padrao === 'km') {
    const porUnidade = t.unidade_espaco_padrao === 'km' ? 1000 : 20
    let inteiro = Math.floor(marcador + 1e-9)
    let resto = Math.round((marcador - inteiro) * porUnidade * 100) / 100
    if (resto >= porUnidade) {
      inteiro += 1
      resto = 0
    }
    if (t.unidade_espaco_padrao === 'estaca')
      saida = resto === 0 ? String(inteiro) : `${inteiro}+${numeroBR(resto, 2)}`
    else {
      const [m = '0', cc] = numeroBR(resto, 2).split(',')
      saida = `${inteiro}+${m.padStart(3, '0')}${cc ? `,${cc}` : ''}`
    }
  } else saida = numeroBR(marcador, t.unidade_espaco_padrao === 'm' ? 2 : 3)
  // o texto precisa voltar válido pelo mesmo caminho do campo
  return estacaParaMetros(t, saida) === null ? null : saida
}

export type LocalResolvido =
  | { ok: true; trechoId: string | null; inicioM: number | null; fimM: number | null }
  /** `campos`: a frase de cada campo errado (inicial, final), para a tela mostrar embaixo dele */
  | { ok: false; erro: string; campos: { inicial?: string; final?: string } }

/** "EST 0 a EST 600": os limites do eixo, para as frases de erro. */
export const faixaTexto = (t: LocalDto): string =>
  `${estacaInicialTexto(t)} a ${estacaFinalTexto(t)}`
export const erroPosicaoVazia = (t: LocalDto): string => `Informe um valor de ${faixaTexto(t)}.`
export const erroPosicaoFora = (t: LocalDto): string =>
  `Valor inválido ou fora do eixo (${faixaTexto(t)}).`

export function resolverLocal(t: LocalDto | null, ini: string, fim: string): LocalResolvido {
  if (!t) return { ok: true, trechoId: null, inicioM: null, fimM: null }
  if (t.tipo === 'area') return { ok: true, trechoId: t.id, inicioM: null, fimM: null }
  const a = ini.trim() ? estacaParaMetros(t, ini) : null
  const b = fim.trim() ? estacaParaMetros(t, fim) : null
  const campos: { inicial?: string; final?: string } = {}
  if (!ini.trim()) campos.inicial = erroPosicaoVazia(t)
  else if (a === null) campos.inicial = erroPosicaoFora(t)
  if (!fim.trim()) campos.final = erroPosicaoVazia(t)
  else if (b === null) campos.final = erroPosicaoFora(t)
  if (a !== null && b !== null && a === b) campos.final = 'Informe um valor diferente do inicial.'
  if (a === null || b === null || a === b)
    return { ok: false, erro: campos.inicial ?? campos.final ?? erroPosicaoFora(t), campos }
  const i = Math.min(a, b)
  const f = Math.max(a, b)
  return {
    ok: true,
    trechoId: t.id,
    inicioM: Math.round(i * 1000) / 1000,
    fimM: Math.round(f * 1000) / 1000,
  }
}
