// POST /functions/v1/acompanhamento-matching-sugerir
// Body: { obra_id: string }
//
// Calcula sugestões de match (NÃO grava). Para cada equipe/encarregado/serviço
// que aparece em `acompanhamento_producao` ou `acompanhamento_foto` da obra,
// busca o melhor candidato em:
//   - equipe (planejamento)            → match para equipes
//   - profiles (uso futuro)            → SKIP (apenas devolve apelido_canonico)
//   - servico (catálogo) + item_orcamentario (servico_grupo) → match para serviços
//
// Similaridade via pg_trgm.similarity() + unaccent + strip tokens lixo.
// Thresholds:
//   >= 0.85 → motivo='exato/fuzzy_alto', recomenda auto-confirmar
//   0.60..  → motivo='fuzzy_medio'
//   abaixo  → não devolve
//
// Permissão: god/adm/eng com acesso à obra.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

interface Body {
  obra_id?: string
}

interface Candidato {
  id: string
  nome: string
  confianca: number
  motivo: 'referencia_externa' | 'exato' | 'fuzzy_alto' | 'fuzzy_medio'
  /** Para serviço, atalho pro item_orcamentario do servico_grupo da obra. */
  item_orcamentario_id?: string | null
  /** Unidade esperada no orçamento (do item_orcamentario.unidade_referencia). */
  unidade_orcamento?: string | null
}

interface SugestaoEquipe {
  siga_nome: string
  candidatos: Candidato[]
  match_atual?: { equipe_id: string | null; origem: string } | null
}

interface SugestaoEncarregado {
  siga_nome: string
  apelido_canonico_sugerido: string
  match_atual?: { equipe_match_id: string | null; origem: string } | null
}

interface SugestaoServico {
  siga_id: number
  siga_nome: string
  siga_unidade_id: number | null
  siga_unidade_nome: string | null
  candidatos: Candidato[]
  match_atual?: {
    servico_id: string | null
    item_orcamentario_id: string | null
    origem: string
    fator_conversao: number | null
  } | null
}

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'e', 'em', 'para', 'com',
  'equipe', 'eq', 'frente', 'time', 'grupo', 'turma', 'servico', 'serviço'])

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
}

function similarity(a: string, b: string): number {
  const n1 = normalize(a)
  const n2 = normalize(b)
  if (!n1 || !n2) return 0
  if (n1 === n2) return 1

  // Token-based: quantos tokens fortes do menor estão no maior?
  const t1 = tokens(a)
  const t2 = tokens(b)
  if (t1.length && t2.length) {
    const set2 = new Set(t2)
    let hits = 0
    for (const t of t1) if (set2.has(t)) hits++
    const tokenScore = hits / Math.min(t1.length, t2.length)
    if (tokenScore >= 1) return 0.95 // todos os tokens fortes batem → match excelente
    if (tokenScore >= 0.5) return Math.min(0.92, 0.65 + tokenScore * 0.25)
  }

  // Fallback: dice bigrams + prefixo
  const bg1 = new Set<string>()
  for (let i = 0; i < n1.length - 1; i++) bg1.add(n1.slice(i, i + 2))
  const bg2 = new Set<string>()
  for (let i = 0; i < n2.length - 1; i++) bg2.add(n2.slice(i, i + 2))
  let inter = 0
  for (const bg of bg1) if (bg2.has(bg)) inter++
  const dice = !bg1.size || !bg2.size ? 0 : (2 * inter) / (bg1.size + bg2.size)

  // Bonus por substring contida (ex: "CBUQ" dentro de "Capa - CBUQ")
  let sub = 0
  if (n1.length >= 3 && n2.includes(n1)) sub = 0.3
  else if (n2.length >= 3 && n1.includes(n2)) sub = 0.3

  // Bonus por prefixo comum até 4 chars
  let pref = 0
  for (let i = 0; i < Math.min(4, n1.length, n2.length); i++) {
    if (n1[i] === n2[i]) pref++
    else break
  }
  return Math.min(1, dice + pref * 0.05 + sub)
}

