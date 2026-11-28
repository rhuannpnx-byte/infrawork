// Traz uma obra do InfraWork desktop para o web, no stack LOCAL: lê o banco do desktop (só leitura, pela CLI do
// Supabase a partir da raiz do repositório) e grava como o usuário faria — as tabelas que são iguais nos dois
// sistemas (recursos, preços, composições, serviços) são copiadas; o orçamento entra por `importar_orcamento`
// (no web o agrupador fica fora da planilha de venda, ligado às receitas por alocação); o cronograma é montado,
// calculado pelo motor do web e promovido a linha de base. Se a empresa de destino tem o SIGA conectado, liga a
// obra ao projeto e leva os de-para do desktop.
//
// Vem só o plano que é a linha de base no desktop. Não vêm: revisões antigas, produção e fotos (vêm do SIGA),
// alertas e documentos.
//
//   VITE_SUPABASE_URL=http://127.0.0.1:56421 VITE_SUPABASE_ANON_KEY=<anon> E2E_PASSWORD=... \
//     npx vite-node scripts/importar-do-desktop.mjs -- --obra 6.508 --empresa <id da empresa no web> \
//       [--local "T1 km 108 a 111=BR-452"] [--fora-do-orcamento 361] [--orcamento-pelo-plano] [--recriar]
//
// Depois de conferida no local, a obra pronta vai para produção por scripts/transferir-obra.py.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { supabase as sb } from '../src/lib/supabase/client'
import { carregarPlanoEntrada } from '../src/features/cronograma/dados'
import { calcularPlano, payloadGravacao } from '../src/features/cronograma/motor/calculo'

const URL = process.env.VITE_SUPABASE_URL ?? ''
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const EMAIL = process.env.E2E_EMAIL ?? 'god@infrawork.local'
const PASSWORD = process.env.E2E_PASSWORD
if (!ANON || !PASSWORD) throw new Error('VITE_SUPABASE_ANON_KEY e E2E_PASSWORD são obrigatórios')
if (!/127\.0\.0\.1|localhost/.test(URL)) throw new Error(`só contra o stack local (VITE_SUPABASE_URL=${URL})`)
if (!sb) throw new Error('cliente do Supabase não configurado')

const args = process.argv.slice(2)
const arg = (nome) => {
  const i = args.indexOf(`--${nome}`)
  return i >= 0 ? args[i + 1] : undefined
}
const argsDe = (nome) => args.flatMap((a, i) => (a === `--${nome}` && args[i + 1] ? [args[i + 1]] : []))
const CODIGO = arg('obra')
const EMPRESA = arg('empresa')
if (!CODIGO || !EMPRESA) throw new Error('uso: --obra <código no desktop> --empresa <id da empresa no web>')
// trechos do SIGA que não têm o mesmo nome do local: "nome no SIGA=nome do local"
const LOCAIS_EXTRA = new Map(argsDe('local').map((s) => s.split('=').map((x) => x.trim())))
// serviços do SIGA que ficam fora do orçamento de propósito (não viram pendência)
const FORA = new Set(argsDe('fora-do-orcamento').map(Number))

const RAIZ = resolve(import.meta.dirname, '..', '..')
const MODELO = new Uint8Array(
  readFileSync(new globalThis.URL('../src/features/cronograma/motor/modelo/default.dr5', import.meta.url))
)
const avisos = []
const aviso = (m) => {
  avisos.push(m)
  console.log('  ! ' + m)
}

// ── leitura do desktop ───────────────────────────────────────────────────────────────────────────────────────
function lerDesktop(sql) {
  const arq = join(mkdtempSync(join(tmpdir(), 'iw-desktop-')), 'consulta.sql')
  writeFileSync(arq, sql, 'utf8')
  const saida = execFileSync(
    'npx',
    ['-y', 'supabase@3.0.0', 'db', 'query', '--remote', '--read-only', '--workdir', '.', '-f', `"${arq}"`],
    { cwd: RAIZ, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, shell: true }
  )
  const json = JSON.parse(saida.slice(saida.indexOf('{'), saida.lastIndexOf('}') + 1))
  if (!json.rows) throw new Error('leitura do desktop falhou: ' + JSON.stringify(json).slice(0, 500))
  return json.rows
}
const lista = (tabela, onde) =>
  `(select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.${tabela} x where ${onde})`
