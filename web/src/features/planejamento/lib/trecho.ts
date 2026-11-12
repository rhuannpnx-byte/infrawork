/** Leituras derivadas de um local (`obra_trecho`): contexto de estaqueamento, comprimento efetivo, rótulos. */
import {
  divisorMetrosPorUnidade,
  formatMarcadorCompacto,
  type TrechoCtx
} from '@/lib/format/posicao'
import type { TrechoUnidadeConfig } from '@/lib/quantidades/grade'
import type { SegmentoValores } from '@/lib/quantidades/segmentos'
import type { ObraTrecho, UnidadeEspacoPadrao } from '@/types/gerencial'
import type { TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'

type TrechoBase = Pick<
  ObraTrecho,
  | 'tipo'
  | 'comprimento_m'
  | 'geometry_comprimento_m'
  | 'unidade_espaco_padrao'
  | 'unidade_custom_label'
  | 'unidade_custom_divisor_m'
  | 'marcador_valor_inicial'
  | 'geometry_sentido'
>

export const temGeometria = (t: Pick<ObraTrecho, 'geometry_geojson'>): boolean =>
  !!t.geometry_geojson && t.geometry_geojson.coordinates.length >= 2

/** Comprimento do eixo em metros internos (área → 0). */
export function comprimentoEfetivo(t: TrechoBase): number {
  if (t.tipo === 'area') return 0
  const c = Number(t.comprimento_m ?? t.geometry_comprimento_m ?? 0)
  return Number.isFinite(c) && c > 0 ? c : 0
}

export function ctxObraTrecho(t: TrechoBase): TrechoCtx {
  return {
    unidade_espaco_padrao: t.unidade_espaco_padrao,
    unidade_custom_label: t.unidade_custom_label,
    unidade_custom_divisor_m: t.unidade_custom_divisor_m,
    marcador_valor_inicial: Number(t.marcador_valor_inicial ?? 0),
    geometry_sentido: t.geometry_sentido,
    geometry_comprimento_m: comprimentoEfetivo(t) || null
  }
}

export function cfgUnidade(t: TrechoBase): TrechoUnidadeConfig {
  return {
    geometry_comprimento_m: comprimentoEfetivo(t),
    unidade_espaco_padrao: t.unidade_espaco_padrao,
    unidade_custom_label: t.unidade_custom_label,
    unidade_custom_divisor_m: t.unidade_custom_divisor_m,
    marcador_valor_inicial: Number(t.marcador_valor_inicial ?? 0),
    geometry_sentido: t.geometry_sentido
  }
}

/** Rótulo da unidade do estaqueamento ("km", "EST", "m" ou o rótulo custom). */
export function rotuloUnidadeTrecho(u: UnidadeEspacoPadrao, customLabel?: string | null): string {
  return u === 'km' ? 'km' : u === 'estaca' ? 'EST' : u === 'm' ? 'm' : customLabel?.trim() || 'ref'
}

export const estacaInicialTexto = (t: TrechoBase): string =>
  formatMarcadorCompacto(0, ctxObraTrecho(t)) || '—'

export const estacaFinalTexto = (t: TrechoBase): string => {
  const c = comprimentoEfetivo(t)
  return c > 0 ? formatMarcadorCompacto(c, ctxObraTrecho(t)) || '—' : '—'
}

/**
 * Estaca inicial e final digitadas (valores do marcador) → comprimento e numeração (o eixo do DynaRoad é só
 * "station begin / station end"; final menor que inicial = numeração decrescente).
 */
export function eixoDeEstacas(
  inicial: number,
  final: number,
  ctx: Pick<TrechoCtx, 'unidade_espaco_padrao' | 'unidade_custom_divisor_m'>
): { comprimento_m: number; geometry_sentido: 'natural' | 'invertido' } {
  const d = divisorMetrosPorUnidade({ ...ctx, marcador_valor_inicial: 0 })
  return {
    comprimento_m: Math.round(Math.abs(final - inicial) * d * 100) / 100,
    geometry_sentido: final < inicial ? 'invertido' : 'natural'
  }
}

/** Faixas da versão atual do template com os valores por serviço (`item_orcamentario_id`). */
export function segmentosDoTemplate(
  tpl: TrechoQuantidadeVersaoCompleta | null | undefined
): SegmentoValores[] {
  if (!tpl) return []
  const item = new Map(tpl.colunas.map((c) => [c.id, c.item_orcamentario_id]))
  return tpl.segmentos.map((s) => ({
    ini: s.posicao_inicio_m,
    fim: s.posicao_fim_m,
    label_ini: s.unidade_inicio_label ?? '',
    label_fim: s.unidade_fim_label ?? '',
    valores: Object.fromEntries(
      Object.entries(s.valores)
        .filter(([, v]) => v > 0)
        .map(([col, v]) => [item.get(col) ?? col, v])
    )
  }))
}

export const normalizarNome = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