function motivoFromConfianca(c: number): Candidato['motivo'] {
  if (c >= 0.95) return 'exato'
  if (c >= 0.75) return 'fuzzy_alto'
  return 'fuzzy_medio'
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
  const roleErr = assertRole(ctx.caller, ['god', 'adm', 'engenheiro'])
  if (roleErr) return roleErr
  const accErr = await assertObraAccess(ctx, body.obra_id, { write: false })
  if (accErr) return accErr

  const { admin } = ctx

  // ── 1) Coleta nomes únicos do cache ────────────────────────────────────
  const [{ data: prodRows, error: pErr }, { data: fotoRows, error: fErr }] = await Promise.all([
    admin
      .from('acompanhamento_producao')
      .select('equipe_nome, encarregado_nome, servico_id, servico_nome, siga_unidade_id, siga_unidade_nome, sincronizado_em')
      .eq('obra_id', body.obra_id)
      .order('sincronizado_em', { ascending: false }),
    admin
      .from('acompanhamento_foto')
      .select('encarregado_nome, servico_executado_id, servico_executado_nome')
      .eq('obra_id', body.obra_id)
  ])
  if (pErr) return json({ error: `Produção: ${pErr.message}` }, 500)
  if (fErr) return json({ error: `Fotos: ${fErr.message}` }, 500)

  const equipesSiga = new Set<string>()
  const encarregadosSiga = new Set<string>()
  const servicosSiga = new Map<number, string>()
  /** Unidade SIGA por serviço — usa a mais recente */
  const sigaUnidadePorServico = new Map<number, { id: number | null; nome: string | null }>()

  for (const r of prodRows ?? []) {
    if (r.equipe_nome) equipesSiga.add(String(r.equipe_nome).trim())
    if (r.encarregado_nome) encarregadosSiga.add(String(r.encarregado_nome).trim())
    if (r.servico_id != null) {
      const sid = Number(r.servico_id)
      servicosSiga.set(sid, String(r.servico_nome ?? ''))
      if (!sigaUnidadePorServico.has(sid)) {
        sigaUnidadePorServico.set(sid, {
          id: r.siga_unidade_id != null ? Number(r.siga_unidade_id) : null,
          nome: r.siga_unidade_nome ? String(r.siga_unidade_nome) : null
        })
      }
    }
  }
  for (const r of fotoRows ?? []) {
    if (r.encarregado_nome) encarregadosSiga.add(String(r.encarregado_nome).trim())
    if (r.servico_executado_id != null)
      servicosSiga.set(Number(r.servico_executado_id), String(r.servico_executado_nome ?? ''))
  }

  // ── 2) Carrega cadastros do Planejamento/Orçamento ──────────────────────
  const [equipesCadResp, servicosCadResp, itensOrcResp, matchesEqResp, matchesEncResp, matchesSrvResp] = await Promise.all([
    admin.from('equipe').select('id, nome, cor, tipo, ativo').eq('obra_id', body.obra_id),
    admin.from('servico').select('id, codigo, nome, unidade, referencia_externa'),
    admin
      .from('item_orcamentario')
      .select('id, codigo, descricao, servico_id, unidade, unidade_referencia')
      .eq('obra_id', body.obra_id)
      .not('servico_id', 'is', null),
    admin
      .from('acompanhamento_equipe_match')
      .select('siga_equipe_nome, equipe_id, origem')
      .eq('obra_id', body.obra_id),
    admin
      .from('acompanhamento_encarregado_match')
      .select('siga_encarregado_nome, apelido_canonico, equipe_match_id, origem')
      .eq('obra_id', body.obra_id),
    admin
      .from('acompanhamento_servico_match')
      .select('siga_servico_executado_id, servico_id, item_orcamentario_id, origem, fator_conversao')
      .eq('obra_id', body.obra_id)
  ])
  if (equipesCadResp.error) return json({ error: `Equipes: ${equipesCadResp.error.message}` }, 500)
  if (servicosCadResp.error) return json({ error: `Servicos: ${servicosCadResp.error.message}` }, 500)
  if (itensOrcResp.error) return json({ error: `ItemOrc: ${itensOrcResp.error.message}` }, 500)

  const equipesCad = equipesCadResp.data ?? []
  const servicosCad = servicosCadResp.data ?? []
  const itensOrc = itensOrcResp.data ?? []

  const matchesEqMap = new Map<string, { equipe_id: string | null; origem: string }>()
  for (const m of matchesEqResp.data ?? []) matchesEqMap.set(m.siga_equipe_nome, { equipe_id: m.equipe_id, origem: m.origem })
  const matchesEncMap = new Map<string, { equipe_match_id: string | null; origem: string }>()
  for (const m of matchesEncResp.data ?? []) matchesEncMap.set(m.siga_encarregado_nome, { equipe_match_id: m.equipe_match_id, origem: m.origem })
  const matchesSrvMap = new Map<number, { servico_id: string | null; item_orcamentario_id: string | null; origem: string; fator_conversao: number | null }>()
  for (const m of matchesSrvResp.data ?? [])
    matchesSrvMap.set(Number(m.siga_servico_executado_id), {
      servico_id: m.servico_id,
      item_orcamentario_id: m.item_orcamentario_id,
      origem: m.origem,
      fator_conversao: m.fator_conversao != null ? Number(m.fator_conversao) : null
    })

  // Map servico_id (uuid) -> item_orcamentario_id (uuid) na obra
  const servicoToItem = new Map<string, string>()
  for (const io of itensOrc) {
    if (io.servico_id) servicoToItem.set(io.servico_id, io.id)
  }

  // ── 3) Calcula sugestões ────────────────────────────────────────────────
  const sugestoesEquipes: SugestaoEquipe[] = []
  for (const sigaNome of equipesSiga) {
    const candidatos: Candidato[] = []
    for (const eq of equipesCad) {
      if (!eq.ativo) continue
      const conf = similarity(sigaNome, eq.nome)
      if (conf >= 0.6) {
        candidatos.push({ id: eq.id, nome: eq.nome, confianca: Math.round(conf * 1000) / 1000, motivo: motivoFromConfianca(conf) })
      }
    }
    candidatos.sort((a, b) => b.confianca - a.confianca)
    sugestoesEquipes.push({
      siga_nome: sigaNome,
      candidatos: candidatos.slice(0, 5),
      match_atual: matchesEqMap.get(sigaNome) ?? null
    })
  }

  const sugestoesEncarregados: SugestaoEncarregado[] = []
  for (const sigaNome of encarregadosSiga) {
    sugestoesEncarregados.push({
      siga_nome: sigaNome,
      apelido_canonico_sugerido: sigaNome
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
      match_atual: matchesEncMap.get(sigaNome) ?? null
    })
  }

  // Map servico_id → item_orcamentario completo da obra (pra mostrar código do item)
  const servicoToItemFull = new Map<string, { id: string; codigo: string; descricao: string; unidade: string | null }>()
  for (const io of itensOrc) {
    if (io.servico_id) servicoToItemFull.set(io.servico_id, {
      id: io.id,
      codigo: io.codigo,
      descricao: io.descricao,
      unidade: io.unidade_referencia ?? io.unidade ?? null
    })
  }
  const servicosUsadosObra = new Set(itensOrc.map((io) => io.servico_id).filter((x): x is string => !!x))

  const sugestoesServicos: SugestaoServico[] = []
  for (const [sigaId, sigaNome] of servicosSiga.entries()) {
    const candidatos: Candidato[] = []
    // 1) match por referencia_externa = 'SIGA:<id>' → confianca 1.0
    const refMatch = servicosCad.find(
      (s) => s.referencia_externa && String(s.referencia_externa).trim() === `SIGA:${sigaId}`
    )
    if (refMatch) {
      const ioFull = servicoToItemFull.get(refMatch.id)
      candidatos.push({
        id: refMatch.id,
        nome: ioFull
          ? `${ioFull.codigo} — ${ioFull.descricao}`
          : `${refMatch.codigo} — ${refMatch.nome}`,
        confianca: 1.0,
        motivo: 'referencia_externa',
        item_orcamentario_id: ioFull?.id ?? null,
        unidade_orcamento: ioFull?.unidade ?? null
      })
    }
    // 2) fuzzy por nome — calcula em 2 passes: primeiro serviços vinculados à obra,
    //    depois catálogo geral. Bonus +0.10 para os da obra.
    const calcMatch = (s: typeof servicosCad[number], bonusObra: number) => {
      if (refMatch && s.id === refMatch.id) return
      let conf = similarity(sigaNome, s.nome)
      // Tenta também similaridade contra a descrição do item_orcamentario
      const ioFull = servicoToItemFull.get(s.id)
      if (ioFull) {
        const confDesc = similarity(sigaNome, ioFull.descricao)
        if (confDesc > conf) conf = confDesc
      }
      conf = Math.min(1, conf + bonusObra)
      if (conf >= 0.4) {
        candidatos.push({
          id: s.id,
          nome: ioFull
            ? `${ioFull.codigo} — ${ioFull.descricao}`
            : `${s.codigo} — ${s.nome}`,
          confianca: Math.round(conf * 1000) / 1000,
          motivo: motivoFromConfianca(conf),
          item_orcamentario_id: ioFull?.id ?? null,
          unidade_orcamento: ioFull?.unidade ?? null
        })
      }
    }
    for (const s of servicosCad) if (servicosUsadosObra.has(s.id)) calcMatch(s, 0.10)
    for (const s of servicosCad) if (!servicosUsadosObra.has(s.id)) calcMatch(s, 0)

    candidatos.sort((a, b) => b.confianca - a.confianca)
    const sigaUnid = sigaUnidadePorServico.get(sigaId) ?? { id: null, nome: null }
    sugestoesServicos.push({
      siga_id: sigaId,
      siga_nome: sigaNome,
      siga_unidade_id: sigaUnid.id,
      siga_unidade_nome: sigaUnid.nome,
      candidatos: candidatos.slice(0, 8),
      match_atual: matchesSrvMap.get(sigaId) ?? null
    })
  }

  return json({
    ok: true,
    equipes: sugestoesEquipes,
    encarregados: sugestoesEncarregados,
    servicos: sugestoesServicos,
    totais: {
      equipes_siga: equipesSiga.size,
      encarregados_siga: encarregadosSiga.size,
      servicos_siga: servicosSiga.size,
      equipes_cad: equipesCad.length,
      servicos_cad: servicosCad.length,
      itens_orc_com_servico: itensOrc.length
    }
  })
})
