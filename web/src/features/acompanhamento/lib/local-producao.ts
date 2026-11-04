/**
 * Local de um lançamento de produção (controle por estaca): a mesma regra para o formulário, o lançamento em lote e a
 * importação XLSX. Eixo → as estacas digitadas no padrão do eixo viram a faixa em metros internos (obrigatória);
 * área → sem faixa; sem local → as estacas ficam só como texto.
 */
import {
  ctxObraTrecho,
  estacaFinalTexto,
  estacaInicialTexto,
  normalizarNome
} from '@/features/planejamento/lib/trecho'
import { parseMarcador } from '@/lib/format/posicao'
import type { ObraTrecho } from '@/types/gerencial'

export type TrechoLocal = Pick<
  ObraTrecho,
  | 'id'
  | 'nome'
  | 'tipo'
  | 'comprimento_m'
  | 'geometry_comprimento_m'
  | 'unidade_espaco_padrao'
  | 'unidade_custom_label'
  | 'unidade_custom_divisor_m'
  | 'marcador_valor_inicial'
  | 'geometry_sentido'
>

export type LocalResolvido =
  | {
      ok: true
      trecho_id: string | null
      posicao_inicio_m: number | null
      posicao_fim_m: number | null
    }
  | { ok: false; erro: string }

const texto = (v: unknown): string => (v == null ? '' : String(v).trim())

export function resolverLocalProducao(
  trecho: TrechoLocal | null | undefined,
  estacaIni: unknown,
  estacaFim: unknown
): LocalResolvido {
  if (!trecho) return { ok: true, trecho_id: null, posicao_inicio_m: null, posicao_fim_m: null }
  if (trecho.tipo === 'area')
    return { ok: true, trecho_id: trecho.id, posicao_inicio_m: null, posicao_fim_m: null }
  const ctx = ctxObraTrecho(trecho)
  const faixa = `${estacaInicialTexto(trecho)} – ${estacaFinalTexto(trecho)}`
  const ti = texto(estacaIni),
    tf = texto(estacaFim)
  if (!ti || !tf)
    return { ok: false, erro: `Informe as estacas inicial e final em ${trecho.nome} (${faixa}).` }
  const a = parseMarcador(ti, ctx),
    b = parseMarcador(tf, ctx)
  if (a.metros === null)
    return {
      ok: false,
      erro: `Estaca inicial "${ti}" inválida ou fora de ${trecho.nome} (${faixa}).`
    }
  if (b.metros === null)
    return {
      ok: false,
      erro: `Estaca final "${tf}" inválida ou fora de ${trecho.nome} (${faixa}).`
    }
  const ini = Math.min(a.metros, b.metros),
    fim = Math.max(a.metros, b.metros)
  if (!(fim > ini)) return { ok: false, erro: 'A estaca final precisa ser diferente da inicial.' }
  return {
    ok: true,
    trecho_id: trecho.id,
    posicao_inicio_m: Math.round(ini * 1000) / 1000,
    posicao_fim_m: Math.round(fim * 1000) / 1000
  }
}

/** Local pelo nome (sem acento/caixa; aceita "Área X" para a área X). */
export function localPorNome<T extends Pick<ObraTrecho, 'nome' | 'tipo'>>(
  trechos: readonly T[],
  nome: unknown
): T | undefined {
  const n = normalizarNome(texto(nome))
  if (!n) return undefined
  const semPrefixo = n.replace(/^area\s+/, '')
  return (
    trechos.find((t) => normalizarNome(t.nome) === n) ??
    trechos.find((t) => t.tipo === 'area' && normalizarNome(t.nome) === semPrefixo)
  )
}

/** Rótulo de exibição do local de um lançamento ("Trecho 1 · 2+000 → 2+500", "Área OAE"). */
export function rotuloLocalProducao(p: {
  trecho_nome?: string | null
  trecho_tipo?: 'eixo' | 'area' | null
  estaca_inicial?: string | null
  estaca_final?: string | null
}): string {
  const ini = texto(p.estaca_inicial),
    fim = texto(p.estaca_final)
  const est = ini && fim ? `${ini} → ${fim}` : ini || fim
  const local = p.trecho_nome
    ? p.trecho_tipo === 'area'
      ? `Área ${p.trecho_nome}`
      : p.trecho_nome
    : ''
  return [local, p.trecho_tipo === 'area' ? '' : est].filter(Boolean).join(' · ')
}
