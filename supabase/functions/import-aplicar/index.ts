// POST /functions/v1/import-aplicar
// Body: { job_id: string }
//
// Aplica um import_job (status='mapeado') na Planilha Orçamentária:
//   1. Itens com unidade → tipo='receita' (qtd × venda_unit).
//   2. Itens sem unidade  → tipo='etapa' (estrutural; agrupa filhos).
//   3. Hierarquia preservada pelo código (1.2.3 fica embaixo de 1.2).
//   4. servico_id/cpu_snapshot_id NÃO são vinculados aqui — o usuário faz isso
//      depois via modal "Agrupar como serviço" (transforma N receitas em
//      um servico_grupo com CPU + quantidade de referência).
//   5. Cria indireto_item se houver indireto no payload.
//   6. Roda recalcular_orcamento.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

interface ParsedItem {
  idx: number
  codigo: string
  descricao: string
  unidade?: string | null
  quantidade?: number | null
  venda_unitaria?: number | null
  is_folha: boolean
}

interface ParsedIndireto {
  idx: number
  codigo?: string | null
  descricao: string
  tipo: 'mobilizacao' | 'desmob' | 'admin_local' | 'outros'
  valor_total: number
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
  void caller

  let body: { job_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const job_id = body.job_id?.trim()
  if (!job_id) return json({ error: 'job_id obrigatório' }, 400)

  const { data: job } = await admin
    .from('import_job')
    .select('id, obra_id, status, payload_parse')
    .eq('id', job_id)
    .single()
  if (!job) return json({ error: 'Job não encontrado' }, 404)
  if (job.status !== 'mapeado') {
    return json({ error: `Job em status ${job.status}; precisa estar 'mapeado'` }, 400)
  }

  const acc = await assertObraAccess(ctx, job.obra_id, { write: true })
  if (acc) return acc

  const parse = job.payload_parse as { itens: ParsedItem[]; indireto: ParsedIndireto[] }
  const itens = parse.itens ?? []
  const indireto = parse.indireto ?? []

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

  const idPorCodigo = new Map<string, string>()
  let criados = 0
  const erros: string[] = []

  for (const it of sorted) {
    const parentCod = parentCodigo(it.codigo)
    const parent_id = parentCod ? (idPorCodigo.get(parentCod) ?? null) : null

    // Receita se tem unidade; etapa se não tem.
    const tipo = it.is_folha ? 'receita' : 'etapa'

    const { data: novo, error: errIns } = await admin
      .from('item_orcamentario')
      .insert({
        obra_id: job.obra_id,
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

    if (errIns) {
      erros.push(`Item ${it.codigo}: ${errIns.message}`)
      continue
    }
    idPorCodigo.set(it.codigo, novo.id)
    criados++
  }

  // Indireto
  let indiretoCriados = 0
  for (const ind of indireto) {
    const { error } = await admin.from('indireto_item').insert({
      obra_id: job.obra_id,
      codigo: ind.codigo ?? `IMP-${ind.idx}`,
      descricao: ind.descricao,
      tipo: ind.tipo,
      valor_total: ind.valor_total,
      distribuicao_perc: 1.0
    })
    if (error) {
      erros.push(`Indireto ${ind.codigo ?? ind.idx}: ${error.message}`)
    } else {
      indiretoCriados++
    }
  }

  await admin.rpc('recalcular_orcamento', { _obra_id: job.obra_id })

  const newStatus = erros.length > 0 && criados === 0 ? 'erro' : 'aplicado'
  const error_msg = erros.length > 0 ? erros.join(' | ').slice(0, 2000) : null
  await admin
    .from('import_job')
    .update({
      status: newStatus,
      itens_aplicados: criados,
      error_msg
    })
    .eq('id', job_id)

  return json({
    job_id,
    status: newStatus,
    itens_criados: criados,
    snapshots_criados: 0,
    indireto_criados: indiretoCriados,
    erros
  })
})
