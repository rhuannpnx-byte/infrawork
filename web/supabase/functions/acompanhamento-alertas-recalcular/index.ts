// POST /functions/v1/acompanhamento-alertas-recalcular
// Body: { obra_id?: string }
//
// - Sem obra_id: percorre todas as obras ativas (cron horário).
// - Com obra_id: recalcula só aquela obra.
//
// Estratégia: calcula os alertas de agora, cada um com uma chave estável (tipo + serviço/tarefa/equipe + período),
// e sincroniza pela RPC acompanhamento_alertas_sincronizar (atualiza os que continuam, resolve os que sumiram,
// insere os novos; silenciado ou resolvido à mão com a mesma chave não reabre).
//
// Permissão: service_role (cron) OU god/adm/eng com acesso à obra.

import { handlePreflight, json } from '../_shared/cors.ts'
import { lerTodas } from '../_shared/paginar.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'
import { addDiasIso, dataLocal, hojeLocal, semanaIsoLocal } from '../_shared/dates.ts'

interface Body { obra_id?: string }

interface Resultado {
  inseridos: number
  atualizados: number
  reabertos: number
  resolvidos: number
  abertos: number
  total: number
  erros: string[]
}

interface AlertaSpec {
  obra_id: string
  chave: string
  tipo: string
  severidade: 'info' | 'warn' | 'critical'
  titulo: string
  descricao: string | null
  contexto: Record<string, unknown>
}

