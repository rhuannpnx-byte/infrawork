// Busca de células de uma versão de template de quantidades.
//
// Por que existe: as células (trecho_quantidade_celula) não têm versao_id —
// só segmento_id. As leituras antigas faziam `.in('segmento_id', [...500 ids])`
// em chunks dimensionados pelo limite de URL do PostgREST. MAS cada chunk podia
// retornar centenas×N colunas de células, e o PostgREST corta a RESPOSTA em
// 1000 linhas por padrão — então células eram silenciosamente perdidas e os
// TOTAIS apareciam subcontados (ex.: 457 segmentos × 7 colunas = 3172 células,
// só 1000 voltavam → ~31% do total).
//
// Aqui filtramos via embed (`!inner`) em trecho_quantidade_segmento.versao_id
// (evita o IN gigante) e paginamos por LINHAS com `.range()` de 1000 em 1000,
// até a página vir incompleta. Ordena por (segmento_id, coluna_id) — chave única
// da célula — pra paginação determinística (sem pular nem duplicar nas bordas).

import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'

export interface CelulaRow {
  segmento_id: string
  coluna_id: string
  valor: number
}

const PAGE = 1000

export async function fetchCelulasDaVersao(versaoId: string): Promise<CelulaRow[]> {
  if (!SUPABASE_ENABLED || !supabase) return []
  const out: CelulaRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('trecho_quantidade_celula')
      .select('segmento_id, coluna_id, valor, trecho_quantidade_segmento!inner(versao_id)')
      .eq('trecho_quantidade_segmento.versao_id', versaoId)
      .order('segmento_id', { ascending: true })
      .order('coluna_id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const c of data as unknown as CelulaRow[]) {
      out.push({ segmento_id: c.segmento_id, coluna_id: c.coluna_id, valor: Number(c.valor) })
    }
    if (data.length < PAGE) break
  }
  return out
}
