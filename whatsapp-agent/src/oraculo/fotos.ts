// Busca de fotos georreferenciadas de uma obra para o Oráculo enviar no WhatsApp.
// Escopado por obra_id; filtra por serviço (texto) e período. Teto configurável.

import { supabase } from '../supabase.js'
import { config } from '../config.js'
import { logger } from '../logger.js'

export interface FotoParaEnviar {
  buffer: Buffer
  caption: string
}

export interface ResultadoFotos {
  fotos: FotoParaEnviar[]
  total: number
  hasMore: boolean
}

export interface FiltrosFotos {
  servico?: string | null
  encarregado?: string | null // nome (parcial) do encarregado/colaborador
  dataInicio?: string | null // YYYY-MM-DD
  dataFim?: string | null // YYYY-MM-DD
}

/** Aplica filtro de encarregado por nome (match no display OU no nome do SIGA). */
function filtroEncarregado<T extends { or: (f: string) => T }>(q: T, nome: string): T {
  const esc = nome.replace(/[,()]/g, ' ').trim()
  return q.or(
    `encarregado_display_nome.ilike.%${esc}%,siga_encarregado_nome.ilike.%${esc}%`
  )
}

const VIEW = 'vw_acompanhamento_foto_enriquecida'

/** Busca até `oraculoMaxFotos` fotos da obra que casem com os filtros e baixa os
 *  bytes do bucket. `total` é a contagem real (pode ser maior que o enviado). */
export async function buscarFotos(obraId: string, f: FiltrosFotos): Promise<ResultadoFotos> {
  const max = config.oraculoMaxFotos

  // contagem total (sem baixar bytes)
  let countQ = supabase.from(VIEW).select('id', { count: 'exact', head: true }).eq('obra_id', obraId)
  if (f.servico) countQ = countQ.ilike('servico_display_nome', `%${f.servico}%`)
  if (f.encarregado) countQ = filtroEncarregado(countQ, f.encarregado)
  if (f.dataInicio) countQ = countQ.gte('captured_date', f.dataInicio)
  if (f.dataFim) countQ = countQ.lte('captured_date', f.dataFim)
  const { count } = await countQ
  const total = count ?? 0

  // página com metadados das fotos a enviar
  let listaQ = supabase
    .from(VIEW)
    .select(
      'storage_bucket, storage_key, servico_display_nome, encarregado_display_nome, captured_date, captured_at'
    )
    .eq('obra_id', obraId)
  if (f.servico) listaQ = listaQ.ilike('servico_display_nome', `%${f.servico}%`)
  if (f.encarregado) listaQ = filtroEncarregado(listaQ, f.encarregado)
  if (f.dataInicio) listaQ = listaQ.gte('captured_date', f.dataInicio)
  if (f.dataFim) listaQ = listaQ.lte('captured_date', f.dataFim)
  const { data: linhas } = await listaQ.order('captured_at', { ascending: false }).limit(max)

  const fotos: FotoParaEnviar[] = []
  for (const l of linhas ?? []) {
    const bucket = (l.storage_bucket as string) || config.bucketFotos
    const key = l.storage_key as string
    if (!key) continue
    const dl = await supabase.storage.from(bucket).download(key)
    if (dl.error || !dl.data) {
      logger.warn({ key, err: dl.error }, 'falha ao baixar foto')
      continue
    }
    const buffer = Buffer.from(await dl.data.arrayBuffer())
    const servico = (l.servico_display_nome as string) || 'Serviço'
    const data = (l.captured_date as string) || ''
    const enc = (l.encarregado_display_nome as string) || ''
    fotos.push({
      buffer,
      caption: `${servico}${data ? ` — ${data}` : ''}${enc ? ` · ${enc}` : ''}`
    })
  }

  return { fotos, total, hasMore: total > fotos.length }
}
