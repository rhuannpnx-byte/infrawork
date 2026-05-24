// POST /functions/v1/import-indireto-aplicar
//
// Cria UM item monolítico de custo indireto na obra a partir do total mensal
// extraído da aba INDIRETO da planilha (J4) × número de meses informado pelo
// usuário.
//
// Não importa a hierarquia detalhada. Se o usuário quiser quebrar depois,
// pode criar items filhos manualmente.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { caller, admin } = ctx
  const roleErr = assertRole(caller, ['god', 'adm', 'engenheiro'])
  if (roleErr) return roleErr

  let body: {
    obra_id?: string
    descricao?: string
    valor_mensal?: number
    meses?: number
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }

  const obra_id = body.obra_id?.trim()
  const descricao = body.descricao?.trim() || 'Custos Indiretos'
  const valor_mensal = Number(body.valor_mensal ?? 0)
  const meses = Math.max(1, Math.floor(Number(body.meses ?? 1)))

  if (!obra_id) return json({ error: 'obra_id obrigatório' }, 400)
  if (!Number.isFinite(valor_mensal) || valor_mensal <= 0) {
    return json({ error: 'valor_mensal deve ser > 0' }, 400)
  }

  const acc = await assertObraAccess(ctx, obra_id, { write: true })
  if (acc) return acc

  const t0 = Date.now()
  const valor_total = valor_mensal * meses

  // Gera código único — IND-001, IND-002…
  const { data: existentes } = await admin
    .from('indireto_item')
    .select('codigo')
    .eq('obra_id', obra_id)
    .like('codigo', 'IND-%')
  const indices = (existentes ?? [])
    .map((e) => parseInt(String(e.codigo).replace('IND-', ''), 10))
    .filter((n) => Number.isFinite(n))
  const next = indices.length > 0 ? Math.max(...indices) + 1 : 1
  const codigo = `IND-${String(next).padStart(3, '0')}`

  const { data: novo, error } = await admin
    .from('indireto_item')
    .insert({
      obra_id,
      parent_id: null,
      codigo,
      descricao,
      tipo: 'outros',
      valor_total,
      distribuicao_perc: 1.0,
      ordem: 0
    })
    .select('id, codigo, descricao, valor_total')
    .single()

  if (error || !novo) {
    return json({ error: error?.message ?? 'falha ao criar' }, 400)
  }

  return json({
    ok: true,
    item: novo,
    valor_mensal,
    meses,
    valor_total,
    duracao_ms: Date.now() - t0
  })
})
