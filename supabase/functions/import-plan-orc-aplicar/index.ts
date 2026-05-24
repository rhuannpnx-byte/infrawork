// POST /functions/v1/import-plan-orc-aplicar
//
// Importa itens diretos da planilha orçamentária (ex.: aba Plan_Orc da
// TecPav, ou qualquer outra com layout código + descrição + unid + qtd +
// venda_unit). Versão simples: sem matching contra servicos, sem wizard
// de matches fracos.
//
// Para cada item:
//   - is_folha=false → tipo='etapa' (estrutural, sem unidade/qtd)
//   - is_folha=true  → tipo='receita' (cobra do cliente)
// Hierarquia preservada pelo código (1.2.3 fica sob 1.2). Vinculação a
// CPU é feita depois via "Agrupar como serviço".

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

interface ParsedItem {
  idx: number
  codigo: string
  descricao: string
  unidade: string | null
  quantidade: number | null
  venda_unitaria: number | null
  is_folha: boolean
}

function parentCodigo(codigo: string): string | null {
  const i = codigo.lastIndexOf('.')
  if (i < 0) return null
  return codigo.slice(0, i)
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

  let body: { obra_id?: string; itens?: ParsedItem[] }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }

  const obra_id = body.obra_id?.trim()
  const itens = body.itens ?? []
  if (!obra_id) return json({ error: 'obra_id obrigatório' }, 400)
  if (!Array.isArray(itens) || itens.length === 0) {
    return json({ error: 'Nenhum item para importar' }, 400)
  }

  const acc = await assertObraAccess(ctx, obra_id, { write: true })
  if (acc) return acc

  const t0 = Date.now()

  // Pré-carrega códigos já existentes pra dedup
  const { data: existentes } = await admin
    .from('item_orcamentario')
    .select('id, codigo')
    .eq('obra_id', obra_id)
  const idPorCodigo = new Map<string, string>()
  for (const e of existentes ?? []) idPorCodigo.set(e.codigo as string, e.id as string)

  // Ordena por código (raiz primeiro)
  const sorted = [...itens].sort((a, b) => {
    const ca = a.codigo.split('.').map((n) => parseInt(n, 10) || 0)
    const cb = b.codigo.split('.').map((n) => parseInt(n, 10) || 0)
    const len = Math.max(ca.length, cb.length)
    for (let i = 0; i < len; i++) {
      const va = ca[i] ?? 0
      const vb = cb[i] ?? 0
      if (va !== vb) return va - vb
    }
    return 0
  })

  const stats = { criados: 0, pulados: 0 }
  const erros: string[] = []

  for (const it of sorted) {
    if (idPorCodigo.has(it.codigo)) {
      stats.pulados++
      continue
    }
    const parentCod = parentCodigo(it.codigo)
    const parent_id = parentCod ? (idPorCodigo.get(parentCod) ?? null) : null
    const tipo = it.is_folha ? 'receita' : 'etapa'

    const { data: novo, error } = await admin
      .from('item_orcamentario')
      .insert({
        obra_id,
        parent_id,
        codigo: it.codigo,
        descricao: it.descricao,
        tipo,
        unidade: tipo === 'receita' ? (it.unidade ?? null) : null,
        quantidade: tipo === 'receita' ? (it.quantidade ?? 0) : null,
        venda_unitaria: tipo === 'receita' ? (it.venda_unitaria ?? 0) : null
      })
      .select('id')
      .single()

    if (error || !novo) {
      erros.push(`${it.codigo} ${it.descricao}: ${error?.message ?? 'falha'}`)
      stats.pulados++
      continue
    }
    idPorCodigo.set(it.codigo, novo.id as string)
    stats.criados++
  }

  // Recalcula a obra pra rollup ficar correto
  await admin.rpc('recalcular_orcamento', { _obra_id: obra_id })

  return json({
    ok: erros.length === 0 || stats.criados > 0,
    stats,
    erros: erros.slice(0, 200),
    duracao_ms: Date.now() - t0
  })
})
