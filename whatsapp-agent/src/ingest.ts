// Recebe uma imagem de um grupo monitorado, roda a visão e decide se sobe.
// Regra: só sobe se for foto de serviço E tiver geolocalização (lat/lng).
// As fotos subidas vão para `acompanhamento_foto` e aparecem no mapa como as
// do mobile (via RPC whatsapp_registrar_foto, que cuida do match de serviço).

import { supabase } from './supabase.js'
import { config } from './config.js'
import { logger } from './logger.js'
import { classificarFoto } from './vision.js'

export interface ImagemEntrada {
  grupoId: string
  obraId: string
  waMessageId: string
  remetente: string | null
  imagem: Buffer
  mime: string
  timestampMsg: Date
}

export type Decisao = 'subida' | 'sem_geo' | 'nao_servico' | 'erro' | 'duplicada'

interface ServicoVinculado {
  servico_id: string
  codigo: string
  nome: string
  unidade: string | null
}

// Cache por obra (TTL 10min) dos serviços COM vínculo ativo.
const catalogoCache = new Map<string, { itens: ServicoVinculado[]; expira: number }>()

/** Serviços da obra que têm vínculo ATIVO no matching SIGA→Planejamento
 *  (acompanhamento_servico_match com servico_id e origem != 'rejeitado').
 *  A classificação fica restrita a esses — e deve escolher sempre um deles. */
async function getServicosVinculados(obraId: string): Promise<ServicoVinculado[]> {
  const cached = catalogoCache.get(obraId)
  if (cached && cached.expira > Date.now()) return cached.itens

  const { data: matches } = await supabase
    .from('acompanhamento_servico_match')
    .select('servico_id')
    .eq('obra_id', obraId)
    .not('servico_id', 'is', null)
    .neq('origem', 'rejeitado')

  const ids = [...new Set((matches ?? []).map((m) => m.servico_id as string))]
  let itens: ServicoVinculado[] = []
  if (ids.length > 0) {
    const { data: servicos } = await supabase
      .from('servico')
      .select('id, codigo, nome, unidade')
      .in('id', ids)
      .eq('ativo', true)
    itens = (servicos ?? []).map((s) => ({
      servico_id: s.id as string,
      codigo: s.codigo as string,
      nome: s.nome as string,
      unidade: s.unidade as string | null
    }))
  }
  catalogoCache.set(obraId, { itens, expira: Date.now() + 600_000 })
  return itens
}

async function logSimples(
  grupoId: string,
  waMessageId: string,
  remetente: string | null,
  decisao: Decisao,
  ai: unknown,
  erro?: string
): Promise<void> {
  await supabase.from('whatsapp_mensagem_log').upsert(
    {
      grupo_id: grupoId,
      wa_message_id: waMessageId,
      remetente,
      decisao,
      ai_resultado: ai ?? null,
      erro: erro ?? null
    },
    { onConflict: 'wa_message_id', ignoreDuplicates: true }
  )
}

/** Retorna true se a mensagem já foi processada antes (dedup). */
export async function jaProcessada(waMessageId: string): Promise<boolean> {
  const { data } = await supabase
    .from('whatsapp_mensagem_log')
    .select('id')
    .eq('wa_message_id', waMessageId)
    .maybeSingle()
  return !!data
}

export async function processarImagem(e: ImagemEntrada): Promise<Decisao> {
  if (await jaProcessada(e.waMessageId)) return 'subida' // já tratada anteriormente

  let decisao: Decisao = 'erro'
  try {
    const catalogo = await getServicosVinculados(e.obraId)
    const ai = await classificarFoto(
      e.imagem,
      e.mime,
      catalogo.map((c) => ({ codigo: c.codigo, nome: c.nome, unidade: c.unidade }))
    )

    if (!ai.is_foto_servico) {
      decisao = 'nao_servico'
      await logSimples(e.grupoId, e.waMessageId, e.remetente, decisao, ai)
      return decisao
    }

    // Só sobe foto que casa, COM CONFIANÇA, num serviço que TEM vínculo ativo
    // na obra. Sem correspondência confiável ⇒ descarta (documentos, fotos
    // ruins, baixa confiança, serviço sem vínculo).
    const item = ai.servico_codigo
      ? catalogo.find((c) => c.codigo === ai.servico_codigo)
      : undefined
    if (!item || ai.confianca < config.confiancaMinima) {
      decisao = 'nao_servico'
      logger.info(
        { waMessageId: e.waMessageId, servico_codigo: ai.servico_codigo, confianca: ai.confianca },
        'descartada: sem serviço vinculado com confiança suficiente'
      )
      await logSimples(e.grupoId, e.waMessageId, e.remetente, decisao, ai)
      return decisao
    }

    if (ai.lat == null || ai.lng == null) {
      decisao = 'sem_geo'
      await logSimples(e.grupoId, e.waMessageId, e.remetente, decisao, ai)
      return decisao
    }

    const servicoId: string = item.servico_id
    const servicoNome: string = item.nome
    const ts = e.timestampMsg
    const capturedAt = ai.captured_at ?? ts.toISOString()

    // Dedup por conteúdo ANTES do upload: mesma foto (obra + captura + coords)
    // já na base ⇒ descarta (reenvios, backfill sobreposto com id diferente).
    const { data: jaExiste } = await supabase
      .from('acompanhamento_foto')
      .select('id')
      .eq('obra_id', e.obraId)
      .eq('captured_at', capturedAt)
      .eq('lat', ai.lat)
      .eq('lng', ai.lng)
      .is('excluida_em', null)
      .limit(1)
      .maybeSingle()
    if (jaExiste) {
      decisao = 'duplicada'
      logger.info({ waMessageId: e.waMessageId, fotoId: jaExiste.id }, 'descartada: foto duplicada')
      await supabase.from('whatsapp_mensagem_log').upsert(
        {
          grupo_id: e.grupoId,
          wa_message_id: e.waMessageId,
          remetente: e.remetente,
          decisao,
          foto_id: jaExiste.id as string,
          ai_resultado: ai
        },
        { onConflict: 'wa_message_id', ignoreDuplicates: true }
      )
      return decisao
    }

    // Upload do binário
    const stamp = ts.toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const ext = e.mime.includes('png') ? 'png' : 'jpg'
    const storageKey = `obra/${e.obraId}/whatsapp/${stamp}_${e.waMessageId.slice(-12)}.${ext}`

    const up = await supabase.storage
      .from(config.bucketFotos)
      .upload(storageKey, e.imagem, { contentType: e.mime || 'image/jpeg', upsert: true })
    if (up.error) throw up.error
    const { data: fotoId, error: rpcErr } = await supabase.rpc('whatsapp_registrar_foto', {
      _grupo_id: e.grupoId,
      _obra_id: e.obraId,
      _servico_id: servicoId,
      _servico_nome: servicoNome,
      _lat: ai.lat,
      _lng: ai.lng,
      _captured_at: capturedAt,
      _storage_key: storageKey,
      _mime: e.mime || 'image/jpeg',
      _size_bytes: e.imagem.length,
      _wa_message_id: e.waMessageId,
      _remetente: e.remetente,
      _ai: ai
    })
    if (rpcErr) throw rpcErr

    decisao = 'subida'
    logger.info({ fotoId, obraId: e.obraId, servico: ai.servico_codigo }, 'foto subida')
    return decisao
  } catch (err) {
    logger.error({ err, waMessageId: e.waMessageId }, 'erro ao processar imagem')
    await logSimples(e.grupoId, e.waMessageId, e.remetente, 'erro', null, String(err))
    return 'erro'
  }
}
