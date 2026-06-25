// POST /functions/v1/documentacao-resolver
// Body: { obra_id }
//
// Resolução OBRA-LEVEL dos candidatos (extracao_candidato) no Dossiê. SEM LLM.
// - ESCALAR: escolhe 1 vencedor ANCORADO na categoria certa (assinado > minuta,
//   recente > antigo, maior confiança) → campo_dossie + linha contrato.
// - INCREMENTAL: une todos os candidatos das categorias certas, dedup por
//   chave_dedup → tabelas-alvo (parte/responsavel_tecnico/evento/clausula).
// Normaliza entidades (HTML, acentos, "Ltda.", BR-30→BR-030) e dedup. Conflito
// de alta confiança em categorias válidas → finding WARN "a conferir".

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'
import {
  addDiasIso,
  carregarCampos,
  carregarGrupos,
  chaveConsenso,
  chaveDedup,
  chaveEntidade,
  cnpjValido,
  dateOnly,
  dedupEventos,
  derivarFinanceiro,
  diasEntreIso,
  desescaparHtml,
  mapaGrupoBase,
  normalizarDataParcial,
  normalizarTexto,
  num,
  relParaBase,
  slugEventoTipo,
  type TemplateCampo
} from '../_shared/template.ts'

// deno-lint-ignore no-explicit-any
type Admin = any

interface Cand {
  doc_id: string | null
  campo_chave: string
  item_key: string
  valor_json: unknown
  pagina: number | null
  confianca: number | null
  doc_categoria: string | null
  assinado: boolean | null
  doc_data: string | null
}

const CONTRATO_COLS = new Set([
  'numero', 'processo', 'sei', 'edital', 'lei', 'objeto', 'natureza', 'regime',
  'valor_p0', 'data_base', 'assinatura', 'publicacao', 'prazo_exec_dias',
  'prazo_vig_dias', 'inicio_exec', 'termino_exec', 'termino_vig', 'fiscal'
])

function normalizaPorTipo(valor: unknown, tipo: string): unknown {
  if (tipo === 'data') return dateOnly(valor)
  if (tipo === 'moeda' || tipo === 'numero') return num(valor)
  if (tipo === 'booleano') return Boolean(valor)
  return normalizarTexto(valor)
}

/** Ordena candidatos: assinado > minuta, mais recente, maior confiança. */
function melhor(a: Cand, b: Cand): number {
  const sa = a.assinado ? 1 : 0
  const sb = b.assinado ? 1 : 0
  if (sa !== sb) return sb - sa
  const da = a.doc_data ?? ''
  const db = b.doc_data ?? ''
  if (da !== db) return db.localeCompare(da)
  return (b.confianca ?? 0) - (a.confianca ?? 0)
}

