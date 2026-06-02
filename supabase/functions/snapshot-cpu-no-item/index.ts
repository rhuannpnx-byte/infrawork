// POST /functions/v1/snapshot-cpu-no-item
// Body: { item_id: string, cpu_id?: string, force?: boolean }
//
// Cria um cpu_snapshot blindado (cópia da CPU + itens + preços vigentes)
// e vincula a um item_orcamentario do tipo `servico_grupo`.
//
// Dois modos:
//   - Legado: servico sem vínculos em servico_cpu_link. Usa a CPU vigente
//     (ou a passada em cpu_id) — comportamento original.
//   - Agregador: servico com N CPUs vinculadas. Snapshot rico: payload guarda
//     todas as CPUs + fatores + cpu_items + preços. Custo unit = Σ
//     (cpu.custo_unit / fator). cpu_id_origem fica NULL nesse caso.
//
// Idempotente: se o snapshot atual já tem o mesmo custo_unit e (modo
// legado) mesmo cpu_id_origem, retorna o existente — a menos que force=true.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

interface CpuRow {
  id: string
  obra_id: string
  servico_id: string
  versao: number
  producao_diaria_qtde: number
  producao_diaria_unidade: string
  custo_unit_calc: number
  custo_eq_dia_calc: number
  custo_comb_dia_calc: number
  custo_mo_dia_calc: number
  custo_mat_dia_calc: number
  servico?: { codigo: string; nome: string; unidade: string | null } | null
}

type Admin = Awaited<ReturnType<typeof resolveCaller>> extends infer R
  ? R extends { admin: infer A }
    ? A
    : never
  : never

