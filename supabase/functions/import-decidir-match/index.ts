// POST /functions/v1/import-decidir-match
// Body: {
//   job_id: string,
//   decisoes: { item_idx: number, servico_id: string | null }[]
// }
//
// Atualiza import_match_fraco com as escolhas do usuário.
// Quando TODOS os matches fracos do job estiverem decididos (escolha_em != null),
// transita o job para 'mapeado' e mescla as escolhas no payload_match.matches.
//
// Permissão: god/adm/eng com acesso à obra.

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

  let body: { job_id?: string; decisoes?: { item_idx: number; servico_id: string | null }[] }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const job_id = body.job_id?.trim()
  if (!job_id) return json({ error: 'job_id obrigatório' }, 400)
  const decisoes = body.decisoes ?? []
  if (!Array.isArray(decisoes)) return json({ error: 'decisoes deve ser array' }, 400)

  // Carrega job
  const { data: job } = await admin
    .from('import_job')
    .select('id, obra_id, status, payload_match')
    .eq('id', job_id)
    .single()
  if (!job) return json({ error: 'Job não encontrado' }, 404)
  if (job.status !== 'parseado' && job.status !== 'mapeado') {
    return json({ error: `Job em status ${job.status} não aceita decisões` }, 400)
  }

  const acc = await assertObraAccess(ctx, job.obra_id, { write: true })
  if (acc) return acc

  // Aplica decisões
  const now = new Date().toISOString()
  for (const d of decisoes) {
    const { error } = await admin
      .from('import_match_fraco')
      .update({
        escolha_servico_id: d.servico_id,
        escolha_em: now,
        escolha_por: caller.id
      })
      .eq('job_id', job_id)
      .eq('item_idx', d.item_idx)
    if (error) return json({ error: `Decisão idx ${d.item_idx}: ${error.message}` }, 400)
  }

  // Reavalia: todos os match_fraco do job têm escolha_em?
  const { data: pendentes } = await admin
    .from('import_match_fraco')
    .select('item_idx, escolha_servico_id, escolha_em')
    .eq('job_id', job_id)
  const total = pendentes?.length ?? 0
  const decididos = (pendentes ?? []).filter((p) => p.escolha_em !== null).length

  let newStatus = job.status
  let updatedMatch = job.payload_match as { matches: Record<number, { servico_id: string; tipo: string }> }
  if (total === decididos) {
    // Mescla escolhas no payload_match.matches (só os que escolheram servico_id != null)
    const matches = { ...(updatedMatch?.matches ?? {}) }
    for (const p of pendentes ?? []) {
      if (p.escolha_servico_id) {
        matches[p.item_idx] = { servico_id: p.escolha_servico_id, tipo: 'fraco' }
      }
    }
    updatedMatch = { matches }
    newStatus = 'mapeado'
    const { error: errUp } = await admin
      .from('import_job')
      .update({ status: newStatus, payload_match: updatedMatch })
      .eq('id', job_id)
    if (errUp) return json({ error: `Update job: ${errUp.message}` }, 400)
  }

  return json({
    job_id,
    status: newStatus,
    total_fracos: total,
    decididos
  })
})
