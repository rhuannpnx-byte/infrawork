// POST /functions/v1/documentacao-consolidar
// Body: { obra_id, documento_id, categoria, respostas, entradas, confianca?, assinado?, doc_data? }
//
// Grava os CANDIDATOS extraídos de UM documento (escalares + entradas de listas
// incrementais) em extracao_candidato. NÃO resolve o canônico — isso é feito
// pelo documentacao-resolver (obra-level, ancorado por categoria). SEM LLM.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'
import { carregarCampos, categoriaCodigo, chaveDedup, dateOnly } from '../_shared/template.ts'

interface Resposta {
  chave: string
  valor: unknown
  pagina?: number | null
  confianca?: number | null
}
interface Entrada {
  chave: string
  item: Record<string, unknown>
  pagina?: number | null
  confianca?: number | null
}
interface Body {
  obra_id?: string
  documento_id?: string
  categoria?: string
  respostas?: Resposta[]
  entradas?: Entrada[]
  confianca?: number
  assinado?: boolean
  doc_data?: string | null
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const roleErr = assertRole(ctx.caller, ['god', 'adm', 'engenheiro'])
  if (roleErr) return roleErr
  const { admin } = ctx

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const obra_id = body.obra_id?.trim()
  const documento_id = body.documento_id?.trim()
  if (!obra_id || !documento_id) return json({ error: 'obra_id e documento_id são obrigatórios' }, 400)

  const acc = await assertObraAccess(ctx, obra_id, { write: true })
  if (acc) return acc

  const codigo = categoriaCodigo(body.categoria)
  const confDoc = typeof body.confianca === 'number' ? body.confianca : 0.7
  const assinado = body.assinado ?? null
  const doc_data = dateOnly(body.doc_data) ?? null

  const campos = await carregarCampos(admin, obra_id)
  const dedupDe = new Map(campos.map((c) => [c.chave, c.chave_dedup]))

  // Idempotente: reextrair o mesmo doc substitui seus candidatos.
  await admin.from('extracao_candidato').delete().eq('obra_id', obra_id).eq('doc_id', documento_id)

  const linhas: Array<Record<string, unknown>> = []

  for (const r of body.respostas ?? []) {
    if (!r?.chave || r.valor == null || r.valor === '') continue
    linhas.push({
      obra_id,
      doc_id: documento_id,
      campo_chave: r.chave,
      item_key: '',
      valor_json: r.valor,
      pagina: typeof r.pagina === 'number' ? r.pagina : null,
      confianca: typeof r.confianca === 'number' ? r.confianca : confDoc,
      doc_categoria: codigo,
      assinado,
      doc_data
    })
  }

  // Entradas incrementais: item_key = dedup (distingue itens do mesmo doc).
  const vistosPorChave = new Map<string, number>()
  for (const e of body.entradas ?? []) {
    if (!e?.chave || !e.item || !Object.keys(e.item).length) continue
    let key = chaveDedup(e.item, dedupDe.get(e.chave))
    // garante unicidade intra-doc mesmo se a dedup colidir
    const seenKey = `${e.chave}|${key}`
    const n = vistosPorChave.get(seenKey) ?? 0
    if (n > 0) key = `${key}#${n}`
    vistosPorChave.set(seenKey, n + 1)
    linhas.push({
      obra_id,
      doc_id: documento_id,
      campo_chave: e.chave,
      item_key: key || `${linhas.length}`,
      valor_json: e.item,
      pagina: typeof e.pagina === 'number' ? e.pagina : null,
      confianca: typeof e.confianca === 'number' ? e.confianca : confDoc,
      doc_categoria: codigo,
      assinado,
      doc_data: dateOnly((e.item as Record<string, unknown>).data) ?? doc_data
    })
  }

  if (linhas.length) {
    const { error } = await admin.from('extracao_candidato').insert(linhas)
    if (error) return json({ error: error.message }, 500)
  }

  return json({ ok: true, candidatos: linhas.length })
})