const cod = CODIGO.replace(/'/g, "''")
const [{ doc }] = lerDesktop(`
with o as (select id from public.obras where codigo = '${cod}' limit 1),
     lb as (select p.id from public.planejamento p, o where p.obra_id = o.id and p.is_baseline order by p.updated_at desc limit 1)
select jsonb_build_object(
  'obra', (select to_jsonb(x) from public.obras x, o where x.id = o.id),
  'recursos', ${lista('recurso', 'x.obra_id = (select id from o)')},
  'precos', ${lista('recurso_preco', 'x.recurso_id in (select id from public.recurso where obra_id = (select id from o))')},
  'cpus', ${lista('cpu', 'x.obra_id = (select id from o)')},
  'cpu_itens', ${lista('cpu_item', 'x.cpu_id in (select id from public.cpu where obra_id = (select id from o))')},
  'servicos', ${lista('servico', 'x.obra_id = (select id from o)')},
  'links', ${lista('servico_cpu_link', 'x.servico_id in (select id from public.servico where obra_id = (select id from o))')},
  'itens', ${lista('item_orcamentario', 'x.obra_id = (select id from o)')},
  'indiretos', ${lista('indireto_item', 'x.obra_id = (select id from o)')},
  'equipes', ${lista('equipe', 'x.obra_id = (select id from o)')},
  'trechos', ${lista('obra_trecho', 'x.obra_id = (select id from o)')},
  'calendario', (select to_jsonb(x) from public.obra_calendario x, o where x.obra_id = o.id),
  'excecoes', ${lista('obra_calendario_excecao', 'x.obra_id = (select id from o)')},
  'plano', (select to_jsonb(x) from public.planejamento x, lb where x.id = lb.id),
  'tarefas', ${lista('planejamento_tarefa', 'x.planejamento_id = (select id from lb)')},
  'tarefa_equipes', ${lista('planejamento_tarefa_equipe', 'x.tarefa_id in (select id from public.planejamento_tarefa where planejamento_id = (select id from lb))')},
  'tarefa_indiretos', ${lista('planejamento_tarefa_indireto', 'x.tarefa_id in (select id from public.planejamento_tarefa where planejamento_id = (select id from lb))')},
  'regimes', ${lista('encargos_sociais_regime', 'x.obra_id = (select id from o)')},
  'vinculo', (select to_jsonb(x) from public.obra_acompanhamento_link x, o where x.obra_id = o.id and x.ativo),
  'match_servico', ${lista('acompanhamento_servico_match', 'x.obra_id = (select id from o)')},
  'match_equipe', ${lista('acompanhamento_equipe_match', 'x.obra_id = (select id from o)')}
) as doc`)
if (!doc.obra) throw new Error(`obra ${CODIGO} não encontrada no desktop`)
console.log(
  `desktop: ${doc.obra.codigo} ${doc.obra.nome} — ${doc.recursos.length} recursos, ${doc.cpus.length} composições, ` +
    `${doc.itens.length} itens de orçamento, ${doc.equipes.length} equipes, ${doc.tarefas.length} nós do plano`
)

// ── sessão no web local ──────────────────────────────────────────────────────────────────────────────────────
const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
if (authErr) throw authErr
const token = auth.session.access_token
async function fn(name, body) {
  const r = await fetch(`${URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${name} ${r.status}: ${text.slice(0, 400)}`)
  return JSON.parse(text)
}
async function rpc(name, a) {
  const { data, error } = await sb.rpc(name, a)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}
async function q(tabela, build) {
  const { data, error } = await build(sb.from(tabela))
  if (error) throw new Error(`${tabela}: ${error.message}`)
  return data
}
async function inserir(tabela, linhas) {
  for (let i = 0; i < linhas.length; i += 200)
    await q(tabela, (t) => t.insert(linhas.slice(i, i + 200)).select('id'))
}
/** A linha do desktop pronta para o web: sem quem criou (os usuários são outros) e na obra nova. */
const limpar = (linha, extra = {}) => {
  const out = {}
  for (const [k, v] of Object.entries(linha)) if (!/(_por|_by)$/.test(k)) out[k] = v
  return { ...out, ...extra }
}
const chave = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()

const ja = await q('obras', (t) => t.select('id').eq('empresa_id', EMPRESA).eq('codigo', doc.obra.codigo))
if (ja.length > 0) {
  if (!args.includes('--recriar'))
    throw new Error(`a obra ${doc.obra.codigo} já existe nesta empresa (${ja[0].id}): use --recriar para apagar e carregar de novo`)
  await fn('delete-obra', { obra_id: ja[0].id })
  console.log('obra anterior apagada', ja[0].id)
}

// ── obra ─────────────────────────────────────────────────────────────────────────────────────────────────────
const criada = await fn('create-obra', {
  nome: doc.obra.nome,
  codigo: doc.obra.codigo,
  status: doc.obra.status,
  empresa_id: EMPRESA
})
const obraId = criada.id ?? criada.obra?.id
if (!obraId) throw new Error('create-obra não devolveu o id: ' + JSON.stringify(criada).slice(0, 200))
console.log('obra criada', obraId)
const naObra = (linha, extra = {}) => limpar(linha, { obra_id: obraId, ...extra })

// ── taxas (o regime da obra; a tarefa do indireto aponta para ele) ───────────────────────────────────────────
if (doc.regimes.length > 0) await inserir('encargos_sociais_regime', doc.regimes.map((r) => naObra(r)))

// ── recursos, preços, composições e serviços (tabelas iguais nos dois sistemas) ──────────────────────────────
await inserir('recurso', doc.recursos.map((r) => naObra(r)))
await inserir('recurso_preco', doc.precos.map((p) => limpar(p)))
await inserir('servico', doc.servicos.map((s) => naObra(s)))
await inserir('cpu', doc.cpus.map((c) => naObra(c)))
await inserir('cpu_item', doc.cpu_itens.map((c) => limpar(c)))
await inserir('servico_cpu_link', doc.links.map((l) => limpar(l)))
console.log(`recursos ${doc.recursos.length}, composições ${doc.cpus.length} (${doc.cpu_itens.length} insumos), serviços ${doc.servicos.length}`)

// ── orçamento: a árvore do desktop (receita dentro do agrupador) vira planilha de venda + alocações ──────────
const porId = new Map(doc.itens.map((i) => [i.id, i]))
const grupos = doc.itens.filter((i) => i.tipo === 'servico_grupo')
const nomesGrupo = new Map()
for (const g of grupos) {
  if (nomesGrupo.has(chave(g.descricao))) throw new Error(`dois agrupadores com o nome "${g.descricao}"`)
  nomesGrupo.set(chave(g.descricao), g)
}
const itens = []
const alocacoes = []
let row = 2
for (const i of [...doc.itens].sort((a, b) => a.codigo.localeCompare(b.codigo))) {
  if (i.tipo === 'etapa') itens.push({ row: row++, codigo: i.codigo, descricao: i.descricao })
  if (i.tipo !== 'receita') continue
  if (!(Number(i.quantidade) > 0)) {
    aviso(`receita ${i.codigo} "${i.descricao}" tem quantidade zero e ficou de fora`)
    continue
  }
  const r = row++
  itens.push({
    row: r,
    codigo: i.codigo,
    descricao: i.descricao,
    unidade: i.unidade ?? 'un',
    quantidade: Number(i.quantidade),
    venda_unitaria: Number(i.venda_unitaria ?? 0)
  })
  const g = porId.get(i.parent_id)
  if (g?.tipo === 'servico_grupo')
    alocacoes.push({
      row: r,
      codigo: i.codigo,
      criterio: 'percentual',
      compoe: (g.qtd_ref_filhos ?? []).includes(i.id),
      destinos: [{ servico: g.descricao, valor: 100 }]
    })
}
const manuais = grupos
  .filter((g) => g.qtd_ref_modo === 'manual' || g.indireto_id)
  .map((g) => ({
    servico: g.descricao,
    quantidade: Number(g.quantidade_referencia) || 1,
    unidade: g.unidade_referencia || 'un'
  }))
const imp = await fn('import-orcamento', {
  obra_id: obraId,
  itens,
  alocacoes,
  servicos: manuais,
  opcoes: { existentes: 'atualizar' }
})
if (!imp.ok) throw new Error('orçamento: ' + JSON.stringify(imp.erros).slice(0, 600))
console.log('orçamento', JSON.stringify(imp.stats))

const itensWeb = await q('item_orcamentario', (t) =>
  t.select('id, codigo, descricao, tipo, parent_id').eq('obra_id', obraId)
)
const etapaWeb = new Map(itensWeb.filter((i) => i.tipo === 'etapa').map((i) => [i.codigo, i.id]))
const grupoWeb = new Map(itensWeb.filter((i) => i.tipo === 'servico_grupo').map((i) => [chave(i.descricao), i.id]))
/** id do agrupador do desktop → id do agrupador no web */
const grupoDoDesktop = new Map(grupos.map((g) => [g.id, grupoWeb.get(chave(g.descricao))]))

// indireto: o item e o agrupador que o representa
await inserir('indireto_item', doc.indiretos.map((x) => naObra(x)))
for (const g of grupos) {
  const id = grupoDoDesktop.get(g.id)
  if (!id) {
    aviso(`agrupador "${g.descricao}" não tem receita e não foi criado`)
    continue
  }
  const mudar = g.indireto_id ? { indireto_id: g.indireto_id } : g.servico_id ? { servico_id: g.servico_id } : null
  if (!mudar) {
    aviso(`agrupador "${g.descricao}" está sem composição no desktop`)
    continue
  }
  await q('item_orcamentario', (t) => t.update(mudar).eq('id', id).select('id'))
}
// a receita cujo prefixo de código não é uma etapa fica na etapa em que o agrupador dela estava
for (const i of doc.itens.filter((x) => x.tipo === 'receita')) {
  const web = itensWeb.find((w) => w.tipo === 'receita' && w.codigo === i.codigo)
  if (!web || web.parent_id) continue
  const etapa = etapaWeb.get(porId.get(porId.get(i.parent_id)?.parent_id)?.codigo)
  if (!etapa) continue
  try {
    await q('item_orcamentario', (t) => t.update({ parent_id: etapa }).eq('id', web.id).select('id'))
  } catch (e) {
    aviso(`receita ${i.codigo} ficou na raiz da planilha (${e.message})`)
  }
}
await rpc('recalcular_orcamento', { _obra_id: obraId })

// ── equipes e locais ─────────────────────────────────────────────────────────────────────────────────────────
const equipes = doc.equipes.filter((e) => !e.is_sistema)
await inserir('equipe', equipes.map((e, k) => naObra(e, { ordem: k })))
const trechos = doc.trechos.filter((t) => !t.is_sistema)
await inserir(
  'obra_trecho',
  trechos.map((t) => {
    const { is_sistema: _s, ...resto } = naObra(t)
    const comprimento = Number(t.geometry_comprimento_m) || null
    return { ...resto, tipo: comprimento ? 'eixo' : 'area', comprimento_m: comprimento }
  })
)
const trechoWeb = new Map(trechos.map((t) => [t.id, t]))
console.log(`equipes ${equipes.length}, locais ${trechos.map((t) => t.nome).join(', ')}`)

// ── calendário: os dias úteis do desktop (bit 0 = segunda) e os feriados ─────────────────────────────────────
const [cal] = await q('calendario', (t) => t.select('id, semana').eq('obra_id', obraId).eq('padrao', true))
const bits = Number(doc.calendario?.dias_uteis_bitmask ?? 31)
await q('calendario', (t) =>
  t
    .update({ semana: cal.semana.map((d, k) => ({ inicio: d.inicio ?? '07:00', horas: (bits >> k) & 1 ? 8 : 0 })) })
    .eq('id', cal.id)
    .select('id')
)
const feriados = doc.excecoes.filter((e) => !e.eh_util)
for (const e of doc.excecoes.filter((x) => x.eh_util)) aviso(`dia útil excepcional ${e.data} (${e.motivo}) não foi levado`)
if (feriados.length > 0)
  await q('calendario_definicao', (t) =>
    t
      .insert(
        feriados.map((e, k) => ({
          calendario_id: cal.id,
          tipo: 'feriado',
          nome: e.motivo ?? 'Feriado',
          data_inicio: e.data,
          data_fim: e.data,
          todo_ano: false,
          ordem: k + 1
        }))
      )
      .select('id')
  )
console.log(`calendário: ${cal.semana.filter((_d, k) => (bits >> k) & 1).length} dias por semana, ${feriados.length} feriados`)

// ── plano (a linha de base do desktop) ───────────────────────────────────────────────────────────────────────
let planoId = null
if (doc.plano) {
  const [plano] = await q('planejamento', (t) =>
    t
      .insert({
        id: doc.plano.id,
        obra_id: obraId,
        nome: doc.plano.nome,
        descricao: doc.plano.descricao,
        data_referencia_inicio: doc.plano.data_referencia_inicio,
        prazo: doc.obra.data_fim_planejada
      })
      .select()
  )
  planoId = plano.id
  const equipesDaTarefa = new Map()
  for (const te of doc.tarefa_equipes) {
    if (!equipes.some((e) => e.id === te.equipe_id)) continue
    equipesDaTarefa.set(te.tarefa_id, [...(equipesDaTarefa.get(te.tarefa_id) ?? []), te])
  }
  // --orcamento-pelo-plano: onde o plano programa mais do que o orçamento tem, a quantidade do serviço passa a
  // ser a do plano (quantidade manual), para o plano entrar inteiro. A planilha de venda não muda.
  if (args.includes('--orcamento-pelo-plano')) {
    const doPlano = new Map()
    for (const t of doc.tarefas) {
      const item = grupoDoDesktop.get(t.item_orcamentario_id)
      if (t.tipo_no !== 'tarefa' || !item || porId.get(t.item_orcamentario_id)?.indireto_id) continue
      doPlano.set(item, (doPlano.get(item) ?? 0) + Number(t.quantidade_alocada ?? 0))
    }
    const servicos = await q('item_orcamentario', (x) =>
      x.select('id, descricao, quantidade_referencia, unidade_referencia').eq('obra_id', obraId).eq('tipo', 'servico_grupo')
    )
    let ajustados = 0
    for (const g of servicos) {
      const noPlano = Math.round((doPlano.get(g.id) ?? 0) * 10000) / 10000
      if (!(noPlano > Number(g.quantidade_referencia) + 0.0005)) continue
      await q('item_orcamentario', (x) =>
        x.update({ qtd_ref_modo: 'manual', quantidade_referencia: noPlano }).eq('id', g.id).select('id')
      )
      ajustados++
      aviso(
        `orçamento: "${g.descricao}" passou de ${Number(g.quantidade_referencia)} para ${noPlano} ${g.unidade_referencia ?? ''} (quantidade do plano)`
      )
    }
    if (ajustados > 0) await rpc('recalcular_orcamento', { _obra_id: obraId })
    console.log(`orçamento ajustado pelo plano em ${ajustados} serviço(s)`)
  }

  const idsValidos = new Set()
  let semItem = 0
  let acima = 0
  let fora = 0
  let semFaixa = 0
  let indiretas = 0
  for (const t of [...doc.tarefas].sort((a, b) => a.nivel - b.nivel || a.ordem - b.ordem)) {
    const base = {
      id: t.id,
      planejamento_id: planoId,
      tipo_no: t.tipo_no,
      nivel: t.nivel,
      parent_id: idsValidos.has(t.parent_id) ? t.parent_id : null,
      ordem: t.ordem,
      nome_custom: t.nome_custom,
      notas: t.notas,
      codigo_eap: t.codigo_eap
    }
    if (t.tipo_no === 'grupo') {
      await q('planejamento_tarefa', (x) => x.insert(base).select('id'))
      idsValidos.add(t.id)
      continue
    }
    // tarefa e marco entram com o início fixado na data do desktop
    const ancora = { asap: false, inicio_em: t.data_inicio ? `${t.data_inicio}T07:00:00` : null }
    if (t.tipo_no === 'marco') {
      await q('planejamento_tarefa', (x) => x.insert({ ...base, ...ancora }).select('id'))
      idsValidos.add(t.id)
      continue
    }
    const item = grupoDoDesktop.get(t.item_orcamentario_id)
    const desktopItem = porId.get(t.item_orcamentario_id)
    const nomeTarefa = t.nome_custom ?? desktopItem?.descricao ?? t.id
    if (!item) {
      semItem++
      aviso(`tarefa "${nomeTarefa}" está sem serviço no web e não foi levada`)
      continue
    }
    // a tarefa do indireto tem configuração própria (periodicidade, receita, taxas) e entra pela função dela
    if (desktopItem?.indireto_id) {
      const ind = doc.tarefa_indiretos.find((x) => x.tarefa_id === t.id)
      try {
        await rpc('criar_tarefa_indireta', {
          p_planejamento_id: planoId,
          p_item_orcamentario_id: item,
          p_indireto_config: {
            distribuicao: 'continuo',
            custo_periodicidade: ind?.custo_periodicidade ?? 'mes',
            custo_unitario: ind?.custo_unitario ?? null,
            receita_modo: ind?.receita_modo ?? 'mesma_logica_custo',
            receita_unitaria: ind?.receita_unitaria ?? null,
            receita_percentual: ind?.receita_percentual ?? null,
            receita_extrapola: ind?.receita_extrapola ?? false,
            offset_dias_antes: ind?.offset_dias_antes ?? 0,
            offset_dias_depois: ind?.offset_dias_depois ?? 0,
            aplica_taxas: ind?.aplica_taxas ?? true,
            taxa_regime_id: doc.regimes.some((r) => r.id === ind?.taxa_regime_id) ? ind.taxa_regime_id : null
          },
          // a tarefa do indireto fica na raiz do plano (é assim que o web a cria)
          p_parent_id: null,
          p_nome_custom: t.nome_custom,
          p_ordem: t.ordem,
          p_notas: t.notas
        })
        indiretas++
      } catch (e) {
        aviso(`tarefa do indireto "${nomeTarefa}": ${e.message}`)
      }
      continue
    }
    const eqs = equipesDaTarefa.get(t.id) ?? []
    const nEquipes = Math.min(50, Math.max(1, eqs.reduce((s, e) => s + Number(e.qtd_equipes ?? 1), 0)))
    const tr = trechoWeb.get(t.trecho_id)
    const comprimento = Number(tr?.geometry_comprimento_m) || 0
    const comFaixa = comprimento > 0 && t.posicao_inicio_m != null && t.posicao_fim_m != null
    // no eixo o web pede a faixa: sem ela no desktop, a tarefa vale para o eixo inteiro
    if (comprimento > 0 && !comFaixa) semFaixa++
    const local = {
      tarefa_id: t.id,
      planejamento_id: planoId,
      ordem: 0,
      trecho_id: tr?.id ?? null,
      inicio_m: comprimento > 0 ? (comFaixa ? Number(t.posicao_inicio_m) : 0) : null,
      fim_m: comprimento > 0 ? (comFaixa ? Number(t.posicao_fim_m) : comprimento) : null,
      quantidade: Number(t.quantidade_alocada ?? 0),
      qtd_origem: 'manual'
    }
    try {
      await q('planejamento_tarefa', (x) =>
        x.insert({ ...base, ...ancora, item_orcamentario_id: item, qtd_equipes: nEquipes }).select('id')
      )
      try {
        await q('planejamento_tarefa_local', (x) => x.insert(local).select('id'))
      } catch (e) {
        // o web não deixa programar acima do orçado: a tarefa entra com o que o orçamento ainda comporta
        const resta = Number(/restam ([\d.]+)\)/.exec(e.message)?.[1])
        if (!(resta > 0) || resta < local.quantidade * 0.01) throw e
        await q('planejamento_tarefa_local', (x) => x.insert({ ...local, quantidade: resta }).select('id'))
        acima++
        aviso(`tarefa "${nomeTarefa}": ${local.quantidade} no desktop, ${resta} no web (é o que o orçamento comporta)`)
      }
      if (eqs.length > 0)
        await q('planejamento_tarefa_equipe', (x) =>
          x
            .insert(eqs.map((e) => ({ tarefa_id: t.id, equipe_id: e.equipe_id, qtd_equipes: e.qtd_equipes ?? 1 })))
            .select('tarefa_id')
        )
      idsValidos.add(t.id)
    } catch (e) {
      fora++
      aviso(`tarefa "${nomeTarefa}" (${local.quantidade}) não foi levada: ${e.message}`)
      await q('planejamento_tarefa', (x) => x.delete().eq('id', t.id).select('id')).catch(() => undefined)
    }
  }
  console.log(
    `plano "${plano.nome}": ${idsValidos.size + indiretas} de ${doc.tarefas.length} nós ` +
      `(${indiretas} do indireto, ${semFaixa} no eixo inteiro, ${acima} reduzidas ao orçado, ${fora + semItem} de fora)`
  )

  const calcular = async () => {
    const entrada = await carregarPlanoEntrada(planoId)
    const resultado = calcularPlano(entrada, MODELO).resultado
    const gravado = await rpc('planejamento_gravar_calculo', {
      _planejamento_id: planoId,
      _dados: payloadGravacao(entrada, resultado)
    })
    if (!gravado.ok) throw new Error('gravar cálculo: ' + JSON.stringify(gravado).slice(0, 400))
  }
  await calcular()
  // Equipe nomeada não trabalha em duas tarefas ao mesmo tempo no web, e o motor empurra a segunda. Onde o desktop
  // tinha a mesma equipe em tarefas simultâneas, vale a data do desktop: a tarefa fica só com o número de equipes.
  const inicioDesktop = new Map(doc.tarefas.filter((t) => t.tipo_no === 'tarefa').map((t) => [t.id, t.data_inicio]))
  for (let volta = 0; volta < 4; volta++) {
    const datas = await q('planejamento_tarefa', (t) =>
      t.select('id, inicio_em, nome_custom').eq('planejamento_id', planoId).eq('tipo_no', 'tarefa')
    )
    const empurradas = datas.filter(
      (t) => inicioDesktop.get(t.id) && String(t.inicio_em).slice(0, 10) !== inicioDesktop.get(t.id)
    )
    if (empurradas.length === 0) break
    const comEquipe = await q('planejamento_tarefa_equipe', (t) =>
      t.select('tarefa_id').in('tarefa_id', empurradas.map((t) => t.id))
    )
    if (comEquipe.length === 0) {
      for (const t of empurradas)
        aviso(`tarefa ${t.nome_custom ?? t.id}: início ${String(t.inicio_em).slice(0, 10)} no web, ${inicioDesktop.get(t.id)} no desktop`)
      break
    }
    await q('planejamento_tarefa_equipe', (t) =>
      t.delete().in('tarefa_id', empurradas.map((t) => t.id)).select('tarefa_id')
    )
    // o cálculo gravou o início empurrado: volta para a data do desktop antes de calcular de novo
    for (const t of empurradas)
      await q('planejamento_tarefa', (x) =>
        x.update({ inicio_em: `${inicioDesktop.get(t.id)}T07:00:00` }).eq('id', t.id).select('id')
      )
    aviso(`${empurradas.length} tarefa(s) ficaram sem a equipe nomeada: no desktop a mesma equipe está em tarefas simultâneas`)
    await calcular()
  }
  const promovido = await rpc('planejamento_promover', { _planejamento_id: planoId, _marcar_vigente: true })
  console.log('cronograma calculado e promovido a linha de base vigente', JSON.stringify(promovido).slice(0, 160))
}

