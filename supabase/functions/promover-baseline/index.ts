// POST /functions/v1/promover-baseline
// Body: { planejamento_id: string }
// Permissão: God/Adm/Engenheiro com acesso à obra (write).
//
// Promove um planejamento a baseline:
//   1) Desmarca baseline anterior da obra.
//   2) Marca este como baseline (is_baseline=true).
//   3) Cria snapshot imutável em planejamento_baseline_snapshot
//      com payload contendo tarefas + deps + equipes + calendário.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

interface Body {
  planejamento_id?: string
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { caller, admin } = ctx
  const roleErr = assertRole(caller, ['god', 'adm', 'engenheiro'])
  if (roleErr) return roleErr

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const planejamento_id = body.planejamento_id?.trim()
  if (!planejamento_id) return json({ error: 'planejamento_id é obrigatório' }, 400)

  const { data: plan, error: planErr } = await admin
    .from('planejamento')
    .select('id, obra_id, nome, status, is_baseline')
    .eq('id', planejamento_id)
    .maybeSingle()
  if (planErr || !plan) return json({ error: 'Planejamento não encontrado' }, 404)

  const accErr = await assertObraAccess(ctx, plan.obra_id, { write: true })
  if (accErr) return accErr

  if (plan.is_baseline) {
    return json({ error: 'Este planejamento já é a baseline.' }, 409)
  }
  if (plan.status !== 'ativo' && plan.status !== 'rascunho') {
    return json({ error: 'Apenas planejamento ativo ou rascunho pode virar baseline.' }, 409)
  }

  // 1) Coletar tudo para o snapshot ANTES de marcar baseline (evita
  //    trigger imutabilidade bloquear edição posterior se algo falhar).
  const [tarRes, depRes, eqRes, calRes, excRes, fatRes] = await Promise.all([
    admin
      .from('planejamento_tarefa')
      .select('*')
      .eq('planejamento_id', planejamento_id),
    admin
      .from('planejamento_dependencia')
      .select('*')
      .eq('planejamento_id', planejamento_id),
    admin
      .from('planejamento_tarefa_equipe')
      .select('*, equipe:equipe_id (id, nome, cor, tipo)')
      .in(
        'tarefa_id',
        ((await admin
          .from('planejamento_tarefa')
          .select('id')
          .eq('planejamento_id', planejamento_id)).data ?? []).map((t) => t.id)
      ),
    admin.from('obra_calendario').select('*').eq('obra_id', plan.obra_id).maybeSingle(),
    admin.from('obra_calendario_excecao').select('*').eq('obra_id', plan.obra_id),
    admin.from('obra_produtividade_mes').select('*').eq('obra_id', plan.obra_id)
  ])

  const payload = {
    tarefas: tarRes.data ?? [],
    dependencias: depRes.data ?? [],
    equipes_aloc: eqRes.data ?? [],
    calendario: {
      base: calRes.data ?? null,
      excecoes: excRes.data ?? [],
      fatores_mes: fatRes.data ?? []
    },
    snapshot_em: new Date().toISOString()
  }

  // 2) Insert snapshot
  const { data: snap, error: snapErr } = await admin
    .from('planejamento_baseline_snapshot')
    .insert({
      planejamento_id,
      obra_id: plan.obra_id,
      payload,
      criado_por: caller.id
    })
    .select('id')
    .single()
  if (snapErr) return json({ error: snapErr.message }, 500)

  // 3) Marca baseline (trigger fn_planejamento_baseline_unica desmarca anteriores)
  const { error: updErr } = await admin
    .from('planejamento')
    .update({ is_baseline: true, status: 'ativo' })
    .eq('id', planejamento_id)
  if (updErr) return json({ error: updErr.message }, 500)

  return json({
    ok: true,
    baseline_id: plan.id,
    snapshot_id: snap.id
  })
})
