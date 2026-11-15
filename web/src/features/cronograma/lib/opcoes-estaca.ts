import { divisorMetrosPorUnidade } from '@/lib/format/posicao'
import { formatNumber } from '@/lib/format'
import type { SegmentoValores } from '@/lib/quantidades/segmentos'
import { ctxTrecho, lerEstaca, textoEstaca } from '../visoes/formato'
import type { TrechoEntrada } from '../motor/tipos'

export interface OpcaoEstaca {
  /** posição em metros internos do eixo */
  m: number
  rotulo: string
  dica?: string
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
 * planilha de quantidades onde o serviço tem quantidade (com a quantidade da faixa como dica). Em ordem de posição.
 */
export function opcoesEstaca(
  t: TrechoEntrada,
  segs: readonly SegmentoValores[],
  itemId: string,
  unidade: string
): OpcaoEstaca[] {
  const comp = t.comprimento_m ?? 0
  const pontos = new Map<number, string[]>()
  const marcar = (m: number, dica?: string): void => {
    const k = Math.round(Math.min(Math.max(m, 0), comp) * 100) / 100
    const d = pontos.get(k) ?? []
    if (dica && !d.includes(dica)) d.push(dica)
    pontos.set(k, d)
  }
  marcar(0, 'início do local')
  marcar(comp, 'fim do local')
  const passo = passoDaLista(t)
  // as marcas caem nos valores redondos da unidade, a partir do valor inicial do local
  const ctx = ctxTrecho(t)
  const inicial = Number(ctx.marcador_valor_inicial ?? 0) * divisorMetrosPorUnidade(ctx)
  const resto = ((inicial % passo) + passo) % passo
  // numeração decrescente: o marcador cai com a posição, então a marca redonda fica a `resto` do início
  const primeiro = ctx.geometry_sentido === 'invertido' ? resto : resto === 0 ? 0 : passo - resto
  for (let m = primeiro; m < comp; m += passo) if (m > 0) marcar(m)
  for (const s of segs) {
    const v = s.valores[itemId] ?? 0
    if (!(v > 0)) continue
    const faixa = `faixa da planilha: ${formatNumber(v, 2)}${unidade ? ` ${unidade}` : ''}`
    marcar(s.ini, `início da ${faixa}`)
    marcar(s.fim, 'fim de faixa da planilha')
  }
  return [...pontos.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([m, dicas]) => ({ m, rotulo: textoEstaca(m, t), dica: dicas.join(' · ') || undefined }))
}

/** Estaca digitada na busca, aceita se cair dentro do local. */
export function estacaDigitada(texto: string, t: TrechoEntrada): OpcaoEstaca | null {
  const m = lerEstaca(texto, t)
  return m === null ? null : { m, rotulo: textoEstaca(m, t), dica: 'digitada' }
}
