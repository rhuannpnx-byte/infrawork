/**
 * Estacas nos locais da obra — a mesma regra do InfraWork Web (`features/acompanhamento/lib/local-producao.ts`):
 * eixo → as estacas digitadas no padrão do eixo (km 2+500, EST 125+10, metros…) viram a faixa em metros internos;
 * área → sem faixa.
 */
import { formatMarcadorCompacto, parseMarcador, type TrechoCtx } from './posicao'
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

export type LocalResolvido =
  | { ok: true; trechoId: string | null; inicioM: number | null; fimM: number | null }
  | { ok: false; erro: string }

export function resolverLocal(t: LocalDto | null, ini: string, fim: string): LocalResolvido {
  if (!t) return { ok: true, trechoId: null, inicioM: null, fimM: null }
  if (t.tipo === 'area') return { ok: true, trechoId: t.id, inicioM: null, fimM: null }
  const faixa = `${estacaInicialTexto(t)} – ${estacaFinalTexto(t)}`
  const nome = nomePosicao(t)
  if (!ini.trim() || !fim.trim())
    return { ok: false, erro: `Informe ${nome} inicial e final (${faixa}).` }
  const a = estacaParaMetros(t, ini)
  const b = estacaParaMetros(t, fim)
  if (a === null)
    return { ok: false, erro: `${nome} inicial "${ini}" inválido ou fora de ${t.nome} (${faixa}).` }
  if (b === null)
    return { ok: false, erro: `${nome} final "${fim}" inválido ou fora de ${t.nome} (${faixa}).` }
  const i = Math.min(a, b)
  const f = Math.max(a, b)
  if (!(f > i)) return { ok: false, erro: `${nome} final precisa ser diferente do inicial.` }
  return {
    ok: true,
    trechoId: t.id,
    inicioM: Math.round(i * 1000) / 1000,
    fimM: Math.round(f * 1000) / 1000,
  }
}
