// POST /functions/v1/atualizar-itens-para-cpu-vigente
// Body: { obra_id: string, servico_ids?: string[] }
//
// Para uma obra, identifica itens (servico_grupo) cujo snapshot está
// desatualizado em relação à CPU/serviço vigente — comparando CUSTO e
// PRODUTIVIDADE EFETIVOS (via vw_servico_custo_agregado, que resolve tanto o
// modo legado quanto o agregador + override de produtividade no serviço) — e
// re-snapshota delegando à função canônica `snapshot-cpu-no-item` (que trata
// legado, agregador e produtividade do serviço corretamente, e recalcula o
// orçamento).
//
// Importante: a versão anterior usava um re-snapshot inline "legado-only" e
// buscava CPU vigente por servico_id — serviços AGREGADORES (sem CPU própria)
// eram pulados, então mudar a produtividade do serviço não refletia em nada.
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

  // 1) Itens servico_grupo da obra com servico_id
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

  const servicoIds = Array.from(new Set(lista.map((i) => i.servico_id!).filter(Boolean)))
  if (servicoIds.length === 0) {
    return json({ atualizados: 0, custo_total_anterior: 0, custo_total_novo: 0, diff_perc: 0 }, 200)
  }

  // 2) Valores EFETIVOS por serviço (custo + produtividade), resolvendo
  //    agregador (Σ cpu/fator + producao_diaria_efetiva) e override no serviço.
  const { data: agg } = await admin
    .from('vw_servico_custo_agregado')
    .select('servico_id, cpus_vinculadas, custo_unit_agregado, producao_diaria_efetiva')
    .in('servico_id', servicoIds)
  const aggPorServico = new Map<
    string,
    { cpus_vinculadas: number; custo_unit_agregado: number | null; producao_diaria_efetiva: number | null }
  >()
  for (const a of agg ?? []) {
    aggPorServico.set(a.servico_id as string, {
      cpus_vinculadas: Number(a.cpus_vinculadas ?? 0),
      custo_unit_agregado: a.custo_unit_agregado == null ? null : Number(a.custo_unit_agregado),
      producao_diaria_efetiva:
        a.producao_diaria_efetiva == null ? null : Number(a.producao_diaria_efetiva)
    })
  }

  // 3) CPU vigente por serviço (modo legado: custo/produtividade/versão da CPU)
  const { data: cpusVig } = await admin
    .from('cpu')
    .select('id, servico_id, versao, custo_unit_calc, producao_diaria_qtde')
    .in('servico_id', servicoIds)
    .eq('is_vigente', true)
  const cpuPorServico = new Map<
    string,
    { id: string; versao: number; custo_unit_calc: number; producao_diaria_qtde: number | null }
  >()
  for (const c of cpusVig ?? []) {
    cpuPorServico.set(c.servico_id as string, c as never)
  }

  // 4) Snapshots atuais (para comparar custo + produtividade + tipo)
  const snapIds = Array.from(new Set(lista.map((i) => i.cpu_snapshot_id).filter(Boolean))) as string[]
  const snapMap = new Map<
    string,
    {
      cpu_id_origem: string | null
      versao_origem: number | null
      custo_unit: number
      producao_diaria_qtde: number | null
    }
  >()
  if (snapIds.length > 0) {
    const { data: snaps } = await admin
      .from('cpu_snapshot')
      .select('id, cpu_id_origem, versao_origem, custo_unit, producao_diaria_qtde')
      .in('id', snapIds)
    for (const s of snaps ?? []) {
      snapMap.set(s.id as string, {
        cpu_id_origem: s.cpu_id_origem,
        versao_origem: s.versao_origem,
        custo_unit: Number(s.custo_unit),
        producao_diaria_qtde: s.producao_diaria_qtde == null ? null : Number(s.producao_diaria_qtde)
      })
    }
  }

  const aprox = (a: number, b: number): boolean => Math.abs(a - b) < 0.0001

  // 5) Decide quais precisam re-snapshot
  let custoAnterior = 0
  let custoNovo = 0
  const staleItemIds: string[] = []
  for (const it of lista) {
    const a = aggPorServico.get(it.servico_id!)
    const cpuVig = cpuPorServico.get(it.servico_id!)
    const isAggreg = !!a && a.cpus_vinculadas > 0

    const efCusto = isAggreg
      ? (a!.custo_unit_agregado ?? 0)
      : cpuVig
        ? Number(cpuVig.custo_unit_calc)
        : null
    const efProd = isAggreg
      ? (a!.producao_diaria_efetiva ?? 0)
      : cpuVig
        ? Number(cpuVig.producao_diaria_qtde ?? 0)
        : null
    if (efCusto === null && efProd === null) continue // serviço sem fonte vigente

    const snap = it.cpu_snapshot_id ? snapMap.get(it.cpu_snapshot_id) : null

    const tipoMismatch = isAggreg
      ? !snap || snap.cpu_id_origem !== null // agregador → snapshot deve ter cpu_id_origem NULL
      : !snap || snap.cpu_id_origem !== cpuVig?.id || snap.versao_origem !== cpuVig?.versao
    const custoMudou = !snap || (efCusto !== null && !aprox(snap.custo_unit, efCusto))
    const prodMudou =
      !snap || (efProd !== null && Number(snap.producao_diaria_qtde ?? 0) !== efProd)

    if (!(tipoMismatch || custoMudou || prodMudou)) continue

    custoAnterior += snap?.custo_unit ?? 0
    custoNovo += efCusto ?? 0
    staleItemIds.push(it.id)
  }

  // 6) Re-snapshot delegando à função canônica (legado + agregador + recalc).
  //    Forward do JWT do usuário para passar no resolveCaller/assertRole de lá.
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const apikey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const auth = req.headers.get('Authorization') ?? ''
  const erros: string[] = []
  for (const itemId of staleItemIds) {
    try {
      const r = await fetch(`${url}/functions/v1/snapshot-cpu-no-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth, apikey },
        body: JSON.stringify({ item_id: itemId, force: true })
      })
      if (!r.ok) {
        const txt = await r.text().catch(() => '')
        erros.push(`${itemId}: HTTP ${r.status} ${txt.slice(0, 120)}`)
      }
    } catch (e) {
      erros.push(`${itemId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const atualizados = staleItemIds.length - erros.length

  // 7) Recalcula o cronograma APENAS do planejamento atual em edição: o mais
  //    recente NÃO arquivado e NÃO baseline. A baseline é imutável e não deve
  //    mudar; se a revisão atual estiver travada (baseline/arquivada), nada é
  //    recalculado (calcular-cronograma também recusa baseline com 409).
  //    Produtividade afeta as durações, que só são recomputadas pela
  //    calcular-cronograma (recalcular_orcamento não mexe no cronograma).
  if (atualizados > 0) {
    const { data: plans } = await admin
      .from('planejamento')
      .select('id, is_baseline, created_at')
      .eq('obra_id', obra_id)
      .neq('status', 'arquivado')
      .order('created_at', { ascending: false })
    const atual = (plans ?? []).find((p) => !p.is_baseline)
    if (atual) {
      try {
        await fetch(`${url}/functions/v1/calcular-cronograma`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: auth, apikey },
          body: JSON.stringify({ planejamento_id: atual.id as string, force: true })
        })
      } catch {
        /* recalc best-effort — não bloqueia a atualização do orçamento */
      }
    }
  }

  return json(
    {
      atualizados,
      custo_total_anterior: custoAnterior,
      custo_total_novo: custoNovo,
      diff_perc:
        custoAnterior > 0 ? (custoNovo - custoAnterior) / custoAnterior : custoNovo > 0 ? 1 : 0,
      erros: erros.slice(0, 5)
    },
    200
  )
})
