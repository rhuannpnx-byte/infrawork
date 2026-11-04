// POST /functions/v1/acompanhamento-alertas-recalcular
// Body: { obra_id?: string }
//
// - Sem obra_id: percorre todas as obras ativas (cron horário).
// - Com obra_id: recalcula só aquela obra.
//
// Estratégia: calcula o conjunto novo de alertas "abertos" e substitui os
// abertos anteriores (silenciados/resolvidos ficam intactos).
//
// Permissão: service_role (cron) OU god/adm/eng com acesso à obra.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'
import { addDiasIso, dataLocal, hojeLocal, semanaIsoLocal } from '../_shared/dates.ts'

interface Body { obra_id?: string }

interface AlertaSpec {
  obra_id: string
  tipo: string
  severidade: 'info' | 'warn' | 'critical'
  titulo: string
  descricao: string | null
  contexto: Record<string, unknown>
}

async function recalcOneObra(
  obraId: string,
  admin: ReturnType<typeof import('jsr:@supabase/supabase-js@2').createClient>
): Promise<{ inseridos: number; resolvidos: number; total: number; erros: string[] }> {
  const erros: string[] = []
  const novos: AlertaSpec[] = []

  const [prodResp, fotosResp, prevRealResp, produtResp] = await Promise.all([
    admin
      .from('acompanhamento_producao')
      .select('id, data, equipe_id, encarregado_id, item_orcamentario_id, servico_nome, quantidade, fator_conversao, origem')
      .eq('obra_id', obraId),
    admin
      .from('acompanhamento_foto')
      .select('id, producao_id, captured_at, item_orcamentario_id')
      .eq('obra_id', obraId)
      .is('excluida_em', null),
    admin
      .from('vw_acompanhamento_previsto_x_realizado')
      .select('tarefa_id, codigo, descricao, qtd_plan, qtd_real, pct_avanco, pct_esperado_hoje, data_inicio_plan, data_fim_plan, status, desvio_dias_estimado, data_ultima_realizacao, item_orcamentario_id')
      .eq('obra_id', obraId),
    admin
      .from('vw_acompanhamento_produtividade_equipe')
      .select('equipe_id, equipe_display_nome, servico_nome, item_orcamentario_id, dias_trabalhados, qtd_p50, producao_diaria_meta, pct_aderencia_meta')
      .eq('obra_id', obraId)
  ])
  if (prodResp.error) erros.push(`prod: ${prodResp.error.message}`)
  if (fotosResp.error) erros.push(`fotos: ${fotosResp.error.message}`)
  if (prevRealResp.error) erros.push(`prevReal: ${prevRealResp.error.message}`)
  if (produtResp.error) erros.push(`produt: ${produtResp.error.message}`)

  const prods = prodResp.data ?? []
  const fotos = fotosResp.data ?? []
  const hojeIso = hojeLocal()
  const seteDiasAtrasIso = addDiasIso(hojeIso, -7)
  const semanaIso = semanaIsoLocal()
  const mesIso = hojeIso.slice(0, 7)

  // ── 1) Lançamentos recentes sem equipe (informativo) ───────────────────
  const semEquipe = prods.filter((p) => !p.equipe_id && p.data && String(p.data) >= seteDiasAtrasIso)
  if (semEquipe.length > 0) {
    novos.push({
      obra_id: obraId,
      tipo: 'lancamento_sem_equipe',
      severidade: 'info',
      titulo: `${semEquipe.length} lançamento(s) sem equipe nos últimos 7 dias`,
      descricao: 'Sem equipe, a produtividade por equipe e os rankings ficam incompletos.',
      contexto: { semana: semanaIso, n: semEquipe.length }
    })
  }

  // ── 2) Produção zero há ≥ 3 dias em serviço do baseline em andamento ───
  for (const t of prevRealResp.data ?? []) {
    if (!t.data_inicio_plan || !t.data_fim_plan) continue
    if (String(t.data_inicio_plan) > hojeIso || String(t.data_fim_plan) < hojeIso) continue
    const nomeSrv = String(t.descricao ?? t.codigo)
    const codigoSrv = String(t.codigo ?? '')
    const ultima = t.data_ultima_realizacao as string | null
    if (!ultima) {
      if (String(t.data_inicio_plan) < addDiasIso(hojeIso, -3)) {
        novos.push({
          obra_id: obraId,
          tipo: 'producao_zero_dias',
          severidade: 'warn',
          titulo: `${nomeSrv} — sem lançamento`,
          descricao: `Serviço do baseline iniciou em ${t.data_inicio_plan} mas não tem produção lançada.`,
          contexto: { tarefa_id: t.tarefa_id, item_orcamentario_id: t.item_orcamentario_id, codigo: codigoSrv, descricao: nomeSrv, semana: semanaIso }
        })
      }
    } else {
      const diff = Math.floor((new Date(hojeIso + 'T00:00:00Z').getTime() - new Date(ultima + 'T00:00:00Z').getTime()) / 86_400_000)
      if (diff >= 3) {
        novos.push({
          obra_id: obraId,
          tipo: 'producao_zero_dias',
          severidade: 'warn',
          titulo: `${nomeSrv} — sem lançamento há ${diff} dias`,
          descricao: `Último lançamento em ${ultima}. Serviço em andamento no baseline.`,
          contexto: { tarefa_id: t.tarefa_id, item_orcamentario_id: t.item_orcamentario_id, codigo: codigoSrv, descricao: nomeSrv, dias_sem: diff, semana: semanaIso }
        })
      }
    }
  }

  // ── 3) Desvio de quantidade (pct_avanco / pct_esperado) ─────────────────
  for (const t of prevRealResp.data ?? []) {
    if (t.pct_esperado_hoje == null || t.pct_avanco == null) continue
    if (Number(t.pct_esperado_hoje) <= 0) continue
    const nomeSrv = String(t.descricao ?? t.codigo)
    const codigoSrv = String(t.codigo ?? '')
    const ratio = Number(t.pct_avanco) / Number(t.pct_esperado_hoje)
    const base = { tarefa_id: t.tarefa_id, item_orcamentario_id: t.item_orcamentario_id, codigo: codigoSrv, descricao: nomeSrv, ratio: Math.round(ratio * 1000) / 1000, mes: mesIso }
    if (ratio < 0.4) {
      novos.push({
        obra_id: obraId,
        tipo: 'desvio_quantidade',
        severidade: 'critical',
        titulo: `${nomeSrv} — avanço crítico (${Math.round(ratio * 100)}% do esperado)`,
        descricao: `Realizado ${Math.round(Number(t.pct_avanco) * 100)}% vs esperado ${Math.round(Number(t.pct_esperado_hoje) * 100)}%.`,
        contexto: base
      })
    } else if (ratio < 0.7) {
      novos.push({
        obra_id: obraId,
        tipo: 'desvio_quantidade',
        severidade: 'warn',
        titulo: `${nomeSrv} — avanço abaixo do esperado (${Math.round(ratio * 100)}%)`,
        descricao: `Realizado ${Math.round(Number(t.pct_avanco) * 100)}% vs esperado ${Math.round(Number(t.pct_esperado_hoje) * 100)}%.`,
        contexto: base
      })
    }
  }

  // ── 4) Desvio de prazo (projeção > data_fim + 7d) ───────────────────────
  for (const t of prevRealResp.data ?? []) {
    if (t.desvio_dias_estimado == null) continue
    const nomeSrv = String(t.descricao ?? t.codigo)
    const codigoSrv = String(t.codigo ?? '')
    if (Number(t.desvio_dias_estimado) < -7) {
      novos.push({
        obra_id: obraId,
        tipo: 'desvio_prazo',
        severidade: 'critical',
        titulo: `${nomeSrv} — projeção de atraso de ${Math.abs(Number(t.desvio_dias_estimado))} dias`,
        descricao: 'Mantida a produção atual, a conclusão fica depois do prazo do baseline.',
        contexto: { tarefa_id: t.tarefa_id, item_orcamentario_id: t.item_orcamentario_id, codigo: codigoSrv, descricao: nomeSrv, dias_atraso: Math.abs(Number(t.desvio_dias_estimado)) }
      })
    }
  }

  // ── 5) Produtividade baixa por equipe (p50 < 0.6 × meta, ≥ 5 dias) ─────
  for (const r of produtResp.data ?? []) {
    if (!r.equipe_id) continue
    if (r.pct_aderencia_meta == null) continue
    if (Number(r.dias_trabalhados) < 5) continue
    if (Number(r.pct_aderencia_meta) < 0.6) {
      novos.push({
        obra_id: obraId,
        tipo: 'produtividade_baixa',
        severidade: 'warn',
        titulo: `${r.equipe_display_nome} — produtividade ${Math.round(Number(r.pct_aderencia_meta) * 100)}% da meta`,
        descricao: `Em ${r.servico_nome}, p50 diário ${Number(r.qtd_p50).toFixed(0)} vs meta ${Number(r.producao_diaria_meta).toFixed(0)}.`,
        contexto: {
          equipe_id: r.equipe_id,
          item_orcamentario_id: r.item_orcamentario_id,
          equipe_nome: r.equipe_display_nome,
          servico_nome: r.servico_nome,
          mes: mesIso
        }
      })
    }
  }

  // ── 6) Produção relevante sem foto (±1 dia); importações isentas ────────
  const fotosPorProducao = new Set<string>()
  const fotosPorItemData = new Set<string>()
  for (const f of fotos) {
    if (f.producao_id) fotosPorProducao.add(String(f.producao_id))
    if (f.item_orcamentario_id && f.captured_at) {
      fotosPorItemData.add(`${f.item_orcamentario_id}|${dataLocal(f.captured_at as string)}`)
    }
  }
  const qtds = prods
    .map((p) => Number(p.quantidade ?? 0) * Number(p.fator_conversao ?? 1))
    .filter((q) => q > 0)
    .sort((a, b) => a - b)
  const p50Qtd = qtds.length ? qtds[Math.floor(qtds.length / 2)] : 0
  for (const p of prods) {
    if (!p.data || p.quantidade == null) continue
    if (p.origem === 'importacao') continue
    const qtdConv = Number(p.quantidade) * Number(p.fator_conversao ?? 1)
    if (qtdConv < p50Qtd) continue
    if (fotosPorProducao.has(String(p.id))) continue
    let found = false
    if (p.item_orcamentario_id) {
      for (let off = -1; off <= 1; off++) {
        if (fotosPorItemData.has(`${p.item_orcamentario_id}|${addDiasIso(String(p.data), off)}`)) {
          found = true
          break
        }
      }
    }
    if (!found) {
      novos.push({
        obra_id: obraId,
        tipo: 'sem_foto_periodo',
        severidade: 'info',
        titulo: `Lançamento ${p.data} sem foto`,
        descricao: `${p.servico_nome ?? 'serviço'} — qtd ${qtdConv.toFixed(0)} — sem evidência fotográfica em ±1 dia.`,
        contexto: { producao_id: p.id, data: p.data, item_orcamentario_id: p.item_orcamentario_id, qtd: qtdConv }
      })
    }
  }

  // ── Substitui os abertos ───────────────────────────────────────────────
  let resolvidos = 0
  {
    const { count: resolvidosCount, error: delErr } = await admin
      .from('acompanhamento_alerta')
      .delete({ count: 'exact' })
      .eq('obra_id', obraId)
      .eq('status', 'aberto')
    if (delErr) erros.push(`del abertos: ${delErr.message}`)
    else resolvidos = resolvidosCount ?? 0
  }

  let inseridos = 0
  if (novos.length > 0) {
    const BATCH = 100
    for (let i = 0; i < novos.length; i += BATCH) {
      const slice = novos.slice(i, i + BATCH)
      const { error, count } = await admin.from('acompanhamento_alerta').insert(slice, { count: 'exact' })
      if (error) erros.push(`insert lote ${i}: ${error.message}`)
      else inseridos += count ?? slice.length
    }
  }

  // Alertas silenciados (dentro do prazo) ou resolvidos à mão não voltam a abrir: o mesmo
  // contexto_hash (tipo + contexto) recém-inserido como "aberto" sai.
  {
    const agora = new Date().toISOString()
    const { data: calados } = await admin
      .from('acompanhamento_alerta')
      .select('contexto_hash, status, silenciado_ate, resolvido_automaticamente')
      .eq('obra_id', obraId)
      .neq('status', 'aberto')
    const hashes = [
      ...new Set(
        (calados ?? [])
          .filter((a) =>
            a.status === 'silenciado'
              ? !a.silenciado_ate || (a.silenciado_ate as string) > agora
              : a.resolvido_automaticamente === false
          )
          .map((a) => a.contexto_hash as string)
      )
    ]
    for (let i = 0; i < hashes.length; i += 200) {
      const { count, error } = await admin
        .from('acompanhamento_alerta')
        .delete({ count: 'exact' })
        .eq('obra_id', obraId)
        .eq('status', 'aberto')
        .in('contexto_hash', hashes.slice(i, i + 200))
      if (error) erros.push(`calados: ${error.message}`)
      else inseridos -= count ?? 0
    }
  }
  return { inseridos, resolvidos, total: novos.length, erros }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  let body: Body = {}
  try { body = await req.json() } catch { /* ignore */ }

  const authHeader = req.headers.get('Authorization') ?? ''
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const tokenFromHeader = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  let isServiceRole = !!SERVICE_KEY && tokenFromHeader === SERVICE_KEY
  if (!isServiceRole && tokenFromHeader) {
    try {
      const payload = JSON.parse(atob(tokenFromHeader.split('.')[1] ?? ''))
      if (payload?.role === 'service_role') isServiceRole = true
    } catch { /* ignore */ }
  }

  const { createClient } = await import('jsr:@supabase/supabase-js@2')
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // sem obra_id: o cron (service_role) e o god percorrem todas; os demais, só as obras da própria empresa
  let soEmpresa: string | null = null
  if (!isServiceRole) {
    const ctx = await resolveCaller(req)
    if (ctx instanceof Response) return ctx
    const roleErr = assertRole(ctx.caller, ['god', 'adm', 'engenheiro'])
    if (roleErr) return roleErr
    if (body.obra_id) {
      const accErr = await assertObraAccess(ctx, body.obra_id, { write: false })
      if (accErr) return accErr
    } else if (ctx.caller.role !== 'god') {
      if (ctx.caller.role !== 'adm') return json({ error: 'Informe a obra' }, 400)
      soEmpresa = ctx.caller.empresa_id
    }
  }

  const t0 = Date.now()
  let obraIds: string[] = []
  if (body.obra_id) {
    obraIds = [body.obra_id]
  } else {
    let q = admin.from('obras').select('id').eq('ativa', true)
    if (soEmpresa) q = q.eq('empresa_id', soEmpresa)
    const { data } = await q
    obraIds = (data ?? []).map((r) => r.id as string)
  }

  const resultados: Array<{ obra_id: string; inseridos: number; resolvidos: number; total: number; erros: string[] }> = []
  for (const id of obraIds) {
    try {
      const r = await recalcOneObra(id, admin)
      resultados.push({ obra_id: id, ...r })
    } catch (e) {
      resultados.push({ obra_id: id, inseridos: 0, resolvidos: 0, total: 0, erros: [(e as Error).message] })
    }
  }

  return json({ ok: true, resultados, duracao_ms: Date.now() - t0 })
})
