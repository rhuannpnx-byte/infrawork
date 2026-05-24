// POST /functions/v1/acompanhamento-alertas-recalcular
// Body: { obra_id?: string }
//
// - Sem obra_id: percorre todas as obras com link ativo (cron horário).
// - Com obra_id: recalcula só aquela obra (chain após sync ou matching).
//
// Estratégia:
//   1) Calcula conjunto novo de "alertas teóricos" baseado nas regras.
//   2) UPSERT em acompanhamento_alerta com ON CONFLICT (obra_id, contexto_hash)
//      DO NOTHING — evita criar duplicatas de alertas já abertos.
//   3) Alertas previamente abertos cujo contexto_hash NÃO está mais no
//      conjunto novo viram status='resolvido', resolvido_automaticamente=true.
//
// Permissão: service_role (cron + chain) OU god/adm/eng com acesso à obra.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

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

  // ── Fetch base data ────────────────────────────────────────────────────
  const [
    prodResp,
    fotosResp,
    matchesEqResp,
    matchesEncResp,
    matchesSrvResp,
    prevRealResp,
    produtResp
  ] = await Promise.all([
    admin
      .from('acompanhamento_producao')
      .select('id, data, equipe_nome, encarregado_nome, servico_id, servico_nome, qtd')
      .eq('obra_id', obraId),
    admin
      .from('acompanhamento_foto')
      .select('id, producao_siga_id, captured_at, servico_executado_id')
      .eq('obra_id', obraId),
    admin
      .from('acompanhamento_equipe_match')
      .select('siga_equipe_nome, equipe_id, origem')
      .eq('obra_id', obraId),
    admin
      .from('acompanhamento_encarregado_match')
      .select('siga_encarregado_nome, origem')
      .eq('obra_id', obraId),
    admin
      .from('acompanhamento_servico_match')
      .select('siga_servico_executado_id, servico_id, item_orcamentario_id, origem')
      .eq('obra_id', obraId),
    admin
      .from('vw_acompanhamento_previsto_x_realizado')
      .select('tarefa_id, codigo, descricao, qtd_plan, qtd_real, pct_avanco, pct_esperado_hoje, data_inicio_plan, data_fim_plan, status, desvio_dias_estimado, data_ultima_realizacao, item_orcamentario_id')
      .eq('obra_id', obraId),
    admin
      .from('vw_acompanhamento_produtividade_equipe')
      .select('siga_equipe_nome, equipe_match_id, servico_nome, item_orcamentario_id, dias_trabalhados, qtd_p50, producao_diaria_cpu, pct_aderencia_cpu')
      .eq('obra_id', obraId)
  ])
  if (prodResp.error) erros.push(`prod: ${prodResp.error.message}`)
  if (fotosResp.error) erros.push(`fotos: ${fotosResp.error.message}`)
  if (matchesEqResp.error) erros.push(`mEq: ${matchesEqResp.error.message}`)
  if (matchesEncResp.error) erros.push(`mEnc: ${matchesEncResp.error.message}`)
  if (matchesSrvResp.error) erros.push(`mSrv: ${matchesSrvResp.error.message}`)
  if (prevRealResp.error) erros.push(`prevReal: ${prevRealResp.error.message}`)
  if (produtResp.error) erros.push(`produt: ${produtResp.error.message}`)

  const prods = prodResp.data ?? []
  const fotos = fotosResp.data ?? []
  const matchesEq = new Map<string, { equipe_id: string | null; origem: string }>()
  for (const m of matchesEqResp.data ?? []) matchesEq.set(m.siga_equipe_nome, m)
  const matchesEnc = new Map<string, { origem: string }>()
  for (const m of matchesEncResp.data ?? []) matchesEnc.set(m.siga_encarregado_nome, m)
  const matchesSrv = new Map<number, { servico_id: string | null; item_orcamentario_id: string | null; origem: string }>()
  for (const m of matchesSrvResp.data ?? []) matchesSrv.set(Number(m.siga_servico_executado_id), m)

  const seteDiasAtras = new Date()
  seteDiasAtras.setDate(seteDiasAtras.getDate() - 7)
  const hojeIso = new Date().toISOString().slice(0, 10)
  const semanaIso = (() => {
    const d = new Date()
    const ano = d.getFullYear()
    const start = new Date(ano, 0, 1)
    const semana = Math.ceil((((d.getTime() - start.getTime()) / 86400000) + start.getDay() + 1) / 7)
    return `${ano}-W${String(semana).padStart(2, '0')}`
  })()

  // ── Regras ─────────────────────────────────────────────────────────────

  // 1) Equipes não vinculadas (apareceu nos últimos 7d, sem match qualquer)
  const equipesRecentesProd = new Set<string>()
  for (const p of prods) {
    if (!p.equipe_nome || !p.data) continue
    if (new Date(p.data) >= seteDiasAtras) equipesRecentesProd.add(String(p.equipe_nome).trim())
  }
  for (const sigaNome of equipesRecentesProd) {
    if (!matchesEq.has(sigaNome)) {
      novos.push({
        obra_id: obraId,
        tipo: 'equipe_nao_vinculada',
        severidade: 'info',
        titulo: `Equipe "${sigaNome}" sem vínculo com o Planejamento`,
        descricao: `Apontamentos recentes da equipe "${sigaNome}" não estão vinculados a nenhuma equipe do Planejamento. Comparações previsto×realizado por equipe ficam indisponíveis.`,
        contexto: { siga_equipe_nome: sigaNome }
      })
    }
  }

  // 2) Encarregados não vinculados (informativo)
  const encarregadosRecentes = new Set<string>()
  for (const p of prods) {
    if (!p.encarregado_nome || !p.data) continue
    if (new Date(p.data) >= seteDiasAtras) encarregadosRecentes.add(String(p.encarregado_nome).trim())
  }
  for (const sigaNome of encarregadosRecentes) {
    if (!matchesEnc.has(sigaNome)) {
      novos.push({
        obra_id: obraId,
        tipo: 'encarregado_nao_vinculado',
        severidade: 'info',
        titulo: `Encarregado "${sigaNome}" sem vínculo`,
        descricao: `Encarregado "${sigaNome}" aparece em apontamentos recentes mas não tem cadastro canônico no InfraWork.`,
        contexto: { siga_encarregado_nome: sigaNome }
      })
    }
  }

  // 3) Serviços não vinculados (blocker p/ previsto×real) — WARN
  const servicosUsados = new Map<number, string>()
  for (const p of prods) {
    if (p.servico_id != null) servicosUsados.set(Number(p.servico_id), String(p.servico_nome ?? ''))
  }
  for (const [sigaId, sigaNome] of servicosUsados.entries()) {
    const m = matchesSrv.get(sigaId)
    if (!m || !m.servico_id) {
      novos.push({
        obra_id: obraId,
        tipo: 'servico_nao_vinculado',
        severidade: 'warn',
        titulo: `Serviço "${sigaNome}" sem vínculo com o Orçamento`,
        descricao: `Sem vínculo, este serviço não contribui para o avanço físico e curva-S realizada.`,
        contexto: { siga_servico_executado_id: sigaId, siga_servico_nome: sigaNome }
      })
    }
  }

  // 4) Produção zero há ≥ 3 dias úteis em tarefa baseline em andamento
  for (const t of prevRealResp.data ?? []) {
    if (!t.data_inicio_plan || !t.data_fim_plan) continue
    if (t.data_inicio_plan > hojeIso || t.data_fim_plan < hojeIso) continue
    const nomeSrv = String(t.descricao ?? t.codigo)
    const codigoSrv = String(t.codigo ?? '')
    const ultima = t.data_ultima_realizacao as string | null
    if (!ultima) {
      const limite = new Date(); limite.setDate(limite.getDate() - 3)
      if (new Date(t.data_inicio_plan) < limite) {
        novos.push({
          obra_id: obraId,
          tipo: 'producao_zero_dias',
          severidade: 'warn',
          titulo: `${nomeSrv} — sem apontamento`,
          descricao: `Tarefa do baseline iniciou em ${t.data_inicio_plan} mas não tem produção registrada.`,
          contexto: { tarefa_id: t.tarefa_id, codigo: codigoSrv, descricao: nomeSrv, semana: semanaIso }
        })
      }
    } else {
      const diff = Math.floor((Date.now() - new Date(ultima).getTime()) / 86_400_000)
      if (diff >= 3) {
        novos.push({
          obra_id: obraId,
          tipo: 'producao_zero_dias',
          severidade: 'warn',
          titulo: `${nomeSrv} — sem apontamento há ${diff} dias`,
          descricao: `Último apontamento em ${ultima}. Tarefa em andamento no baseline.`,
          contexto: { tarefa_id: t.tarefa_id, codigo: codigoSrv, descricao: nomeSrv, dias_sem: diff, semana: semanaIso }
        })
      }
    }
  }

  // 5) Desvio de quantidade (pct_avanco / pct_esperado < 0.7)
  for (const t of prevRealResp.data ?? []) {
    if (t.pct_esperado_hoje == null || t.pct_avanco == null) continue
    if (Number(t.pct_esperado_hoje) <= 0) continue
    const nomeSrv = String(t.descricao ?? t.codigo)
    const codigoSrv = String(t.codigo ?? '')
    const ratio = Number(t.pct_avanco) / Number(t.pct_esperado_hoje)
    if (ratio < 0.4) {
      novos.push({
        obra_id: obraId,
        tipo: 'desvio_quantidade',
        severidade: 'critical',
        titulo: `${nomeSrv} — avanço crítico (${Math.round(ratio * 100)}% do esperado)`,
        descricao: `Realizado ${Math.round(Number(t.pct_avanco) * 100)}% vs esperado ${Math.round(Number(t.pct_esperado_hoje) * 100)}%.`,
        contexto: { tarefa_id: t.tarefa_id, codigo: codigoSrv, descricao: nomeSrv, ratio: Math.round(ratio * 1000) / 1000, mes: new Date().toISOString().slice(0, 7) }
      })
    } else if (ratio < 0.7) {
      novos.push({
        obra_id: obraId,
        tipo: 'desvio_quantidade',
        severidade: 'warn',
        titulo: `${nomeSrv} — avanço abaixo do esperado (${Math.round(ratio * 100)}%)`,
        descricao: `Realizado ${Math.round(Number(t.pct_avanco) * 100)}% vs esperado ${Math.round(Number(t.pct_esperado_hoje) * 100)}%.`,
        contexto: { tarefa_id: t.tarefa_id, codigo: codigoSrv, descricao: nomeSrv, ratio: Math.round(ratio * 1000) / 1000, mes: new Date().toISOString().slice(0, 7) }
      })
    }
  }

  // 6) Desvio de prazo (projeção > data_fim + 7d)
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
        descricao: `Mantida produção atual, estima-se conclusão após o prazo do baseline.`,
        contexto: { tarefa_id: t.tarefa_id, codigo: codigoSrv, descricao: nomeSrv, dias_atraso: Math.abs(Number(t.desvio_dias_estimado)) }
      })
    }
  }

  // 7) Produtividade baixa por equipe (p50 < 0.6 * CPU, com ≥5 dias)
  for (const r of produtResp.data ?? []) {
    if (!r.equipe_match_id) continue
    if (r.pct_aderencia_cpu == null) continue
    if (Number(r.dias_trabalhados) < 5) continue
    if (Number(r.pct_aderencia_cpu) < 0.6) {
      novos.push({
        obra_id: obraId,
        tipo: 'produtividade_baixa',
        severidade: 'warn',
        titulo: `${r.siga_equipe_nome} — produtividade ${Math.round(Number(r.pct_aderencia_cpu) * 100)}% da CPU`,
        descricao: `Em ${r.servico_nome}, p50 diário ${Number(r.qtd_p50).toFixed(0)} vs CPU ${Number(r.producao_diaria_cpu).toFixed(0)}.`,
        contexto: {
          equipe_match_id: r.equipe_match_id,
          item_orcamentario_id: r.item_orcamentario_id,
          siga_equipe_nome: r.siga_equipe_nome,
          servico_nome: r.servico_nome,
          mes: new Date().toISOString().slice(0, 7)
        }
      })
    }
  }

  // 8) Produção relevante sem foto na janela ±1 dia
  const fotosPorProducao = new Set<number>()
  for (const f of fotos) {
    if (f.producao_siga_id != null) fotosPorProducao.add(Number(f.producao_siga_id))
  }
  const fotosPorServicoData = new Map<string, number>()
  for (const f of fotos) {
    if (f.servico_executado_id != null && f.captured_at) {
      const dt = new Date(f.captured_at).toISOString().slice(0, 10)
      fotosPorServicoData.set(`${f.servico_executado_id}|${dt}`, (fotosPorServicoData.get(`${f.servico_executado_id}|${dt}`) ?? 0) + 1)
    }
  }
  // p50 de qtd na obra
  const qtds = prods.map((p) => Number(p.qtd ?? 0)).filter((q) => q > 0).sort((a, b) => a - b)
  const p50Qtd = qtds.length ? qtds[Math.floor(qtds.length / 2)] : 0
  for (const p of prods) {
    if (!p.data || p.qtd == null || Number(p.qtd) < p50Qtd) continue
    if (fotosPorProducao.has(Number(p.id))) continue
    // confere foto do mesmo serviço em D-1, D, D+1
    let found = false
    for (let off = -1; off <= 1; off++) {
      const dt = new Date(p.data); dt.setDate(dt.getDate() + off)
      const key = `${p.servico_id}|${dt.toISOString().slice(0, 10)}`
      if (fotosPorServicoData.has(key)) { found = true; break }
    }
    if (!found) {
      novos.push({
        obra_id: obraId,
        tipo: 'sem_foto_periodo',
        severidade: 'info',
        titulo: `Apontamento ${p.data} sem foto`,
        descricao: `${p.servico_nome ?? 'serviço'} — qtd ${Number(p.qtd).toFixed(0)} — sem evidência fotográfica em ±1 dia.`,
        contexto: { producao_id: p.id, data: p.data, servico_id: p.servico_id, qtd: p.qtd }
      })
    }
  }

  // ── Limpa abertos e re-insere ────────────────────────────────────────
  // Estratégia simples e correta: o estado-verdade dos abertos é sempre o
  // resultado do recálculo. Os silenciados/resolvidos ficam intactos.
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

  const aInserir = novos.map((n) => ({
    obra_id: n.obra_id,
    tipo: n.tipo,
    severidade: n.severidade,
    titulo: n.titulo,
    descricao: n.descricao,
    contexto: n.contexto
  }))

  let inseridos = 0
  if (aInserir.length > 0) {
    // Em lotes pra evitar payloads gigantes
    const BATCH = 100
    for (let i = 0; i < aInserir.length; i += BATCH) {
      const slice = aInserir.slice(i, i + BATCH)
      const { error, count } = await admin
        .from('acompanhamento_alerta')
        .insert(slice, { count: 'exact' })
      if (error) erros.push(`insert lote ${i}: ${error.message}`)
      else inseridos += count ?? slice.length
    }
  }
  // resolvidos representa o número de alertas anteriores que sumiram
  // (pode incluir alguns que reapareceram). Não impacta UX.
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

  if (!isServiceRole) {
    const ctx = await resolveCaller(req)
    if (ctx instanceof Response) return ctx
    const roleErr = assertRole(ctx.caller, ['god', 'adm', 'engenheiro'])
    if (roleErr) return roleErr
    if (body.obra_id) {
      const accErr = await assertObraAccess(ctx, body.obra_id, { write: false })
      if (accErr) return accErr
    }
  }

  const t0 = Date.now()
  let obraIds: string[] = []
  if (body.obra_id) {
    obraIds = [body.obra_id]
  } else {
    const { data } = await admin.from('obra_acompanhamento_link').select('obra_id').eq('ativo', true)
    obraIds = (data ?? []).map((r) => r.obra_id as string)
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
