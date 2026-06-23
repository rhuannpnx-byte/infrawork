// POST /functions/v1/sugerir-agrupamento
// Body: { obra_id: string, instrucoes?: string, plano_atual?: GrupoSugerido[] }
// Resposta IMEDIATA: { job_id }. O app faz polling da tabela `agrupamento_job`
// até status != 'processando' e lê `resultado` (AgrupamentoResposta).
//
// Por quê assíncrono: a chamada ao LLM (Claude via OpenRouter) leva ~1-2min numa
// obra grande, acima do teto de ~150s do gateway de Edge Functions (504). Aqui
// criamos o job, devolvemos na hora e processamos em background via
// EdgeRuntime.waitUntil — eliminando a classe de erro 504.
//
// Otimizações de tokens (latência/custo): receitas trafegam com REF curto
// (r0..rN) em vez de UUID; o modelo devolve só GRUPOS (o servidor deriva os
// não-agrupados) e identifica serviço por código curto; effort 'low'.
//
// Restrito a 'god' por enquanto (rollout assistido). Chave OPENROUTER_API_KEY
// fica server-side (Deno.env).

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? ''
const OPENROUTER_MODEL = Deno.env.get('OPENROUTER_MODEL_AGRUPAMENTO') ?? 'anthropic/claude-opus-4-8'
const EFFORT = Deno.env.get('OPENROUTER_EFFORT_AGRUPAMENTO') ?? 'low'

const MAX_INSUMOS_POR_SERVICO = 30
const MAX_FEWSHOT = 60

// deno-lint-ignore no-explicit-any
type AnyClient = { from: (t: string) => any }

interface ItemRow {
  id: string
  parent_id: string | null
  tipo: 'etapa' | 'servico_grupo' | 'receita'
  codigo: string
  descricao: string
  unidade: string | null
  quantidade: number | null
}

interface ServicoCatalogo {
  servico_id: string
  codigo: string
  nome: string
  unidade: string | null
  cpus_vinculadas: number
  custo_unit_agregado: number | null
  modo: string
}

