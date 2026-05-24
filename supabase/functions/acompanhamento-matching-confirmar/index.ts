// POST /functions/v1/acompanhamento-matching-confirmar
// Body: {
//   obra_id: string,
//   matches: Array<
//     | { tipo: 'equipe',       siga_nome: string,  equipe_id: string | null }
//     | { tipo: 'encarregado',  siga_nome: string,  apelido_canonico?: string, equipe_match_id?: string | null }
//     | { tipo: 'servico',      siga_id: number,    siga_nome?: string, servico_id: string | null, item_orcamentario_id?: string | null }
//   >,
//   origem?: 'auto' | 'manual'   // default 'manual'
// }
//
// UPSERT em batch nas 3 tabelas de match. equipe_id/servico_id=null com
// origem='manual' grava como 'rejeitado' (= "vi e decidi não vincular").
//
// Ao final, dispara `acompanhamento-alertas-recalcular` fire-and-forget
// pra atualizar os alertas baseados nesses novos vínculos.
//
// Permissão: god/adm/eng com acesso de escrita à obra.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

interface MatchEquipe {
  tipo: 'equipe'
  siga_nome: string
  equipe_id: string | null
  confianca?: number
}
interface MatchEncarregado {
  tipo: 'encarregado'
  siga_nome: string
  apelido_canonico?: string
  equipe_match_id?: string | null
  confianca?: number
}
interface MatchServico {
  tipo: 'servico'
  siga_id: number
  siga_nome?: string
  servico_id: string | null
  item_orcamentario_id?: string | null
  confianca?: number
  fator_conversao?: number
  siga_unidade_id?: number | null
  siga_unidade_nome?: string | null
}
type Match = MatchEquipe | MatchEncarregado | MatchServico

interface Body {
  obra_id?: string
  matches?: Match[]
  origem?: 'auto' | 'manual'
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  let body: Body = {}
  try { body = await req.json() } catch { /* ignore */ }
  if (!body.obra_id) return json({ error: 'obra_id obrigatório' }, 400)
  if (!Array.isArray(body.matches) || body.matches.length === 0)
    return json({ error: 'matches obrigatório (array não vazio)' }, 400)
  if (body.matches.length > 500) return json({ error: 'máximo 500 matches por chamada' }, 400)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const roleErr = assertRole(ctx.caller, ['god', 'adm', 'engenheiro'])
  if (roleErr) return roleErr
  const accErr = await assertObraAccess(ctx, body.obra_id, { write: true })
  if (accErr) return accErr

  const { admin } = ctx
  const origemBase = body.origem ?? 'manual'
  const nowIso = new Date().toISOString()

  // Auto-resolve item_orcamentario quando ausente mas tem servico_id
  const servicosSemItem = body.matches
    .filter((m): m is MatchServico => m.tipo === 'servico' && !!m.servico_id && !m.item_orcamentario_id)
    .map((m) => m.servico_id as string)
  if (servicosSemItem.length > 0) {
    const { data: itens } = await admin
      .from('item_orcamentario')
      .select('id, servico_id')
      .eq('obra_id', body.obra_id)
      .in('servico_id', servicosSemItem)
    const servicoToItens = new Map<string, string[]>()
    for (const i of itens ?? []) {
      const arr = servicoToItens.get(i.servico_id) ?? []
      arr.push(i.id)
      servicoToItens.set(i.servico_id, arr)
    }
    for (const m of body.matches) {
      if (m.tipo === 'servico' && m.servico_id && !m.item_orcamentario_id) {
        const arr = servicoToItens.get(m.servico_id) ?? []
        if (arr.length === 1) m.item_orcamentario_id = arr[0]
        // Se 0 ou >1, deixa null — UI pode pedir escolha manual depois
      }
    }
  }

  const equipesRows: Array<Record<string, unknown>> = []
  const encarregadosRows: Array<Record<string, unknown>> = []
  const servicosRows: Array<Record<string, unknown>> = []
  const erros: string[] = []

