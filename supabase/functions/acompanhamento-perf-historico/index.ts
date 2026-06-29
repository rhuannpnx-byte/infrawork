// POST /functions/v1/acompanhamento-perf-historico
// Body: { siga_servico_ids: number[], obra_id?: string }
// Permissão: god / adm / engenheiro / apoio.
//
// Benchmark histórico de produtividade diária de equipe para um serviço
// EXECUTADO do SIGA (id global do ERP), calculado DIRETO no MySQL do SIGA —
// sobre TODOS os projetos do SIGA, não só as obras importadas no InfraWork.
// Exclui o(s) projeto(s) SIGA vinculado(s) à obra atual. Uma amostra = produção
// somada de uma equipe nesse serviço num dia. Outliers removidos por IQR 1.5×.
// Percentis calculados no Deno (MySQL não tem percentile_cont).

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { sigaQuery } from '../_shared/siga-mysql.ts'

interface Body {
  siga_servico_ids?: number[]
  obra_id?: string
}

/** Quantil por interpolação linear (R-7), igual ao percentile_cont. */
function quantil(xs: number[], p: number): number {
  if (xs.length === 0) return 0
  if (xs.length === 1) return xs[0]
  const s = [...xs].sort((a, b) => a - b)
  const idx = p * (s.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return s[lo]
  const f = idx - lo
  return s[lo] * (1 - f) + s[hi] * f
}

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null

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

function vazio(): Record<string, unknown> {
  return {
    ok: true,
    n_amostras: 0,
    n_outliers: 0,
    p25: null,
    p50: null,
    p75: null,
    media_trim: null,
    media_bruta: null,
    n_obras: 0,
    unidade: null
  }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const roleErr = assertRole(ctx.caller, ['god', 'adm', 'engenheiro', 'apoio'])
  if (roleErr) return roleErr

  let body: Body = {}
  try {
    body = await req.json()
  } catch {
    /* sem body */
  }

  const ids = [
    ...new Set((body.siga_servico_ids ?? []).map((v) => Number(v)).filter((v) => Number.isFinite(v)))
  ]
  if (ids.length === 0) return json(vazio())

  // Projeto(s) SIGA da obra atual — para EXCLUIR do benchmark.
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const excluir: number[] = []
  if (body.obra_id) {
    try {
      const { createClient } = await import('jsr:@supabase/supabase-js@2')
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
      })
      const { data: links } = await admin
        .from('obra_acompanhamento_link')
        .select('siga_projeto_id')
        .eq('obra_id', body.obra_id)
      for (const l of links ?? []) {
        const n = Number((l as { siga_projeto_id: unknown }).siga_projeto_id)
        if (Number.isFinite(n)) excluir.push(n)
      }
    } catch {
      /* segue sem exclusão se o lookup falhar */
    }
  }

  try {
    const pCols = await loadCols('pnj_controle_producao')
    if (pCols.size === 0) throw new Error('Tabela pnj_controle_producao não encontrada')

    const cProjeto = pick(pCols, 'controle_producao_projeto_id', 'projeto_id')
    const cServico = pick(
      pCols,
      'controle_producao_servico_executado_id',
      'controle_producao_servico_id',
      'servico_id'
    )
    const cQtd = pick(
      pCols,
      'controle_producao_servico_executado_qtd',
      'controle_producao_qtde',
      'controle_producao_quantidade',
      'qtd'
    )
    const cDt = pick(pCols, 'controle_producao_dt', 'controle_producao_data', 'data')
    const cEqId = pick(pCols, 'controle_producao_equipe_id', 'equipe_id')
    const cEqNome = pick(pCols, 'controle_producao_equipe_nome', 'equipe_nome')
    const cDeletado = pick(pCols, 'controle_producao_deletado', 'deletado')
    const cInativo = pick(pCols, 'controle_producao_inativo', 'inativo')
    const cUnidNome = pick(
      pCols,
      'controle_producao_servico_executado_unidade_nome',
      'unidade_nome'
    )

    if (!cProjeto || !cServico || !cQtd || !cDt) {
      throw new Error(
        `Colunas básicas não detectadas (projeto=${cProjeto}, servico=${cServico}, qtd=${cQtd}, data=${cDt})`
      )
    }

    const eqKey = cEqId ? `p.${cEqId}` : cEqNome ? `p.${cEqNome}` : `''`

    const where: string[] = [
      `p.${cServico} IN (${ids.map(() => '?').join(',')})`,
      `p.${cQtd} > 0`
    ]
    const params: unknown[] = [...ids]
    if (cDeletado) where.push(`p.${cDeletado} <> 'S'`)
    if (cInativo) where.push(`p.${cInativo} <> 'S'`)
    if (excluir.length > 0) {
      where.push(`p.${cProjeto} NOT IN (${excluir.map(() => '?').join(',')})`)
      params.push(...excluir)
    }

    const sql =
      `SELECT p.${cProjeto} AS projeto, ${eqKey} AS equipe, DATE(p.${cDt}) AS d, ` +
      `SUM(p.${cQtd}) AS q${cUnidNome ? `, MAX(p.${cUnidNome}) AS un` : ''} ` +
      `FROM pnj_controle_producao p WHERE ${where.join(' AND ')} ` +
      `GROUP BY p.${cProjeto}, ${eqKey}, DATE(p.${cDt})`

    const rows = await sigaQuery<{ projeto: number; q: number | string; un?: string | null }>(
      sql,
      params
    )

    const vals = rows
      .map((r) => Number(r.q))
      .filter((v) => Number.isFinite(v) && v > 0)
    if (vals.length === 0) return json(vazio())

    const projetos = new Set(rows.map((r) => Number(r.projeto)))
    let unidade: string | null = null
    if (cUnidNome) {
      for (const r of rows) {
        if (r.un) {
          unidade = String(r.un)
          break
        }
      }
    }

    // Outliers por IQR 1.5× (só com amostra suficiente).
    let limpos = vals
    let nOut = 0
    if (vals.length >= 4) {
      const q1 = quantil(vals, 0.25)
      const q3 = quantil(vals, 0.75)
      const iqr = q3 - q1
      const lo = q1 - 1.5 * iqr
      const hi = q3 + 1.5 * iqr
      limpos = vals.filter((v) => v >= lo && v <= hi)
      nOut = vals.length - limpos.length
    }

    return json({
      ok: true,
      n_amostras: limpos.length,
      n_outliers: nOut,
      p25: limpos.length ? quantil(limpos, 0.25) : null,
      p50: limpos.length ? quantil(limpos, 0.5) : null,
      p75: limpos.length ? quantil(limpos, 0.75) : null,
      media_trim: mean(limpos),
      media_bruta: mean(vals),
      n_obras: projetos.size,
      unidade
    })
  } catch (e) {
    const err = e as Error
    return json({ error: err.message, stack: err.stack?.split('\n').slice(0, 5) }, 500)
  }
})
