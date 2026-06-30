// Reprocessamento (retroanálise): re-roda a extração + resolução sobre os
// documentos JÁ ingeridos, sem re-inserir arquivos. Usa o texto em cache
// (documento_versao.texto_extraido via ocr-texto) e o TEMPLATE/PROMPTS ATUAIS,
// então mudanças de template/prompts passam a valer retroativamente.

import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { adminApi } from '@/lib/supabase/functions'
import { nomeCategoria } from '@/types/documentacao'

export interface ReprocessoProgresso {
  total: number
  feitos: number
  etapa: 'extraindo' | 'consolidando' | 'resolvendo' | 'concluido'
  doc?: string | null
}

export interface ReprocessoResultado {
  docs: number
  erros: number
}

/**
 * Reprocessa todos os documentos da obra com as premissas atuais (template +
 * prompts). Não re-faz upload nem (re)OCR quando há texto em cache. Ao final,
 * roda resolver → validar → reavaliar-lacunas → montar (igual ao fim de lote da
 * ingestão).
 */
export async function reprocessarObra(
  obraId: string,
  opts: { reindexar?: boolean; onProgress?: (p: ReprocessoProgresso) => void } = {}
): Promise<ReprocessoResultado> {
  if (!SUPABASE_ENABLED || !supabase) throw new Error('Supabase não configurado.')
  const { data, error } = await supabase
    .from('documento')
    .select('id, titulo, nome, grupo_codigo, tipo_codigo')
    .eq('obra_id', obraId)
  if (error) throw error
  const docs = (data ?? []) as Array<{
    id: string
    titulo: string | null
    nome: string | null
    grupo_codigo: string | null
    tipo_codigo: string | null
  }>
  const total = docs.length
  let feitos = 0
  let erros = 0

  for (const d of docs) {
    const cat = d.tipo_codigo ?? '20'
    const categoria = `${cat} ${nomeCategoria(cat)}`
    opts.onProgress?.({ total, feitos, etapa: 'extraindo', doc: d.titulo ?? d.nome })
    try {
      // Texto em cache (não re-faz OCR se já existe).
      const r = await adminApi.ocrTexto({ documento_id: d.id })
      const texto = r.texto ?? ''
      const ex = await adminApi.extrairDocumento({
        obra_id: obraId,
        documento_id: d.id,
        categoria,
        grupo_codigo: d.grupo_codigo ?? cat,
        texto: texto || undefined
      })
      await adminApi.consolidarDocumento({
        obra_id: obraId,
        documento_id: d.id,
        categoria,
        respostas: ex.respostas ?? [],
        entradas: ex.entradas ?? [],
        confianca: ex.confianca
      })
      if (opts.reindexar) {
        await adminApi.gerarEmbeddings({ documento_id: d.id, texto: texto || undefined })
      }
    } catch (e) {
      console.warn('[reprocessar] falha em', d.id, e)
      erros++
    }
    feitos++
    opts.onProgress?.({ total, feitos, etapa: 'extraindo', doc: d.titulo ?? d.nome })
  }

  // Resolução obra-level (âncora+dedup) → validação → lacunas → remonta o dossiê.
  opts.onProgress?.({ total, feitos, etapa: 'resolvendo', doc: null })
  await adminApi.resolverDossie({ obra_id: obraId })
  await adminApi.validarDossie({ obra_id: obraId })
  await adminApi.reavaliarLacunas({ obra_id: obraId })
  await adminApi.montarDossie({ obra_id: obraId, fresh: true })
  opts.onProgress?.({ total, feitos, etapa: 'concluido', doc: null })

  return { docs: total, erros }
}
