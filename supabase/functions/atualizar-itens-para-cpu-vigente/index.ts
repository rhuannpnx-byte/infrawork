// POST /functions/v1/atualizar-itens-para-cpu-vigente
// Body: { obra_id: string, servico_ids?: string[] }
//
// Para uma obra, identifica itens cujo snapshot está desatualizado em
// relação à CPU vigente do serviço (versão diferente ou custo_unit
// diferente), e re-snapshota todos. Ao final, recalcula a obra.
//
// Se `servico_ids` for passado, restringe ao subconjunto.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

interface ItemRow {
  id: string
  servico_id: string | null
  cpu_snapshot_id: string | null
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

  let body: { obra_id?: string; servico_ids?: string[] }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const obra_id = body.obra_id?.trim()
  if (!obra_id) return json({ error: 'obra_id é obrigatório' }, 400)

  const acc = await assertObraAccess(ctx, obra_id, { write: true })
  if (acc) return acc

  // 1) Pega itens servico_grupo da obra com servico_id
  let q = admin
    .from('item_orcamentario')
    .select('id, servico_id, cpu_snapshot_id')
    .eq('obra_id', obra_id)
    .eq('tipo', 'servico_grupo')
    .not('servico_id', 'is', null)
  if (body.servico_ids && body.servico_ids.length > 0) {
    q = q.in('servico_id', body.servico_ids)
  }
  const { data: itens, error: errItens } = await q
  if (errItens) return json({ error: errItens.message }, 400)
  const lista: ItemRow[] = (itens ?? []) as ItemRow[]

  // 2) Pega CPUs vigentes desses serviços
  const servicoIds = Array.from(new Set(lista.map((i) => i.servico_id!).filter(Boolean)))
  if (servicoIds.length === 0) {
    return json({ atualizados: 0, custo_total_anterior: 0, custo_total_novo: 0, diff_perc: 0 }, 200)
  }

  const { data: cpusVig } = await admin
    .from('cpu')
    .select('id, servico_id, versao, custo_unit_calc')
    .in('servico_id', servicoIds)
    .eq('is_vigente', true)
  const cpuPorServico = new Map<string, { id: string; versao: number; custo_unit_calc: number }>()
  for (const c of cpusVig ?? []) {
    cpuPorServico.set(c.servico_id as string, c as never)
  }

  // 3) Pega snapshots atuais (para comparar)
  const snapIds = Array.from(new Set(lista.map((i) => i.cpu_snapshot_id).filter(Boolean))) as string[]
  let snapMap = new Map<string, { cpu_id_origem: string | null; versao_origem: number | null; custo_unit: number }>()
  if (snapIds.length > 0) {
    const { data: snaps } = await admin
      .from('cpu_snapshot')
      .select('id, cpu_id_origem, versao_origem, custo_unit')
      .in('id', snapIds)
    snapMap = new Map(
      (snaps ?? []).map((s) => [
        s.id as string,
        { cpu_id_origem: s.cpu_id_origem, versao_origem: s.versao_origem, custo_unit: Number(s.custo_unit) }
      ])
    )
  }

  // 4) Decide quais precisam re-snapshot
  let custoAnterior = 0
  let custoNovo = 0
  let atualizados = 0
  for (const it of lista) {
    const cpuVig = cpuPorServico.get(it.servico_id!)
    if (!cpuVig) continue
    const snap = it.cpu_snapshot_id ? snapMap.get(it.cpu_snapshot_id) : null

    const precisa =
      !snap ||
      snap.cpu_id_origem !== cpuVig.id ||
      snap.versao_origem !== cpuVig.versao ||
      snap.custo_unit !== Number(cpuVig.custo_unit_calc)

    if (!precisa) continue

    custoAnterior += snap?.custo_unit ?? 0
    custoNovo += Number(cpuVig.custo_unit_calc)

    // Re-snapshot inline (chamada interna ao admin client)
    await reSnapshot(admin, it.id, it.servico_id!, caller.id)
    atualizados++
  }

  // 5) Recalcula
  if (atualizados > 0) {
    await admin.rpc('recalcular_orcamento', { _obra_id: obra_id })
  }

  return json(
    {
      atualizados,
      custo_total_anterior: custoAnterior,
      custo_total_novo: custoNovo,
      diff_perc:
        custoAnterior > 0 ? (custoNovo - custoAnterior) / custoAnterior : custoNovo > 0 ? 1 : 0
    },
    200
  )
})

// Reimplementação inline do snapshot — evita HTTP loop entre funções
async function reSnapshot(
  // deno-lint-ignore no-explicit-any
  admin: any,
  itemId: string,
  servicoId: string,
  callerId: string
): Promise<void> {
  const { data: cpu } = await admin
    .from('cpu')
    .select(
      'id, obra_id, servico_id, versao, producao_diaria_qtde, producao_diaria_unidade, ' +
        'custo_unit_calc, custo_eq_dia_calc, custo_comb_dia_calc, custo_mo_dia_calc, custo_mat_dia_calc, ' +
        'servico:servico_id(codigo, nome, unidade)'
    )
    .eq('servico_id', servicoId)
    .eq('is_vigente', true)
    .maybeSingle()
  if (!cpu) return

  const { data: item } = await admin
    .from('item_orcamentario')
    .select('obra_id')
    .eq('id', itemId)
    .single()
  if (cpu.obra_id !== item.obra_id) return

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

  const recursosIds = Array.from(new Set((itens ?? []).map((i: { recurso_id: string }) => i.recurso_id)))
  let precosMap: Record<string, number | null> = {}
  if (recursosIds.length > 0) {
    const { data: precos } = await admin
      .from('vw_recurso_com_preco')
      .select('id, preco_vigente')
      .in('id', recursosIds)
    precosMap = Object.fromEntries(
      (precos ?? []).map((p: { id: string; preco_vigente: number | null }) => [p.id, p.preco_vigente])
    )
  }

  const itensEnriched = (itens ?? []).map((it: Record<string, unknown>) => ({
    ...it,
    preco_vigente: precosMap[it.recurso_id as string] ?? null
  }))

  const servico = (cpu as { servico?: { codigo: string; nome: string; unidade: string | null } }).servico

  const { data: snap } = await admin
    .from('cpu_snapshot')
    .insert({
      obra_id: item.obra_id,
      cpu_id_origem: cpu.id,
      versao_origem: cpu.versao,
      criado_por: callerId,
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
      payload: { cpu, itens: itensEnriched, snapshot_em: new Date().toISOString() }
    })
    .select('id')
    .single()
  if (!snap) return
  await admin.from('item_orcamentario').update({ cpu_snapshot_id: snap.id }).eq('id', itemId)
}