// ── SIGA: vínculo da obra e de-para (só se a empresa tem o SIGA conectado) ───────────────────────────────────
const conectado = await q('integracao', (t) => t.select('id').eq('empresa_id', EMPRESA).eq('tipo', 'siga'))
if (doc.vinculo && conectado.length > 0) {
  await rpc('siga_vincular_obra', {
    _obra_id: obraId,
    _projeto_id: doc.vinculo.siga_projeto_id,
    _projeto_codigo: doc.vinculo.siga_projeto_codigo,
    _data_corte: doc.vinculo.data_corte,
    _traz_fotos: doc.vinculo.sincronizar_fotos ?? true
  })
  const cad = await fn('siga', { acao: 'cadastros', obra_id: obraId })
  const linhas = []
  // serviços: o que o desktop já tinha ligado, com o fator
  const jaTemPrincipal = new Set()
  for (const m of doc.match_servico) {
    const interno = grupoDoDesktop.get(m.item_orcamentario_id)
    if (!interno) aviso(`serviço do SIGA ${m.siga_servico_executado_id} "${m.siga_servico_nome}" ficou sem vínculo`)
    linhas.push({
      tipo: 'servico',
      externo_id: m.siga_servico_executado_id,
      externo_nome: m.siga_servico_nome ?? `Serviço ${m.siga_servico_executado_id}`,
      externo_unidade: m.siga_unidade_nome,
      interno_id: interno ?? null,
      fator_conversao: Number(m.fator_conversao ?? 1),
      principal: !!interno && !jaTemPrincipal.has(interno)
    })
    if (interno) jaTemPrincipal.add(interno)
  }
  for (const s of cad.servicos)
    if (FORA.has(s.id) && !linhas.some((l) => l.tipo === 'servico' && Number(l.externo_id) === s.id))
      linhas.push({ tipo: 'servico', externo_id: s.id, externo_nome: s.nome, externo_unidade: s.unidade, ignorado: true })
  // encarregados e equipes do projeto no SIGA: criados aqui já vinculados; a equipe que o desktop ligava a uma de
  // planejamento fica com essa
  for (const e of cad.encarregados)
    linhas.push({ tipo: 'encarregado', externo_id: e.id, externo_nome: e.nome, criar: true })
  const equipeDoDesktop = new Map(doc.match_equipe.map((m) => [chave(m.siga_equipe_nome), m.equipe_id]))
  for (const e of cad.equipes) {
    const interno = equipeDoDesktop.get(chave(e.nome))
    linhas.push({
      tipo: 'equipe',
      externo_id: e.id,
      externo_nome: e.nome,
      interno_id: interno && equipes.some((x) => x.id === interno) ? interno : null,
      criar: true,
      principal: true,
      dados: e.encarregado_id ? { encarregado_id: e.encarregado_id } : null
    })
  }
  // locais: pelo nome, ou pelo de-para informado na chamada
  const localPorNome = new Map(trechos.map((t) => [chave(t.nome), t.id]))
  for (const l of cad.locais) {
    const interno = localPorNome.get(chave(LOCAIS_EXTRA.get(l.nome) ?? l.nome))
    if (!interno) aviso(`trecho do SIGA "${l.nome}" ficou sem local (${l.lancamentos} lançamentos)`)
    linhas.push({ tipo: 'local', externo_id: l.id, externo_nome: l.nome, interno_id: interno ?? null })
  }
  const dp = await rpc('siga_de_para_salvar', { _obra_id: obraId, _linhas: linhas })
  console.log('SIGA: projeto', doc.vinculo.siga_projeto_codigo, '— de-para', JSON.stringify(dp))
  const sinc = await fn('siga', { acao: 'sincronizar', obra_id: obraId })
  console.log('SIGA: sincronização', JSON.stringify(sinc.resumo ?? sinc).slice(0, 300))
} else if (doc.vinculo) aviso('a empresa de destino não tem o SIGA conectado: o vínculo e os de-para não foram levados')

console.log(`\nobra ${doc.obra.codigo} no web local: ${obraId} — ${avisos.length} aviso(s)`)
process.exit(0)