async function recalcOneObra(
  obraId: string,
  admin: ReturnType<typeof import('jsr:@supabase/supabase-js@2').createClient>
): Promise<Resultado> {
  const erros: string[] = []
  const novos: AlertaSpec[] = []

  const [prodResp, fotosResp, prevRealResp, produtResp] = await Promise.all([
    lerTodas((de, ate) =>
      admin
        .from('acompanhamento_producao')
        .select('id, data, equipe_id, encarregado_id, item_orcamentario_id, servico_nome, quantidade, fator_conversao, origem')
        .eq('obra_id', obraId)
        .order('id')
        .range(de, ate)
    ),
    lerTodas((de, ate) =>
      admin
        .from('acompanhamento_foto')
        .select('id, producao_id, captured_at, item_orcamentario_id')
        .eq('obra_id', obraId)
        .is('excluida_em', null)
        .order('id')
        .range(de, ate)
    ),
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
      chave: `lancamento_sem_equipe|semana:${semanaIso}`,
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
          chave: `producao_zero_dias|tarefa:${t.tarefa_id}|desde:nunca`,
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
          chave: `producao_zero_dias|tarefa:${t.tarefa_id}|desde:${ultima}`,
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
        chave: `desvio_quantidade|tarefa:${t.tarefa_id}|mes:${mesIso}`,
        tipo: 'desvio_quantidade',
        severidade: 'critical',
        titulo: `${nomeSrv} — avanço crítico (${Math.round(ratio * 100)}% do esperado)`,
        descricao: `Realizado ${Math.round(Number(t.pct_avanco) * 100)}% vs esperado ${Math.round(Number(t.pct_esperado_hoje) * 100)}%.`,
        contexto: base
      })
    } else if (ratio < 0.7) {
      novos.push({
        obra_id: obraId,
        chave: `desvio_quantidade|tarefa:${t.tarefa_id}|mes:${mesIso}`,
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
        chave: `desvio_prazo|tarefa:${t.tarefa_id}|mes:${mesIso}`,
        tipo: 'desvio_prazo',
        severidade: 'critical',
        titulo: `${nomeSrv} — projeção de atraso de ${Math.abs(Number(t.desvio_dias_estimado))} dias`,
        descricao: 'Mantida a produção atual, a conclusão fica depois do prazo do baseline.',
        contexto: { tarefa_id: t.tarefa_id, item_orcamentario_id: t.item_orcamentario_id, codigo: codigoSrv, descricao: nomeSrv, dias_atraso: Math.abs(Number(t.desvio_dias_estimado)), mes: mesIso }
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
        chave: `produtividade_baixa|equipe:${r.equipe_id}|item:${r.item_orcamentario_id ?? r.servico_nome}|mes:${mesIso}`,
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

  // ── 6) Produção sem foto (±1 dia) nos últimos 7 dias, um alerta por serviço ──
  // Importação e viagens ficam de fora: a evidência é a planilha / a ficha e o ticket.
  const fotosPorProducao = new Set<string>()
  const fotosPorItemData = new Set<string>()
  for (const f of fotos) {
    if (f.producao_id) fotosPorProducao.add(String(f.producao_id))
    if (f.item_orcamentario_id && f.captured_at) {
      fotosPorItemData.add(`${f.item_orcamentario_id}|${dataLocal(f.captured_at as string)}`)
    }
  }
  const temFoto = (p: Record<string, unknown>): boolean => {
    if (fotosPorProducao.has(String(p.id))) return true
    if (!p.item_orcamentario_id) return false
    for (let off = -1; off <= 1; off++) {
      if (fotosPorItemData.has(`${p.item_orcamentario_id}|${addDiasIso(String(p.data), off)}`)) return true
    }
    return false
  }
  const qtdConv = (p: Record<string, unknown>): number => Number(p.quantidade ?? 0) * Number(p.fator_conversao ?? 1)
  const porServico = new Map<string, Record<string, unknown>[]>()
  for (const p of prods) {
    if (!p.data || p.quantidade == null) continue
    if (p.origem === 'importacao' || p.origem === 'viagens') continue
    if (String(p.data) < seteDiasAtrasIso || String(p.data) > hojeIso) continue
    if (qtdConv(p) <= 0) continue
    const k = String(p.item_orcamentario_id ?? p.servico_nome ?? 'sem-servico')
    const lista = porServico.get(k) ?? []
    lista.push(p)
    porServico.set(k, lista)
  }
  for (const [k, lista] of porServico) {
    const qs = lista.map(qtdConv).sort((a, b) => a - b)
    const p50 = qs[Math.floor(qs.length / 2)]
    const semFoto = lista.filter((p) => qtdConv(p) >= p50 && !temFoto(p))
    if (semFoto.length === 0) continue
    const nome = String(semFoto[0].servico_nome ?? 'Serviço')
    const datas = [...new Set(semFoto.map((p) => String(p.data)))].sort()
    novos.push({
      obra_id: obraId,
      chave: `sem_foto_periodo|item:${k}|semana:${semanaIso}`,
      tipo: 'sem_foto_periodo',
      severidade: 'info',
      titulo: `${nome} — ${semFoto.length} lançamento(s) sem foto nos últimos 7 dias`,
      descricao: `Sem evidência fotográfica em ±1 dia: ${datas.map((d) => d.slice(8, 10) + '/' + d.slice(5, 7)).join(', ')}.`,
      contexto: {
        item_orcamentario_id: semFoto[0].item_orcamentario_id ?? null,
        servico_nome: nome,
        n: semFoto.length,
        datas,
        producao_ids: semFoto.map((p) => p.id),
        semana: semanaIso
      }
    })
  }

  if (erros.length > 0) return { inseridos: 0, atualizados: 0, reabertos: 0, resolvidos: 0, abertos: 0, total: novos.length, erros }

  const { data: sinc, error: sincErr } = await admin.rpc('acompanhamento_alertas_sincronizar', {
    p_obra_id: obraId,
    p_alertas: novos.map(({ obra_id: _o, ...a }) => a)
  })
  if (sincErr) {
    erros.push(`sincronizar: ${sincErr.message}`)
    return { inseridos: 0, atualizados: 0, reabertos: 0, resolvidos: 0, abertos: 0, total: novos.length, erros }
  }
  const r = sinc as { inseridos: number; atualizados: number; reabertos: number; resolvidos: number; abertos: number }
  return { ...r, total: novos.length, erros }
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

  const resultados: Array<{ obra_id: string } & Resultado> = []
  for (const id of obraIds) {
    try {
      const r = await recalcOneObra(id, admin)
      resultados.push({ obra_id: id, ...r })
    } catch (e) {
      resultados.push({ obra_id: id, inseridos: 0, atualizados: 0, reabertos: 0, resolvidos: 0, abertos: 0, total: 0, erros: [(e as Error).message] })
    }
  }

  return json({ ok: true, resultados, duracao_ms: Date.now() - t0 })
})
