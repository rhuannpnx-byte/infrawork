// POST /functions/v1/criar-revisao-orcamento
// Body: { obra_id: string, rotulo?: string, observacao?: string }
//
// Cria uma revisão "rascunho" da obra:
//   1. Roda recalcular_orcamento para garantir totais fresh.
//   2. Chama snapshot_orcamento_atual() — produz JSONB com Plan_Orc +
//      Indireto + obra + cpu_snapshots referenciados + totais.
//   3. Insere em revisao_orcamento (versão auto via trigger).
//
// Permissão: god/adm/engenheiro com acesso à obra.

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

  let body: { obra_id?: string; rotulo?: string; observacao?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const obra_id = body.obra_id?.trim()
  if (!obra_id) return json({ error: 'obra_id é obrigatório' }, 400)

  const acc = await assertObraAccess(ctx, obra_id, { write: true })
  if (acc) return acc

  // 1) Recalcula para garantir totais frescos
  const { error: errRecalc } = await admin.rpc('recalcular_orcamento', { _obra_id: obra_id })
  if (errRecalc) return json({ error: `Recalcular: ${errRecalc.message}` }, 400)

  // 2) Gera snapshot via função PL/pgSQL
  const { data: snapshot, error: errSnap } = await admin.rpc('snapshot_orcamento_atual', {
    _obra_id: obra_id
  })
  if (errSnap) return json({ error: `Snapshot: ${errSnap.message}` }, 400)

  const totais = (snapshot as { totais?: { custo_direto?: number; venda_total?: number } } | null)?.totais ?? {}
  const custoTotal = Number(totais.custo_direto ?? 0)
  const vendaTotal = Number(totais.venda_total ?? 0)

  // Lê alíquotas da obra para lucratividade
  const { data: obra } = await admin
    .from('obras')
    .select('aliquota_iss_perc, aliquota_pis_perc, aliquota_cofins_perc, aliquota_outros_perc')
    .eq('id', obra_id)
    .single()
  const aliquota =
    Number(obra?.aliquota_iss_perc ?? 0) +
    Number(obra?.aliquota_pis_perc ?? 0) +
    Number(obra?.aliquota_cofins_perc ?? 0) +
    Number(obra?.aliquota_outros_perc ?? 0)
  const lucr = vendaTotal > 0 ? (vendaTotal - custoTotal - vendaTotal * aliquota) / vendaTotal : null

  // 3) Insere revisão (versão auto-incrementada pelo trigger)
  const { data: revisao, error: errIns } = await admin
    .from('revisao_orcamento')
    .insert({
      obra_id,
      rotulo: body.rotulo?.trim() || null,
      observacao: body.observacao?.trim() || null,
      status: 'rascunho',
      snapshot,
      custo_total: custoTotal,
      venda_total: vendaTotal,
      lucratividade_perc: lucr,
      criada_por: caller.id
    })
    .select('id, versao, status, custo_total, venda_total, lucratividade_perc, criada_em')
    .single()
  if (errIns) return json({ error: errIns.message }, 400)

  return json(revisao, 201)
})
