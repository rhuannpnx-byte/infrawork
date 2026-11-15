import { divisorMetrosPorUnidade } from '@/lib/format/posicao'
import type { SegmentoValores } from '@/lib/quantidades/segmentos'
import { ctxTrecho, lerEstaca, textoEstaca } from '../visoes/formato'
import type { TrechoEntrada } from '../motor/tipos'

export interface OpcaoEstaca {
  /** posição em metros internos do eixo */
  m: number
  rotulo: string
}

/** Passo da lista: 1 unidade do local (km, km de marco, estaca); em metros, 100 m. Nunca mais de ~5.000 opções. */
function passoDaLista(t: TrechoEntrada): number {
  const ctx = ctxTrecho(t)
  const base = ctx.unidade_espaco_padrao === 'm' ? 100 : divisorMetrosPorUnidade(ctx)
  const comp = t.comprimento_m ?? 0
  let passo = base > 0 ? base : 1000
  while (comp / passo > 5000) passo *= 2
  return passo
}

/**
 * Estacas que dá para escolher num eixo: o início e o fim do local, cada unidade dele e as bordas das faixas da
 * planilha de quantidades onde o serviço tem quantidade. Em ordem de posição.
 */
export function opcoesEstaca(
  t: TrechoEntrada,
  segs: readonly SegmentoValores[],
  itemId: string
): OpcaoEstaca[] {
  const comp = t.comprimento_m ?? 0
  const pontos = new Set<number>()
  const marcar = (m: number): void => {
    pontos.add(Math.round(Math.min(Math.max(m, 0), comp) * 100) / 100)
  }
  marcar(0)
  marcar(comp)
  const passo = passoDaLista(t)
  // as marcas caem nos valores redondos da unidade, a partir do valor inicial do local
  const ctx = ctxTrecho(t)
  const inicial = Number(ctx.marcador_valor_inicial ?? 0) * divisorMetrosPorUnidade(ctx)
  const resto = ((inicial % passo) + passo) % passo
  // numeração decrescente: o marcador cai com a posição, então a marca redonda fica a `resto` do início
  const primeiro = ctx.geometry_sentido === 'invertido' ? resto : resto === 0 ? 0 : passo - resto
  for (let m = primeiro; m < comp; m += passo) if (m > 0) marcar(m)
  for (const s of segs) {
    if (!((s.valores[itemId] ?? 0) > 0)) continue
    marcar(s.ini)
    marcar(s.fim)
  }
  return [...pontos].sort((a, b) => a - b).map((m) => ({ m, rotulo: textoEstaca(m, t) }))
}

/** Estaca digitada na busca, aceita se cair dentro do local. */
export function estacaDigitada(texto: string, t: TrechoEntrada): OpcaoEstaca | null {
  const m = lerEstaca(texto, t)
  return m === null ? null : { m, rotulo: textoEstaca(m, t) }
}