async function upsertCampoDossie(
  admin: Admin,
  obra_id: string,
  caminho: string,
  valor: unknown,
  doc_id: string | null,
  pagina: number | null,
  confianca: number | null
): Promise<void> {
  if (valor == null || valor === '') return
  const { data: ex } = await admin
    .from('campo_dossie')
    .select('id, validado_humano')
    .eq('obra_id', obra_id)
    .eq('caminho', caminho)
    .maybeSingle()
  if (ex?.validado_humano) return
  const linha = {
    obra_id,
    caminho,
    valor_json: valor,
    doc_id,
    pagina,
    confianca,
    derivado: false,
    atualizado_em: new Date().toISOString()
  }
  if (ex) await admin.from('campo_dossie').update(linha).eq('id', ex.id)
  else await admin.from('campo_dossie').insert(linha)
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const roleErr = assertRole(ctx.caller, ['god', 'adm', 'engenheiro'])
  if (roleErr) return roleErr
  const { admin } = ctx

  let body: { obra_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const obra_id = body.obra_id?.trim()
  if (!obra_id) return json({ error: 'obra_id é obrigatório' }, 400)
  const acc = await assertObraAccess(ctx, obra_id, { write: true })
  if (acc) return acc

  const campos = await carregarCampos(admin, obra_id)
  if (!campos.length) return json({ ok: true, resolvidos: 0, conflitos: [] })

  const { data: candData } = await admin
    .from('extracao_candidato')
    .select('doc_id, campo_chave, item_key, valor_json, pagina, confianca, doc_categoria, assinado, doc_data')
    .eq('obra_id', obra_id)
  const candidatos = (candData ?? []) as Cand[]
  const porChave = new Map<string, Cand[]>()
  for (const c of candidatos) {
    const arr = porChave.get(c.campo_chave) ?? []
    arr.push(c)
    porChave.set(c.campo_chave, arr)
  }

  const conflitos: string[] = []
  const contratoPatch: Record<string, unknown> = {}
  // Escalares resolvidos (valor + proveniência) p/ sintetizar marcos contratuais.
  const escalares = new Map<string, { valor: unknown; doc_id: string | null; pagina: number | null }>()

  // resolver é dono do finding de conflito (R-CONF); limpa os antigos.
  await admin.from('documentacao_finding').delete().eq('obra_id', obra_id).eq('regra_id', 'R-CONF')

  // ─── ESCALARES (resolução por CONSENSO, antifrágil) ──────────────────────
  // Em vez de eleger 1 documento "melhor" (que premiava ruído de OCR), agrupa as
  // variações de superfície do MESMO valor e elege o de MAIOR CONSENSO ponderado
  // (nº de docs + confiança + assinatura). Sem assumir formato/prefixo.
  for (const campo of campos.filter((c) => c.cardinalidade === 'escalar')) {
    const todos = (porChave.get(campo.chave) ?? []).filter((c) => c.item_key === '')
    if (!todos.length) continue
    const anchored = campo.doc_categorias?.length
      ? todos.filter((c) => campo.doc_categorias.includes(c.doc_categoria ?? ''))
      : todos
    const pool = anchored.length ? anchored : todos

    const grupos = new Map<string, { cands: Cand[]; score: number }>()
    for (const c of pool) {
      const v = normalizaPorTipo(c.valor_json, campo.tipo)
      if (v == null || v === '') continue
      // texto/entidade agrupam por consenso tolerante; números/datas por valor exato
      const k = campo.tipo === 'texto' || campo.tipo === 'entidade' ? chaveConsenso(v) : String(v)
      const g = grupos.get(k) ?? { cands: [], score: 0 }
      g.cands.push(c)
      g.score += 1 + (c.confianca ?? 0) + (c.assinado ? 0.5 : 0)
      grupos.set(k, g)
    }
    if (!grupos.size) continue
    const ordenados = [...grupos.values()].sort((a, b) => b.score - a.score)
    const venc = ordenados[0]
    venc.cands.sort(melhor)
    const best = venc.cands[0]
    const valor = normalizaPorTipo(best.valor_json, campo.tipo)
    if (valor == null || valor === '') continue

    await upsertCampoDossie(admin, obra_id, campo.chave, valor, best.doc_id, best.pagina, best.confianca)
    escalares.set(campo.chave, { valor, doc_id: best.doc_id, pagina: best.pagina })

    if (campo.chave.startsWith('contrato.')) {
      const col = campo.chave.slice('contrato.'.length)
      if (CONTRATO_COLS.has(col)) {
        contratoPatch[col] =
          col === 'natureza' ? (valor === 'privado' ? 'privado' : valor === 'publico' ? 'publico' : null) : valor
      }
    }

    // conflito: ≥2 grupos distintos, cada um com candidato de alta confiança
    const gruposAltaConf = ordenados.filter((g) => g.cands.some((c) => (c.confianca ?? 0) >= 0.8))
    if (gruposAltaConf.length > 1) {
      conflitos.push(campo.chave)
      const variantes = gruposAltaConf
        .slice(0, 4)
        .map((g) => String(normalizaPorTipo([...g.cands].sort(melhor)[0].valor_json, campo.tipo)))
      await admin.from('documentacao_finding').insert({
        obra_id,
        regra_id: 'R-CONF',
        severidade: 'WARN',
        campo: campo.chave,
        mensagem: `Leituras divergentes para "${campo.rotulo}" — adotado o de maior consenso; conferir.`,
        encontrado: variantes.join(' | '),
        aberto: true
      })
    }
  }

  // contrato (linha) — upsert do principal (necessário p/ grafo + financeiro)
  let contratoId: string | null = null
  {
    const { data: existente } = await admin
      .from('contrato')
      .select('id')
      .eq('obra_id', obra_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(contratoPatch)) if (v != null) patch[k] = v
    if (existente) {
      contratoId = existente.id
      if (Object.keys(patch).length) await admin.from('contrato').update(patch).eq('id', existente.id)
    } else if (patch.numero) {
      const { data: novo } = await admin.from('contrato').insert({ obra_id, ...patch }).select('id').maybeSingle()
      contratoId = novo?.id ?? null
    }
  }

  // ─── INCREMENTAIS ──────────────────────────────────────────────────────
  const partes: Array<Record<string, unknown>> = []
  const rts: Array<Record<string, unknown>> = []
  const clausulas: Array<Record<string, unknown>> = []
  const eventos: Array<Record<string, unknown>> = []
  const alvosTocados = new Set<string>()

  for (const campo of campos.filter((c) => c.cardinalidade === 'incremental')) {
    const todos = (porChave.get(campo.chave) ?? []).filter((c) => c.item_key !== '')
    if (!todos.length) continue
    const anchored = campo.doc_categorias?.length
      ? todos.filter((c) => campo.doc_categorias.includes(c.doc_categoria ?? ''))
      : todos
    const pool = anchored.length ? anchored : todos

    // dedup por chave_dedup, mantendo o de maior confiança. RT é deduplicado por
    // NOME (a ART pode vir mascarada/ausente — não serve de chave de identidade).
    const map = new Map<string, Cand>()
    for (const c of pool) {
      const item = (c.valor_json ?? {}) as Record<string, unknown>
      const key =
        campo.alvo === 'responsavel_tecnico'
          ? `rt:${chaveEntidade(normalizarTexto(item.nome as string), null)}`
          : chaveDedup(item, campo.chave_dedup)
      const cur = map.get(key)
      if (!cur || (c.confianca ?? 0) > (cur.confianca ?? 0)) map.set(key, c)
    }

    alvosTocados.add(campo.alvo)
    for (const c of map.values()) {
      const it = (c.valor_json ?? {}) as Record<string, unknown>
      const base = { obra_id, doc_id: c.doc_id, pagina: c.pagina, confianca: c.confianca }
      if (campo.alvo === 'parte') {
        const nome = normalizarTexto(it.nome)
        if (!nome) continue
        const cnpjRaw = normalizarTexto(it.cnpj)
        const cnpj = cnpjValido(cnpjRaw) ? cnpjRaw : null
        // O próprio consórcio (guarda-chuva, sem CNPJ próprio) não é uma consorciada.
        if (/^cons[oó]rcio\b/i.test(nome) && !cnpj) continue
        partes.push({ ...base, papel: normalizarTexto(it.papel) ?? 'consorciada', nome, cnpj })
      } else if (campo.alvo === 'responsavel_tecnico') {
        const nome = normalizarTexto(it.nome)
        if (!nome) continue
        rts.push({ ...base, nome, crea: normalizarTexto(it.crea), papel: normalizarTexto(it.papel), art: normalizarTexto(it.art) })
      } else if (campo.alvo === 'clausula') {
        const numero = normalizarTexto(it.numero)
        const titulo = normalizarTexto(it.titulo) ?? numero
        if (!titulo) continue
        clausulas.push({
          ...base,
          numero,
          titulo,
          categoria: normalizarTexto(it.categoria),
          texto: it.texto ? desescaparHtml(String(it.texto)) : null
        })
      } else if (campo.alvo === 'evento') {
        const tipo = slugEventoTipo(campo.evento_tipo ?? it.tipo ?? it.ato ?? 'evento')
        // ART: rótulo "ART <nº> — <profissional>"; demais: rótulo/objeto do item.
        const rotuloArt =
          tipo === 'art'
            ? [it.numero ? `ART ${normalizarTexto(it.numero)}` : 'ART', normalizarTexto(it.profissional)]
                .filter(Boolean)
                .join(' — ')
            : null
        const rotulo =
          normalizarTexto(it.rotulo) ?? normalizarTexto(it.objeto) ?? rotuloArt ?? campo.rotulo
        const descPartes = [it.objeto ? `Objeto: ${normalizarTexto(it.objeto)}` : null, it.validade ? `Validade: ${dateOnly(it.validade)}` : null].filter(Boolean)
        const dt = normalizarDataParcial(it.data)
        eventos.push({
          ...base,
          tipo,
          data_norm: dt.iso,
          data_precisao: dt.precisao,
          data_rotulo: it.data != null ? String(it.data) : null,
          rotulo,
          descricao: descPartes.join(' · ') || null,
          valor: num(it.valor),
          delta: num(it.delta),
          valor_resultante: num(it.valor_resultante)
        })
      }
    }
  }

  // dedup final por alvo + grava (substitui o estado da obra para os alvos tocados)
  const dedupPartes = dedupBy(partes, (p) => chaveEntidade(p.nome as string, p.cnpj as string | null))
  const dedupRts = dedupBy(rts, (r) => chaveEntidade(r.nome as string, r.art as string | null))
  const dedupClaus = dedupBy(clausulas, (c) =>
    `${c.numero ?? ''}|${c.titulo}`.toUpperCase().trim()
  )

  // Marcos contratuais SINTETIZADOS dos escalares resolvidos (determinístico,
  // limpo): assinatura, publicação, início (OS), términos. Substituem os eventos
  // de campo-livre desses tipos (que traziam nomes de signatários / carimbos).
  const SINT_TIPOS = new Set(['assinatura', 'publicacao', 'ordem_servico', 'termino_exec', 'termino_vig'])
  const marco = (
    chave: string,
    tipo: string,
    rotulo: string
  ): Record<string, unknown> | null => {
    const sc = escalares.get(chave)
    const dt = normalizarDataParcial(sc?.valor)
    if (!sc || !dt.iso) return null
    return {
      obra_id,
      doc_id: sc.doc_id,
      pagina: sc.pagina,
      confianca: 1,
      tipo,
      data_norm: dt.iso,
      data_precisao: dt.precisao,
      data_rotulo: String(sc.valor),
      rotulo,
      descricao: null,
      valor: null,
      delta: null,
      valor_resultante: null
    }
  }
  // Término de EXECUÇÃO considerando PARALISAÇÕES: o prazo congela na paralisação
  // e volta a contar no reinício. término = início + prazo_exec + Σ dias suspensos
  // (pares paralisação→reinício, em ordem). Cai p/ o término extraído se faltar dado.
  const inicioIso = dateOnly(escalares.get('contrato.inicio_exec')?.valor)
  const prazoExec = num(escalares.get('contrato.prazo_exec_dias')?.valor)
  const paralis = eventos
    .filter((e) => e.tipo === 'paralisacao' && e.data_norm)
    .map((e) => String(e.data_norm))
    .sort()
  const reinicios = eventos
    .filter((e) => e.tipo === 'reinicio' && e.data_norm)
    .map((e) => String(e.data_norm))
    .sort()
  let suspensaoDias = 0
  for (let i = 0; i < paralis.length; i++) {
    const fim = reinicios[i] // pareia i-ésima paralisação com i-ésimo reinício
    if (fim) suspensaoDias += Math.max(0, diasEntreIso(paralis[i], fim) ?? 0)
  }
  const terminoCalc =
    inicioIso && prazoExec != null ? addDiasIso(inicioIso, prazoExec + suspensaoDias) : null

  const marcoTerminoExec = ((): Record<string, unknown> | null => {
    if (terminoCalc) {
      const sc = escalares.get('contrato.inicio_exec')
      const sufixo = suspensaoDias > 0 ? ` (+${suspensaoDias}d de paralisação)` : ''
      return {
        obra_id,
        doc_id: sc?.doc_id ?? null,
        pagina: sc?.pagina ?? null,
        confianca: 1,
        tipo: 'termino_exec',
        data_norm: terminoCalc,
        data_precisao: 'dia',
        data_rotulo: terminoCalc,
        rotulo: `Término previsto da execução${sufixo}`,
        descricao: `Início ${inicioIso} + ${prazoExec} dias${suspensaoDias > 0 ? ` + ${suspensaoDias} dias suspensos` : ''}`,
        valor: null,
        delta: null,
        valor_resultante: null
      }
    }
    return marco('contrato.termino_exec', 'termino_exec', 'Término previsto da execução')
  })()

  const sintetizados = [
    marco('contrato.assinatura', 'assinatura', 'Assinatura do contrato'),
    marco('contrato.publicacao', 'publicacao', 'Publicação do extrato'),
    marco('contrato.inicio_exec', 'ordem_servico', 'Ordem de Serviço — início dos serviços'),
    marcoTerminoExec,
    marco('contrato.termino_vig', 'termino_vig', 'Término da vigência')
  ].filter((e): e is Record<string, unknown> => e != null)

  const eventosFinais = [...eventos.filter((e) => !SINT_TIPOS.has(String(e.tipo))), ...sintetizados]
  // Timeline: dedup com rótulo (preserva eventos distintos no mesmo dia).
  const eventosTimeline = dedupEventos(eventosFinais, true)

  if (alvosTocados.has('parte')) await substituir(admin, 'parte', obra_id, dedupPartes)
  if (alvosTocados.has('responsavel_tecnico')) await substituir(admin, 'responsavel_tecnico', obra_id, dedupRts)
  if (alvosTocados.has('clausula')) await substituir(admin, 'clausula', obra_id, dedupClaus)
  if (alvosTocados.has('evento') || sintetizados.length)
    await substituir(admin, 'evento', obra_id, eventosTimeline)

  // ─── Financeiro derivado (na linha contrato) — cadeia de apostilamentos ───
  // Dedup ESTRITO (sem rótulo) — evita dupla-contagem do mesmo apostilamento.
  if (contratoId) {
    const { data: ctr } = await admin.from('contrato').select('valor_p0').eq('id', contratoId).maybeSingle()
    const apost = dedupEventos(eventos.filter((e) => e.tipo === 'apostilamento'), false) as Array<{
      data_norm?: string | null
      delta?: number | null
      valor_resultante?: number | null
    }>
    const adit = dedupEventos(eventos.filter((e) => e.tipo === 'aditivo'), false) as Array<{ delta?: number | null }>
    const fin = derivarFinanceiro(apost, adit, num(ctr?.valor_p0))
    await admin
      .from('contrato')
      .update({
        valor_p0: fin.p0,
        valor_vigente: fin.vigente,
        pct_reajuste: fin.pctReajuste,
        pct_aditado: fin.pctAditado
      })
      .eq('id', contratoId)
    // mantém o campo_dossie do P0 coerente com a cadeia (proveniência preservada)
    if (fin.p0 != null) {
      await admin
        .from('campo_dossie')
        .update({ valor_json: fin.p0, derivado: true })
        .eq('obra_id', obra_id)
        .eq('caminho', 'contrato.valor_p0')
    }
  }

  // ─── Grafo radial (contrato no centro, hubs de grupo, entidades) ───────────
  await admin.from('aresta').delete().eq('obra_id', obra_id)
  await admin.from('no_grafo').delete().eq('obra_id', obra_id)
  if (contratoId) {
    const { data: ctr } = await admin.from('contrato').select('numero').eq('id', contratoId).maybeSingle()
    const [{ data: docs }, grupos] = await Promise.all([
      admin.from('documento').select('grupo_codigo, tipo_codigo').eq('obra_id', obra_id),
      carregarGrupos(admin, obra_id)
    ])
    const base = mapaGrupoBase(grupos)
    const nomeGrupo = new Map(grupos.map((g) => [g.codigo, g.nome]))

    // Conta documentos por grupo (cai p/ tipo_codigo quando sem grupo_codigo).
    const cont = new Map<string, number>()
    for (const d of (docs ?? []) as Array<{ grupo_codigo?: string; tipo_codigo?: string }>) {
      const g = d.grupo_codigo ?? d.tipo_codigo ?? '20'
      cont.set(g, (cont.get(g) ?? 0) + 1)
    }

    const nos: Array<Record<string, unknown>> = [
      { obra_id, no_id: 'contrato', tipo: 'contrato', label: normalizarTexto(ctr?.numero) ?? 'Contrato' }
    ]
    const arestas: Array<Record<string, unknown>> = []

    // Hubs de grupo (exceto o próprio contrato, base 03), com contagem.
    for (const [cod, peso] of [...cont.entries()].sort((a, b) => b[1] - a[1])) {
      const b = base[cod] ?? cod
      if (b === '03') continue
      const id = `grupo_${cod}`
      nos.push({
        obra_id,
        no_id: id,
        tipo: 'grupo',
        grupo_codigo: cod,
        peso,
        label: nomeGrupo.get(cod) ?? cod,
        sub: `${peso} doc${peso === 1 ? '' : 's'}`
      })
      arestas.push({ obra_id, de: id, para: 'contrato', rel: relParaBase(b) })
    }

    // Entidades: consorciadas e responsáveis técnicos (nomes), ligadas ao contrato.
    dedupPartes.forEach((p, i) => {
      const id = `parte_${i}`
      nos.push({ obra_id, no_id: id, tipo: 'empresa', label: p.nome, sub: p.papel })
      arestas.push({ obra_id, de: id, para: 'contrato', rel: String(p.papel) })
    })
    dedupRts.slice(0, 16).forEach((r, i) => {
      const id = `rt_${i}`
      nos.push({ obra_id, no_id: id, tipo: 'profissional', label: r.nome, sub: 'ART' })
      arestas.push({ obra_id, de: id, para: 'contrato', rel: 'responsavel_via_ART' })
    })
    await admin.from('no_grafo').insert(nos)
    if (arestas.length) await admin.from('aresta').insert(arestas)
  }

  return json({ ok: true, resolvidos: campos.length, conflitos })
})

function dedupBy<T extends Record<string, unknown>>(arr: T[], key: (x: T) => string): T[] {
  const map = new Map<string, T>()
  for (const x of arr) {
    const k = key(x)
    const cur = map.get(k)
    if (!cur || ((x.confianca as number) ?? 0) > ((cur.confianca as number) ?? 0)) map.set(k, x)
  }
  return Array.from(map.values())
}

async function substituir(
  admin: Admin,
  tabela: string,
  obra_id: string,
  linhas: Array<Record<string, unknown>>
): Promise<void> {
  await admin.from(tabela).delete().eq('obra_id', obra_id)
  if (linhas.length) await admin.from(tabela).insert(linhas)
}
