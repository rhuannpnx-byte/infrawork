// POST /functions/v1/import-iniciar
// Body: {
//   obra_id: string,
//   template_id?: string,
//   arquivo_nome: string,
//   arquivo_tamanho?: number,
//   payload_parse: {
//     itens: ParsedItem[],
//     indireto?: ParsedIndireto[]
//   }
// }
//
// Cria um import_job, faz matching automático dos itens contra o
// catálogo `servico` da empresa e retorna o job + estatísticas.
//
// Matching:
//   - servico.codigo == item.codigo  → forte
//   - servico.nome normalizado == item.descricao normalizada → forte
//   - score > 0.6 (overlap de tokens) → fraco (vai em import_match_fraco)
//   - resto → sem match
//
// Itens "agrupador" (sem unidade/quantidade) não entram em matching.

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
  /** Se folha (true), entra em matching com `servico`. */
  is_folha: boolean
}

interface ParsedIndireto {
  idx: number
  codigo?: string | null
  descricao: string
  tipo: 'mobilizacao' | 'desmob' | 'admin_local' | 'outros'
  valor_total: number
}

interface ServicoCat {
  id: string
  codigo: string | null
  nome: string
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter((t) => t.length >= 3))
}

function score(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / Math.max(ta.size, tb.size)
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

  let body: {
    obra_id?: string
    template_id?: string
    arquivo_nome?: string
    arquivo_tamanho?: number
    payload_parse?: { itens?: ParsedItem[]; indireto?: ParsedIndireto[] }
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }

  const obra_id = body.obra_id?.trim()
  if (!obra_id) return json({ error: 'obra_id obrigatório' }, 400)
  const arquivo_nome = body.arquivo_nome?.trim()
  if (!arquivo_nome) return json({ error: 'arquivo_nome obrigatório' }, 400)
  const itens = body.payload_parse?.itens ?? []
  if (!Array.isArray(itens) || itens.length === 0) {
    return json({ error: 'payload_parse.itens vazio' }, 400)
  }
  const indireto = body.payload_parse?.indireto ?? []

  const acc = await assertObraAccess(ctx, obra_id, { write: true })
  if (acc) return acc

  // Carrega catálogo de serviços DA OBRA para matching
  const { data: servicos } = await admin
    .from('servico')
    .select('id, codigo, nome')
    .eq('obra_id', obra_id)
    .eq('ativo', true)
  const cat = (servicos ?? []) as ServicoCat[]

  // Index por código (lowercase)
  const byCodigo = new Map<string, ServicoCat>()
  const byNome = new Map<string, ServicoCat>()
  for (const s of cat) {
    if (s.codigo) byCodigo.set(s.codigo.trim().toLowerCase(), s)
    byNome.set(normalize(s.nome), s)
  }

  // Matching item a item
  const matches: Record<number, { servico_id: string; tipo: 'forte' | 'fraco' }> = {}
  const fracos: {
    item_idx: number
    codigo_origem: string | null
    descricao_origem: string
    sugestoes: { servico_id: string; codigo: string | null; nome: string; score: number }[]
  }[] = []
  let fortes = 0
  let semMatch = 0

  for (const it of itens) {
    if (!it.is_folha) continue

    // 1) Match exato por código
    const codeKey = it.codigo?.trim().toLowerCase()
    if (codeKey && byCodigo.has(codeKey)) {
      const s = byCodigo.get(codeKey)!
      matches[it.idx] = { servico_id: s.id, tipo: 'forte' }
      fortes++
      continue
    }

    // 2) Match exato por nome normalizado
    const nomeNorm = normalize(it.descricao)
    if (byNome.has(nomeNorm)) {
      const s = byNome.get(nomeNorm)!
      matches[it.idx] = { servico_id: s.id, tipo: 'forte' }
      fortes++
      continue
    }

    // 3) Score por overlap (top 5 sugestões com score >= 0.6)
    const sug = cat
      .map((s) => ({
        servico_id: s.id,
        codigo: s.codigo,
        nome: s.nome,
        score: score(it.descricao, s.nome)
      }))
      .filter((x) => x.score >= 0.6)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    if (sug.length > 0) {
      fracos.push({
        item_idx: it.idx,
        codigo_origem: it.codigo ?? null,
        descricao_origem: it.descricao,
        sugestoes: sug
      })
    } else {
      semMatch++
    }
  }

  // Cria o job
  const payload_parse = { itens, indireto }
  const payload_match = { matches }
  const { data: job, error: errJob } = await admin
    .from('import_job')
    .insert({
      obra_id,
      template_id: body.template_id ?? null,
      arquivo_nome,
      arquivo_tamanho: body.arquivo_tamanho ?? null,
      status: fracos.length === 0 ? 'mapeado' : 'parseado',
      payload_parse,
      payload_match,
      total_itens: itens.length,
      matches_fortes: fortes,
      matches_fracos: fracos.length,
      sem_match: semMatch,
      criado_por: caller.id
    })
    .select('id, status, total_itens, matches_fortes, matches_fracos, sem_match')
    .single()

  if (errJob) return json({ error: errJob.message }, 400)

  // Popula match_fraco
  if (fracos.length > 0) {
    const rows = fracos.map((f) => ({
      job_id: job.id,
      item_idx: f.item_idx,
      codigo_origem: f.codigo_origem,
      descricao_origem: f.descricao_origem,
      sugestoes: f.sugestoes
    }))
    const { error: errIns } = await admin.from('import_match_fraco').insert(rows)
    if (errIns) return json({ error: `match_fraco: ${errIns.message}` }, 400)
  }

  return json(job, 201)
})