async function carregarCpuComItens(
  admin: Admin,
  cpuId: string
): Promise<{ cpu: CpuRow; itensEnriched: unknown[] } | { error: string }> {
  const { data: cpu } = await (admin as { from: (t: string) => unknown })
    .from('cpu')
    .select(
      'id, obra_id, servico_id, versao, producao_diaria_qtde, producao_diaria_unidade, ' +
        'custo_unit_calc, custo_eq_dia_calc, custo_comb_dia_calc, custo_mo_dia_calc, custo_mat_dia_calc, ' +
        'servico:servico_id(codigo, nome, unidade)'
    )
    .eq('id', cpuId)
    .maybeSingle()
  if (!cpu) return { error: `CPU ${cpuId} não encontrada` }

  const { data: itens } = await (admin as { from: (t: string) => unknown })
    .from('cpu_item')
    .select(
      'id, grupo, recurso_id, quantidade, horas_dia, consumo_combustivel_lh, indice_produtividade, ' +
        'consumo_material_por_unid, ordem, custo_total_calc, ' +
        'recurso:recurso_id(id, nome, unidade, grupo, codigo)'
    )
    .eq('cpu_id', cpuId)
    .order('grupo')
    .order('ordem')

  const recursosIds = Array.from(
    new Set(((itens ?? []) as { recurso_id: string }[]).map((i) => i.recurso_id))
  )
  let precosMap: Record<string, number | null> = {}
  if (recursosIds.length > 0) {
    const { data: precos } = await (admin as { from: (t: string) => unknown })
      .from('vw_recurso_com_preco')
      .select('id, preco_vigente')
      .in('id', recursosIds)
    precosMap = Object.fromEntries(
      ((precos ?? []) as { id: string; preco_vigente: number | null }[]).map((p) => [
        p.id,
        p.preco_vigente
      ])
    )
  }

  const itensEnriched = ((itens ?? []) as Record<string, unknown>[]).map((it) => ({
    ...it,
    preco_vigente: precosMap[it.recurso_id as string] ?? null
  }))

  return { cpu: cpu as CpuRow, itensEnriched }
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

  if (!item.servico_id) {
    return json({ error: 'Item sem servico_id' }, 400)
  }

  // 2) Detecta modo: agregador se há vínculos servico_cpu_link
  const { data: links } = await admin
    .from('servico_cpu_link')
    .select('id, cpu_id, fator, operacao, ordem, observacao')
    .eq('servico_id', item.servico_id)
    .order('ordem')

  const modo: 'legado' | 'agregador' =
    body.cpu_id ? 'legado' : (links?.length ?? 0) > 0 ? 'agregador' : 'legado'

  // ─── Carrega servico (sempre — usado em ambos modos pra header) ──────
  const { data: servico } = await admin
    .from('servico')
    .select('id, codigo, nome, unidade, producao_diaria_qtde, producao_diaria_unidade')
    .eq('id', item.servico_id)
    .maybeSingle()
  if (!servico) return json({ error: 'Servico não encontrado' }, 404)

  if (modo === 'legado') {
    // ─── Modo legado: 1 CPU única (vigente ou passada explicitamente) ───
    let cpuId = body.cpu_id?.trim()
    if (!cpuId) {
      const { data: cpuVig } = await admin
        .from('cpu')
        .select('id')
        .eq('servico_id', item.servico_id)
        .eq('is_vigente', true)
        .maybeSingle()
      if (!cpuVig) return json({ error: 'Nenhuma CPU vigente para o serviço' }, 404)
      cpuId = cpuVig.id as string
    }

    const carga = await carregarCpuComItens(admin as unknown as Admin, cpuId)
    if ('error' in carga) return json({ error: carga.error }, 404)
    const { cpu, itensEnriched } = carga
    if (cpu.obra_id !== item.obra_id) {
      return json({ error: 'CPU e item são de obras diferentes' }, 400)
    }

    // Idempotência
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
        return json(
          { snapshot_id: atual.id, custo_unit: atual.custo_unit, criado: false, modo },
          200
        )
      }
    }

    const payload = {
      modo,
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
        servico_codigo: cpu.servico?.codigo ?? servico.codigo,
        servico_nome: cpu.servico?.nome ?? servico.nome,
        servico_unidade: cpu.servico?.unidade ?? servico.unidade,
        payload
      })
      .select('id')
      .single()
    if (errSnap) return json({ error: errSnap.message }, 400)

    const { error: errUp } = await admin
      .from('item_orcamentario')
      .update({ cpu_snapshot_id: snap.id })
      .eq('id', item_id)
    if (errUp) return json({ error: errUp.message }, 400)

    await admin.rpc('recalcular_orcamento', { _obra_id: item.obra_id })

    return json(
      { snapshot_id: snap.id, custo_unit: cpu.custo_unit_calc, criado: true, modo },
      201
    )
  }

  // ─── Modo agregador: snapshot rico de todas as CPUs vinculadas ───────
  const cpusPayload: Array<Record<string, unknown>> = []
  let custoUnitAgregado = 0
  let custoEqDia = 0
  let custoCombDia = 0
  let custoMoDia = 0
  let custoMatDia = 0
  let producaoQtde: number | null = servico.producao_diaria_qtde ?? null
  let producaoUnidade: string | null = servico.producao_diaria_unidade ?? null

  for (let i = 0; i < (links ?? []).length; i++) {
    const link = (links ?? [])[i] as {
      cpu_id: string
      fator: number
      operacao?: 'dividir' | 'multiplicar'
      ordem: number
      observacao: string | null
      id: string
    }
    const carga = await carregarCpuComItens(admin as unknown as Admin, link.cpu_id)
    if ('error' in carga) return json({ error: carga.error }, 404)
    const { cpu, itensEnriched } = carga
    if (cpu.obra_id !== item.obra_id) {
      return json({ error: `CPU ${cpu.id} é de outra obra` }, 400)
    }
    const fator = Number(link.fator) || 1
    const operacao = link.operacao ?? 'dividir'
    // Aplica operação: 'multiplicar' multiplica o custo da CPU pelo fator;
    // 'dividir' (default) divide. Mesma semântica em todos os custos parciais.
    const apply = (v: number): number => {
      if (!isFinite(fator) || fator === 0) return 0
      return operacao === 'multiplicar' ? v * fator : v / fator
    }
    const contribuicao = apply(Number(cpu.custo_unit_calc))
    custoUnitAgregado += contribuicao
    custoEqDia += apply(Number(cpu.custo_eq_dia_calc))
    custoCombDia += apply(Number(cpu.custo_comb_dia_calc))
    custoMoDia += apply(Number(cpu.custo_mo_dia_calc))
    custoMatDia += apply(Number(cpu.custo_mat_dia_calc))
    if (producaoQtde === null && i === 0) {
      producaoQtde = Number(cpu.producao_diaria_qtde)
      producaoUnidade = cpu.producao_diaria_unidade
    }
    cpusPayload.push({
      cpu: {
        id: cpu.id,
        servico_id: cpu.servico_id,
        versao: cpu.versao,
        custo_unit_calc: cpu.custo_unit_calc,
        producao_diaria_qtde: cpu.producao_diaria_qtde,
        producao_diaria_unidade: cpu.producao_diaria_unidade,
        servico: cpu.servico
      },
      fator,
      operacao,
      ordem: link.ordem,
      observacao: link.observacao,
      contribuicao_custo: contribuicao,
      itens: itensEnriched
    })
  }

  if (cpusPayload.length === 0) {
    return json({ error: 'Servico-agregador sem CPUs vinculadas' }, 400)
  }

  // Idempotência (agregador): compara custo total — se bate e !force, mantém
  if (!force && item.cpu_snapshot_id) {
    const { data: atual } = await admin
      .from('cpu_snapshot')
      .select('id, cpu_id_origem, custo_unit')
      .eq('id', item.cpu_snapshot_id)
      .maybeSingle()
    if (
      atual &&
      atual.cpu_id_origem === null &&
      Math.abs(Number(atual.custo_unit) - custoUnitAgregado) < 0.0001
    ) {
      return json(
        { snapshot_id: atual.id, custo_unit: atual.custo_unit, criado: false, modo },
        200
      )
    }
  }

  const payloadAgregado = {
    modo,
    servico: {
      id: servico.id,
      codigo: servico.codigo,
      nome: servico.nome,
      unidade: servico.unidade,
      producao_diaria_qtde: producaoQtde,
      producao_diaria_unidade: producaoUnidade
    },
    cpus: cpusPayload,
    snapshot_em: new Date().toISOString()
  }

  const { data: snap, error: errSnap } = await admin
    .from('cpu_snapshot')
    .insert({
      obra_id: item.obra_id,
      cpu_id_origem: null,
      versao_origem: null,
      criado_por: caller.id,
      custo_unit: custoUnitAgregado,
      custo_eq_dia: custoEqDia,
      custo_comb_dia: custoCombDia,
      custo_mo_dia: custoMoDia,
      custo_mat_dia: custoMatDia,
      producao_diaria_qtde: producaoQtde ?? 1,
      producao_diaria_unidade: producaoUnidade ?? 'DIA',
      servico_codigo: servico.codigo,
      servico_nome: servico.nome,
      servico_unidade: servico.unidade,
      payload: payloadAgregado
    })
    .select('id')
    .single()
  if (errSnap) return json({ error: errSnap.message }, 400)

  const { error: errUp } = await admin
    .from('item_orcamentario')
    .update({ cpu_snapshot_id: snap.id })
    .eq('id', item_id)
  if (errUp) return json({ error: errUp.message }, 400)

  await admin.rpc('recalcular_orcamento', { _obra_id: item.obra_id })

  return json(
    { snapshot_id: snap.id, custo_unit: custoUnitAgregado, criado: true, modo },
    201
  )
})