function sistemaPrompt(): string {
  return `Você é um engenheiro orçamentista sênior especialista em obras de infraestrutura rodoviária.
Sua tarefa é AGRUPAR receitas (itens cobrados do cliente) sob serviços de custo na Planilha Orçamentária.

LÓGICA DO AGRUPAMENTO:
- Um "serviço de custo" (ex.: CBUQ, TSD, base/sub-base com mistura) já é um agregador de CPUs e fornece o CUSTO.
- Cada grupo vincula UM serviço de custo a UMA OU MAIS receitas. A receita principal é a óbvia (mesmo nome do serviço).
- PORÉM, um serviço puxa também receitas PULVERIZADAS que pertencem a ele: transporte comercial/local de material betuminoso, transporte de massa asfáltica/mistura, CAP, transporte comercial/local de agregado, cimento/cal/filler, etc.
- O SINAL para inferir quais receitas pulverizadas um serviço puxa são os INSUMOS da composição da CPU do serviço (campo "insumos", principalmente o grupo MATERIAL). Se a CPU do CBUQ consome CAP e agregado, então as receitas de CAP e de transporte de agregado provavelmente pertencem ao grupo do CBUQ.

SEJA EXAUSTIVO (regra forte):
- Para CADA serviço do catálogo que claramente tem receitas correspondentes entre as soltas, CRIE o grupo — não pule serviços. Em obra rodoviária típica, espere grupos para: desmatamento, escavação/carga de solo (com seus transportes por distância — DMT), escavação/carga de jazida, estabilização/compactação de aterro, base, brita graduada, imprimação, reciclagem, TSD, CBUQ, sinalização, defensa, cerca, revestimento vegetal.
- Receitas que descrevem o MESMO serviço variando só por faixa de distância (DMT), categoria, ou etapa (ex.: "Escav., carga e transporte ... Dt 51 a 200M", "... 201 a 400M", ...) pertencem TODAS ao mesmo grupo do serviço-base. Não deixe nenhuma de fora.
- Antes de finalizar, confira: toda receita de transporte/fornecimento/material foi avaliada para o serviço que a consome?

DESEMPATE:
- Material/transporte (CAP, emulsão, agregado, cascalho, filler, pintura de ligação) pertence ao serviço cuja CPU CONSOME esse insumo (use o campo "insumos"). Ex.: "Fornecimento de emulsão"/"Pintura de ligação" → o serviço asfáltico que a consome (CBUQ/Imprimação conforme o insumo da CPU); "Fornecimento/transporte de material de jazida (cascalho)" → o serviço de base/estabilização que consome cascalho, não necessariamente o de "escavação de jazida".
- Se houver dois serviços de nome quase idêntico no catálogo (ex.: "Imprimacao" cód 02 e "Imprimação" cód 10), escolha pelo contexto da etapa da receita; na dúvida, use o de código menor e registre aviso.

ANÁLISE CRÍTICA (obrigatória):
- Insumos como TRANSPORTE DE AGREGADO costumam ser COMPARTILHADOS entre vários serviços (CBUQ, TSD, base, sub-base com mistura). NÃO duplique a mesma receita em vários grupos.
- Quando uma receita auxiliar puder pertencer a mais de um serviço, escolha o mais provável, atribua confiança menor e registre um item em "alertas_compartilhamento" listando os serviços concorrentes e o motivo da dúvida — isso será revisado por um humano.
- Respeite a etapa/EAP de origem como pista: prefira agrupar receitas da mesma etapa, mas não é regra absoluta.

REGRAS:
- Use APENAS \`servico_codigo\` que existam no catálogo fornecido e APENAS \`ref\` de receitas da lista de receitas soltas. Nunca invente códigos nem refs.
- O que NÃO casar com nenhuma lógica clara, simplesmente NÃO inclua — é melhor deixar de fora do que agrupar errado.
- qtd_ref_modo: use "heranca" quando a quantidade do grupo deve vir da receita principal; "soma_filhos" quando somar as receitas faz sentido; "manual" só quando precisar de um valor específico (então preencha qtd_ref_sugerida).
- confianca: 0..1, honesta. Baixa quando há ambiguidade ou compartilhamento.
- Aprenda com os EXEMPLOS confirmados (few-shot) fornecidos: eles refletem o critério já validado pela equipe desta empresa.
- Se vier "instrucoes" do usuário e/ou "plano_atual", AJUSTE o plano conforme as instruções em vez de recomeçar do zero.

CONVERSA (o operador está num chat com você):
- Quando vier "historico_chat", trate como a conversa até agora — RESPEITE pedidos anteriores ao aplicar a instrução atual (ex.: se ele já pediu "não agrupe sinalização", mantenha fora).
- Devolva "resposta_agente": UMA frase curta (≤ 160 caracteres), em PT-BR, dizendo o que você fez NESTE ajuste (ex.: "Movi o transporte de agregado para a Base e tirei a sinalização do CBUQ."). Na proposta inicial, resuma o que agrupou. Fale como um colega orçamentista, direto.

SAÍDA (CRÍTICO — o gargalo é o TAMANHO da resposta; seja enxuto):
- NÃO devolva "nao_agrupados". O servidor deriva automaticamente toda receita que você NÃO incluir em nenhum grupo.
- Em "receitas", devolva APENAS {ref, papel} — use o \`ref\` curto da lista (ex.: "r12"), nunca uuid.
- Identifique o serviço por "servico_codigo" (código curto do catálogo, ex.: "04").
- "justificativa" ≤ 100 caracteres. "observacao" dos alertas ≤ 100 caracteres.

Responda SOMENTE com um objeto JSON (sem texto fora do JSON, sem cercas de código), com as chaves:
grupos (array de {descricao, servico_codigo, confianca, justificativa, receitas:[{ref,papel}], qtd_ref_modo, qtd_ref_sugerida, alertas_compartilhamento:[{receita_ref,servicos_concorrentes,observacao}]}),
resposta_agente (string curta — ver CONVERSA),
avisos (array de string, opcional).
papel ∈ principal|transporte|material|mao_obra|outro. qtd_ref_modo ∈ manual|heranca|soma_filhos.`
}

