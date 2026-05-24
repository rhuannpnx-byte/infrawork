// POST /functions/v1/snapshot-cpu-no-item
// Body: { item_id: string, cpu_id?: string, force?: boolean }
//
// Cria um cpu_snapshot blindado (cópia da CPU + itens + preços vigentes)
// e vincula a um item_orcamentario do tipo `servico_grupo`. Se `cpu_id`
// não informado, usa a CPU vigente do servico do item. Idempotente: se
// o snapshot atual já tem o mesmo cpu_id_origem com mesmo custo_unit,
// retorna existente (a menos que `force=true`).
//
// Após criar o snapshot, dispara recalcular_orcamento.

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

  let body: { item_id?: string; cpu_id?: string; force?: boolean }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const item_id = body.item_id?.trim()
  if (!item_id) return json({ error: 'item_id é obrigatório' }, 400)
  const force = body.force === true

  // 1) Carrega item + valida tipo
  const { data: item } = await admin
    .from('item_orcamentario')
    .select('id, obra_id, servico_id, tipo, cpu_snapshot_id')
    .eq('id', item_id)
    .maybeSingle()
  if (!item) return json({ error: 'Item não encontrado' }, 404)
  if (item.tipo !== 'servico_grupo') {
    return json({ error: 'Snapshot de CPU só faz sentido em item tipo servico_grupo' }, 400)
  }

  const acc = await assertObraAccess(ctx, item.obra_id, { write: true })
  if (acc) return acc

  // 2) Resolve CPU origem
  let cpuId = body.cpu_id?.trim()
  if (!cpuId) {
    if (!item.servico_id) {
      return json({ error: 'Item sem servico_id e sem cpu_id informado' }, 400)
    }
    const { data: cpuVig } = await admin
      .from('cpu')
      .select('id')
      .eq('servico_id', item.servico_id)
      .eq('is_vigente', true)
      .maybeSingle()
    if (!cpuVig) return json({ error: 'Nenhuma CPU vigente para o serviço' }, 404)
    cpuId = cpuVig.id as string
  }

  // 3) Carrega CPU + servico (CPU agora é por obra; valida mesma obra)
  const { data: cpu } = await admin
    .from('cpu')
    .select(
      'id, obra_id, servico_id, versao, producao_diaria_qtde, producao_diaria_unidade, ' +
        'custo_unit_calc, custo_eq_dia_calc, custo_comb_dia_calc, custo_mo_dia_calc, custo_mat_dia_calc, ' +
        'servico:servico_id(codigo, nome, unidade)'
    )
    .eq('id', cpuId)
    .maybeSingle()
  if (!cpu) return json({ error: 'CPU não encontrada' }, 404)
  if (cpu.obra_id !== item.obra_id) {
    return json({ error: 'CPU e item são de obras diferentes' }, 400)
  }

  // 4) Idempotência
  if (!force && item.cpu_snapshot_id) {
    const { data: atual } = await admin
      .from('cpu_snapshot')
      .select('id, cpu_id_origem, versao_origem, custo_unit')
      .eq('id', item.cpu_snapshot_id)
      .maybeSingle()
    if (
      atual &&
      atual.cpu_id_origem === cpu.id &&
      atual.versao_origem === cpu.versao &&
      Number(atual.custo_unit) === Number(cpu.custo_unit_calc)
    ) {
      return json({ snapshot_id: atual.id, custo_unit: atual.custo_unit, criado: false }, 200)
    }
  }

  // 5) cpu_items + preços vigentes
  const { data: itens } = await admin
    .from('cpu_item')
    .select(
      'id, grupo, recurso_id, quantidade, horas_dia, consumo_combustivel_lh, indice_produtividade, ' +
        'consumo_material_por_unid, ordem, custo_total_calc, ' +
        'recurso:recurso_id(id, nome, unidade, grupo, codigo)'
    )
    .eq('cpu_id', cpu.id)
    .order('grupo')
    .order('ordem')

  const recursosIds = Array.from(
    new Set((itens ?? []).map((i: { recurso_id: string }) => i.recurso_id))
  )
  let precosMap: Record<string, number | null> = {}
  if (recursosIds.length > 0) {
    const { data: precos } = await admin
      .from('vw_recurso_com_preco')
      .select('id, preco_vigente')
      .in('id', recursosIds)
    precosMap = Object.fromEntries(
      (precos ?? []).map((p: { id: string; preco_vigente: number | null }) => [
        p.id,
        p.preco_vigente
      ])
    )
  }

  const itensEnriched = (itens ?? []).map((it: Record<string, unknown>) => ({
    ...it,
    preco_vigente: precosMap[it.recurso_id as string] ?? null
  }))

  const servico = (cpu as { servico?: { codigo: string; nome: string; unidade: string | null } })
    .servico

  const payload = {
    cpu: {
      id: cpu.id,
      servico_id: cpu.servico_id,
      versao: cpu.versao,
      producao_diaria_qtde: cpu.producao_diaria_qtde,
      producao_diaria_unidade: cpu.producao_diaria_unidade
    },
    itens: itensEnriched,
    snapshot_em: new Date().toISOString()
  }

  // 6) Insere snapshot (admin bypassa imutabilidade e RLS)
  const { data: snap, error: errSnap } = await admin
    .from('cpu_snapshot')
    .insert({
      obra_id: item.obra_id,
      cpu_id_origem: cpu.id,
      versao_origem: cpu.versao,
      criado_por: caller.id,
      custo_unit: cpu.custo_unit_calc,
      custo_eq_dia: cpu.custo_eq_dia_calc,
      custo_comb_dia: cpu.custo_comb_dia_calc,
      custo_mo_dia: cpu.custo_mo_dia_calc,
      custo_mat_dia: cpu.custo_mat_dia_calc,
      producao_diaria_qtde: cpu.producao_diaria_qtde,
      producao_diaria_unidade: cpu.producao_diaria_unidade,
      servico_codigo: servico?.codigo ?? null,
      servico_nome: servico?.nome ?? null,
      servico_unidade: servico?.unidade ?? null,
      payload
    })
    .select('id')
    .single()
  if (errSnap) return json({ error: errSnap.message }, 400)

  // 7) Vincula ao item
  const { error: errUp } = await admin
    .from('item_orcamentario')
    .update({ cpu_snapshot_id: snap.id })
    .eq('id', item_id)
  if (errUp) return json({ error: errUp.message }, 400)

  // 8) Recalcula
  await admin.rpc('recalcular_orcamento', { _obra_id: item.obra_id })

  return json({ snapshot_id: snap.id, custo_unit: cpu.custo_unit_calc, criado: true }, 201)
})
