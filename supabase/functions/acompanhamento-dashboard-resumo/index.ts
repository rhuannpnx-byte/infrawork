// POST /functions/v1/acompanhamento-dashboard-resumo
// Body: { obra_id: string, periodo_dias?: number (default 30) }
//
// Single-call que combina todos os payloads do dashboard estratégico,
// evitando que o front faça 6+ round-trips ao Supabase. Lê:
//   - vw_acompanhamento_obra_resumo
//   - vw_acompanhamento_curva_s (limitada ao período)
//   - vw_acompanhamento_previsto_x_realizado (top serviços por % desvio)
//   - vw_acompanhamento_produtividade_equipe
//   - vw_acompanhamento_frente_kpis
//   - acompanhamento_alerta (críticos abertos)
//   - acompanhamento_producao (últimos N apontamentos)
//   - acompanhamento_foto (subset georreferenciado para mini-mapa)
//
// Permissão: god/adm/eng/apoio com acesso à obra.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

interface Body {
  obra_id?: string
  periodo_dias?: number
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  let body: Body = {}
  try { body = await req.json() } catch { /* ignore */ }
  if (!body.obra_id) return json({ error: 'obra_id obrigatório' }, 400)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const roleErr = assertRole(ctx.caller, ['god', 'adm', 'engenheiro', 'apoio'])
  if (roleErr) return roleErr
  const accErr = await assertObraAccess(ctx, body.obra_id, { write: false })
  if (accErr) return accErr

  const { admin } = ctx
  const dias = Math.max(7, Math.min(365, Number(body.periodo_dias ?? 30)))
  const dataDe = new Date()
  dataDe.setDate(dataDe.getDate() - dias)
  const dataDeIso = dataDe.toISOString().slice(0, 10)

  const t0 = Date.now()

  const [
    resumoResp,
    curvaSResp,
    prevRealResp,
    produtividadeResp,
    frentesResp,
    alertasResp,
    ultimasProdResp,
    fotosGeoResp
  ] = await Promise.all([
    admin.from('vw_acompanhamento_obra_resumo').select('*').eq('obra_id', body.obra_id).maybeSingle(),
    admin
      .from('vw_acompanhamento_curva_s')
      .select('data, planejado_acumulado, realizado_acumulado, planejado_dia, realizado_dia, servico_grupo_codigo, item_orcamentario_id')
      .eq('obra_id', body.obra_id)
      .gte('data', dataDeIso)
      .order('data', { ascending: true })
      .limit(5000),
    admin
      .from('vw_acompanhamento_previsto_x_realizado')
      .select('*')
      .eq('obra_id', body.obra_id),
    admin
      .from('vw_acompanhamento_produtividade_equipe')
      .select('*')
      .eq('obra_id', body.obra_id),
    admin
      .from('vw_acompanhamento_frente_kpis')
      .select('*')
      .eq('obra_id', body.obra_id)
      .order('ultima_data', { ascending: false, nullsFirst: false })
      .limit(20),
    admin
      .from('acompanhamento_alerta')
      .select('id, tipo, severidade, titulo, descricao, contexto, criado_em, status')
      .eq('obra_id', body.obra_id)
      .eq('status', 'aberto')
      .order('severidade', { ascending: true })
      .order('criado_em', { ascending: false })
      .limit(10),
    admin
      .from('vw_acompanhamento_producao_enriquecida')
      .select('id, data, qtd, siga_servico_nome, servico_display_nome, equipe_display_nome, equipe_display_cor, frente')
      .eq('obra_id', body.obra_id)
      .order('data', { ascending: false })
      .order('sincronizado_em', { ascending: false })
      .limit(15),
    admin
      .from('vw_acompanhamento_foto_enriquecida')
      .select('id, lat, lng, captured_at, servico_display_nome, siga_servico_nome, equipe_display_cor, storage_bucket, storage_key')
      .eq('obra_id', body.obra_id)
      .not('lat', 'is', null)
      .not('lng', 'is', null)
      .order('captured_at', { ascending: false })
      .limit(200)
  ])

  if (resumoResp.error) return json({ error: `resumo: ${resumoResp.error.message}` }, 500)

  // Cobertura fotográfica (heatmap mês corrente) — dia x conta de fotos.
  // Filtra excluida_em IS NULL pra nao contar fotos deletadas pelo god/adm.
  const mesIni = new Date(); mesIni.setDate(1); mesIni.setHours(0, 0, 0, 0)
  const { data: coberturaRaw } = await admin
    .from('acompanhamento_foto')
    .select('captured_at')
    .eq('obra_id', body.obra_id)
    .is('excluida_em', null)
    .gte('captured_at', mesIni.toISOString())
    .limit(5000)
  const coberturaMap = new Map<string, number>()
  for (const f of coberturaRaw ?? []) {
    if (!f.captured_at) continue
    const d = new Date(f.captured_at as string).toISOString().slice(0, 10)
    coberturaMap.set(d, (coberturaMap.get(d) ?? 0) + 1)
  }

  return json({
    ok: true,
    resumo: resumoResp.data ?? null,
    curva_s: curvaSResp.data ?? [],
    previsto_realizado: prevRealResp.data ?? [],
    produtividade_equipes: produtividadeResp.data ?? [],
    frentes: frentesResp.data ?? [],
    alertas_criticos: alertasResp.data ?? [],
    ultimos_apontamentos: ultimasProdResp.data ?? [],
    fotos_geo: fotosGeoResp.data ?? [],
    cobertura_mes: Array.from(coberturaMap.entries()).map(([data, qtd]) => ({ data, qtd })),
    periodo_dias: dias,
    duracao_ms: Date.now() - t0
  })
})