  for (const m of body.matches) {
    const ehRejeicao = origemBase === 'manual'
    if (m.tipo === 'equipe') {
      if (!m.siga_nome) { erros.push('equipe sem siga_nome'); continue }
      equipesRows.push({
        obra_id: body.obra_id,
        siga_equipe_nome: m.siga_nome,
        equipe_id: m.equipe_id,
        origem: m.equipe_id ? origemBase : (ehRejeicao ? 'rejeitado' : 'auto'),
        confianca_sugestao: m.confianca ?? null,
        confirmado_por: ctx.caller.id,
        confirmado_em: nowIso
      })
    } else if (m.tipo === 'encarregado') {
      if (!m.siga_nome) { erros.push('encarregado sem siga_nome'); continue }
      encarregadosRows.push({
        obra_id: body.obra_id,
        siga_encarregado_nome: m.siga_nome,
        apelido_canonico: m.apelido_canonico ?? m.siga_nome,
        equipe_match_id: m.equipe_match_id ?? null,
        origem: origemBase,
        confianca_sugestao: m.confianca ?? null,
        confirmado_por: ctx.caller.id,
        confirmado_em: nowIso
      })
    } else if (m.tipo === 'servico') {
      if (m.siga_id == null) { erros.push('servico sem siga_id'); continue }
      const row: Record<string, unknown> = {
        obra_id: body.obra_id,
        siga_servico_executado_id: m.siga_id,
        siga_servico_nome: m.siga_nome ?? null,
        servico_id: m.servico_id,
        item_orcamentario_id: m.item_orcamentario_id ?? null,
        origem: m.servico_id ? origemBase : (ehRejeicao ? 'rejeitado' : 'auto'),
        confianca_sugestao: m.confianca ?? null,
        confirmado_por: ctx.caller.id,
        confirmado_em: nowIso
      }
      if (m.fator_conversao != null) row.fator_conversao = m.fator_conversao
      if (m.siga_unidade_id !== undefined) row.siga_unidade_id = m.siga_unidade_id
      if (m.siga_unidade_nome !== undefined) row.siga_unidade_nome = m.siga_unidade_nome
      servicosRows.push(row)
    } else {
      erros.push(`tipo desconhecido: ${(m as { tipo: string }).tipo}`)
    }
  }

  const result: { equipes?: number; encarregados?: number; servicos?: number } = {}
  if (equipesRows.length > 0) {
    const { error, count } = await admin
      .from('acompanhamento_equipe_match')
      .upsert(equipesRows, { onConflict: 'obra_id,siga_equipe_nome', count: 'exact' })
    if (error) erros.push(`equipes: ${error.message}`)
    else result.equipes = count ?? equipesRows.length
  }
  if (encarregadosRows.length > 0) {
    const { error, count } = await admin
      .from('acompanhamento_encarregado_match')
      .upsert(encarregadosRows, { onConflict: 'obra_id,siga_encarregado_nome', count: 'exact' })
    if (error) erros.push(`encarregados: ${error.message}`)
    else result.encarregados = count ?? encarregadosRows.length
  }
  if (servicosRows.length > 0) {
    const { error, count } = await admin
      .from('acompanhamento_servico_match')
      .upsert(servicosRows, { onConflict: 'obra_id,siga_servico_executado_id', count: 'exact' })
    if (error) erros.push(`servicos: ${error.message}`)
    else result.servicos = count ?? servicosRows.length
  }

  // Fire-and-forget recálculo de alertas (não bloqueia retorno)
  try {
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    if (SERVICE_KEY && SUPABASE_URL) {
      fetch(`${SUPABASE_URL}/functions/v1/acompanhamento-alertas-recalcular`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ obra_id: body.obra_id })
      }).catch(() => { /* ignore */ })
    }
  } catch { /* ignore */ }

  return json({ ok: erros.length === 0, gravados: result, erros: erros.length > 0 ? erros : undefined })
})
