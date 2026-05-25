// POST /functions/v1/acompanhamento-sync
// Body: { obra_id?: string, force_full?: boolean }
//
// - Sem obra_id: sincroniza TODOS os vínculos ativos (uso do pg_cron).
// - Com obra_id: sincroniza só aquele vínculo (botão UI).
// - force_full=true: re-baixa tudo (recovery).
//
// Lê SIGA MySQL e popula tabelas `acompanhamento_producao` e `acompanhamento_foto`.
// Schema do SIGA validado em probe — usa nomes reais (controle_producao_servico_executado_*, etc).

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'
import { sigaQuery } from '../_shared/siga-mysql.ts'

interface Body {
  obra_id?: string
  force_full?: boolean
}

interface VinculoRow {
  id: string
  obra_id: string
  siga_projeto_id: number
  ultimo_sync_em: string | null
  sincronizar_fotos: boolean
}

interface SyncStats {
  producao_inseridas: number
  producao_atualizadas: number
  fotos_inseridas: number
  fotos_atualizadas: number
}

async function loadCols(table: string): Promise<Set<string>> {
  const rows = await sigaQuery<{ COLUMN_NAME: string }>(
    `SELECT COLUMN_NAME FROM information_schema.columns
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  )
  return new Set(rows.map((r) => r.COLUMN_NAME))
}

function pick(cols: Set<string>, ...candidates: string[]): string | null {
  for (const c of candidates) if (cols.has(c)) return c
  return null
}

async function syncOneVinculo(
  vinculo: VinculoRow,
  admin: ReturnType<typeof import('jsr:@supabase/supabase-js@2').createClient>,
  forceFull: boolean
): Promise<{ stats: SyncStats; warnings: string[] }> {
  const warnings: string[] = []

  await admin
    .from('obra_acompanhamento_link')
    .update({ ultimo_sync_status: 'rodando', ultimo_sync_erro: null })
    .eq('id', vinculo.id)

  const desde =
    forceFull || !vinculo.ultimo_sync_em
      ? null
      : new Date(new Date(vinculo.ultimo_sync_em).getTime() - 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 19)
          .replace('T', ' ')

  const stats: SyncStats = {
    producao_inseridas: 0,
    producao_atualizadas: 0,
    fotos_inseridas: 0,
    fotos_atualizadas: 0
  }

  // ─── PRODUÇÃO ──────────────────────────────────────────────────────────
  try {
    const pCols = await loadCols('pnj_controle_producao')
    if (pCols.size === 0) throw new Error('Tabela pnj_controle_producao não encontrada')

    const cIdProd = pick(pCols, 'controle_producao_id', 'id')!
    const cProjeto = pick(pCols, 'controle_producao_projeto_id', 'projeto_id')!
    const cDeletado = pick(pCols, 'controle_producao_deletado', 'deletado')
    const cInativo = pick(pCols, 'controle_producao_inativo', 'inativo')
    const cDt = pick(pCols, 'controle_producao_dt', 'controle_producao_data', 'data')
    const cServicoId = pick(
      pCols,
      'controle_producao_servico_executado_id',
      'controle_producao_servico_id',
      'servico_id'
    )
    const cEncId = pick(pCols, 'controle_producao_encarregado_id', 'encarregado_id')
    const cEncNome = pick(pCols, 'controle_producao_encarregado_nome', 'encarregado_nome')
    const cEqId = pick(pCols, 'controle_producao_equipe_id', 'equipe_id')
    const cEqNome = pick(pCols, 'controle_producao_equipe_nome', 'equipe_nome')
    const cQtd = pick(
      pCols,
      'controle_producao_servico_executado_qtd',
      'controle_producao_qtde',
      'controle_producao_quantidade',
      'qtd'
    )
    const cTrecho = pick(pCols, 'controle_producao_trecho_nome', 'controle_producao_trecho', 'trecho')
    const cEstaca = pick(
      pCols,
      'controle_producao_estaca',
      'controle_producao_estaca_inicial',
      'estaca'
    )
    const cObs = pick(pCols, 'controle_producao_obs', 'obs')
    const cUnidId = pick(pCols, 'controle_producao_servico_executado_unidade_id', 'unidade_id')
    const cUnidNome = pick(pCols, 'controle_producao_servico_executado_unidade_nome', 'unidade_nome')
    const cCriado = pick(
      pCols,
      'controle_producao_cadastrador_dh',
      'controle_producao_dt_inclusao',
      'created_at'
    )
    const cAtualiz = pick(
      pCols,
      'controle_producao_alterador_dh',
      'controle_producao_dt_alteracao',
      'updated_at'
    )

    if (!cIdProd || !cProjeto) {
      throw new Error(`Produção: colunas básicas não detectadas (id=${cIdProd}, projeto=${cProjeto})`)
    }

    const where: string[] = [`p.${cProjeto} = ?`]
    const params: unknown[] = [vinculo.siga_projeto_id]
    if (cDeletado) where.push(`p.${cDeletado} <> 'S'`)
    if (cInativo) where.push(`p.${cInativo} <> 'S'`)
    if (desde && cAtualiz) {
      where.push(`(p.${cAtualiz} IS NULL OR p.${cAtualiz} >= ?)`)
      params.push(desde)
    }

    const prodRows = await sigaQuery<Record<string, unknown>>(
      `SELECT p.* FROM pnj_controle_producao p WHERE ${where.join(' AND ')} LIMIT 5000`,
      params
    )

    // Lookup nome do serviço executado em cdt_servico_executado
    const servicoNomes = new Map<number, string>()
    if (cServicoId && prodRows.length > 0) {
      const ids = [
        ...new Set(prodRows.map((r) => r[cServicoId]).filter((v) => v != null))
      ] as number[]
      if (ids.length > 0) {
        try {
          const seCols = await loadCols('cdt_servico_executado')
          const seId = pick(seCols, 'servico_executado_id', 'id')
          const seNome = pick(seCols, 'servico_executado_nome', 'nome', 'descricao')
          if (seId && seNome) {
            const ph = ids.map(() => '?').join(',')
            const seRows = await sigaQuery<{ id: number; nome: string }>(
              `SELECT ${seId} AS id, ${seNome} AS nome FROM cdt_servico_executado WHERE ${seId} IN (${ph})`,
              ids
            )
            for (const r of seRows) servicoNomes.set(Number(r.id), String(r.nome ?? ''))
          } else {
            warnings.push(`cdt_servico_executado sem coluna id/nome reconhecida`)
          }
        } catch (e) {
          warnings.push(`Lookup serviço falhou: ${(e as Error).message}`)
        }
      }
    }

    const BATCH = 200
    for (let i = 0; i < prodRows.length; i += BATCH) {
      const slice = prodRows.slice(i, i + BATCH)
      const toIsoDate = (v: unknown): string | null => {
        if (v == null) return null
        if (v instanceof Date) return v.toISOString().slice(0, 10)
        const s = String(v)
        // Já é ISO 'YYYY-MM-DD...' (ou só YYYY-MM-DD)
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
        const d = new Date(s)
        return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
      }
      const toIso = (v: unknown): string | null => {
        if (v == null) return null
        if (v instanceof Date) return v.toISOString()
        const d = new Date(String(v))
        return Number.isNaN(d.getTime()) ? null : d.toISOString()
      }
      const payload = slice.map((r) => ({
        obra_id: vinculo.obra_id,
        siga_producao_id: Number(r[cIdProd]),
        data: cDt ? toIsoDate(r[cDt]) : null,
        servico_id: cServicoId && r[cServicoId] != null ? Number(r[cServicoId]) : null,
        servico_nome:
          cServicoId && r[cServicoId] != null
            ? servicoNomes.get(Number(r[cServicoId])) ?? null
            : null,
        encarregado_id: cEncId && r[cEncId] != null ? Number(r[cEncId]) : null,
        encarregado_nome: cEncNome && r[cEncNome] != null ? String(r[cEncNome]) : null,
        equipe_id: cEqId && r[cEqId] != null ? Number(r[cEqId]) : null,
        equipe_nome: cEqNome && r[cEqNome] != null ? String(r[cEqNome]) : null,
        qtd: cQtd && r[cQtd] != null ? Number(r[cQtd]) : null,
        trecho: cTrecho && r[cTrecho] != null ? String(r[cTrecho]) : null,
        estaca_inicial: cEstaca && r[cEstaca] != null ? String(r[cEstaca]) : null,
        estaca_final: null,
        obs: cObs && r[cObs] != null ? String(r[cObs]) : null,
        siga_unidade_id: cUnidId && r[cUnidId] != null ? Number(r[cUnidId]) : null,
        siga_unidade_nome: cUnidNome && r[cUnidNome] != null ? String(r[cUnidNome]) : null,
        siga_created_at: cCriado ? toIso(r[cCriado]) : null,
        siga_updated_at: cAtualiz ? toIso(r[cAtualiz]) : null,
        payload_bruto: r,
        sincronizado_em: new Date().toISOString()
      }))
      const { count, error } = await admin
        .from('acompanhamento_producao')
        .upsert(payload, { onConflict: 'siga_producao_id', count: 'exact' })
      if (error) {
        warnings.push(`UPSERT produção lote ${i}: ${error.message}`)
      } else {
        stats.producao_atualizadas += count ?? slice.length
      }
    }
  } catch (e) {
    warnings.push(`Produção: ${(e as Error).message}`)
  }

  // ─── FOTOS ─────────────────────────────────────────────────────────────
  if (vinculo.sincronizar_fotos === false) {
    warnings.push('Fotos: sync desabilitado para esta obra (sincronizar_fotos=false)')
  } else try {
    const fCols = await loadCols('pnj_foto')
    if (fCols.size === 0) throw new Error('Tabela pnj_foto não encontrada')

    const fcId = pick(fCols, 'foto_id', 'id')!
    const fcProj = pick(fCols, 'foto_projeto_id', 'projeto_id')!
    const fcDel = pick(fCols, 'foto_deletado', 'deletado')
    const fcInativo = pick(fCols, 'foto_inativo', 'inativo')
    const fcUuid = pick(fCols, 'foto_app_uuid', 'foto_uuid', 'uuid')
    const fcProdId = pick(fCols, 'foto_controle_producao_id', 'controle_producao_id')
    const fcLat = pick(fCols, 'foto_lat', 'lat', 'latitude')
    const fcLng = pick(fCols, 'foto_lng', 'lng', 'longitude')
    const fcSeId = pick(fCols, 'foto_servico_executado_id', 'servico_executado_id')
    const fcSeNome = pick(fCols, 'foto_servico_executado_nome', 'servico_executado_nome')
    const fcEncId = pick(fCols, 'foto_encarregado_id', 'encarregado_id')
    const fcEncNome = pick(fCols, 'foto_encarregado_nome', 'encarregado_nome')
    const fcCap = pick(fCols, 'foto_captured_at', 'captured_at', 'foto_dt_captura')
    const fcBucket = pick(fCols, 'foto_storage_bucket', 'storage_bucket')
    const fcKey = pick(fCols, 'foto_storage_key', 'storage_key')
    const fcObs = pick(fCols, 'foto_obs', 'obs')
    const fcSize = pick(fCols, 'foto_size_bytes', 'size_bytes')
    const fcMime = pick(fCols, 'foto_mime', 'mime')
    const fcCriado = pick(
      fCols,
      'foto_cadastrador_dh',
      'foto_dt_inclusao',
      'foto_created_at',
      'created_at'
    )

    if (!fcId || !fcProj) throw new Error('Fotos: colunas básicas não detectadas')

    const where: string[] = [`f.${fcProj} = ?`]
    const params: unknown[] = [vinculo.siga_projeto_id]
    if (fcDel) where.push(`f.${fcDel} <> 'S'`)
    if (fcInativo) where.push(`f.${fcInativo} <> 'S'`)
    if (desde && fcCriado) {
      where.push(`(f.${fcCriado} IS NULL OR f.${fcCriado} >= ?)`)
      params.push(desde)
    }

    const fotoRows = await sigaQuery<Record<string, unknown>>(
      `SELECT f.* FROM pnj_foto f WHERE ${where.join(' AND ')} LIMIT 5000`,
      params
    )

    const toIsoF = (v: unknown): string | null => {
      if (v == null) return null
      if (v instanceof Date) return v.toISOString()
      const d = new Date(String(v))
      return Number.isNaN(d.getTime()) ? null : d.toISOString()
    }
    const BATCH = 200
    for (let i = 0; i < fotoRows.length; i += BATCH) {
      const slice = fotoRows.slice(i, i + BATCH)
      const payload = slice.map((r) => ({
        obra_id: vinculo.obra_id,
        siga_foto_id: Number(r[fcId]),
        app_uuid: fcUuid ? (r[fcUuid] as string | null) : null,
        producao_siga_id: fcProdId && r[fcProdId] != null ? Number(r[fcProdId]) : null,
        lat: fcLat && r[fcLat] != null ? Number(r[fcLat]) : null,
        lng: fcLng && r[fcLng] != null ? Number(r[fcLng]) : null,
        servico_executado_id: fcSeId && r[fcSeId] != null ? Number(r[fcSeId]) : null,
        servico_executado_nome: fcSeNome ? (r[fcSeNome] as string | null) : null,
        encarregado_id: fcEncId && r[fcEncId] != null ? Number(r[fcEncId]) : null,
        encarregado_nome: fcEncNome ? (r[fcEncNome] as string | null) : null,
        captured_at: fcCap ? toIsoF(r[fcCap]) : null,
        storage_bucket: fcBucket ? (r[fcBucket] as string | null) : null,
        storage_key: fcKey ? (r[fcKey] as string | null) : null,
        obs: fcObs ? (r[fcObs] as string | null) : null,
        size_bytes: fcSize && r[fcSize] != null ? Number(r[fcSize]) : null,
        mime: fcMime ? (r[fcMime] as string | null) : null,
        siga_created_at: fcCriado ? toIsoF(r[fcCriado]) : null,
        payload_bruto: r,
        sincronizado_em: new Date().toISOString()
      }))
      const { count, error } = await admin
        .from('acompanhamento_foto')
        .upsert(payload, { onConflict: 'siga_foto_id', count: 'exact' })
      if (error) {
        warnings.push(`UPSERT foto lote ${i}: ${error.message}`)
      } else {
        stats.fotos_atualizadas += count ?? slice.length
      }
    }
  } catch (e) {
    warnings.push(`Fotos: ${(e as Error).message}`)
  }

  await admin
    .from('obra_acompanhamento_link')
    .update({
      ultimo_sync_em: new Date().toISOString(),
      ultimo_sync_status: 'ok',
      ultimo_sync_erro: warnings.length > 0 ? warnings.slice(0, 5).join(' | ') : null,
      ultimo_sync_stats: stats
    })
    .eq('id', vinculo.id)

  return { stats, warnings }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  let body: Body = {}
  try {
    body = await req.json()
  } catch {
    /* sem body é OK (cron) */
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const tokenFromHeader = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  // Detecta service_role tanto por comparação direta quanto por claim "role"
  // no JWT (Supabase injeta env vars diferentes em alguns ambientes).
  let isServiceRole = !!SERVICE_KEY && tokenFromHeader === SERVICE_KEY
  if (!isServiceRole && tokenFromHeader) {
    try {
      const payload = JSON.parse(atob(tokenFromHeader.split('.')[1] ?? ''))
      if (payload?.role === 'service_role') isServiceRole = true
    } catch {
      /* ignora */
    }
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

  let q = admin
    .from('obra_acompanhamento_link')
    .select('id, obra_id, siga_projeto_id, ultimo_sync_em, sincronizar_fotos')
    .eq('ativo', true)
  if (body.obra_id) q = q.eq('obra_id', body.obra_id)
  const { data: vinculos, error: vErr } = await q
  if (vErr) return json({ error: vErr.message }, 500)

  if (!vinculos || vinculos.length === 0) {
    return json({ ok: true, sincronizados: [], duracao_ms: Date.now() - t0 })
  }

  const resultados: Array<{
    obra_id: string
    siga_projeto_id: number
    stats?: SyncStats
    warnings?: string[]
    erro?: string
  }> = []

  for (const v of vinculos as VinculoRow[]) {
    try {
      const r = await syncOneVinculo(v, admin, !!body.force_full)
      resultados.push({
        obra_id: v.obra_id,
        siga_projeto_id: v.siga_projeto_id,
        stats: r.stats,
        warnings: r.warnings
      })
      // Chain fire-and-forget: recalcula alertas para essa obra após sync OK
      try {
        const SUPABASE_URL_LOCAL = Deno.env.get('SUPABASE_URL') ?? ''
        if (SUPABASE_URL_LOCAL && SERVICE_KEY) {
          fetch(`${SUPABASE_URL_LOCAL}/functions/v1/acompanhamento-alertas-recalcular`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ obra_id: v.obra_id })
          }).catch(() => { /* ignore */ })
        }
      } catch { /* ignore */ }
    } catch (e) {
      const msg = (e as Error).message
      await admin
        .from('obra_acompanhamento_link')
        .update({ ultimo_sync_status: 'erro', ultimo_sync_erro: msg })
        .eq('id', v.id)
      resultados.push({ obra_id: v.obra_id, siga_projeto_id: v.siga_projeto_id, erro: msg })
    }
  }

  return json({
    ok: true,
    sincronizados: resultados,
    duracao_ms: Date.now() - t0
  })
})