function extrairJson(texto: string): unknown {
  const t = texto.trim()
  const semCerca = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  try {
    return JSON.parse(semCerca)
  } catch {
    const ini = semCerca.indexOf('{')
    const fim = semCerca.lastIndexOf('}')
    if (ini >= 0 && fim > ini) return JSON.parse(semCerca.slice(ini, fim + 1))
    throw new Error('Resposta do modelo não é JSON válido')
  }
}

async function chamarOpenRouter(messages: Array<{ role: string; content: string }>): Promise<string> {
  const body = {
    model: OPENROUTER_MODEL,
    messages,
    reasoning: { effort: EFFORT },
    max_tokens: 16000,
    response_format: { type: 'json_object' }
  }
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Title': 'InfraWork Agente de Agrupamento'
    },
    body: JSON.stringify(body)
  })
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '')
    throw new Error(`OpenRouter ${resp.status}: ${txt.slice(0, 400)}`)
  }
  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('OpenRouter devolveu resposta vazia')
  return content
}

// ─── Processamento em background (grava no job) ────────────────────────────
async function processarJob(
  admin: AnyClient,
  jobId: string,
  obraId: string,
  body: { instrucoes?: string; plano_atual?: unknown; historico_chat?: unknown }
): Promise<void> {
  const t0 = Date.now()
  try {
    // 1. Itens → receitas soltas (com REF curto)
    const { data: itensRaw, error: errItens } = await admin
      .from('item_orcamentario')
      .select('id, parent_id, tipo, codigo, descricao, unidade, quantidade')
      .eq('obra_id', obraId)
    if (errItens) throw new Error(errItens.message)
    const itens = (itensRaw ?? []) as ItemRow[]
    const tipoById = new Map(itens.map((i) => [i.id, i.tipo]))
    const descById = new Map(itens.map((i) => [i.id, i.descricao]))

    const refToReceita = new Map<string, ItemRow>()
    const idToRef = new Map<string, string>()
    const receitasSoltasModel: Array<Record<string, unknown>> = []
    let idx = 0
    for (const i of itens) {
      if (i.tipo !== 'receita') continue
      if (i.parent_id && tipoById.get(i.parent_id) === 'servico_grupo') continue // já agrupada
      const ref = `r${idx++}`
      refToReceita.set(ref, i)
      idToRef.set(i.id, ref)
      receitasSoltasModel.push({
        ref,
        codigo: i.codigo,
        descricao: i.descricao,
        unidade: i.unidade,
        quantidade: i.quantidade,
        etapa: i.parent_id ? (descById.get(i.parent_id) ?? null) : null
      })
    }

    if (receitasSoltasModel.length === 0) {
      await admin
        .from('agrupamento_job')
        .update({
          status: 'concluido',
          resultado: { grupos: [], nao_agrupados: [], avisos: ['Nenhuma receita solta para agrupar.'] },
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId)
      return
    }

    // 2. Catálogo de serviços-folha
    const { data: catRaw, error: errCat } = await admin
      .from('vw_servico_custo_agregado')
      .select('servico_id, codigo, nome, unidade, cpus_vinculadas, custo_unit_agregado, modo')
      .eq('obra_id', obraId)
    if (errCat) throw new Error(errCat.message)
    const servicosFolha = ((catRaw ?? []) as ServicoCatalogo[]).filter((s) => s.unidade !== null)
    const servicoIds = new Set(servicosFolha.map((s) => s.servico_id))

    // 3. Insumos da CPU de cada serviço (sinal de inferência)
    const { data: cpusVig } = await admin
      .from('cpu')
      .select('id, servico_id')
      .eq('obra_id', obraId)
      .eq('is_vigente', true)
    const cpuDoServico = new Map<string, string>()
    for (const c of (cpusVig ?? []) as Array<{ id: string; servico_id: string | null }>) {
      if (c.servico_id) cpuDoServico.set(c.servico_id, c.id)
    }
    const { data: links } = await admin.from('servico_cpu_link').select('servico_id, cpu_id')
    const linksDoServico = new Map<string, string[]>()
    for (const l of (links ?? []) as Array<{ servico_id: string; cpu_id: string }>) {
      if (!servicoIds.has(l.servico_id)) continue
      const arr = linksDoServico.get(l.servico_id) ?? []
      arr.push(l.cpu_id)
      linksDoServico.set(l.servico_id, arr)
    }
    const cpuServicoPairs: Array<{ servico_id: string; cpu_id: string }> = []
    for (const s of servicosFolha) {
      const proprio = cpuDoServico.get(s.servico_id)
      if (proprio) cpuServicoPairs.push({ servico_id: s.servico_id, cpu_id: proprio })
      for (const cid of linksDoServico.get(s.servico_id) ?? [])
        cpuServicoPairs.push({ servico_id: s.servico_id, cpu_id: cid })
    }
    const cpuIds = Array.from(new Set(cpuServicoPairs.map((p) => p.cpu_id)))
    const insumosPorCpu = new Map<string, Array<{ grupo: string; nome: string }>>()
    if (cpuIds.length > 0) {
      const { data: cpuItens } = await admin
        .from('cpu_item')
        .select('cpu_id, grupo, recurso:recurso_id(nome)')
        .in('cpu_id', cpuIds)
      for (const it of (cpuItens ?? []) as Array<{
        cpu_id: string
        grupo: string
        recurso?: { nome?: string } | null
      }>) {
        const nome = it.recurso?.nome
        if (!nome) continue
        const arr = insumosPorCpu.get(it.cpu_id) ?? []
        arr.push({ grupo: it.grupo, nome })
        insumosPorCpu.set(it.cpu_id, arr)
      }
    }
    const insumosPorServico = new Map<string, Record<string, string[]>>()
    for (const pair of cpuServicoPairs) {
      const rec = insumosPorServico.get(pair.servico_id) ?? {}
      for (const ins of insumosPorCpu.get(pair.cpu_id) ?? []) {
        const lista = rec[ins.grupo] ?? []
        if (!lista.includes(ins.nome)) lista.push(ins.nome)
        rec[ins.grupo] = lista
      }
      insumosPorServico.set(pair.servico_id, rec)
    }
    const catalogo = servicosFolha.map((s) => {
      const insumos = insumosPorServico.get(s.servico_id) ?? {}
      const ordemGrupos = ['MATERIAL', 'COMBUSTIVEL', 'EQUIPAMENTO', 'MO']
      const compact: Record<string, string[]> = {}
      let count = 0
      for (const g of ordemGrupos) {
        const lista = insumos[g]
        if (!lista || lista.length === 0) continue
        const restante = MAX_INSUMOS_POR_SERVICO - count
        if (restante <= 0) break
        compact[g] = lista.slice(0, restante)
        count += compact[g].length
      }
      return {
        codigo: s.codigo,
        nome: s.nome,
        unidade: s.unidade,
        custo_unit: s.custo_unit_agregado,
        insumos: compact
      }
    })

    // 4. Few-shot empresa-wide
    const { data: obraRow } = await admin
      .from('obras')
      .select('empresa_id')
      .eq('id', obraId)
      .maybeSingle()
    const empresaId = (obraRow as { empresa_id?: string } | null)?.empresa_id ?? null
    let fewshot: Array<Record<string, unknown>> = []
    if (empresaId) {
      const { data: fb } = await admin
        .from('agrupamento_feedback')
        .select('receita_descricao, servico_codigo, servico_nome, contexto')
        .eq('empresa_id', empresaId)
        .in('acao', ['aceito', 'corrigido', 'movido'])
        .order('created_at', { ascending: false })
        .limit(MAX_FEWSHOT)
      fewshot = ((fb ?? []) as Array<Record<string, unknown>>).map((f) => ({
        receita: f.receita_descricao,
        servico: `${f.servico_codigo ?? ''} ${f.servico_nome ?? ''}`.trim(),
        papel: (f.contexto as { papel?: string } | null)?.papel ?? null
      }))
    }

    // plano_atual (refino): remapeia ids reais → refs para o modelo
    let planoAtualModel: unknown = null
    if (Array.isArray(body.plano_atual)) {
      planoAtualModel = (body.plano_atual as Array<Record<string, unknown>>).map((g) => ({
        descricao: g.descricao,
        servico_codigo: g.servico_codigo,
        receitas: ((g.receitas as Array<Record<string, unknown>>) ?? [])
          .map((r) => ({ ref: idToRef.get(String(r.id)), papel: r.papel }))
          .filter((r) => r.ref),
        qtd_ref_modo: g.qtd_ref_modo
      }))
    }

    // historico_chat (memória da conversa): mantém só {role, texto}, capado.
    let historicoModel: Array<{ role: string; texto: string }> | null = null
    if (Array.isArray(body.historico_chat)) {
      historicoModel = (body.historico_chat as Array<Record<string, unknown>>)
        .map((m) => ({
          role: m.role === 'agente' ? 'agente' : 'user',
          texto: String(m.texto ?? '').slice(0, 500)
        }))
        .filter((m) => m.texto)
        .slice(-12)
    }

    const contexto = {
      receitas_soltas: receitasSoltasModel,
      catalogo_servicos: catalogo,
      exemplos_confirmados: fewshot,
      historico_chat: historicoModel,
      instrucoes_usuario: typeof body.instrucoes === 'string' ? body.instrucoes : null,
      plano_atual: planoAtualModel
    }

    const raw = await chamarOpenRouter([
      { role: 'system', content: sistemaPrompt() },
      {
        role: 'user',
        content:
          'Contexto da obra (JSON). Gere a proposta de agrupamento no formato especificado.\n\n' +
          JSON.stringify(contexto)
      }
    ])

    const parsed = extrairJson(raw) as {
      grupos?: Array<Record<string, unknown>>
      avisos?: string[]
      resposta_agente?: string
    }

    // 5. Validação + enriquecimento (ref → receita real)
    const servicoByCodigo = new Map(servicosFolha.map((s) => [s.codigo, s]))
    const PAPEIS = ['principal', 'transporte', 'material', 'mao_obra', 'outro']
    const resolveReceita = (ref: unknown): ItemRow | null => refToReceita.get(String(ref)) ?? null

    const gruposValidados = ((parsed.grupos ?? []) as Array<Record<string, unknown>>)
      .map((g) => {
        const serv = servicoByCodigo.get(String(g.servico_codigo ?? ''))
        if (!serv) return null
        const receitas = ((g.receitas as Array<Record<string, unknown>>) ?? [])
          .map((r) => {
            const base = resolveReceita(r.ref)
            if (!base) return null
            const papel = PAPEIS.includes(String(r.papel)) ? String(r.papel) : 'outro'
            return { id: base.id, codigo: base.codigo, descricao: base.descricao, papel }
          })
          .filter(Boolean)
        if (receitas.length === 0) return null
        const alertas = ((g.alertas_compartilhamento as Array<Record<string, unknown>>) ?? [])
          .map((a) => {
            const base = resolveReceita(a.receita_ref)
            if (!base) return null
            return {
              receita_id: base.id,
              servicos_concorrentes: Array.isArray(a.servicos_concorrentes)
                ? a.servicos_concorrentes
                : [],
              observacao: String(a.observacao ?? '')
            }
          })
          .filter(Boolean)
        return {
          descricao: String(g.descricao ?? serv.nome),
          servico_id: serv.servico_id,
          servico_codigo: serv.codigo,
          servico_nome: serv.nome,
          servico_unidade: serv.unidade,
          confianca: typeof g.confianca === 'number' ? g.confianca : null,
          justificativa: String(g.justificativa ?? ''),
          receitas,
          qtd_ref_modo: ['manual', 'heranca', 'soma_filhos'].includes(String(g.qtd_ref_modo))
            ? g.qtd_ref_modo
            : 'soma_filhos',
          qtd_ref_sugerida: typeof g.qtd_ref_sugerida === 'number' ? g.qtd_ref_sugerida : null,
          alertas_compartilhamento: alertas
        }
      })
      .filter(Boolean) as Array<{ receitas: Array<{ id: string }> }>

    // nao_agrupados = toda receita solta que não entrou em nenhum grupo
    const agrupadasIds = new Set<string>()
    for (const g of gruposValidados) for (const r of g.receitas) agrupadasIds.add(r.id)
    const naoAgrupados = receitasSoltasModel
      .filter((r) => !agrupadasIds.has(refToReceita.get(String(r.ref))!.id))
      .map((r) => {
        const base = refToReceita.get(String(r.ref))!
        return {
          receita_id: base.id,
          codigo: base.codigo,
          descricao: base.descricao,
          motivo: 'Não classificada pelo agente.'
        }
      })

    const resultado = {
      grupos: gruposValidados,
      nao_agrupados: naoAgrupados,
      avisos: parsed.avisos ?? [],
      resposta_agente:
        typeof parsed.resposta_agente === 'string' && parsed.resposta_agente.trim()
          ? parsed.resposta_agente.trim()
          : `${gruposValidados.length} grupo(s) proposto(s), ${naoAgrupados.length} receita(s) sem grupo.`,
      _meta: {
        modelo: OPENROUTER_MODEL,
        receitas_soltas: receitasSoltasModel.length,
        servicos_catalogo: catalogo.length,
        exemplos_fewshot: fewshot.length,
        duracao_ms: Date.now() - t0
      }
    }

    await admin
      .from('agrupamento_job')
      .update({ status: 'concluido', resultado, updated_at: new Date().toISOString() })
      .eq('id', jobId)
  } catch (e) {
    await admin
      .from('agrupamento_job')
      .update({
        status: 'erro',
        erro: e instanceof Error ? e.message : 'Falha ao gerar proposta',
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId)
  }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  if (!OPENROUTER_API_KEY) return json({ error: 'OPENROUTER_API_KEY não configurada' }, 500)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { caller, admin } = ctx
  // Restrito a 'god' por enquanto (feature em rollout assistido).
  const roleErr = assertRole(caller, ['god'])
  if (roleErr) return roleErr

  let body: {
    obra_id?: string
    instrucoes?: string
    plano_atual?: unknown
    historico_chat?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const obra_id = body.obra_id?.trim()
  if (!obra_id) return json({ error: 'obra_id é obrigatório' }, 400)

  const acc = await assertObraAccess(ctx, obra_id, { write: true })
  if (acc) return acc

  const db = admin as unknown as AnyClient
  const { data: job, error: errJob } = await db
    .from('agrupamento_job')
    .insert({
      obra_id,
      status: 'processando',
      params: {
        instrucoes: typeof body.instrucoes === 'string' ? body.instrucoes : null,
        plano_atual: body.plano_atual ?? null,
        historico_chat: Array.isArray(body.historico_chat) ? body.historico_chat : null
      },
      created_by: caller.id
    })
    .select('id')
    .single()
  if (errJob || !job) return json({ error: errJob?.message ?? 'Falha ao criar job' }, 400)

  // Processa em background — a resposta já volta com o job_id.
  EdgeRuntime.waitUntil(
    processarJob(db, job.id as string, obra_id, {
      instrucoes: body.instrucoes,
      plano_atual: body.plano_atual,
      historico_chat: body.historico_chat
    })
  )

  return json({ job_id: job.id }, 202)
})
