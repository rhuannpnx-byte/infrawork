// POST /functions/v1/acompanhamento-listar-projetos-siga
// Body: {}
// Permissão: god / adm.
//
// Lista projetos ativos do SIGA (cdt_projeto). Defensivo: tenta múltiplos
// nomes de coluna (projeto_codigo, projeto_codigo_obra, codigo) e flags de
// "ativo" (projeto_deletado='N' ou projeto_status). Retorna o que conseguir.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { sigaQuery } from '../_shared/siga-mysql.ts'

interface ProjetoRow {
  projeto_id: number
  projeto_codigo?: string
  projeto_codigo_obra?: string
  codigo?: string
  projeto_nome?: string
  nome?: string
  projeto_deletado?: string
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const roleErr = assertRole(ctx.caller, ['god', 'adm'])
  if (roleErr) return roleErr

  try {
    // Lista as colunas reais da tabela
    const cols = await sigaQuery<{ COLUMN_NAME: string }>(
      `SELECT COLUMN_NAME FROM information_schema.columns
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cdt_projeto'`
    )
    const colNames = new Set(cols.map((c) => c.COLUMN_NAME))

    const pickCol = (...candidates: string[]): string | null => {
      for (const c of candidates) if (colNames.has(c)) return c
      return null
    }

    const colId = pickCol('projeto_id', 'id')
    const colCodigo = pickCol('projeto_codigo', 'projeto_codigo_obra', 'codigo')
    const colNome = pickCol('projeto_nome', 'projeto_descricao', 'nome', 'descricao')
    const colDeletado = pickCol('projeto_deletado', 'deletado')
    const colInativo = pickCol('projeto_inativo', 'inativo')
    const colStatus = pickCol('projeto_status', 'status')

    if (!colId) {
      return json(
        {
          error: 'Tabela cdt_projeto sem coluna de id reconhecida',
          colunas_disponiveis: [...colNames]
        },
        500
      )
    }

    const selectCols = [
      `${colId} AS projeto_id`,
      colCodigo ? `${colCodigo} AS projeto_codigo` : `NULL AS projeto_codigo`,
      colNome ? `${colNome} AS projeto_nome` : `NULL AS projeto_nome`
    ].join(', ')

    const whereClauses: string[] = []
    if (colDeletado) whereClauses.push(`${colDeletado} <> 'S'`)
    if (colInativo) whereClauses.push(`${colInativo} <> 'S'`)
    if (colStatus) whereClauses.push(`(${colStatus} IS NULL OR ${colStatus} <> 'inativo')`)

    const orderCol = colCodigo ?? colId
    const sql =
      `SELECT ${selectCols} FROM cdt_projeto` +
      (whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : '') +
      ` ORDER BY ${orderCol} LIMIT 1000`

    const rows = await sigaQuery<ProjetoRow>(sql)

    return json({
      ok: true,
      projetos: rows.map((r) => ({
        id: Number(r.projeto_id),
        codigo: String(r.projeto_codigo ?? r.projeto_id),
        nome: String(r.projeto_nome ?? '')
      })),
      schema_detectado: {
        colunas_usadas: { id: colId, codigo: colCodigo, nome: colNome, deletado: colDeletado, status: colStatus },
        total_colunas: colNames.size
      }
    })
  } catch (e) {
    const err = e as Error
    return json({ error: err.message, stack: err.stack?.split('\n').slice(0, 5) }, 500)
  }
})
